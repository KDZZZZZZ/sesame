---
name: abu-trade-judges
description: Score a query trade against prior completed trades with transparent nearest neighbors.
---

# 历史交易裁判基线

用 `abu_trade_judges_analyze` 将查询与已结束且当时已知的历史交易比较，结合近邻数量、距离和历史结果解释评分。

这是缩放后的近邻基线，不是 ABU UMP/GMM 的等价实现。加权历史收益不是校准的预期收益，decision_hint 也不构成下单批准；样本覆盖不足会限制结论。

## 输入与交接

本能力属于数值方法层，消费调用者提供的已知输入。把 neighbors、距离、历史结果与 decision_hint 交给风险或策略复盘；这是一份近邻证据，不能把 score 和加权收益拆成多个独立批准。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少已声明的必需字段或真实时序时，交回具体缺口，不补造数据以通过校验。

工具 abu_trade_judges_analyze 的已注册 inputSchema 和 usage 给出准确字段、参数、返回路径与错误条件，不要求先阅读示例或运行教学演练。保留 input_artifact、result_artifact、source/as_of、实际参数和 limitations；原始工件可用 data_read({ref}) 按完整引用再次读取。其他方法需要不同输入形状时按其已声明接口显式转换，不把一个结果对象直接冒充另一个工具的输入。

## 可选改进

这是可修改、可验证的研究基线；只有任务需要比较公式或参数时才开展改进，保留原结果、修改假设与同一输入上的对照。references/method.md 解释公式和原版差异；examples/input.json 是合成教学输入。两者按需读取，合成结果保持演示身份。
