---
name: abu-price-structure
description: 价格结构研究基线，计算延迟确认摆动、支撑阻力和黄金分割。
license: GPL-3.0-only
---

# abu-price-structure

使用前读取 `references/method.md` 和 `examples/input.json`。

**本包代码是可修改、可验证的基线，不是标准答案。Agent 可以按需求改进。** 所有改进都要保留 baseline、假设、差异和固定样本外验证。

适合把价格结构转为可审计观察：延迟确认摆动点、支撑阻力层和黄金分割价位。观察结果不能直接视为入场、止损或收益证明。

通过 native 工具调用时，结果会带 `input_dataset_id` 与 `dataset_id`，表示宿主登记的固定输入/输出数据集；CLI 不自动持久化这些数据集。
