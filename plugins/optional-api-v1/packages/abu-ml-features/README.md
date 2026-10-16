# abu-ml-features

这是受 ABU 特征工程与 ML 示例启发的历史特征研究基线，参考上游 commit `d602d847677e4c2b77b0a122df30816ea68b5710`。**这里的具体代码是基线，不是标准答案；Agent 可以按任务改进或修改特征，但必须证明每个特征在决策时间前可见，并保留原始输出、假设、变更、试验和固定 holdout。**

## 输入

输入需要 `schema_version: 1`、`source`、规范 UTC `as_of`、`bars` 和可选 `decision_times`。每根 bar 必须有 `time`、`available_at`、正数 OHLC 和非负 `volume`。`time` 是收盘时间，`available_at` 是该 bar 可被研究流程看到的时间。

参数包括 `window`、`atr_window`、`rank_window`，默认都以 `window=5` 为中心。每个 `decision_time` 必须不晚于 `as_of`。工具只使用 `available_at <= decision_time` 的 bar；如果可见 bar 数不足以覆盖最大窗口加上一根前值，会拒绝输入。

## 输出

每个决策时点输出：

- `close_regression_slope`：最近 `window` 个可见 close 的线性回归斜率
- `close_rank_percentile`：最新 close 在最近 `rank_window` 个可见 close 中的百分位
- `realized_volatility`：最近 `window` 个 close-to-close 收益的标准差
- `atr`：最近 `atr_window` 个 true range 的简单均值
- `gap_from_previous_close`：最新可见 bar 的 open 相对上一可见 close 的比例
- `source_until`：本次特征实际使用数据中的最大 `available_at`

CLI 示例：

```bash
node scripts/baseline.mjs examples/input.json --out result.json
```

通过 Sesame native 工具调用时，宿主会保存固定输入和输出数据集，并返回 `input_artifact` 与 `result_artifact`。CLI 只生成 JSON，不自动登记数据集。

## 局限

本包不生成标签、不预测、不下单，也不声称复刻 ABU 全量特征族。它只提供可见性严格的少量价格特征。Agent 可以加入成交量、行业、基本面、横截面标准化或更多窗口，但必须保留 baseline、说明变化，并用固定 holdout 检查是否泄漏未来。

## API 2 调用契约

`abu_ml_features_analyze({input})`：在明确的决策时间点提取当时已经可见的趋势、价格排名、波动、ATR 与跳空特征。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 decision_times 可省略，默认 [as_of]；提供时是 1..1000 个不晚于 as_of 的 UTC 时点。每个时点至少需 max(window,atr_window,rank_window)+1 根当时已可见的历史 K 线；decision_times.length * bars.length <= 10000000。

observations 是数组，每项含 decision_time、available_by、source_until、close_regression_slope、close_rank_percentile、realized_volatility、atr、gap_from_previous_close 和 close。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

atr_window 和 rank_window 省略时各自使用 window；它们不固定为 5。 只生成时点特征；不生成未来标签、不训练模型，也不自行拉取数据。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
