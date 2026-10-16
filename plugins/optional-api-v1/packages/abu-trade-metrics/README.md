# abu-trade-metrics

这是一个受 ABU `MetricsBu` / `TradeBu` 启发的交易指标研究基线，参考上游 commit `d602d847677e4c2b77b0a122df30816ea68b5710`。**这里的具体代码是基线，不是标准答案；Agent 可以根据账户、市场、成本口径和风控要求改进或修改，但必须保留原版输出、假设、差异、试验记录和固定样本外对照。**

## 输入

输入必须是 `schema_version: 1`，并提供 `source.id`、`source.kind`、规范 UTC `as_of`。`portfolio.currency` 是展示币种；`portfolio.basis` 只能是 `adjusted_equity` 或 `closed_trade_equity`；`portfolio.no_external_flows` 必须为 `true`，否则本工具不会计算收益率。

`equity_curve` 至少两行，每行需要 `time`、`available_at` 和正数 `equity`，时间严格递增，`available_at <= as_of`。`closed_trades` 可为空；每笔闭合交易需要 `entry_time <= exit_time <= available_at <= as_of`，并提供 `gross_pnl`、`net_pnl`、`cost`，且 `gross_pnl - net_pnl` 必须等于 `cost` 的容差范围内结果。`strategy` 省略时归为 `unclassified`。

## 输出

工具输出总收益、CAGR、最大回撤、声明周期 Sharpe、闭合交易胜率、净盈亏、gross profit/loss、profit factor、总成本和按策略归因。`periods_per_year` 默认 `252`，`risk_free_rate` 默认 `0`。CAGR 使用首尾 equity 的日历时间跨度；跨度过短或年化值异常时会输出 `null` 并在 `warnings` 中说明。

CLI 示例：

```bash
node scripts/baseline.mjs examples/input.json --out result.json
```

通过 Sesame native 工具调用时，宿主会保存固定输入和输出数据集，并返回 `input_artifact` 与 `result_artifact`，方便用户和 Agent 复核同一份证据。CLI 只读写 JSON，不自动登记数据集。

## 局限

本包不重建券商流水、不核对真实成交、不处理出入金，也不证明实盘业绩。ABU 原框架包含更完整的组合、因子和回测指标；本包只提供一个可审计、无依赖、可替换的窄基线。Agent 若改进 Sharpe、现金流、分母、风险暴露或归因口径，必须保留 baseline 与固定 holdout 对照。

## API 2 调用契约

`abu_trade_metrics_analyze({input})`：从固定权益曲线和已平仓交易计算回撤、收益风险与交易归因，保留成本口径。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 portfolio:{currency,basis:"adjusted_equity"|"closed_trade_equity",no_external_flows:true}；equity_curve 至少 2 条 {time,available_at,equity>0}，time 严格递增且 time <= available_at <= as_of。closed_trades 可省略，每项含 id?、strategy?、entry_time、exit_time、available_at、gross_pnl、net_pnl、cost；entry <= exit <= available_at <= as_of，id 唯一，cost 必须与 gross_pnl-net_pnl 一致。

observations.equity 为权益、回撤与收益风险统计，closed_trades 为交易和策略归因；parameters 记录年化与无风险利率口径。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

只有已扣除外部资金流影响的曲线才可声明 no_external_flows:true；未知资金流不能为了通过校验而改写声明。 不重建券商账单；CAGR 使用实际日历时长，Sharpe 使用声明的 periods_per_year。输入来源与曲线口径仍需证据。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
