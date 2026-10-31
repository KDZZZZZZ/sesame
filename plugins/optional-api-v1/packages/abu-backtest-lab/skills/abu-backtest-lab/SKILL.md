---
name: abu-backtest-lab
description: Audit supplied replay evidence and hand off matching/accounting to the native engine.
---

# 回测审计基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_backtest_lab_analyze`：审计已提供的订单、成交和 K 线证据，指出时序、成交数量、成本与限价异常，并给出原生引擎交接说明；不执行回测。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 可省略，审计仅有订单和成交的证据时无需补造 K 线。若提供，bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 可选 engine:{name}；orders:[{id,symbol,time,available_at,quantity,limit_price?}] 和 trades:[{id,order_id,symbol,time,available_at,quantity,price,cost}] 默认空。数量和价格为正，cost 非负，各列表 id 唯一；time <= available_at <= as_of。expected_engine 若提供须与 engine.name 一致。

observations.evidence_counts 给出输入条数，audit 是逐项审计结论，fills/fills_by_symbol 为成交汇总，native_engine_handoff 为引擎交接信息。audit 中失败项是研究结果，不是能力调用失败。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

只审计输入证据，不能证明策略生成过程、券商可成交性或复现真实回测。不同标的数量不能相加当作统一仓位。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
