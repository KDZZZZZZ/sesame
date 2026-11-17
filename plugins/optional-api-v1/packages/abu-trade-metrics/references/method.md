# 方法说明

上游参考：ABU `MetricsBu` 与交易结果汇总，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。

这是可验证的基线，不是标准答案。Agent 可以改进或修改公式，但必须保留原始 baseline、输入摘要、有效参数、假设、差异、所有试验和固定样本外对照。

## 字段与时序

`portfolio.currency` 只作为币种标签；`portfolio.basis` 记录 equity 曲线含义；`portfolio.no_external_flows: true` 是收益指标前提。若存在出入金，应先在外部重建调整后 equity，再输入本工具。

`equity_curve[].time` 是 equity 观察时间，`available_at` 是该点被研究流程知道的时间。闭合交易必须满足 `entry_time <= exit_time <= available_at <= as_of`。闭合交易的 `cost` 必须和 `gross_pnl - net_pnl` 对齐，避免把费用口径藏进净值。

## 公式

- `total_return = ending_equity / starting_equity - 1`
- `calendar_years = (last_time - first_time) / 365.25 days`
- `CAGR = (ending / starting) ** (1 / calendar_years) - 1`，异常年化值输出 `null`
- `max_drawdown` 使用运行峰值到后续 trough 的相对跌幅
- `periodic_sharpe = (mean(period_returns) * periods_per_year - risk_free_rate) / (std(period_returns) * sqrt(periods_per_year))`
- `win_rate = winning_closed_trades / all_closed_trades`
- `profit_factor = gross_profit / abs(gross_loss)`，没有亏损交易时为 `null`

## 改进建议

可以加入现金流调整、样本标准差、下行风险、时间加权收益、资金占用、滑点拆分或策略层级归因。每个改进都应保留本基线结果，并在相同固定输入与 holdout 上比较，不自动替换 trading-decision 或任何挂载策略。
