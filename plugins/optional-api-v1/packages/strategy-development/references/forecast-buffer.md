# 趋势策略的仓位缓冲

在策略构建中选用 `native_template: "forecast_buffer"`，类名为 `ForecastBufferStrategy`。同一份可编辑 Python 源覆盖基线和缓冲候选。首版通过 Backtrader 研究单一品种、账户同币种、整股只做多的现金股票，使用完整日线及下一根开盘可执行的市价单。运行前固定品种、价格复权口径、交易时段和成本。期货乘数、外汇换算、做空借券、多标的资金分配、日内撮合需要对应实现和原生验证。

## 从收盘预测到股数

1. 以 `vol_window` 个日收盘价差的总体标准差作为每股日波动。快、慢指数均线的差除以该波动，再乘 `forecast_scale`，并用 `forecast_cap` 对正负两端限幅。比例参数可在开发集估计。留出集沿用冻结值。[pysystemtrade 的 EWMAC](https://github.com/pst-group/pysystemtrade/blob/develop/systems/provided/rules/ewmac.py#L110-L115)
2. 基准股数等于当前权益乘 `daily_risk_target` 再除以每股日波动。预测为 10 时使用这份基准股数，预测为 5 时用一半，预测小于等于零时清仓。原始目标再受每日风险上限 `daily_risk_limit`、名义敞口 `max_exposure` 和现金预留 `cash_reserve` 约束，最后向下取整。默认预测上限为 20。日风险参数均以当日权益的比例表示。[pysystemtrade 的仓位计算](https://github.com/pst-group/pysystemtrade/blob/develop/systems/positionsizing.py#L113-L130) · [上游预测和缓冲配置](https://github.com/pst-group/pysystemtrade/blob/develop/sysdata/config/defaults.yaml)
3. 回撤从账户权益高点按日收盘计算。触及 `halt_drawdown` 即发起清仓，此次回测余下时间保持空仓。零波动、不可用的预测和不足一股的目标也要求清仓。跳空和撤单等待期会影响实际成交和最终回撤。以上为本模板的风险处理约定。

## 何时交易

`buffer_fraction=0` 每次对齐风险约束后的目标。`buffer_mode="position"` 将目标股数乘缓冲比例作为半宽，`"forecast"` 将基准股数乘缓冲比例作为半宽。下边界向上取整，上边界向下取整，取整后的区间包含两端。例如目标 100 股、半宽 5 股时，持 95 至 105 股均保持。持 94 股时，`trade_to_edge=true` 买 1 股到 95，`false` 买 6 股到 100。持仓超过硬风控上限或需要清仓时优先减仓。[pysystemtrade 的缓冲宽度](https://github.com/pst-group/pysystemtrade/blob/develop/systems/buffering.py#L111-L161) · [单期缓冲决策](https://github.com/pst-group/pysystemtrade/blob/develop/systems/accounts/account_buffering_subsystem.py#L153-L192)

每次决策读取已确认持仓。有未完成订单时先核对实际持仓加剩余委托量。未完成订单可能突破最新上限或妨碍清仓时，先申请撤单，收到终态回执后按实际持仓重新计算。订单最早在下一根可交易日线开盘撮合。买入数量按已知收盘价和费率预留现金，跳空造成的资金不足以引擎回执为准。[Backtrader 市价单撮合](https://www.backtrader.com/docu/order-creation-execution/order-creation-execution/) · [订单状态和实际成交](https://www.backtrader.com/docu/order/)

## 固定一处差异的 A/B

两组共用源码摘要、品种与有波动的开发日线、起始资金、费用滑点、预测参数与风控。用 `buffer_fraction=0` 跑基线，用 `0.10` 跑候选，其他参数相同。在开发集搜索缓冲宽度时预先固定候选集合、成本和评价指标，保留所有试验。选定的参数可再到独立留出期核验一次。

基线在 `strategy_development_backtest` 的 `experiment.parameters` 显式填写 `buffer_fraction: 0`，并设 `parameter_space: {}`、`max_trials: 1`。将基线回执的 `projectRef` 交给 `strategy_development_plan`，注册下面的变更。再对新项目执行 `strategy_development_backtest`，传 `experiment: { "backend": "backtrader", "planned_trial": true }`，最后用 `strategy_development_compare` 比较两份项目引用。

```json
{
  "parameter_trial": {
    "parameter": "buffer_fraction",
    "to": 0.1,
    "component": "execution",
    "hypothesis": "10% 缓冲让偏离目标的小额调整推迟到越界时执行，从而降低换手。",
    "primary": "turnover",
    "direction": "minimize"
  }
}
```

从原生订单取实际成交数量和价格，比较成交笔数与成交金额，再看手续费、净收益、回撤和敞口偏离。同一订单的累计成交回执只算一次增量。手续费由 broker 对实际成交额按比例计提，滑点进入成交价。样本最后仍持有的股票按期末净值计价。SVL 的固定输入组件回放可用于检查信号和时点，Backtrader 成交与权益回执用于该原生模板的业绩对照。
