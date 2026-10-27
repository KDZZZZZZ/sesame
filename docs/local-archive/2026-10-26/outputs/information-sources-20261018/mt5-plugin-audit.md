# MT5 已安装插件只读行情路径审计

核验日期：2026-10-18；业务请求及核验的 UTC 时间、完整参数、原生响应与摘要哈希见同目录 `mt5-plugin-audit.json`。

**已验证已安装插件的注册绑定到真实终端的行情读取；未验证完整宿主调用链。** 通过插件自身的 `createCapabilities` 分发 `mt5_catalog`、`mt5_call`，经原生方法归属校验和 MT5 MCP，读取到 XAUUSD 报价与 20 根日线。为避免改动用户数据，调用记录和数据集只放内存，没有创建或激活新的 Runtime。

| 核验项 | 实际结果 | 证据边界 |
| --- | --- | --- |
| 已安装包 | `sesame/mt5`，`2.0.2-dev.20261017.1`，安装摘要 `sha256:c4f6e4d9763239e3b7195e22eb554f90619dfa273c13e41adf013072fbf4e42b` | 只读查询用户库中的当前 `plugin_installation`，直接导入对应已安装目录；没有用仓库新版本替代安装版 |
| 真实原生连接 | `http://127.0.0.1:22346/mcp`，目录返回 `MetaTrader 5 MCP / 1.0`、`connected` | 使用现有配置的 token，仅保留于内存；没有导入、保存或更新配置 |
| 注册绑定 | `mt5_catalog` 与 `mt5_call` 都由安装包顶层 `createCapabilities` 返回 | 校验实际 manifest 的绑定名称、输入 Schema；实际原生工具 Schema 来自本次目录查询 |
| 报价 | XAUUSD：bid `4166.84`，ask `4167.28`，源更新时间 `2026-10-16T23:49:59` | 这是原生终端给出的最近报价；审计日为周日，不能写成 10 月 18 日新成交价格。原响应没有时区偏移 |
| 历史 K 线 | D1 共 20 根，`2026-09-21T00:00:00` 至 `2026-10-16T00:00:00` | 实际原生返回 `ok:true`；检查时间唯一递增、OHLC/量为有限数、最高最低包含开收盘 |
| 末根交叉核验 | O/H/L/C = `4170.50 / 4198.68 / 4147.15 / 4166.84` | 与根线程独立 Python SDK 证据 `mt5-native-readiness.json` 的 4 个 OHLC 字段完全一致；没有把该 SDK 调用冒充插件调用 |
| 终端状态 | 调用前后仍为 PID `19324`、`D:\MT5\terminal64.exe` | 没有调用启动、停止、登录、账户切换、交易、EA 或恢复部署能力 |
| 用户配置 | 连接文件内容 SHA-256 前后相同 | 只读打开 app.sqlite；未建立用户会话、未调用配置写入；内存中生成了 2 条命令记录、2 个数据集，均未落用户库 |

## 实际执行链与请求

```text
已安装 plugin_installation 的精确包目录
  → index.js createCapabilities
  → mt5_catalog / mt5_call 注册绑定
  → officialTool 的方法归属检查
  → MT5Official.catalog / call
  → MT5MCP：真实已配置 token，已有 loopback 服务
  → 已运行的 MT5 terminal64
```

目录请求：

```json
{"server":"terminal"}
```

两次业务请求均调用 `sesame/mt5#mt5_call`，每次有独立稳定的 `command_id`，且未提供 `save_as`：

```json
{"server":"terminal","tool":"get_marketwatch_symbols","arguments":{"symbol":"XAUUSD","include_hidden":false,"limit":1},"command_id":"<本次审计UUID>"}
```

```json
{"server":"terminal","tool":"get_chart_history","arguments":{"symbol":"XAUUSD","period":"D1","datetime_from":"2026-09-20T00:00:00","datetime_to":"2026-10-19T00:00:00","limit":20},"command_id":"<本次审计UUID>"}
```

目录明确将两方法标为 `permission:standard`、`agent_tool:mt5_call`、`callable:true`，并说明不下单、不修改或撤销订单。实际传输除 MCP 初始化和工具列表外，仅执行 `get_workspace_info`、`get_marketwatch_symbols`、`get_chart_history`。本次增加了内存传输白名单，任何其他原生操作都会在发送前被拒绝。

## 隔离方式与不能声称的结论

没有调用安装包的 `activate` 或 `MT5Official.init`。前者即使关闭 autoConnect，也会检查部署/回测恢复；后者会初始化存储与历史命令状态。审计用 `Object.create(MT5Official.prototype)` 装载真实现有配置并注入内存命令存储，复用了原版分发、方法归属、原生参数转换、目录和 MCP 实现。配置及凭据没有复制到测试数据库、文件、命令文本或输出；输出写入前检查不含已加载 token/password。

因此 JSON 中 `pluginRouteVerified:true` 的明确范围是上述**插件绑定→原生终端**，同时保留 `hostRegistryAndRunRouteVerified:false`。以下尚未覆盖：

- 宿主 `host.capabilities.invoke` 权限/依赖预检、Run 持久化、会话消息与前端展示；没有把直接绑定测试说成用户工作流端到端测试。
- 仓库当前 MT5 新版本、Python IPC 连接、账户管理、经济日历、指标及所有其他工具。
- 真实行情数据的来源质量和后续策略效果；这里只证明可读、基本结构有效，且末根价格与独立 SDK 一致。

首个本地审计脚本误传了可选字段 `query:""`，被 manifest 的 `minLength:1` 在调用前拒绝。随后按声明省略 `query`，没有为此改插件或用户配置；这个脚本参数错误及零传输记录保留在 JSON，不计作插件运行故障。

## 对信息层组合的直接含义

当前 MT5 已能为分析方法提供真实券商行情，不需要把 FMP/其他供应商行情当作这个账户品种的替代。取得的品种明确是 **Gold vs US Dollar, Spot CFD**，不是交易所黄金期货；`tick_volume` 也不是交易所集中成交量，不能直接与 CFTC 期货持仓或 ETF 实物持仓相加或视为同一度量。

传给方法层时应保留原生品种、周期、来源、采集时间、报价的源更新时间和时间基准。原生日期串未附时区，本次没有伪造 UTC；需要精确 UTC/PIT 的方法不能把它当已完成转换。CFTC、SPF、FRED 等可以补充不同问题的证据，但应按各自报告时点与资产覆盖范围对齐。
