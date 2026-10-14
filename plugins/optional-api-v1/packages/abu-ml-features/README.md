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

通过 Sesame native 工具调用时，宿主会保存固定输入和输出数据集，并返回 `input_dataset_id` 与 `dataset_id`。CLI 只生成 JSON，不自动登记数据集。

## 局限

本包不生成标签、不预测、不下单，也不声称复刻 ABU 全量特征族。它只提供可见性严格的少量价格特征。Agent 可以加入成交量、行业、基本面、横截面标准化或更多窗口，但必须保留 baseline、说明变化，并用固定 holdout 检查是否泄漏未来。
