# 价格结构基线

**这是基线，不是标准答案。** Agent 可以改进摆动定义、聚类、黄金分割和验证方法，但必须保留 baseline 与固定 holdout 对照。

本包参考 ABU `TLineBu` 中的支撑阻力、黄金分割和结构观察主题，提供延迟确认 pivot、支撑阻力聚类和最近高低 pivot 的黄金分割水平。

关键约束：pivot 的 `time` 是价格发生时间，`confirmed_at` 才是研究流程可知道它的时间。需要做临场判断时必须使用 `confirmed_at`。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_artifact` 与 `result_artifact`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。

## API 2 调用契约

`abu_price_structure_analyze({input})`：寻找已确认的摆动高低点、聚类支撑阻力与黄金分割参考水平，保留确认时间避免未来信息泄露。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 left/right 是摆动点左右所需根数；bars.length <= max_bars，产生的 pivot 数量 <= max_pivots。

observations.pivots 含拐点及确认信息，levels 是聚类水平，golden_levels 来自最近确认的高低点，rows/baseline_note 描述覆盖与方法。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

拐点要到右侧 right 根 K 线出现才确认，使用 confirmed_at 而不是 pivot_time 作为可知时点。聚类和黄金分割是启发式参考，不是未来价格保证。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
