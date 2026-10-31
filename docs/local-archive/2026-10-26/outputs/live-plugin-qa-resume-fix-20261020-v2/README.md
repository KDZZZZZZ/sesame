# 恢复作用域和前端说明颜色修复：空闲重启

本目录的重启流程尚未执行。已通过 PowerShell/Node 语法检查、4 个源码摘要核对及只读 `check`；没有创建正式回执或备份，没有打开子数据库。由主负责人评审后运行：

```powershell
pwsh -NoProfile -File E:\brief2great\sesame\outputs\live-plugin-qa-resume-fix-20261020-v2\restart.ps1
```

只更新下面 4 个已经评审、测试和构建过的文件。脚本固定各自源码 SHA-256；任何源码变化都会拒绝执行。使用原 `win32-x64-agent-messages-20261020/win-unpacked/Sesame.exe`、Roaming/Sesame 配置及其 workspace。桌面正常显示，所有 Node 辅助进程隐藏启动。

| 文件 | 准备时的目标状态 |
| --- | --- |
| `modules/agent/plugin-agent-tasks.js` | 已存在，替换前备份 |
| `modules/frontend/dist/_app/index-CPDeqbBR.js` | 新增，`before: null` |
| `modules/frontend/dist/_app/index-DvEfgOOa.css` | 新增，`before: null` |
| `modules/frontend/dist/index.html` | 已存在，替换前备份；最后更新 |

保留全部旧前端资源，不更新任何插件包。主负责人在运行前通过管理接口完成的 CCXT 更新会成为本次动态基线，脚本不要求旧插件摘要。

执行顺序：

1. 仅打开主 `app.sqlite` 的 `readOnly: true` 连接，启用 `query_only`，并只读断言现有 `journal_mode` 已是 WAL；不切换日志模式。检查全部会话活动、队列数量、主库 queued/streaming 回复、活动 Run、排队 Agent、未投递通知、尚未开始的 delivery 和可重放 ingress。可唤醒 Agent 的待投递 Run message 也会阻止重启；Runtime 忽略的 workflow message、没有执行会话的消息，以及目标已 `completed/cancelled/unknown` 的控制消息不算待唤醒工作。终态消息启动时只会由 Runtime 确认收讫，不会调用 `accept`。
2. 空闲后通过现有桌面同源 GET 核对 55 个启用插件全部 ready、模型已认证、输入框无未发送草稿，保存主库 SQLite 备份及元数据摘要。再次仅用主库确认空闲和保护记录未变，立即 `CloseMainWindow`，等所有 Sesame 进程退出；不强杀。
3. 进程全部退出后才读取、备份并验证子 SQLite，备份暂停任务的非数据库输入和 JSONL。备份目录固定为 `Roaming/Sesame/workspace-backups/live-plugin-qa-resume-fix-20261020-v2`。保存已存在的旧目标文件及摘要，新增资源记为 `before: null`；更新固定的 4 文件白名单。
4. 启动普通桌面。只用主 WAL、暂停任务非数据库文件摘要及只读 GET 验证：插件版本/摘要/策略不变且 55 ready、模型和认证不变、6 条历史暂停及基线时本轮仍暂停的 Run/输入/版本锁不变、已完成主消息不变、4 文件摘要正确，界面加载新 JS/CSS。通知记录保持原摘要；唯一允许的变化是上述终态控制消息被 Runtime 写入固定的“终态不再执行”错误、投递时间和版本恰好 +1，正文/来源/目标摘要及目标 Run 仍不变。基线时已经由 Agent 正常取消的任务不计入暂停保护集，不会恢复。启动后绝不打开子 SQLite。

`before.json`、`stopped.json`、`deployment.json`、`launch.json` 和 `verified.json` 分别是对应阶段的独立回执。现有回执、备份或日志不会被覆盖。第一次空闲检查失败只留下唯一命名的日志，不会关闭桌面或消耗正式执行回执；进入正式流程后任何失败都会停止，保留现场，不自动回滚、重试或重复启动。

脚本不写数据库、不改配置/模型/插件、不发送消息、不调用 resume、不处理研究业务。它不新增产品维护接口；两次空闲检查之间或正常关闭前若有新工作会拒绝继续。二次检查到窗口关闭仍存在普通外部操作的短竞态窗口，执行期间请勿另行派发任务。

子 SQLite 的内容核验只在停机阶段成立；启动后的回执明确记录 `childDatabasesOpenedAfterLaunch: 0`，不声称重新读取过运行中的子库。认证文件仅计算摘要，不记录内容。
