# 股票筛选基线

**这是基线，不是标准答案。** Agent 可以按任务改进因子、权重、样本池、成本和验证方法，但必须保留 baseline、差异说明和固定样本外对照。

本包参考 ABU `PickStockBu` 的筛选思想，将显式有界股票池按价格位置、动量、趋势和路径效率做透明排名。它不是收益预测器，也不是完整回测。历史不足的标的标为 `insufficient_history` 并排除出 top，最新 bar 时间不一致时拒绝横截面排名。

输入必须明确 instrument 列表和每个 instrument 的历史 bars。工具不会下载成分股、补全退市标的或修正幸存者偏差。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_dataset_id` 与 `dataset_id`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。
