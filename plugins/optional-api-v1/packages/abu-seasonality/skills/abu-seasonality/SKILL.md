---
name: abu-seasonality
description: ABU-inspired UTC weekday conditional-return research baseline.
---

# 日历效应基线

用 `abu_seasonality_analyze` 比较已完成历史收益的星期分组，结合组内样本数说明差异和证据强度。

分组使用 UTC 日期，不自动识别交易所节假日或本地交易日。小样本差异可能不稳定；未来才完整的分组统计不能倒填为历史决策依据。

## 输入与交接

本能力属于数值方法层，消费调用者提供的已知输入。把每个 UTC 星期的历史样本数和当时可得统计交给实验假设；交易所日历与未来事件需要独立信息来源，不把历史星期效应当作未来事件日历。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少已声明的必需字段或真实时序时，交回具体缺口，不补造数据以通过校验。

工具 abu_seasonality_analyze 的已注册 inputSchema 和 usage 给出准确字段、参数、返回路径与错误条件，不要求先阅读示例或运行教学演练。保留 input_artifact、result_artifact、source/as_of、实际参数和 limitations；原始工件可用 data_read({ref}) 按完整引用再次读取。其他方法需要不同输入形状时按其已声明接口显式转换，不把一个结果对象直接冒充另一个工具的输入。

## 可选改进

这是可修改、可验证的研究基线；只有任务需要比较公式或参数时才开展改进，保留原结果、修改假设与同一输入上的对照。references/method.md 解释公式和原版差异；examples/input.json 是合成教学输入。两者按需读取，合成结果保持演示身份。
