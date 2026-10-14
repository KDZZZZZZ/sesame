# 市场相似性基线

**这是基线，不是标准答案。** Agent 可以改进对齐规则、距离函数、滚动窗口和验证方法，但必须保留 baseline、差异说明和固定 holdout。

本包参考 ABU `SimilarBu` 的相关性主题，计算精确时间对齐后的收益 Pearson、Spearman 和方向一致率。缺失、无交集、样本不足和常数序列会显式给出 `null` 与状态。

输入是有界 instrument 列表，每个 instrument 带自己的 OHLCV。工具不联网、不补日历、不前向填充。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_dataset_id` 与 `dataset_id`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。
