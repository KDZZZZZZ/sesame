---
name: abu-seasonality
description: ABU-inspired UTC weekday conditional-return research baseline.
---

使用前读取 `references/method.md`。本插件是日历条件收益基线，不是标准答案。Agent 可改进或替换为交易所日历、更细 session，但必须保留 baseline、假设、变更、试验和 holdout。

调用 `abu_seasonality_analyze` 或运行 `node scripts/baseline.mjs examples/input.json`。

原生工具会自动登记输入和输出数据集；CLI 只做本地计算，不登记数据集。
