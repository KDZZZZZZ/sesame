# 波动与跳空基线

**这是基线，不是标准答案。** Agent 可以根据市场、周期和用途改进公式，但要保留 baseline、假设、试验和固定样本外验证。

本包参考 ABU 中 ATR、跳空、波动和 VWAP 相关主题，提供收益波动、ATR、跳空标记和累计 VWAP。实现无依赖、只读、可复核，不声称与 ABU 逐行等价。

输入必须提供 UTC `time` 与 `available_at`。未来数据被拒绝，warmup 输出 `null`，每行结果标注可见时间。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_dataset_id` 与 `dataset_id`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`，许可 GPL-3.0-only。
