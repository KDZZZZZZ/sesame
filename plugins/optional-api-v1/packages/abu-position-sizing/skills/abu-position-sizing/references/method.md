# Method: ATR Risk Budget, Kelly and Price Rank

基线将三类仓位观察并列输出：

- ATR risk budget：账户权益乘以风险比例，再除以 ATR stop price distance；若 ATR 风险为 0 或过小，输出 null 和 `undefined_price_risk`。
- Fractional Kelly：使用外部给定胜率和平均盈亏比，负值截为 0，先用 cap 限制，再乘以 `kelly_fraction_multiplier`。
- Price rank：当前 close 在最近窗口中的百分位位置。

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
