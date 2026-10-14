---
name: abu-stock-screening
description: 股票筛选研究基线，按价格、动量、趋势和路径效率排序有界股票池。
license: GPL-3.0-only
---

# abu-stock-screening

使用前读取 `references/method.md` 和 `examples/input.json`。

**本包代码是可修改、可验证的基线，不是标准答案。Agent 可以按需求改进。** 改进必须记录原版、假设、参数、样本外验证、失败条件和是否影响已挂载策略。

适合在固定股票池上做可解释筛选，给 manual-trading、研究报告或策略复盘提供候选排序。排序不是成交、推荐或收益承诺。

通过 native 工具调用时，结果会带 `input_dataset_id` 与 `dataset_id`，表示宿主登记的固定输入/输出数据集；CLI 不自动持久化这些数据集。
