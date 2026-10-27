# MT5 终端连接诊断修复 · 2026-10-22

已在源码完成 `sesame/mt5` 2.1.10 → 2.1.11；未安装、热更新、提交或操作真实 MT5/Sesame。主任务由父 Agent 集成。

问题：连接代码把本机 MCP 端口拒绝直接判为终端未运行，并可能重复请求启动；目录发现也在没有进程证据时提示“等待 MT5 启动”。

修复：现有 `mt5_connect` 先按已配置终端完整路径检查 Windows 进程，再判断 MCP 与券商/账户。查询失败、不可读路径或不支持的平台保持未知。只有两次确认所选终端关闭，才允许现有恢复逻辑请求启动；运行中或未知不重复启动、不轮询等待错误的前提。已有正常交易入口和健康连接检查不增加此步骤。目录与主/官方/connection 提示词统一诊断顺序，缺失 token 先核对终端；明确 401 才按实际凭据问题处理。

现有能力 ID、输入/输出 schema、binding、effects、配置 requirements 均与备份一致；输出仅在现有可扩展结果中补充 `terminal_process` 证据。没有新增 Agent 工具、依赖或宿主接口。

验证：

- 初始 6 项回归全部失败，复现旧误判与缺失进程证据。
- MT5 包全部 JS 测试，加连接生命周期、MetaEditor、终端启动和配置凭据测试：140 项通过。
- 最后补充目录缺 token 分支并保留查询失败时间戳后，相关 23 项测试通过；其中新增回归共 15 项。
- Windows PowerShell 脚本使用替代 `Get-CimInstance` 数据实际执行，验证中文、单引号、美元符号路径按数据传递；没有读取真实终端/账户。
- 三个后端模块 `node --check`、MT5 范围 `git diff --check` 通过。
- `verify.mjs` 只读构造包清单，验证所有当前可选包的格式、引用和路径；比较本轮备份确认公开 schema 未变。

执行的测试命令（cwd `E:/brief2great/sesame/sesame`）：

```powershell
node --import ../mt5agent/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/packages/mt5/tests/*.test.js plugins/api-v1/tests/mt5-connection-lifecycle.test.js plugins/api-v1/tests/editor-connection.test.js plugins/optional-api-v1/tests/mt5-terminal-capability.test.mjs plugins/optional-api-v1/tests/mt5-configuration-credentials.test.mjs
node --import ../mt5agent/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/packages/mt5/tests/connection-diagnosis.test.js plugins/optional-api-v1/packages/mt5/tests/terminal-process.test.js plugins/api-v1/tests/mt5-connection-lifecycle.test.js plugins/api-v1/tests/editor-connection.test.js
```

交付：`before/` 为本轮 9 个原文件备份；`changes.patch` 为只包含本轮 12 个文件的补丁；`changes.json` 为前后哈希；`mt5.package-manifest.json` 为完整 2.1.11 包文件/摘要。已有工作区改动保留。没有改全局锁或 inventory，集成时需按当前包重建对应元数据。

更新需要完整 MT5 包，包括新增 `backend/terminal-process.js`、修改后的 `backend/connect.js` / `backend/official.js`、能力/提示词/接口文档、版本清单；仅替换提示词不会修复后端误判。按现有插件更新流程重新加载包即可，进程中的旧模块不会因源码文件改变自动变为新版。

验证限制：没有真实模型会话、实际 CIM 终端扫描或真实应用更新验收。非 Windows 进程状态为 unknown，会保留已有连接探测，但不再在未知状态自动尝试新开终端。
