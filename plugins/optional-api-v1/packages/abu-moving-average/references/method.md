# Method: Dual Moving Average Cross

基线用简单移动平均和当前已可见 close。

公式：

- `fast_sma = mean(last fast_window closes)`
- `slow_sma = mean(last slow_window closes)`
- bullish cross: previous `fast <= slow` and current `fast > slow`
- bearish cross: previous `fast >= slow` and current `fast < slow`

可见性与限制：

- 输出只在 slow window 完成后有效。
- 不使用未来价格确认交叉。
- 不包含成本、滑点、成交量过滤或市场状态过滤。
- 上游参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710`，本实现是独立 GPL 基线。
