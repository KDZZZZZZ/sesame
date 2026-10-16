# ABU Breakout Baseline

这个插件把 ABU 中“历史窗口突破”一类想法整理成可运行研究基线。它不是标准答案，也不是交易建议；Agent 可以按任务改进，但必须保留原始基线输出、改动说明、假设、固定样本外对照和失败试验记录。

## 输入

读取 `schema_version: 1`、`source`、`as_of`、`parameters` 和 `bars`。每根 bar 使用 UTC `time` 与 `available_at`，并且必须满足 `time <= available_at <= as_of`。示例见 `examples/input.json`。

通过 Sesame 原生工具调用时，运行时会自动登记输入和输出数据集，返回可复核的 dataset id；直接运行 CLI 只把结果写到 stdout 或 `--out` 文件，不登记数据集。

参数：

- `lookback`： prior window 长度，默认 20。
- `direction`：`both`、`long` 或 `short`。

## 公式

对第 `i` 根 bar，若 `i < lookback`，输出 warmup。否则只看 `[i-lookback, i-1]` 的最高 high 和最低 low：

- `close[i] > max(high[i-lookback..i-1])`：prior high close breakout。
- `close[i] < min(low[i-lookback..i-1])`：prior low close breakdown。

信号的最早动作时间是信号 bar 的 `available_at` 之后的下一时段，插件不模拟成交价、滑点或订单。

## 上游差异

参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710` 中 FactorBuyBreak / FactorSellBreak 的思想家族。本实现是独立重写的最小闭合版本，没有复制 ABU 代码，也不声称等价于 ABU 的完整撮合、风控或当前商业平台。

## 改进纪律

改进 Agent 必须保存 baseline 结果，写明 `hypothesis`、`change`、`trial`、固定数据、成本假设和 holdout。不能用未来 bar 调参后覆盖原始基线，不能把研究观察直接升级成挂单。

## API 2 调用契约

`abu_breakout_analyze({input})`：用当前收盘价与此前 lookback 根 K 线的高低点比较，计算向上/向下突破研究信号。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 parameters.direction 选择 both/long/short；窗口不包含当前 K 线。

observations.latest/series 为最新/逐行观察，decision_available_at 为最终证据可用时点；warmup 行保留 null。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

信号产生于数据已可见之后，不能把当前收盘价当作已成交价格；不计算手续费、滑点或收益。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
