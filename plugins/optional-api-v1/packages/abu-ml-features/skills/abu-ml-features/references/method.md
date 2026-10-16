# 方法说明

上游参考：ABU 交易特征与 ML feature 示例，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。

这是可验证的基线，不是标准答案。Agent 可以改进或修改特征，但必须保留原始 baseline、假设、变化、试验记录和固定 holdout 对照。

## 可见性合同

对每个 `decision_time`，只有 `bar.available_at <= decision_time` 的 bar 能进入计算。当前 bar 只有在它自己的 `available_at` 已到达后才可用；否则最新来源就是上一根已可见 bar。输出中的 `source_until` 是所有实际使用 bar 的最大 `available_at`，用于审计特征是否在决策时已知。

## 公式

- 回归斜率：对最近 `window` 个 close，以 `x=0..window-1` 做最小二乘斜率
- close rank：`<= latest_close` 的 close 数量除以 `rank_window`
- realized volatility：最近 `window` 个 close-to-close simple return 的标准差
- ATR：最近 `atr_window` 个 true range 的简单均值，`TR=max(high-low, abs(high-prev_close), abs(low-prev_close))`
- gap：最新可见 bar 的 `open / previous_visible_close - 1`

## 改进建议

可以加入对数收益、Wilder ATR、成交量特征、复权口径、跨品种标准化或标签生成流程。改进时必须明确每个字段的可见时间，保留原版输出，并在固定 holdout 上比较，不能把默认特征当成最优答案。
