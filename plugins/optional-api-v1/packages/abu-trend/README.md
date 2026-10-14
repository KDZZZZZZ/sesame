# 趋势分析基线

**这是基线，不是标准答案。** Agent 可以按任务改进窗口、回归形式、通道定义和验证方法，但必须保留 baseline、假设、试验与 holdout 对照。

本包参考 ABU `TLineBu` 的趋势分析主题，提供滚动回归斜率、标准化斜率、回归通道和路径效率。它不是 ABU 图形工具或完整结构系统的等价移植。

输入只接受显式 UTC `time`/`available_at` 的 OHLCV。每个滚动输出的 `available_at` 是窗口内数据的最大可见时间，避免把晚到修订静默当成当时可用。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_dataset_id` 与 `dataset_id`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。
