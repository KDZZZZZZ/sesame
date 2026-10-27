# Sesame 配置恢复与权限简化验收

验收时间：2026-10-24。结论：原来的 `Local authorization is required for workspace.messages.read` 阻断已修复。当前真实模型已自行完成 MT5 安全配置导入，并验证 Terminal MCP 连接与认证成功。

## 行为调整

- 已启用插件声明的本地配置、插件管理、进程执行、消息读取和能力组合权限默认可用，无需再逐项人工授权；没有新增授权记录或第二套授权接口。
- 用户保存过的权限选择继续生效，插件升级保留选择。外部渠道以用户身份发消息仍使用已绑定的来源授权。
- 配置请求的提示词要求 Agent 完成发现、启用、保存、可执行的恢复和连接验证，复用已有配置和安全引用，减少重复索取密钥及让用户操作的情况。
- MT5 导入使用当前消息投影字段，修正来源识别；仍保留会话归属和密钥隔离。
- 修复配置已成功但公开回执状态被误脱敏为 `[redacted]` 的问题。补全返回 schema，未关闭统一脱敏，也未新增 API。
- 权限设置页、插件脚手架和契约文档同步新默认行为。

## 实测结果

| 检查 | 结果 |
|---|---|
| 权限、撤销、升级保留、提示词及消息读取回归 | 40/40 通过 |
| MT5 导入和配置集成回归 | 14/14 通过 |
| 权限设置页交互 | 通过；此项为隔离页面及模拟 HTTP |
| 前端 TypeScript 与构建 | 通过 |
| 前端 lint | 无错误；保留已有 Fast Refresh 导出警告 |
| 修改文件差异检查 | 通过 |
| 当前应用真实模型 | `mt5_settings` → `mt5_import_configuration` → `mt5_connect`，全部完成 |
| 配置导入 | 已保存，版本更新为 3 |
| Terminal MCP | 连接、认证通过 |
| 目标账户验收 | 返回 `mt5_account_mismatch`，终端登录 FTMO-Demo，已保存目标为 FundingPips-Trial |

测试明确要求保留当前账户，故没有切换账户、下单或启动策略。账户不一致是本轮连接核验的实际结果，不能宣称目标账户已连通。集成测试使用模拟模型/MCP；真实模型结论仅来自当前应用的这一次实际执行。

## 部署与数据保留

- 当前进程 PID：12368。
- 应用：`E:/brief2great/sesame/mt5agent/output/desktop-latest-20261023-q3GwQF/package/win-unpacked/Sesame.exe`。
- 沿用当前打开应用实际使用的数据根目录：`E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z`；未改用旧 Roaming 工作区。
- 已正常关闭旧进程，在同一程序目录部署修正后的宿主文件和前端构建，再沿用原环境启动。
- 通过正式插件管理接口测试并更新 MT5 **2.2.1**、Plugin Manager **3.1.1**，均为 `mounted / ready`。
- 原有 12 条消息、Run 状态和模型配置哈希均保留；测试追加一问一答。结束时无活动回复或待处理消息。
- 数据库备份：`E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z/workspace/backups/config-permissions-20261023/before.sqlite`。
- 当前窗口保持打开，页面为 `http://127.0.0.1:5850/`。

## 修改范围和证据

核心代码：`modules/plugins/plugin-authority.js`、`modules/agent/host-prompt.js`、权限设置组件、MT5 `backend/config-import.js` / `capabilities.json` / `prompt.md`、Plugin Manager `scaffold.js`，以及配套测试、文档和版本声明。

本轮复用了现有权限及消息接口，去掉本地能力的额外人工授权前置条件和升级后重复授权要求，没有增加依赖。

- [本轮精确差异](changes.patch)
- [22 个文件的修改索引及前后哈希](change-index.json)
- [最终应用核验](final-verification.json)
- [真实模型执行结果](real-model-check.json)
- [桌面截图](final-desktop.png)
- [权限回归日志](permissions-recheck.log)
- [MT5 回归日志](mt5-recheck.log)

仓库原先已有大量未提交的架构改动；本轮没有将它们混入提交，已按执行前快照保存精确差异及前后文件。未运行整个仓库的全量测试。截图中聊天表格在当前布局下存在横向溢出，未将其列为本次权限修复已解决的问题。
