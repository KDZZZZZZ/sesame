# ABU Trend Pullback Baseline

这个插件把 ABU 中趋势回撤、黄金分割类示例整理为独立研究基线。它不是标准答案；Agent 可以根据市场结构改进，但必须保存 baseline、假设、改动、试验和 holdout。

## 输入与参数

输入为 UTC 可见 bars。默认参数：

通过 Sesame 原生工具调用时，运行时会自动登记输入和输出数据集，返回可复核的 dataset id；直接运行 CLI 只把结果写到 stdout 或 `--out` 文件，不登记数据集。

- `trend_window`：长趋势窗口。
- `pullback_window`：短回撤窗口。
- `min_trend_return`：长窗口最小涨幅。
- `min_pullback` / `max_pullback`：短窗口高点到当前 close 的回撤范围。
- `golden_tolerance`：当前 close 距趋势区间 0.382 回撤的容差。

## 公式

`trend_return = (close[t] - close[t-trend_window]) / close[t-trend_window]`

`pullback = (recent_high - close[t]) / recent_high`

`golden_ratio = (trend_high - close[t]) / (trend_high - trend_low)`

若趋势收益达标、短回撤在区间内、当前 close 反弹高于上一 close，则输出候选信号；若同时接近 0.382，则标注 `near_382`。

## 上游差异

参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710` 的趋势回撤与黄金分割示例。本实现只提供一个透明 baseline，不复制 ABU 源码，不声称重现 ABU 完整因子。

## 改进纪律

调阈值、加形态、加量能或接入 Agent 判断时，必须留存原基线输出，并用固定样本外数据验证是否真的改善。
