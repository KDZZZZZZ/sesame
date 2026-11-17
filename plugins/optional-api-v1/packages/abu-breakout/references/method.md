# Method: Prior-Window Breakout

基线只使用当前 bar 已经 `available_at` 的 close，以及此前 `lookback` 根 bar 的 high/low。

公式：

- `lookback_high = max(high[t-lookback..t-1])`
- `lookback_low = min(low[t-lookback..t-1])`
- `long = close[t] > lookback_high`
- `short = close[t] < lookback_low`

可见性：

- `time <= available_at <= as_of`
- 每根 bar 严格按 `time` 递增
- `decision_available_at` 是参与当前输出的最大 `available_at`

限制：

- close-based breakout 不处理 intrabar 突破后回落。
- 不估计成交价、盘口、滑点、涨跌停或市场会话。
- ABU 上游 GPL-3.0-only，参考 commit `d602d847677e4c2b77b0a122df30816ea68b5710`；本实现是独立基线。
