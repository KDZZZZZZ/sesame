# 工作流合约摘要零值：只读诊断

结论：manager 读到的 `tick_size=0.0`、`tick_value=0.0` 来自保存的 Terminal MCP 原始回执。不是 portfolio 将 Python 的 `trade_tick_*` 字段映射成了零。不同来源、不同时间的规格返回不一致；现有证据不能确定原生 MCP 给零的原因，也不能据此声称两个字段采用了另一套合法单位或语义。

**本轮真正阻断新增风险的仍是缺少适用的已确认风险规则。规格读取的候选修复未实施，解决规格缺口不会自动解除风险规则阻断。**

## 证据与时间

| 项目 | 准备阶段 | manager 合约摘要 |
|---|---|---|
| 来源 | Python `symbol_info`，经 `mt5_trading_prepare` 返回完整 `spec` | Terminal MCP `get_marketwatch_symbols` |
| 时间 | 准备 `capturedAt=2026-10-21T11:29:25.157Z` | dataset `received_at=2026-10-21T11:37:39.244Z` |
| 品种 | USDJPY | USDJPY |
| 最小跳动 | `trade_tick_size=0.001` | `tick_size=0.0` |
| tick 价值 | `trade_tick_value=0.6332239966565774` | `tick_value=0.0` |
| 盈利／亏损 tick 价值 | `trade_tick_value_profit=0.6332239966565774`；`trade_tick_value_loss=0.6332600862500237` | 本摘要未提供这两个字段 |
| point | `0.001` | `0.001` |
| 合约大小 | `trade_contract_size=100000` | `contract_size=100000.0` |
| 最小手数／数量步长 | `volume_min=0.01`；`volume_step=0.01` | `volume_min=0.01`；`volume_step=0.01` |

准备 Run 为 `run_1f5decdd-7126-4c64-8061-618286bf79fe`。完整规格位于 `E:/brief2great/sesame/outputs/live-trading-charts-20261021/workflow-execution/receipts.json` 的 `/runs/1/output/spec`，同一输出也在 `/calls/3/result/run/output/spec`。准备的 capturedAt 是聚合观察时间，不冒充独立 symbol_info 请求的 HTTP 时间。

manager 中断引用 dataset `data_c32173bd-8d64-4079-9542-c68df3690ee7`；`receipts.json` 第 6582 行保留其原话。同一说明记录于 Agent 输出 `%LOCAL_USER_PROFILE% 的 `workflowTest.secondaryFinding`。这些模型描述由以下原生证据独立核实。

经主线程授权，以 SQLite `mode=ro` 和 `PRAGMA query_only=ON` 只读取共享主插件库 `%LOCAL_USER_PROFILE% 中的一条精确记录：

```sql
SELECT value FROM records
WHERE collection = 'dataset'
  AND id = 'data_c32173bd-8d64-4079-9542-c68df3690ee7';
```

该记录已脱敏保存为同目录 `contract-native-dataset.json`，仅包含这一条 dataset，内部 rows 数为 1：

- `title`: `MT5 terminal / get_marketwatch_symbols`
- `rows[0].command_id`: `QA20261021-WORKFLOW-open-01-contract`
- `rows[0].server`: `terminal`
- `rows[0].tool`: `get_marketwatch_symbols`
- `rows[0].received_at`: `2026-10-21T11:37:39.244Z`
- `provenance.provider`: `mt5/terminal/get_marketwatch_symbols`
- 原记录 `provenance.data_hash`: `sha256:bbfd5439f95fc9ec728ab7f1500aa7bb36a45c03d6cd510b270f84c1ee9b2586`

`rows[0].result.content[0].text` 是保存的原生 MCP JSON 文本；解析后的 `symbols[0]` 确实是 USDJPY，并包含上述两个零值。它是插件保存的原生回执，不宣称为原始 HTTP 字节。导出保留文本结构，按既有 receipt 的敏感键规则脱敏 token/password/secret/credential/login/accountId 等字段；原记录 provenance hash 不重新定义为导出文件的哈希。

## 当前源码路径

仓库根目录：`E:/brief2great/sesame/sesame`。

- `plugins/optional-api-v1/packages/mt5/backend/trading-prepare.js:134`：采集 Python `symbol_info` 等事实并返回原始完整规格。
- `plugins/optional-api-v1/packages/mt5/backend/mcp.js` 的 `MT5MCP.post/call`：解析 JSON-RPC 并返回原生 result，无 tick 字段换算。
- `plugins/optional-api-v1/packages/mt5/backend/official.js:254`：Python 请求走 Python worker；`:259`：Terminal 请求走 MCP client；`:260`：结果仅经过脱敏并进入命令回执；`:263` 起保存 dataset。
- `plugins/optional-api-v1/packages/mt5/backend/plugin-tools.js:13`：公开路由返回命令回执，没有重新构造合约摘要。
- `plugins/optional-api-v1/packages/mt5/backend/contract-mapping.js:100` 的 `mapInstrument` 是另一条标准行情合同路径。本次 manager 直接读 Terminal MCP 回执，不经过这个函数，不能把本次零值归因于它。

## 能力缺口判断与候选后续

`plugins/optional-api-v1/packages/portfolio-execution/bindings.js:113` 的工作流只读工具包含账户 context、`mt5_catalog` 和 `mt5_call`，未授予整个 `mt5_python`。`plugins/optional-api-v1/packages/mt5/backend/tool-groups.json` 当前将 Python 的 `order_calc_profit`／`order_calc_margin` 路由到 `mt5_call`，未包含 `symbol_info`。因此 manager 没有同等便捷的 Python 完整合约规格入口。

值得单独评估的最小候选是提供精确、只读、带来源的 Python 合约规格读取能力，并继续遵守冻结账户和调用权限。不要为了补数据授予整个含可变操作的 Python 能力，不把 point 或旧规格补写成原生 tick 值，不扩大交易授权。此次没有实施这个候选，也没有证据支持先修一个所谓“Python 字段映射丢失”问题。

本次只读核对没有修改产品、配置、版本或插件安装，没有运行 SDK、交易、模型、UI 或新增测试，没有打开任何 child runtime.sqlite。仅保存本诊断和指定的单条脱敏证据。
