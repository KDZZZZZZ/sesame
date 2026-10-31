---
name: abu-price-structure
description: 价格结构研究基线，计算延迟确认摆动、支撑阻力和黄金分割。
license: GPL-3.0-only
---

# 价格结构基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_price_structure_analyze`：寻找已确认的摆动高低点、聚类支撑阻力与黄金分割参考水平，保留确认时间避免未来信息泄露。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 left/right 是摆动点左右所需根数；bars.length <= max_bars，产生的 pivot 数量 <= max_pivots。

observations.pivots 含拐点及确认信息，levels 是聚类水平，golden_levels 来自最近确认的高低点，rows/baseline_note 描述覆盖与方法。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

拐点要到右侧 right 根 K 线出现才确认，使用 confirmed_at 而不是 pivot_time 作为可知时点。聚类和黄金分割是启发式参考，不是未来价格保证。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
