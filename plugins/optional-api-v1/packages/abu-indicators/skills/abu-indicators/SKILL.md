---
name: abu-indicators
description: 技术指标研究基线，计算 SMA、EMA、MACD、RSI、布林带和 ATR。
license: GPL-3.0-only
---

# abu-indicators

使用本包时，先读取 `references/method.md` 和 `examples/input.json`。

**本包代码是可修改、可验证的基线，不是标准答案。Agent 可以按具体研究任务改进。** 改进时保留原始 baseline 输出，记录需求、假设、变更、参数、输入摘要、样本外验证和失败条件。

适用任务：需要在固定 OHLCV 数据上计算 SMA、EMA、MACD、RSI、布林带或 ATR，并把结果作为研究证据提供给策略、复盘或 manual-trading。

通过 native 工具调用时，结果会带 `input_dataset_id` 与 `dataset_id`，表示宿主登记的固定输入/输出数据集；CLI 不自动持久化这些数据集。

约束：不要把观察结果当成交或收益证明；不要默认参数最优；不要在未验证供应商时间戳和复权规则时声称历史真实无误。
