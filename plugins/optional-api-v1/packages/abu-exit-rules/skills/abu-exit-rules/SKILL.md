---
name: abu-exit-rules
description: ABU-inspired ATR stop, trailing stop and holding-period exit baseline.
---

# 退出规则基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_exit_rules_analyze`：针对一个已声明的假设持仓计算 ATR 止损、止盈、追踪回撤与最长持有期退出观察。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 position:{side:"long"|"short",entry_time,entry_price>0}；entry_time 必须等于已提供某根 K 线的收盘 time，且至少有一根其后的可见 K 线。

observations.position 保留假设持仓，latest/series 给出退出条件，first_exit 为首次触发观察，decision_available_at 为证据可用时点。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

入场前 K 线可用于 ATR 预热；入场那根 K 线的极值不作为入场后回撤。 退出观察不平仓、不发单；单根 OHLC 无法证明止损和止盈的盘中先后顺序。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
