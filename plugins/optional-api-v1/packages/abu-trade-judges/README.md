# abu-trade-judges

这是受 ABU UMP 思路启发的透明交易 judge 研究基线，参考上游 commit `d602d847677e4c2b77b0a122df30816ea68b5710`。**这里的具体代码是基线，不是标准答案；Agent 可以改进或修改 judge，但必须明确本实现不是 ABU UMP/GMM 等价复刻，只是可审计替代基线。**

## 输入

输入需要 `feature_names`、`query` 和 `completed_trades`。`feature_names` 决定所有向量字段的顺序，名称不可重复。`query.time` 是待判断交易的决策时点，`query.available_at` 必须不晚于 `query.time`；`query.features` 必须包含所有特征名。

每条 `completed_trades` 需要 `feature_snapshot_at <= decision_time <= outcome_available_at < query.time`，保证历史交易的结果在本次 query 之前已经可知。`outcome.return` 是本基线使用的历史标签，允许范围为 `[-1, 10]`。

参数包括 `k` 和 `distance_floor`。`k` 默认 `3`，`distance_floor` 防止精确匹配时权重无限大。

## 输出

工具用历史完成交易的特征均值和标准差标准化 query 与历史样本，按欧氏距离选最近 `k` 个邻居，并用 `1 / max(distance, distance_floor)` 加权历史 `return`。输出包括邻居列表、`weighted_neighbor_return`、`score=tanh(weighted / mean(abs(history_return)))` 和 `decision_hint`。

CLI 示例：

```bash
node scripts/baseline.mjs examples/input.json --out result.json
```

通过 Sesame native 工具调用时，宿主会保存固定输入和输出数据集，并返回 `input_artifact` 与 `result_artifact`。CLI 不自动登记数据集。

## 局限

`weighted_neighbor_return` 是历史标签摘要，不是校准后的期望收益，也不是执行开关。ABU UMP 有自己的特征族、GMM/edge judge 和 pickle 状态；本包没有加载这些模型，也不声称等价。Agent 若加入概率校准、分层样本、时间衰减或更强模型，必须保留 baseline、记录标签可见性，并在固定 holdout 上比较。

## API 2 调用契约

`abu_trade_judges_analyze({input})`：从查询时点前已结束的历史交易中寻找特征近邻，给出可解释的相似样本评分。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 feature_names 为 1..100 个唯一名称；query:{time,available_at,features}，available_at <= time <= as_of。completed_trades 每项含 id?、feature_snapshot_at、decision_time、outcome_available_at、features、outcome:{return}；feature_snapshot_at <= decision_time <= outcome_available_at < query.time。所有 features 按 feature_names 提供有限数，return 在 [-1,10]，交易 id 唯一。

observations.query_time、neighbors、weighted_neighbor_return、score、decision_hint 分别给出查询时点、近邻证据、加权历史收益、评分和研究提示。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

这是缩放后的近邻基线，不是 ABU UMP/GMM 等价实现。加权历史收益不是校准后的预期收益，decision_hint 不等于下单批准。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
