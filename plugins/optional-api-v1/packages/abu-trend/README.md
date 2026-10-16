# 趋势分析基线

**这是基线，不是标准答案。** Agent 可以按任务改进窗口、回归形式、通道定义和验证方法，但必须保留 baseline、假设、试验与 holdout 对照。

本包参考 ABU `TLineBu` 的趋势分析主题，提供滚动回归斜率、标准化斜率、回归通道和路径效率。它不是 ABU 图形工具或完整结构系统的等价移植。

输入只接受显式 UTC `time`/`available_at` 的 OHLCV。每个滚动输出的 `available_at` 是窗口内数据的最大可见时间，避免把晚到修订静默当成当时可用。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_artifact` 与 `result_artifact`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。

## API 2 调用契约

`abu_trend_analyze({input})`：在固定 OHLCV 上计算滚动收盘价回归斜率、趋势通道和路径效率。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 window 为回归窗口；bars.length <= max_bars。

observations.rows 为根数，latest/series 为最新/逐行趋势观察，baseline_note 说明计算口径；预热阶段保留 null。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

回归按等间隔行序号计算，不自动处理停牌、缺失时段、成交量或市场状态；斜率是特征，不是价格预测。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
