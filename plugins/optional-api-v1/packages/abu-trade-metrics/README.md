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

通过 Sesame native 工具调用时，宿主会保存固定输入和输出数据集，并返回 `input_dataset_id` 与 `dataset_id`，方便用户和 Agent 复核同一份证据。CLI 只读写 JSON，不自动登记数据集。

## 局限

本包不重建券商流水、不核对真实成交、不处理出入金，也不证明实盘业绩。ABU 原框架包含更完整的组合、因子和回测指标；本包只提供一个可审计、无依赖、可替换的窄基线。Agent 若改进 Sharpe、现金流、分母、风险暴露或归因口径，必须保留 baseline 与固定 holdout 对照。
