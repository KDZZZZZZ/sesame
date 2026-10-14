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
