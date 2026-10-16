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

## API 2 调用契约

`abu_moving_average_analyze({input})`：计算快慢简单均线及交叉方向，比较固定数据上的趋势信号。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 fast_window < slow_window；预热阶段保留未成熟信号。

observations.latest/series 为快慢均线和交叉观察，decision_available_at 为最新证据可用时间。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

均线是滞后观察，不是成交承诺；不计算成本、资金曲线或实盘收益。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
