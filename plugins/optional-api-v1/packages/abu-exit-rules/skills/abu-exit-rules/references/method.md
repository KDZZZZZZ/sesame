# Method: ATR Exit Rules

`position.entry_time` 必须对齐输入中的一根 bar close。基线从 entry 后一根 bar 开始评估持仓后的 high/low extrema，避免 entry bar 内入场前价格影响 trailing stop。ATR 可以使用已可见的入场前历史完成 warmup；固定持有期退出不依赖 ATR。

True range:

`max(high-low, abs(high-prev_close), abs(low-prev_close))`

ATR 为最近 `atr_window` 个 true range 的简单平均。long 和 short 的 stop loss / stop win / trailing stop 按方向反转。

限制：

- 输出不是订单，也不代表一定能成交。
- 没有最小跳动、保证金、滑点、交易时段、涨跌停或部分仓位处理。
- 上游参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710`，本实现是独立 baseline。
