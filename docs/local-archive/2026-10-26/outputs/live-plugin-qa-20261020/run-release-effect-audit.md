# W1 Run 收尾超时：一次只读核查

核查日期：2026-10-20。主库状态采样于 16:12:30Z，归档文件元数据核对于 16:15:14Z。

## 结论

**已证实是 MT5 原生证据归档触发 `protectArtifacts` 的 10 秒截止保护；没有证据表明报告 v2 丢失、报告检查失败或原生交易仍在执行。** 该保护按当前实现正确阻止了后续删除与“Run 已完成”通知。但这次约 16.68 MiB、32 个文件的归档低于现有数量和字节上限，因此也不能把它描述成用户提供了非法或超大输入。它暴露的是合法证据规模下的收尾耗时限制。

具体卡点已定位到 `sesame/mt5` 的 `resources.publish`。现有证据不足以进一步把耗时归因于磁盘、杀毒软件、schema Worker、资源持久化、共享资源队列或最终 blob 校验中的某一项。未做隔离性能复现，不能宣称已证明某个性能实现缺陷，更不能据此扩大截止时间。

16:04:43 的错误是再次排队后约 0.4 秒重报**先前**清理失败；并非第二次执行归档又等待了 10 秒。内部 `cleanup_attempts` 始终为 1。重复恢复这个 Run 不能被当成已证明有效的清理恢复办法。

## 实际证据

目标：

- Host Run：`run_8bb61145-74fb-4a2b-a075-0963ef0ab5c0`
- 会话：`conv_066773c0-bac9-49ec-ae2b-bba1dfd3a1b6`
- 工作区生命周期 task_run：`run_7717ff3f-b0ba-4ec2-9e43-e5d782b0cb0f`
- 已交付报告：`rep_f9452d8f-6deb-4fc3-9e10-67d92b8c44e8`，`reports/QA20261020-策略与工作流验收.html`，v2。报告检查和 UI 通过证据见同目录 `strategy-report-render-audit.md` 以及根助手实际 UI 验收；本次没有重做报告验收。

所有数据库查询仅打开主 `workspace/app.sqlite`，使用 `readOnly:true`、`PRAGMA query_only=ON`，并确认 `journal_mode=wal`。

| 时间（UTC） | 证据 | 含义 |
| --- | --- | --- |
| 16:02:25.804 | W1 本轮 JSONL 最后一条 assistant，`stopReason=stop`，无新工具调用 | 模型正文已经结束 |
| 16:02:26.589–16:02:36.100 | 主 WAL 的 46 条 MT5 `host.resources.changed` 事件 | 32 个文件、14 个目录逐一形成；首末事件相隔 9511 ms |
| 16:02:36.327 | `task.updated` seq 149487；当前 task_run 同时刻的失败状态 | `cleanup_failed` / `task_cleanup_timeout`，`cleanup_attempts=1` |
| 16:02:36.539 | `plugin.host_call.failed` seq 149498 | `pluginId=sesame/mt5`，`operation=resources.publish`，`code=task_cleanup_timeout` |
| 16:02:36.541 | `plugin.lifecycle` seq 149499 | MT5 `beforeRunRelease` 被取消，同一超时代码 |
| 16:02:36.392 | `run.updated` seq 149495 | Host Run 已进入 `interrupted`，外层错误 `RUN_RELEASE_FAILED` |
| 16:04:43.412–16:04:43.818 | `run.updated` seq 149838、149839、149848、149849 | 再次 queued/running 后重报旧错误；task_run 未增加清理次数 |

16:12:30Z 主库状态：

- Host Run：`interrupted`，`completedAt=null`；错误为 `RUN_RELEASE_FAILED`，内容为 `Task cleanup phase protectArtifacts exceeded 10000 ms; unfinished work and evidence are retained for recovery.`
- task_run：业务状态 `succeeded`，清理状态 `cleanup_failed`，`finish_requested=true`，`cleanup_attempts=1`，`updated_at=16:02:36.327Z`，没有最终封存 artifact 字段。
- 会话：`waiting`，`active_response_message_id=null`，`pending_message_count=0`。
- `next_cleanup_at=16:03:06.327Z` 是候选重试时间，不代表清理一定会发生：`finish()` 明确跳过暂停的 Run。
- 对应任务目录仍存在。只列出目录元数据；没有打开其中 `runtime.sqlite`。

已创建的 MT5 durable 归档资源仍在，逐个用文件 stat 核对长度与主库元数据一致；没有读取业务文件正文：

| 指标 | 结果 |
| --- | --- |
| 文件 / 目录 | 32 / 14 |
| 实际文件总字节 | 17,484,642（约 16.68 MiB） |
| 其中 dataset 文件字节 | 17,335,761 |
| 最大单文件 | 1,991,801 字节 |
| 当前发布上限 | 32 MiB，最多 256 个 blob |
| 是否找到本 Run 的 `sesame.mt5.native-task/1` 固定归档 | 未找到；已创建资源不等于已完成发布 |

这些计数仅覆盖本次 46 个新资源，不包括工作区总证据量，也不把相邻事件时间当作每个内部步骤的精确执行耗时。

## 实现解释及版本边界

1. [task-cleanup-service.js:20](/E:/brief2great/sesame/mt5agent/modules/agent/task-cleanup-service.js:20) 为阶段设置默认 10000 ms 截止、AbortSignal 及未完成阶段去重。`protectArtifacts` 在第 124 行，之后才是宿主封存、删除临时实体及目录。第 177–181 行保留错误和重试信息。
2. [plugin-registry.js:374](/E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:374) 将旧阶段名 `protectArtifacts` 映射成插件 `beforeRunRelease`，依次调用各插件。传给 MT5 的 `runId` 是真实 Host Run，另有独立 `workspaceRunId`；本例没有把两种 ID 混用的证据。
3. [MT5 plugin-runtime.js:59](/E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/plugin-runtime.js:59) 先 `protectRun`，成功后才 `cleanupRun`。本例失败在保护阶段的发布操作，尚未进入这个钩子的 MT5 删除分支。
4. [MT5 lifecycle.js:26](/E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/lifecycle.js:26) 等待所属原生作业结算，收集 build、backtest、pass 和 dataset；dataset 按 10000 行分片；发布成功后才写 `sealed_run`。
5. [MT5 resource-io.js:20](/E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/mt5/backend/resource-io.js:20) 按目录、文件顺序 `await resources.create`，最后一次 `resources.publish`。已存在的内容没有直接跳过这条完整归档路径。
6. [host-v2 resources.js:432](/E:/brief2great/sesame/mt5agent/modules/plugins/host-v2/resources.js:432) 发布时校验 schema、逐个读取与固定 blob，在事务中完成 artifact 和资源收据；每个边界检查取消信号。超时不等于已经发布。
7. [host-v2 execution.js:126](/E:/brief2great/sesame/mt5agent/modules/plugins/host-v2/execution.js:126) 即使内部 Agent 已 completed，也要求工作区 `cleanup_state=cleaned`，否则返回 `RUN_RELEASE_FAILED`。因此业务完成、报告已发布与 Run 完成是三个不同状态。
8. [runtime.js:159](/E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:159) 与 `TaskCleanupService.finish()` 的暂停检查使清理定时器不会擅自恢复暂停任务。它解释了为何 `next_cleanup_at` 到期后 `cleanup_attempts` 仍为 1。

安装记录：MT5 **2.1.4**，digest `sha256:ea8101b23c7a7ac8664637deb92ae6c46b53de221d6a0b29660d6410b36880f0`。核对了该安装目录内的 `backend/plugin-runtime.js`、`backend/lifecycle.js`、`backend/resource-io.js`，三者与所读源码 SHA256 相同。宿主四个相关文件 `task-cleanup-service.js`、`plugin-registry.js`、`host-v2/execution.js`、`host-v2/resources.js` 也与当前桌面已安装文件 SHA256 相同；没有仅凭本地版本号推断运行版本。

## 已有测试覆盖与缺口

本次只审阅测试，没有运行或修改测试。

- [task-resource-lifecycle.test.js:59](/E:/brief2great/sesame/mt5agent/tests/task-resource-lifecycle.test.js:59)：悬挂 `beforeRunRelease` / `beforeTaskCleanup` 被有界中断，证据保留，未结算钩子不重复执行，迟到结果可复用。
- 同文件另有迟到 rejection、不产生未处理拒绝、同服务阻止重叠和不同 Run 正常并行用例。
- [agent-completion-notification.test.js:149](/E:/brief2great/sesame/mt5agent/tests/agent-completion-notification.test.js:149)：收尾失败不能通知为成功；外层 `RUN_RELEASE_FAILED`，内部 `cleanup_failed`。
- [mt5-plugin-lifecycle.test.js:102](/E:/brief2great/sesame/mt5agent/tests/mt5-plugin-lifecycle.test.js:102)：保护 sources/results、保留精确 EX5、正常清理和幂等封存；数据 fixture 只有一行 equity，直接调用保护函数，不能证明本次 32 文件/16.68 MiB 在默认 10 秒阶段内完成。
- 当前证据未覆盖：真实规模归档的耗时分解、公共恢复路径是否能在不重跑模型/业务的条件下重新进入仅清理阶段。16:04 的恢复实际没有做到这一点；这里只记录限制，不在现场尝试更多恢复操作。

## 只提出的最小后续方向

保留 10 秒截止、取消、封存后才删除和失败保留现场的语义，不用“忽略归档错误”令 Run 假完成。最小安全的下一步是给已有释放钩子记录当前插件/操作、文件数、字节数和已用时间，再用独立 32 文件、约 17.5 MB fixture 分辨串行资源创建与最终发布各占多少时间。现有日志已足够定位 MT5，但不足以安全选择具体性能改动。

只有测出重复固定同一份证据是主要成本后，再评估 MT5 内部复用已验证的固定证据或提前完成分片封存，保持最终归档清单与验证完整。这是待验证优化建议，不是本次已实施修复，也不建议直接并行化当前全局资源写队列。

本次到此停止：未修改产品、配置、报告或业务文件，未打开子 SQLite，未发 API/模型请求，未重试/恢复/取消 Run，未执行维护或清理。
