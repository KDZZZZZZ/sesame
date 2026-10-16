---
name: abu-trade-judges
description: Score a query trade against prior completed trades with transparent nearest neighbors.
---

# 历史交易裁判基线

这是可修改、可验证的研究基线，不是标准答案。改进公式或参数时保留原结果、修改假设和对照证据。

能力 `abu_trade_judges_analyze`：从查询时点前已结束的历史交易中寻找特征近邻，给出可解释的相似样本评分。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 feature_names 为 1..100 个唯一名称；query:{time,available_at,features}，available_at <= time <= as_of。completed_trades 每项含 id?、feature_snapshot_at、decision_time、outcome_available_at、features、outcome:{return}；feature_snapshot_at <= decision_time <= outcome_available_at < query.time。所有 features 按 feature_names 提供有限数，return 在 [-1,10]，交易 id 唯一。

observations.query_time、neighbors、weighted_neighbor_return、score、decision_hint 分别给出查询时点、近邻证据、加权历史收益、评分和研究提示。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

这是缩放后的近邻基线，不是 ABU UMP/GMM 等价实现。加权历史收益不是校准后的预期收益，decision_hint 不等于下单批准。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。

`references/method.md` 解释公式和原版差异；包根目录 `examples/input.json` 提供合成样例。两者用于需要时核对，不是调用前的固定步骤。
