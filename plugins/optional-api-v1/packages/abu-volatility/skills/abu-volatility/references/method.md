# 方法说明

上游参考：`abupy/IndicatorBu` 与 `abupy/TLineBu` 中 ATR、jump、wave、vwap 主题，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`。

公式：收益为 close-to-close simple return；滚动波动为窗口收益标准差；ATR 为 true range 的简单滚动均值；gap 为当前 open 相对上一 close 的比例；VWAP 为输入片段内累计典型价格乘成交量除以累计成交量。

差异：不做 ABU 绘图、月度聚合跳空统计或完整 wave 系统；不解释复权、停牌、盘前盘后或分时微结构。Agent 若改进，应显式声明数据处理和验证方法。
