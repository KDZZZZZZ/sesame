# 技术指标基线

**这是基线，不是标准答案。** Agent 可以根据任务改进参数、公式、数据源和验证方法，但必须保留原版结果、修改假设、试验记录和固定样本外对照。

本包把 ABU `IndicatorBu` 中常见指标主题翻新成一个无依赖 Node.js 研究工具：SMA、EMA、MACD、RSI、布林带和 ATR。实现强调可复核、可解释和时间可见性，不声称与 ABU 逐行等价。

输入为 `schema_version=1` 的 JSON，K 线 `time` 为收盘时间，`available_at` 为该行可被使用的 UTC 时间。未来数据会被拒绝；warmup 阶段输出 `null`，不会补造指标。

通过 Sesame native 工具调用时，宿主会登记固定输入与输出数据集，并在结果中返回 `input_dataset_id` 与 `dataset_id`，便于用户和 Agent 查看同一证据；CLI 只读取/输出 JSON，不自动持久化数据集。

上游参考固定为 `bbfamily/abu` commit `d602d847677e4c2b77b0a122df30816ea68b5710`。本包以 GPL-3.0-only 发布；来源、差异和信任边界见 `PROVENANCE.md` 与 `skills/abu-indicators/references/method.md`。
