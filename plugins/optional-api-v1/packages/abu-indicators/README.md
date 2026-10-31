# 技术指标基线

**这是基线，不是标准答案。** Agent 可以根据任务改进参数、公式、数据源和验证方法，但必须保留原版结果、修改假设、试验记录和固定样本外对照。

本包把 ABU `IndicatorBu` 中常见指标主题翻新成一个无依赖 Node.js 研究工具：SMA、EMA、MACD、RSI、布林带和 ATR。实现强调可复核、可解释和时间可见性，不声称与 ABU 逐行等价。

输入为 `schema_version=1` 的 JSON，K 线 `time` 为收盘时间，`available_at` 为该行可被使用的 UTC 时间。未来数据会被拒绝；warmup 阶段输出 `null`，不会补造指标。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_artifact` 与 `result_artifact`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游参考固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`。本包以 GPL-3.0-only 发布；来源、差异和信任边界见 `PROVENANCE.md` 与 `skills/abu-indicators/references/method.md`。

## API 2 调用契约

`abu_indicators_analyze({input})`：在固定 OHLCV 上计算 SMA、EMA、MACD、RSI、布林带与 ATR，提供可复核的指标基线。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 可按任务覆盖 parameters 中的窗口；省略的参数使用 Schema 中默认值。macd_fast < macd_slow，bars 数量 <= max_bars。

observations.rows 为行数，latest/series 为最新/完整指标，baseline_note 说明公式差异；预热不足的指标为 null。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

EMA 由首个可见 close 初始化；ATR 使用简单滚动均值，不能声称与 Wilder 或其他平台数值完全一致。指标本身不证明收益。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
