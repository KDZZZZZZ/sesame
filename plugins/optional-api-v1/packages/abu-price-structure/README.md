# 价格结构基线

**这是基线，不是标准答案。** Agent 可以改进摆动定义、聚类、黄金分割和验证方法，但必须保留 baseline 与固定 holdout 对照。

本包参考 ABU `TLineBu` 中的支撑阻力、黄金分割和结构观察主题，提供延迟确认 pivot、支撑阻力聚类和最近高低 pivot 的黄金分割水平。

关键约束：pivot 的 `time` 是价格发生时间，`confirmed_at` 才是研究流程可知道它的时间。需要做临场判断时必须使用 `confirmed_at`。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_dataset_id` 与 `dataset_id`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。
