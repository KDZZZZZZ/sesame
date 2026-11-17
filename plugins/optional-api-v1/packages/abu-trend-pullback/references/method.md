# Method: Trend Pullback Rebound

基线只看已可见历史 bars：

- 长窗口收益确认上行趋势。
- 短窗口高点到当前 close 的距离确认回撤。
- 当前 close 高于上一 close 作为最小反弹确认。
- 可选记录当前 close 是否接近长窗口区间的 0.382 回撤。

它不使用未来 swing high/low，不在信号后读取后验确认。

限制：

- 黄金分割只是标签，不是有效性证明。
- 没有交易成本、成交量、板块、波动 regime 或订单薄过滤。
- 参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710`，本实现是独立重写 baseline。
