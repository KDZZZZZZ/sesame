# 方法说明

上游参考：`abupy/IndicatorBu` 与 `abupy/TLineBu` 中 ATR、jump、wave、vwap 主题，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`。

公式：收益为 close-to-close simple return；滚动波动为窗口收益总体标准差；gap 为当前 open 相对上一 close 的比例；VWAP 为输入片段内累计典型价格乘成交量除以累计成交量。

TR 同时覆盖本根振幅和相对前收盘价的跳空：

```text
true_range[t] = max(high[t] - low[t],
                    abs(high[t] - close[t-1]),
                    abs(low[t] - close[t-1]))
atr[t] = mean(最近 atr_window 个有效 true_range)
atr_percent[t] = 100 * atr[t] / close[t]
```

输入第一根没有前收盘价，`true_range` 为 `null`，不能用该根 `high-low` 补齐。窗口为 N 时需至少 N+1 根连续输入；有效 TR 不足 N 个时，`atr` 与 `atr_percent` 为 `null`。`observations.latest/series` 返回这三个字段，计算与解释直接使用该结果。TR 采用 [Fidelity 的三项最大值定义](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr)；本实现的 ATR 是简单滚动均值，与该页面介绍的 Wilder 平滑公式不同。

时序输入：同一序列的 `time` 全部为来源日历日期 `YYYY-MM-DD`，或全部为实际 UTC 收盘时刻 `YYYY-MM-DDTHH:mm:ss.sssZ`。日期标签不转换成虚构的午夜、收盘时间或时区。`as_of` 始终是真实 UTC 截止时刻；未来观测被拒绝，已知 `available_at` 满足 `time <= available_at <= as_of`（日期标签按日期比较）。首次可用时间未知时可省略或传 `null`，输出保留未知状态，不能据此声称历史点时有效；这不阻止基于现有历史样本计算。

FMP 映射：`row.data.date -> time`，`adjOpen/adjHigh/adjLow/adjClose -> open/high/low/close`，`row.data.volume -> volume`，`available_at:null`，再按 time 严格递增排序。保留来源的价格调整警告，`adj*` 字段名本身不是已复权的证明。

差异：不做 ABU 绘图、月度聚合跳空统计或完整 wave 系统；不解释复权、停牌、盘前盘后或分时微结构。Agent 若改进，应显式声明数据处理和验证方法。
