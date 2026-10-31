# 报告完整静态导出修复：一次性空闲部署

本目录仅准备维护工具，尚未执行部署，也没有运行读取工作区的 `check`。准备阶段只检查 Node/PowerShell 语法、固定文件白名单及源码 SHA-256；不关闭窗口，不启动程序，不读取活动子 SQLite，不调用业务能力。

主负责人确认当前任务完成后，可以先执行只读空闲检查：

```powershell
node E:\brief2great\sesame\outputs\live-plugin-qa-export-fix-20261020\evidence.mjs check
```

真正部署使用下面的一次性入口，它会重新检查空闲，不依赖上一次检查结果：

```powershell
pwsh -NoProfile -File E:\brief2great\sesame\outputs\live-plugin-qa-export-fix-20261020\restart.ps1
```

仅替换已经评审并通过回归的 `modules/agent/report-export-renderer.js`。固定源码 SHA-256 为 `8131133dfa642e0c176443da52d94dcfcba7e11292bc4298f93fe384ad0575a0`；源码变化、目标文件不存在、已经部署同一版本都会拒绝继续。不会更新插件、前端资源或其他应用文件。

继续使用以下现有路径：

| 用途 | 路径 |
| --- | --- |
| 程序 | `E:/brief2great/sesame/mt5agent/release/win32-x64-agent-messages-20261020/win-unpacked/Sesame.exe` |
| 配置 | `%LOCAL_USER_PROFILE% |
| 工作区 | `%LOCAL_USER_PROFILE% |
| 独立数据库和暂停任务备份 | `%LOCAL_USER_PROFILE% |
| 原应用文件备份 | 本目录 `previous-application-files/modules/agent/report-export-renderer.js` |

执行顺序与保留校验：

1. 只用主 `app.sqlite` 的只读连接确认现有 WAL 模式，检查全部会话活动、待处理计数、queued/streaming 回复、queued/running/interrupting/cancelling Run 与 Agent 任务、未投递通知、未开始 delivery、未完成 ingress，以及能唤醒 Agent 的待投递 Run message。任一存在就拒绝重启。第一次检查失败只留下唯一命名的日志，不生成正式回执、备份或关闭窗口。
2. 通过当前桌面同源只读 GET 核对 55 个启用插件全部 ready、模型已认证、主会话空闲、输入框没有未发送草稿。保存主库 SQLite 备份以及历史、报告、插件、配置、暂停 Run、输入和版本锁的摘要基线。再用主 WAL 核对空闲和保留项，随后正常 `CloseMainWindow`，等待全部 Sesame 进程退出；不强杀。
3. 只有全部进程退出后才打开和备份子 SQLite，并核对实体/事件内容摘要；同时备份暂停任务的非数据库输入和 JSONL。确认源文件和原安装文件未变，保存原应用文件并验证摘要，再替换白名单中的唯一文件。
4. 启动原普通桌面，明确沿用同一配置目录、工作区及 pi 目录。等待调试端点和普通页面最多 120 秒，再等待输入框最多 15 秒。Node 辅助进程隐藏启动；桌面正常显示并保留打开。主进程检查以短间隔运行，部署工具可异步观察，不靠反复启动处理慢启动。
5. 只通过主 WAL、非数据库文件摘要和只读 GET 核验：插件版本、摘要、策略和模型/认证不变；前端资源列表与重启前一致；6 条历史暂停及基线时本轮所有暂停 Run、关联会话、输入、版本锁和进程库关联不变；全部已有主消息、报告及配置等保护记录不变；原文件备份和已安装导出器摘要正确。启动后不打开子 SQLite。

通知记录默认要求原摘要不变。唯一允许的正常启动变化是：目标已 `completed/cancelled/unknown` 的 Agent 控制消息，被 Runtime 写入固定的“终态不再执行”结果、投递时间和恰好增加一次的版本；正文、来源、目标及目标 Run 摘要仍须不变。这类消息不会调用 `accept` 或启动模型。其他可唤醒消息阻止部署。基线前已经由 Agent 正常取消的任务不计入暂停集，也不会被恢复。

`attempt.json`、`before.json`、`stopped.json`、`deployment.json`、`launch.json`、`verified.json` 依次记录阶段证据。只有最终出现 `verified.json` 和 `status: verified` 才算完成。现有备份、回执和日志不会覆盖；正式流程失败会记录阶段并停止，不自动重试、回滚、强杀或再次启动。检查失败后应按回执处理现场，不能直接重复正式入口。

工具不导入应用 Store/Runtime，不写工作区数据库，不改配置，不发消息、不调用 resume、不执行研究或交易。正常桌面启动仍执行应用原有启动流程，保留检查会拒绝异常变化。继承的 v2 修正包括 SQLite 行转普通对象后比较、`Get-Command node` 只选第一个 Application，以及完整的桌面启动等待。

空闲检查与关闭窗口之间没有宿主原子维护锁，仍有外部新任务进入的短竞态窗口；部署期间不要另行派发任务。子库内容验证仅发生在停机阶段，最终回执明确记录 `childDatabasesOpenedAfterLaunch: 0`。认证文件只记录摘要，不记录内容。
