---
name: abu-breakout
description: ABU-inspired prior-window breakout research baseline.
---

# 突破信号基线

用 `abu_breakout_analyze` 判断价格相对历史区间的突破，给出区间边界、当前价格与最早可知时点。

比较区间排除当前 K 线，否则当前价格会改变自己的基准。信号在数据可见后才成立；当前收盘价不是已成交价，成本和后续收益不在本次计算中。

## 输入与交接

本能力属于数值方法层，消费调用者提供的已知输入。把区间边界、latest/series 和 decision_available_at 交给价格行为或策略假设；已有相同 lookback 的突破计算可复用，是否适合交易由上层结合其他证据决定。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少已声明的必需字段或真实时序时，交回具体缺口，不补造数据以通过校验。

工具 abu_breakout_analyze 的已注册 inputSchema 和 usage 给出准确字段、参数、返回路径与错误条件，不要求先阅读示例或运行教学演练。保留 input_artifact、result_artifact、source/as_of、实际参数和 limitations；原始工件可用 data_read({ref}) 按完整引用再次读取。其他方法需要不同输入形状时按其已声明接口显式转换，不把一个结果对象直接冒充另一个工具的输入。

## 可选改进

这是可修改、可验证的研究基线；只有任务需要比较公式或参数时才开展改进，保留原结果、修改假设与同一输入上的对照。references/method.md 解释公式和原版差异；examples/input.json 是合成教学输入。两者按需读取，合成结果保持演示身份。
