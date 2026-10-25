---
name: abu-trade-metrics
description: Summarize supplied equity and closed-trade evidence with an ABU-inspired baseline.
---

# 交易绩效基线

用 `abu_trade_metrics_analyze` 汇总给定权益与已结束交易的收益、回撤、风险和成本，解释数值对应的统计口径。

CAGR 使用实际日历时长，Sharpe 使用声明的年内期数。资金进出和权益调整会改变收益解释，不能在缺少证据时声称没有外部现金流；本能力不重建券商账单。

## 输入与交接

本能力属于数值方法层，消费调用者提供的已知输入。把 equity 回撤/收益统计及 closed_trades 归因交回策略或账户复盘；保留币种、资金流和年化口径，不另行重建交易或把同一权益曲线的多个比率当独立盈利证明。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少已声明的必需字段或真实时序时，交回具体缺口，不补造数据以通过校验。

工具 abu_trade_metrics_analyze 的已注册 inputSchema 和 usage 给出准确字段、参数、返回路径与错误条件，不要求先阅读示例或运行教学演练。保留 input_artifact、result_artifact、source/as_of、实际参数和 limitations；原始工件可用 data_read({ref}) 按完整引用再次读取。其他方法需要不同输入形状时按其已声明接口显式转换，不把一个结果对象直接冒充另一个工具的输入。

## 可选改进

这是可修改、可验证的研究基线；只有任务需要比较公式或参数时才开展改进，保留原结果、修改假设与同一输入上的对照。references/method.md 解释公式和原版差异；examples/input.json 是合成教学输入。两者按需读取，合成结果保持演示身份。
