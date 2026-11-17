# Method: ATR Risk Budget, Kelly and Price Rank

基线将三类仓位观察并列输出：

- ATR risk budget：账户权益乘以风险比例，再除以 ATR stop price distance；若 ATR 风险为 0 或过小，输出 null 和 `undefined_price_risk`。
- Fractional Kelly：使用外部给定胜率和平均盈亏比，负值截为 0，先用 cap 限制，再乘以 `kelly_fraction_multiplier`。
- Price rank：当前 close 在最近窗口中的百分位位置。

ATR 使用最近 `atr_window` 个 TR 的简单平均；有前收盘价时
`TR=max(high-low,abs(high-prev_close),abs(low-prev_close))`，首根输入则用 `high-low`。
累计 N 根输入可得首个 N 期 ATR；不足时 atr=null。完整仓位结果还须满足 `price_rank_window`，
任一窗口不足均返回 `status:"warmup"`。abu-indicators/abu-volatility 使用首根 TR=null、
N+1 根输入的初始化口径，初始窗口的 ATR 不能直接互换。

关键约束：

- `kelly_win_probability` 必须在 `[0, 1]`。
- `kelly_avg_win_loss_ratio` 必须为正数。
- 必须声明 `account.currency` 和 `instrument.price_currency`。
- 未声明 `instrument.point_value` 与 `instrument.quantity_unit` 时，输出是 cash-per-price-point，不是 broker lot，也不是实际下单数量。
- 历史序列使用同一个账户权益，是 constant-equity hypothetical，不是历史账户轨迹。

限制：

- 不知道合约乘数、最小交易单位、保证金、相关性和组合层风险。
- Kelly 输入若来自同一评估样本，会造成过拟合。
- 上游参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710`，本实现是独立 GPL baseline。
