---
name: abu-position-sizing
description: ABU-inspired ATR risk budget, fractional Kelly and price-rank sizing baseline.
---

# 仓位计算基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_position_sizing_analyze`：在明确权益、币种和标的单位假设下计算 ATR 风险预算、分数 Kelly 与价格排名仓位基线。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 account:{equity>0,currency}；instrument:{price_currency,quantity_unit?,point_value?}。币种和数量单位代码须为 2..32 字符的大写标识；quantity_unit 与 point_value 必须同时提供或同时省略。point_value 表示每个数量单位每一个价格点对应的资金金额，不能把它误作最小跳动。

observations.account/instrument 保留单位假设，latest/series 给出风险/仓位观察，decision_available_at 为证据可用时点。省略数量换算时只得到资金/价格点维度的计算，不是券商下单手数。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

equity 是整段计算的固定假设，不是模拟权益轨迹。Kelly 的概率和盈亏比来自输入假设；未校准概率不能当作可靠盈利概率。本能力不发单。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
