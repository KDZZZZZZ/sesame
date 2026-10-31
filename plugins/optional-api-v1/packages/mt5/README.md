# MetaTrader 5

本插件提供 MT5 行情、账户、MQL5 工程、编译、Tester、交易与持久运行观察。能力及输入输出由 `capabilities.json` 明确声明；完整用法见 [INTERFACES.md](INTERFACES.md)。Agent 可以直接保存连接配置和用户提供的凭据，无需导入文件、打开 Sesame 设置页或重启应用。

## 配置与对应能力

| 配置 | 什么时候需要 | 如何设置和验证 |
| --- | --- | --- |
| `servers.terminal.url/enabled/token` | MT5 Terminal MCP 行情、账户、原生方法和交易 | 主 Agent 用 `mt5_update_configuration` 保存；`mt5_connect` 核验连接及精确账户 |
| `servers.metaeditor.url/enabled/token` | MetaEditor MCP 编辑、编译 | 同一配置能力保存；`mt5_catalog({server:"metaeditor"})` 核验可用方法 |
| `servers.marketdata.enabled/token` | 可选 MetaTrader.com 数据服务 | 固定官方地址；同一配置能力保存，`mt5_catalog({server:"marketdata"})` 核验。券商行情不需要启用它 |
| `account.login/server/password` | 绑定券商账户；独立 Tester 运行需要密码 | 同一配置能力保存，`password_configured` 只证明已保存；终端连接、Python IPC 和 Tester 分别核验 |
| `tester_agent.address/port/password` | 使用明确指定的 MetaTester 代理 | 同一配置能力保存；实际原生代理调用验证可用性 |
| `allow_trading/allow_host_operations` | 交易、EA/脚本启动及原生宿主操作 | 默认为开启，主 Agent 可按用户授权调整；保存本身不会下单或启动程序 |
| 终端目录、数据目录、Windows Python、Wine 路径 | 本机编译、Tester、Python IPC 或启动终端 | `mt5_dependencies({action:"inspect"})` 给出已有路径和实际缺项，`action:"configure"` 保存路径 |

`mt5_update_configuration` 接受 `{command_id,expected_version,changes}`。版本来自 `mt5_settings`，相同操作重试使用相同 `command_id`。凭据字段省略保留现有值，空字符串清除；更换 endpoint 或账户身份会清除对应旧凭据，需要时在同次调用提供新值。连接 token 最长 8192 字符，账户和代理密码最长 1024 字符，均不接受换行或 NUL。

凭据保存在插件私有连接文件中；配置历史、事件和回执隐藏其值，只返回配置状态。保存立即刷新内存和连接客户端。`applied` 表示配置完成，实际连接和业务执行仍以各能力的观察结果为准。凭据不应出现在报告、脚本或长期记忆里。

`mt5_import_configuration` 只是复用 `pendingImports` 引用的可选快捷方式；`changes:{import_native:true}` 也可读取已有原生配置。用户已提供普通 token/password 时直接配置，不要求重新导出或改变输入格式。只有实际缺失的信息才需要询问，已有信息及授权继续使用。

打开已选本机终端使用 `mt5_start_terminal`，无需 MCP token；它保留原数据目录和 profile。启动回执不证明券商、MCP 或 Python 已连接，按任务需要使用对应能力核验。
