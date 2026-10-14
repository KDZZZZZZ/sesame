---
name: abu-moving-average
description: ABU-inspired dual moving-average cross research baseline.
---

使用前读取 `references/method.md`。本插件给出可验证、可修改的双均线基线，不是标准答案。Agent 可以替换窗口、均线类型或过滤器，但必须保留 baseline 输出、修改理由、样本外对照和失败试验。

调用 `abu_moving_average_analyze` 或运行 `node scripts/baseline.mjs examples/input.json`。输出是研究观察，不是订单。

原生工具会自动登记输入和输出数据集；CLI 只做本地计算，不登记数据集。
