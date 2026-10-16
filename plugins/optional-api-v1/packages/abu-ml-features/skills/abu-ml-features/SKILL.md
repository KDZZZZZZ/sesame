---
name: abu-ml-features
description: Generate prior-visible rolling price features for research baselines.
---

# 交易特征基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_ml_features_analyze`：在明确的决策时间点提取当时已经可见的趋势、价格排名、波动、ATR 与跳空特征。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 decision_times 可省略，默认 [as_of]；提供时是 1..1000 个不晚于 as_of 的 UTC 时点。每个时点至少需 max(window,atr_window,rank_window)+1 根当时已可见的历史 K 线；decision_times.length * bars.length <= 10000000。

observations 是数组，每项含 decision_time、available_by、source_until、close_regression_slope、close_rank_percentile、realized_volatility、atr、gap_from_previous_close 和 close。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

atr_window 和 rank_window 省略时各自使用 window；它们不固定为 5。 只生成时点特征；不生成未来标签、不训练模型，也不自行拉取数据。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
