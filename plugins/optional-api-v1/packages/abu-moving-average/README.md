# ABU Moving Average Baseline

这个插件把 ABU 双均线买卖因子的有用部分翻新为独立研究基线。它不是标准答案；Agent 可按品种、周期和成本模型改进，但必须保留 baseline、假设、变更、试验和 holdout。

## 输入与参数

`bars` 必须是已按 UTC close time 递增且在 `as_of` 前可见的数据。

通过 Sesame 原生工具调用时，运行时会自动登记输入和输出数据集，返回可复核的 dataset id；直接运行 CLI 只把结果写到 stdout 或 `--out` 文件，不登记数据集。

- `fast_window`：短均线窗口，默认 5。
- `slow_window`：长均线窗口，默认 20，必须大于短窗口。

## 公式

`fast_sma[t] = mean(close[t-fast_window+1..t])`

`slow_sma[t] = mean(close[t-slow_window+1..t])`

当上一根 `fast <= slow` 且当前 `fast > slow`，输出 `fast_crossed_above_slow`。反向则输出 `fast_crossed_below_slow`。warmup 阶段输出 `null`。

## 上游差异

参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710` 的 `AbuDoubleMaBuy` / `AbuDoubleMaSell` 思路。本插件只实现 close-based 交叉观察，不复制 ABU 代码，也不接入其回测撮合。

## 改进纪律

任何优化窗口、过滤器或退出组合都要记录原基线、假设、变更和固定样本外结果。不要在同一段历史上同时找窗口和宣称效果。
