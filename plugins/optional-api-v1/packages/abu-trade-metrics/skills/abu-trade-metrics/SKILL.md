---
name: abu-trade-metrics
description: Summarize supplied equity and closed-trade evidence with an ABU-inspired baseline.
---

# 交易绩效基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_trade_metrics_analyze`：从固定权益曲线和已平仓交易计算回撤、收益风险与交易归因，保留成本口径。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 portfolio:{currency,basis:"adjusted_equity"|"closed_trade_equity",no_external_flows:true}；equity_curve 至少 2 条 {time,available_at,equity>0}，time 严格递增且 time <= available_at <= as_of。closed_trades 可省略，每项含 id?、strategy?、entry_time、exit_time、available_at、gross_pnl、net_pnl、cost；entry <= exit <= available_at <= as_of，id 唯一，cost 必须与 gross_pnl-net_pnl 一致。

observations.equity 为权益、回撤与收益风险统计，closed_trades 为交易和策略归因；parameters 记录年化与无风险利率口径。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

只有已扣除外部资金流影响的曲线才可声明 no_external_flows:true；未知资金流不能为了通过校验而改写声明。 不重建券商账单；CAGR 使用实际日历时长，Sharpe 使用声明的 periods_per_year。输入来源与曲线口径仍需证据。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
