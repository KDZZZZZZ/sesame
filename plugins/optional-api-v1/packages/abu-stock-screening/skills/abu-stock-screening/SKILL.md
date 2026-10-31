---
name: abu-stock-screening
description: 股票筛选研究基线，按价格、动量、趋势和路径效率排序有界股票池。
license: GPL-3.0-only
---

# 股票筛选基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_stock_screening_analyze`：在给定股票池内按动量、趋势、价格位置与路径效率生成透明的横截面排名。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 instruments 为 1..max_instruments 个 {id,bars}；id 唯一、1..80 字符且只含字母数字 _ . : -。各标的最新 bar.time 必须一致；bars 遵循 OHLCV 契约且不超过 max_bars_per_instrument。efficiency_window 省略时使用 trend_window，再省略则为 8。

observations.universe_size 为输入池大小，all 为全部标的指标/排除原因，top 为合格标的前 top_n；baseline_note 解释评分。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

只覆盖传入股票池，不能称为全市场筛选。历史不足的标的不参与排名；等权指标排名不证明流动性、可交易性或收益。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
