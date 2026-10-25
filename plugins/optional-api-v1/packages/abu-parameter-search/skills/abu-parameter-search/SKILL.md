---
name: abu-parameter-search
description: Rank supplied development trials over a finite grid and preserve a fixed holdout.
---

# 参数实验基线

用 `abu_parameter_search_analyze` 比较已完成实验的开发期指标，冻结选型，再用独立留出证据评价同一组合的稳定性。

选型依据与留出验证分离，避免把留出期也变成调参数据。验证使用实际返回的 frozen_selection；哈希只证明记录内一致，固定保存的开发工件才支持先选型后验证的时序。本能力不运行策略或表达式。

## 输入与交接

本能力属于数值方法层，消费调用者提供的已知输入。把 development_rank 和 frozen_selection 交回实验流程，留出核验传回同一完整 frozen_selection；该工具只比较已有试验指标，不负责取数、运行试验或提出新的调参方向。复用前核对输入版本、参数、截止时间与实现口径；已有匹配结果可直接引用。同源价格、成交或统计派生结果不能重复计为独立证据；计算只回答本项局部问题，方法解释与最终综合由调用者负责。缺少已声明的必需字段或真实时序时，交回具体缺口，不补造数据以通过校验。

工具 abu_parameter_search_analyze 的已注册 inputSchema 和 usage 给出准确字段、参数、返回路径与错误条件，不要求先阅读示例或运行教学演练。保留 input_artifact、result_artifact、source/as_of、实际参数和 limitations；原始工件可用 data_read({ref}) 按完整引用再次读取。其他方法需要不同输入形状时按其已声明接口显式转换，不把一个结果对象直接冒充另一个工具的输入。

## 可选改进

这是可修改、可验证的研究基线；只有任务需要比较公式或参数时才开展改进，保留原结果、修改假设与同一输入上的对照。references/method.md 解释公式和原版差异；examples/input.json 是合成教学输入。两者按需读取，合成结果保持演示身份。
