---
name: abu-position-sizing
description: ABU-inspired ATR risk budget, fractional Kelly and price-rank sizing baseline.
---

使用前读取 `references/method.md`。本插件输出仓位研究量，不自动换算券商手数或下单；它是可改进基线，不是标准答案。Agent 改进时必须保留 baseline、假设、改动、试验和 holdout。

调用 `abu_position_sizing_analyze` 或运行 `node scripts/baseline.mjs examples/input.json`。

原生工具会自动登记输入和输出数据集；CLI 只做本地计算，不登记数据集。
