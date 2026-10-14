---
name: abu-trend
description: 趋势研究基线，计算滚动回归斜率、趋势通道和路径效率。
license: GPL-3.0-only
---

# abu-trend

使用前读取 `references/method.md` 和 `examples/input.json`。

**本包代码是可修改、可验证的基线，不是标准答案。Agent 可以根据需求改进。** 修改时要保留原始输出和差异说明，记录固定样本外验证。

适合把收盘价趋势压缩为少量可解释特征：回归斜率、标准化斜率、通道和路径效率。结果是研究观察，不是买卖建议或成交证明。

通过 native 工具调用时，结果会带 `input_dataset_id` 与 `dataset_id`，表示宿主登记的固定输入/输出数据集；CLI 不自动持久化这些数据集。
