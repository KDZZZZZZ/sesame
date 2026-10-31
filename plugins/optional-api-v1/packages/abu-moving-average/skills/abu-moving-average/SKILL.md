---
name: abu-moving-average
description: ABU-inspired dual moving-average cross research baseline.
---

# 均线信号基线

用 `abu_moving_average_analyze` 比较快慢简单均线及其交叉，用最新数值说明当前关系与历史变化。

均线平滑历史价格，也带来滞后；改变窗口会同时改变灵敏度和噪声。交叉是观察信号，不包含成交、成本或资金曲线证明。

## 输入与交接

本能力属于数值方法层，消费调用者提供的已知输入。把 fast_sma、slow_sma、signal 和证据可得时间交给趋势解释或策略研究；若已有相同窗口的均线序列可复用，交叉为同一价格序列的派生观察。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少已声明的必需字段或真实时序时，交回具体缺口，不补造数据以通过校验。

工具 abu_moving_average_analyze 的已注册 inputSchema 和 usage 给出准确字段、参数、返回路径与错误条件，不要求先阅读示例或运行教学演练。保留 input_artifact、result_artifact、source/as_of、实际参数和 limitations；原始工件可用 data_read({ref}) 按完整引用再次读取。其他方法需要不同输入形状时按其已声明接口显式转换，不把一个结果对象直接冒充另一个工具的输入。

## 可选改进

这是可修改、可验证的研究基线；只有任务需要比较公式或参数时才开展改进，保留原结果、修改假设与同一输入上的对照。references/method.md 解释公式和原版差异；examples/input.json 是合成教学输入。两者按需读取，合成结果保持演示身份。
