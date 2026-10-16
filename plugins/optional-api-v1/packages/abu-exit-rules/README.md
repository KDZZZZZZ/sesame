# ABU Exit Rules Baseline

这个插件把 ABU ATR 止损、止盈、移动止损和固定持有期思想整理成独立退出观察基线。它不是标准答案；Agent 可按策略、品种和执行引擎改进，但必须保留 baseline、假设、改动、试验和 holdout。

## 输入与参数

除 `bars` 外，需要：

通过 Sesame 原生工具调用时，运行时会自动登记输入和输出数据集，返回可复核的 dataset id；直接运行 CLI 只把结果写到 stdout 或 `--out` 文件，不登记数据集。

```json
{ "position": { "side": "long", "entry_time": "...Z", "entry_price": 100 } }
```

参数：

- `atr_window`
- `stop_loss_atr`
- `stop_win_atr`
- `trailing_atr`
- `max_holding_bars`

## 公式

`position.entry_time` 必须对齐输入中的一根 bar close。因为输入没有 bar open 时间，entry bar 的 high/low 可能发生在入场前，所以持仓内 extrema 从 entry 后一根 bar 开始计算；ATR 可以使用已经可见的入场前历史完成 warmup。固定持有期退出不依赖 ATR，ATR 还在 warmup 时也会生效。long:

- `close <= entry_price - stop_loss_atr * ATR`
- `close >= entry_price + stop_win_atr * ATR`
- `best_high_since_entry - close >= trailing_atr * ATR`
- `holding_bars >= max_holding_bars`

short 方向反向。

## 上游差异

参考 ABU commit `d602d847677e4c2b77b0a122df30816ea68b5710` 中 ATR stop 与 N-day exit 思想。本实现是独立重写的观察器，不复制 ABU 代码，不发单、不平仓。

## 改进纪律

Agent 可以接入真实持仓、bar open timestamp、成本和执行策略来改进这个保守假设，但必须把研究观察与实际订单分开，并保留原基线和样本外对照。

## API 2 调用契约

`abu_exit_rules_analyze({input})`：针对一个已声明的假设持仓计算 ATR 止损、止盈、追踪回撤与最长持有期退出观察。

调用形状为 {input:{schema_version:1,source:{id,kind},as_of,parameters?,...}}，不是文件路径或数据 ID。source.id 为 1..500 字符，kind 为 synthetic/historical/live；as_of 及全部时间字段使用真实 UTC YYYY-MM-DDTHH:mm:ss.sssZ（含毫秒）。输入限 2MiB 有限 JSON，不接收代码。parameters 只支持列出的字段。 bars 是 1..10000 条已知 OHLCV，按收盘 time 严格递增且不重复；每行含 time、available_at、open/high/low/close、volume。time <= available_at <= as_of，价格为正且 high/low 覆盖 open/close，volume >= 0。 position:{side:"long"|"short",entry_time,entry_price>0}；entry_time 必须等于已提供某根 K 线的收盘 time，且至少有一根其后的可见 K 线。

observations.position 保留假设持仓，latest/series 给出退出条件，first_exit 为首次触发观察，decision_available_at 为证据可用时点。 立即返回 {schema_version:1,baseline:true,status:"research_baseline",source,as_of,parameters,observations,limitations,input_sha256,implementation_sha256,input_artifact,result_artifact}。两个 artifact 是完整不可变 DataRef，保留 id/revision/digest/kind/schemaVersion；若需再次读取，可将完整 ref 传给 data_read({ref})（需 data-access/workspace）。input_artifact 保存 [{input}]，result_artifact 保存 [{...计算结果}]，后者不自包含 artifact 引用。

入场前 K 线可用于 ATR 预热；入场那根 K 线的极值不作为入场后回撤。 退出观察不平仓、不发单；单根 OHLC 无法证明止损和止盈的盘中先后顺序。 来源与 available_at 是调用方声明，能力不会独立验证供应商历史；synthetic 证据必须保持演示标记。结果是研究观察，不是订单、成交或收益证明。
