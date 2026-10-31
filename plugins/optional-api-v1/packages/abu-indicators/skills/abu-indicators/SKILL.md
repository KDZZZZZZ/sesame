---
name: abu-indicators
description: 技术指标研究基线，计算 SMA、EMA、MACD、RSI、布林带和 ATR。
license: GPL-3.0-only
---

# 技术指标基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_indicators_analyze`：在固定 OHLCV 上计算 SMA、EMA、MACD、RSI、布林带与 ATR，提供可复核的指标基线。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 可按任务覆盖 parameters 中的窗口；省略的参数使用 Schema 中默认值。macd_fast < macd_slow，bars 数量 <= max_bars。

observations.rows 为行数，latest/series 为最新/完整指标，baseline_note 说明公式差异；预热不足的指标为 null。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

EMA 由首个可见 close 初始化；ATR 使用简单滚动均值，不能声称与 Wilder 或其他平台数值完全一致。指标本身不证明收益。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
