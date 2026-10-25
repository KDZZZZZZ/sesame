---
name: abu-backtest-lab
description: Audit supplied replay evidence and hand off matching/accounting to the native engine.
---

# 回测审计基线

用 `abu_backtest_lab_analyze` 审计已提供的订单和成交证据，定位时序、数量、成本与限价异常，说明还缺哪些原生引擎证据。

K 线是可选证据，只有订单和成交时无需补造。审计失败项是发现的异常，不是调用失败；不同标的数量不能相加当作统一仓位。审计不会运行回测，也不能证明策略生成过程或券商可成交性。

## 输入与交接

本能力属于数值方法层，消费调用者提供的已知输入。把 audit、evidence_counts 和 fills_by_symbol 交回策略验证流程，用异常定位需要补齐的引擎证据；它审计已有执行材料，不承担策略生成或撮合。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少已声明的必需字段或真实时序时，交回具体缺口，不补造数据以通过校验。

工具 abu_backtest_lab_analyze 的已注册 inputSchema 和 usage 给出准确字段、参数、返回路径与错误条件，不要求先阅读示例或运行教学演练。保留 input_artifact、result_artifact、source/as_of、实际参数和 limitations；原始工件可用 data_read({ref}) 按完整引用再次读取。其他方法需要不同输入形状时按其已声明接口显式转换，不把一个结果对象直接冒充另一个工具的输入。

## 可选改进

这是可修改、可验证的研究基线；只有任务需要比较公式或参数时才开展改进，保留原结果、修改假设与同一输入上的对照。references/method.md 解释公式和原版差异；examples/input.json 是合成教学输入。两者按需读取，合成结果保持演示身份。
