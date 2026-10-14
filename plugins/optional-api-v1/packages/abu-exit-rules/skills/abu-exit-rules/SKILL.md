---
name: abu-exit-rules
description: ABU-inspired ATR stop, trailing stop and holding-period exit baseline.
---

使用前读取 `references/method.md`。本插件只输出退出观察，不提交订单；它是可改进基线，不是标准答案。Agent 改进时必须保留 baseline、假设、改动、试验和 holdout。

调用 `abu_exit_rules_analyze` 或运行 `node scripts/baseline.mjs examples/input.json`。

原生工具会自动登记输入和输出数据集；CLI 只做本地计算，不登记数据集。
