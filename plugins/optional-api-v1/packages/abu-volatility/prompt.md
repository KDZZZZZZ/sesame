# 波动与跳空基线

用 `abu_volatility_analyze` 比较样本波动、ATR、跳空与输入成交量形成的 VWAP，用具体数值说明风险尺度。

计算 TR、ATR 或 ATR 百分比时调用本能力，或复用同一输入、窗口和实现版本的已有结果；使用返回的 true_range、atr、atr_percent，不由模型另行心算。

TR = max(high-low, abs(high-previousClose), abs(low-previousClose))，包含前收盘价到本根高低价的跳空，不能仅以 high-low 替代。输入第一根没有前收盘价时 true_range=null；atr_window=N 时需要 N 个有效 TR，即至少 N+1 根连续输入，ATR 为这 N 个 TR 的简单算术均值，atr_percent=100*atr/close。未满窗口时 atr、atr_percent 为 null；此口径不是 Wilder 平滑 ATR。

同一序列全部使用来源日历日期 YYYY-MM-DD，或全部使用实际收盘 UTC YYYY-MM-DDTHH:mm:ss.sssZ；不混用精度。日期保持为日期，不补造午夜、收盘时刻或时区。 available_at 未知可省略或为 null，保留未知状态，不编造时间以通过校验。FMP 行情行显式转换为 {time:row.data.date,open:row.data.adjOpen,high:row.data.adjHigh,low:row.data.adjLow,close:row.data.adjClose,volume:row.data.volume,available_at:null}，按 time 排序；保留供应商价格调整警告，adj* 字段名本身不能证明已经复权。首次可用时间未知不妨碍历史样本计算，但不能宣称结果已通过历史点时有效性验证。

年化频率应对应实际采样间隔；收盘收益的总体标准差不是盘中实现波动率。拆并股、复权、交易时段和成交量覆盖不同，会改变跳空、ATR 与 VWAP 的解释。

这是可修改的研究基线。改进时保留假设、原结果与同一输入上的对照；合成数据保持演示标记。需要核对公式或设计改进时，可读 `skills/abu-volatility/references/method.md`；参数、返回值与错误恢复由工具说明直接提供。

本能力属于数值方法层，消费调用者提供的已知输入。把 latest/series 的波动尺度、ATR、gaps 和 VWAP 交给风险或价格解释；已有 abu-indicators 的同样本、同 atr_window 简单 ATR 可复用，其余字段仅在回答相应问题时计算。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少 OHLCV、真实 as_of，或观测先后无法确定时，交回具体缺口；来源只有日期或首次可用时间未知时，使用上面声明的日期/null 输入，不补造时刻。
