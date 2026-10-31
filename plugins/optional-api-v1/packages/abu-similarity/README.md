# 市场相似性基线

**这是基线，不是标准答案。** Agent 可以改进对齐规则、距离函数、滚动窗口和验证方法，但必须保留 baseline、差异说明和固定 holdout。

本包参考 ABU `SimilarBu` 的相关性主题，计算精确时间对齐后的收益 Pearson、Spearman 和方向一致率。缺失、无交集、样本不足和常数序列会显式给出 `null` 与状态。

输入是有界 instrument 列表，每个 instrument 带自己的 OHLCV。工具不联网、不补日历、不前向填充。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_artifact` 与 `result_artifact`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。

## API 2 调用契约

`abu_similarity_analyze({input})`：比较已提供标的在相同相邻时间区间的收益相关、秩相关和方向相似性。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 instruments 至少 2 个且 <= max_instruments，每项 {id,bars}；id 唯一、1..80 字符且只含字母数字 _ . : -。每个 bars 遵循 OHLCV 契约且不超过 max_bars_per_instrument。仅起止时点都相同的相邻收益对可对齐。

observations.instruments 为输入概况，pairs 为逐对重叠样本数和相似指标；不足 min_overlap 的指标保留空缺及诊断。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

不前向填充、不推断交易日历或补造缺失收益。相关性既不是因果关系，也不是下一时段同涨概率。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
