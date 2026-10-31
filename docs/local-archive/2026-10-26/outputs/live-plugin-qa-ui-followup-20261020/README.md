# 宿主文件一次性维护

仅准备，尚未执行。root 负责最后构建并冻结本目录 `plan.json`；本任务没有创建或复制计划。没有连接真实桌面、打开数据库、修改配置或运行任何维护 phase。

本目录从 `live-plugin-qa-final-fixes-retry-20261020` 的最新脚本复制并作小范围适配：

- 计划必须显式为 `mode: "host-files-only"`、`plugins: []`。保留原 `profile`、`workspace` 和 `files: [{ path, before, after }]` 格式与逐文件 SHA256 核验。
- 移除插件包验证和插件管理写入。`verify-plugins` 仅使用现有只读 GET 保存 `plugins-verified.json`，结构仍为 `{ at, operations: [], state, desktop }`。没有 `update-plugins` phase 或 `/plugins/manage` 请求。
- 插件目录按 `id` 比较，每个版本、digest、state、runtime_status、dependency_lock 字段仍严格相等；模型和主会话也要保持一致。
- 当前桌面固定为 PID `42412`，执行文件和既有配置/工作区路径保持原值。关闭证据读取 retry 目录 `resume-launch.json` 及 `resume-desktop.stdout.log` / `resume-desktop.stderr.log` 的新增部分摘要，不复制日志正文。
- 启动使用 PowerShell 7.4 的显式 `Start-Process -Environment`，将 `ELECTRON_RUN_AS_NODE` 设为 `$null`，同时指定原 profile/workspace/pi。Node helper 取 `Get-Command ... | Select-Object -First 1`，避免命令数组。

## 守卫和保留

运行时顺序：`capture` → `verify-plugins` → 相邻两次 `pre-close` 主 WAL 空闲检查 → 正常关闭 → `stopped` 备份 → 只复制冻结清单文件 → 启动 → `verify`。

主 WAL 只读检查活动回复、待处理消息、Run/task、通知、投递、入站和控制消息。有任意待处理工作就停止，应用保持打开，不取消或恢复任务。

仅接受 9 秒以内正常退出、主进程退出码 0、所有 Sesame 进程消失及明确排除产品 10 秒 worker kill fallback 的证据。脚本不强杀；退出超时、日志异常或状态变化就停止，不进入复制。脚本不能阻止应用自身原有的退出超时行为，超时后需审阅实际退出证据。

新数据库备份目录：

`%LOCAL_USER_PROFILE%

该目录只在执行且确认全局空闲后创建。主库用 SQLite backup；子库仅在所有进程退出后打开并备份。应用原文件保存到本目录 `previous-files/`，既有前端 assets 保留。

报告、历史主消息、全部 Run、暂停关联、暂停任务业务字段、插件、配置/密钥和 pi 文件保持原校验。启动只允许暂停任务发生一次原有的 `version + 1` 与有效 `updated_at` 元数据变更，其他字段完整哈希不变。保留现有 6 个历史暂停任务、55 个 ready 插件的验收。

相邻空闲快照不能消除新请求进入到关闭之间的时间窗口；没有私有 UpdateGate 预留或 admission isolation。收据继续如实记录为 false。停机后发现保护数据变化时不部署。

## 离线验证

- `pure-tests.log`：10/10 通过；无需真实计划、插件包、桌面或数据库。覆盖明确模式/空插件数组、目录重排、逐字段保留、活动工作拒绝、暂停任务关联及启动元数据边界。
- `powershell-check.log`：AST 语法、模式守卫、路径规范化、当前日志/PID、显式启动环境、4 个 fallback 判断、2 个全 mock 正常关闭场景通过。`phasesRun/desktopConnections/databasesOpened/realProcessesTouched` 均为 0。
- Node syntax、目标 oxlint 通过；`lint.log` 空输出，退出 0。
- `harness-validation.json` 保存最终脚本 SHA256 和验证摘要。

## root 冻结计划后的调用方式

在本轮桌面业务结束并确认全局空闲后，仅执行一次：

```powershell
pwsh.exe -NoProfile -NonInteractive -File E:\brief2great\sesame\outputs\live-plugin-qa-ui-followup-20261020\restart.ps1
```

维护脚本会再次验证空闲。已有 attempt、phase 日志、备份或回执不会被覆盖。失败时保留证据后停止；不要原地重复运行、自动回滚或重放更新。
