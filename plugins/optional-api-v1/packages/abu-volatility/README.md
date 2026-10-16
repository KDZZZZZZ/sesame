# 波动与跳空基线

**这是基线，不是标准答案。** Agent 可以根据市场、周期和用途改进公式，但要保留 baseline、假设、试验和固定样本外验证。

本包参考 ABU 中 ATR、跳空、波动和 VWAP 相关主题，提供收益波动、ATR、跳空标记和累计 VWAP。实现无依赖、只读、可复核，不声称与 ABU 逐行等价。

输入必须提供 UTC `time` 与 `available_at`。未来数据被拒绝，warmup 输出 `null`，每行结果标注可见时间。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_artifact` 与 `result_artifact`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。

## API 2 调用契约

`abu_volatility_analyze({input})`：计算滚动收盘收益波动、简单 ATR、输入区间量价均价及开盘跳空。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 bars.length <= max_bars；annualization 是当前 K 线周期每年的采样期数，不能对所有周期固定使用 252。

observations.latest/series 为逐行波动指标，gaps 为超过 gap_threshold_pct 的跳空，rows/baseline_note 说明输入规模和方法。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

收盘收益的总体标准差不等于盘中实现波动率；VWAP 只累计传入 volume。拆并股、复权、交易时段差异需在数据口径中说明。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
