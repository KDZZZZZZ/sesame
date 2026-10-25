---
name: abu-position-sizing
description: ABU-inspired ATR risk budget, fractional Kelly and price-rank sizing baseline.
---

# 仓位计算基线

用 `abu_position_sizing_analyze` 比较 ATR 风险预算、分数 Kelly 与排名分配，明确输出预算、数量和单位。

equity 是固定假设，不是模拟资金曲线；Kelly 的概率与盈亏比来自输入，未校准时不能声称可靠盈利概率。数量只有结合单位和点值才有意义，不能直接当作券商手数；本能力不发单。

本基线首根 TR 使用 high-low，累计 atr_window 根输入可得 ATR；完整仓位结果还须满足 price_rank_window。与 abu-indicators/abu-volatility 首根 TR=null、ATR 需 N+1 根的口径不同，不能直接互换初始窗口结果。

## 输入与交接

本能力属于数值方法层，消费调用者提供的已知输入。把账户/单位假设和 latest/series 的风险预算、数量交给风险审查；实际券商手数、保证金和可成交性须用账户后端核验，观察值不直接转成订单。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少已声明的必需字段或真实时序时，交回具体缺口，不补造数据以通过校验。

工具 abu_position_sizing_analyze 的已注册 inputSchema 和 usage 给出准确字段、参数、返回路径与错误条件，不要求先阅读示例或运行教学演练。保留 input_artifact、result_artifact、source/as_of、实际参数和 limitations；原始工件可用 data_read({ref}) 按完整引用再次读取。其他方法需要不同输入形状时按其已声明接口显式转换，不把一个结果对象直接冒充另一个工具的输入。

## 可选改进

这是可修改、可验证的研究基线；只有任务需要比较公式或参数时才开展改进，保留原结果、修改假设与同一输入上的对照。references/method.md 解释公式和原版差异；examples/input.json 是合成教学输入。两者按需读取，合成结果保持演示身份。
