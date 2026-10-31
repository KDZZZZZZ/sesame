# Ultra 插件生命周期交付（2026-10-25）

插件版本：1.0.2。修改仅在官方 Ultra 插件及相关测试；未构建、部署、重启或 commit。

## 已实现

- 新增 host/agent 均可调用的 `sesame/ultra#ultra_close({id?,reason?})`。关闭解除最大化并行与持续扩展的强制原则；普通模式仍可按用户需要使用 subagent 和工作流。
- `ultra_stop` 保持硬停止，可对关闭后保留的 Run/订阅执行明确取消。
- 持久 `sessions.continuation` 为 active/draining/closed。已有有限研究自然完成后内部关闭；无有限活动研究立即关闭；既有持续订阅不阻挡模式关闭，不执行领域 stop，不自动恢复暂停任务。closed 不冒称目标 completed。
- `ultra_status` 返回 enabled、continuation、active_work、accepted_work、queued_work；额外 guidance 仅供宿主模型上下文投影。beforeTurn 不修改可见消息内容。
- 关闭后 Ultra 不自动新建规划、补槽或派发新分支；已接受的 Run、订阅和原结果保留，迟到完成回执回到普通模式。
- owners.closeGeneration 持久栅栏覆盖首次 start 尚未写入 goal、已经 closed 后旧 resume 尚在等待两类竞态。普通新消息、子任务完成通知不会重新开启；明确 /ultra resume、/ultra 或明确自然语言开启可恢复。
- unchanged status 读取不重复写入 running/failed/interrupted 状态。
- prompt、planner、continuation 均明确：enabled=true 时有意义的最大化并行是强制原则；关闭后解除该强制，不禁用正常按需协作。

## 验证

最终 55 项定向测试全部通过，包含插件生命周期、并发关闭、迟到回调、持久重载、原研究保留、重开权限、宿主 schema/native binding、真实 lifecycle 和命令顺序契约。

命令：

`SESAME_HOST_ROOT=E:/brief2great/sesame/mt5agent node --test plugins/api-v1/packages/ultra/tests/*.test.js plugins/api-v1/tests/ultra-host-contract.test.mjs plugins/api-v1/tests/ultra-lifecycle-contract.test.mjs plugins/api-v1/tests/ultra-command-ordering.test.mjs`

证据：`ultra-plugin-tests.log`。JS syntax check 与 git diff --check 通过。独立只读 reviewer 已复核最初两个关闭竞态、可见消息污染和状态重复写入修复，无新增阻断。

测试使用隔离夹具和真实宿主能力契约；未发送真实研究请求，未接触运行中 Sesame 的账户、密钥或任务。

## 修改文件

- plugins/api-v1/packages/ultra/src/state.js
- plugins/api-v1/packages/ultra/src/runtime.js
- plugins/api-v1/packages/ultra/src/planning.js
- plugins/api-v1/packages/ultra/index.js
- plugins/api-v1/packages/ultra/capabilities.json
- plugins/api-v1/packages/ultra/plugin.json
- plugins/api-v1/packages/ultra/package.json
- plugins/api-v1/packages/ultra/README.md
- plugins/api-v1/packages/ultra/prompt.md
- plugins/api-v1/packages/ultra/tests/ultra.test.js
- plugins/api-v1/packages/ultra/tests/close.test.js（新）
- plugins/api-v1/tests/ultra-host-contract.test.mjs

修改前文件已保存在 baseline/sesame 对应路径，没有覆盖已有 baseline。
