---
name: abu-volatility
description: 波动研究基线，计算收益波动、ATR、跳空和 VWAP。
license: GPL-3.0-only
---

# abu-volatility

使用前读取 `references/method.md` 和 `examples/input.json`。

**本包代码是可修改、可验证的基线，不是标准答案。Agent 可以按需求改进。** 改进时保留原版、参数、输入摘要、全部试验与 holdout 结果。

适合生成波动研究证据：rolling returns、ATR、gap、VWAP。输出不是订单、风控指令或业绩证明。

通过 native 工具调用时，结果会带 `input_dataset_id` 与 `dataset_id`，表示宿主登记的固定输入/输出数据集；CLI 不自动持久化这些数据集。
