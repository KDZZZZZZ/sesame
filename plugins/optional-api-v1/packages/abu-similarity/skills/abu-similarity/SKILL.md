---
name: abu-similarity
description: 市场相似性研究基线，计算对齐收益相关、秩相关和方向一致率。
license: GPL-3.0-only
---

# abu-similarity

使用前读取 `references/method.md` 和 `examples/input.json`。

**本包代码是可修改、可验证的基线，不是标准答案。Agent 可以按需求改进。** 任何改进必须保留原始 baseline、输入、参数、差异和样本外验证。

适合回答“这些标的在给定历史窗口里走势是否相似”。相关性不是因果关系，也不是未来收益概率。

通过 native 工具调用时，结果会带 `input_dataset_id` 与 `dataset_id`，表示宿主登记的固定输入/输出数据集；CLI 不自动持久化这些数据集。
