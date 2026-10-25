---
name: abu-price-structure
description: 价格结构研究基线，计算延迟确认摆动、支撑阻力和黄金分割。
license: GPL-3.0-only
---

# 价格结构基线

用 `abu_price_structure_analyze` 提取已确认拐点、支撑阻力聚类与黄金分割参考，说明价格位置和何时可知。

右侧 K 线出现后拐点才确认，因此决策依据是 confirmed_at，不能提前使用 pivot_time。聚类与分割是形态参考；突破或反转仍需后续证据。

## 输入与交接

本能力属于数值方法层，消费调用者提供的已知输入。把 pivots、confirmed_at、levels 和 golden_levels 交给 price-action、elliott-wave 或其他解释方法；窗口、端点和确认定义匹配时复用。聚类水平不等于完整趋势段，不能用同一摆动的多种标签重复确认。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少已声明的必需字段或真实时序时，交回具体缺口，不补造数据以通过校验。

工具 abu_price_structure_analyze 的已注册 inputSchema 和 usage 给出准确字段、参数、返回路径与错误条件，不要求先阅读示例或运行教学演练。保留 input_artifact、result_artifact、source/as_of、实际参数和 limitations；原始工件可用 data_read({ref}) 按完整引用再次读取。其他方法需要不同输入形状时按其已声明接口显式转换，不把一个结果对象直接冒充另一个工具的输入。

## 可选改进

这是可修改、可验证的研究基线；只有任务需要比较公式或参数时才开展改进，保留原结果、修改假设与同一输入上的对照。references/method.md 解释公式和原版差异；examples/input.json 是合成教学输入。两者按需读取，合成结果保持演示身份。
