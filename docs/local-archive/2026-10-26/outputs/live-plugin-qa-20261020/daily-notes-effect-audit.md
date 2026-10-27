# qa/notes-20261020 实际效果核验

结论：本次限定的 7 项生命周期验收均为 **pass**，另 2 项配置入口和只写字段展示检查为 **pass**。依据真实工具结果、原文件逐字节哈希、UI 元数据及主库状态；不以 `completed` 或 `ready` 作为业务成功证据。

工具结果时窗为 2026-10-20 15:28–15:36 UTC。完整调用 ID、时间和脱敏白名单见 [daily-notes-effect-audit.json](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-notes-effect-audit.json)；提取器为 [daily-notes-effect-audit.mjs](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-notes-effect-audit.mjs)。

| 验收项 | 结果 | 实际证据（UTC） |
| --- | --- | --- |
| 未配置时拦截 | pass | 15:31:44 两项依赖均为 `CONFIGURATION_MISSING`；15:32:03 的真实 `notes_query` 返回错误且没有查询结果。 |
| 配置后中文行和文件哈希 | pass | 15:32:36 返回 `qa-notes-v1`，第 1 行为“QA20261020 中文只读笔记”；独立读取该 QA 文件的 109 字节，逐行及 SHA-256 均与回执一致。 |
| 禁用后能力消失 | pass | 15:32:48 状态为 disabled、loaded=false；15:33:01 后续能力目录实际返回 0 项。 |
| 启用后能力及执行恢复 | pass | 15:33:16 mounted、loaded=true；15:33:32 目录恢复该能力，同批真实查询返回正确中文行及相同文件哈希。 |
| 更新 0.1.1 使用新实现并保留挂载 | pass | 15:33:52 更新为 0.1.1，仍 mounted、loaded=true；15:34:06 新查询实际返回 `qa-notes-v2`，不是仅版本元数据变化。正确中文行、文件哈希保持；marker 摘要改变，随后 inspect 确认新 digest 与挂载。 |
| 清空字段后再次阻断 | pass | 15:34:50 两项依赖重新变为 `CONFIGURATION_MISSING`，真实查询被拒绝且没有查询结果。 |
| 卸载后能力消失 | pass | 15:35:01 返回 uninstalled；15:35:16 能力目录为 0 项。主 WAL 中 installation 为 removed=1，主会话未挂载，两字段均为 JSON null。 |
| 统一配置入口与能力绑定 | pass | 15:31:19 catalog 中普通字段及 writeOnly 字段都指向 `qa/notes-20261020#notes_query`，UI 中对应依赖说明可见。 |
| 已检查界面的只写字段不回显 | pass | 15:34:01 的 UI 证据显示 token 输入为 password、hasValue=false，提示留空保留密钥；配置读取只有 name/configured/source。成功查询不返回 token 字段。保留源码将该字段用于 HMAC，并把实现版本、文件哈希等纳入标记。 |

文件 SHA-256 为 `1ccb22f73fa0c5ba1609983b55b8f2e7a7f82ba47e295352d89fc449a3718eee`。三次成功查询的返回行均与原文件相应行完全相同，哈希全部相符。0.1.0 包 digest 为 `0ec05b1df47d41c2578c9d366e6976a40a12fae0265b3ebe9214b0d2e942a825`；0.1.1 为 `7b9a767f280a295522566fe594aebf51b96d29903e47fd3ea4217acc9bb1cd94`。

UI 依据为 [配置界面元数据](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-notes-configuration-ui.json) 及已保存的 [截图](E:/brief2great/sesame/outputs/live-plugin-qa-20261020/daily-notes-configuration-ui.png)。本次没有操控界面。

卸载后 `configuration_read` 仍列出 `QA20261020_NOTES_LABEL` 和 `QA20261020_NOTES_TEST_TOKEN` 的名字，二者 `configured=false`。本次只通过 SQL `json_type` 核对保存状态，结果均为 `"null"`，没有读取字段值。这些是明确清空的记录，不是残留 secret value；安装记录的 removed 标记及历史包也属于审计保留。配置实现以保存的 null 覆盖环境回退，并删除进程环境中的对应值，见 [configuration-service.js](E:/brief2great/sesame/mt5agent/modules/agent/configuration-service.js:28)。

边界：没有读取密钥做 HMAC 独立复算；因此只确认实际查询生成标记、实现消费只写字段的代码路径和已检查界面不回显。仅覆盖一个合成中文文件的正常查询，未核验恶意路径、超大文件、异常输入、卸载后重装复用数据，也不据此宣称所有 workspace 或 plugin-manager 能力通过。未发现需要继续修复的问题。

取证只读主 WAL（readOnly/query_only），活跃子库读取 0，助手配置写入参数解析 0，业务/API/模型请求 0，未修改产品、配置或工作区数据。
