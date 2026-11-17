# 方法说明

上游参考：ABU UMP judge 概念，固定提交 `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。

这是可验证的基线，不是标准答案。Agent 可以改进或修改 judge，但必须保留原始输出、假设、变化、试验、固定 holdout，以及标签在 query 决策前已知的证据。

## 时序合同

query 必须满足 `query.available_at <= query.time <= as_of`。每条完成交易必须满足 `feature_snapshot_at <= decision_time <= outcome_available_at < query.time`。这表示历史标签在本次 query 前已经可见，避免把未来结果用作当时判断。

## 公式

1. 按 `feature_names` 读取 query 和历史交易特征向量。
2. 用历史完成交易计算每个特征的均值和标准差，标准差为 0 时用 1。
3. 标准化 query 与历史向量，计算欧氏距离。
4. 取最近 `k` 个邻居。
5. 权重为 `1 / max(distance, distance_floor)`。
6. `weighted_neighbor_return` 为邻居 return 的加权平均。
7. `score = tanh(weighted_neighbor_return / mean(abs(history_return)))`。

## 改进建议

可以尝试分市场状态、时间衰减、稳健缩放、概率校准、拒绝域外样本或 ABU 风格特征族。但改进结果不得冒充 ABU UMP/GMM 等价实现；必须保留本 baseline 和固定 holdout 对照。
