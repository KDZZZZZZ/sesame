---
name: abu-breakout
description: ABU-inspired prior-window breakout research baseline.
---

使用本技能时，先读取 `references/method.md` 和包内 `examples/input.json`。本插件提供的是可修改研究基线，不是标准答案；Agent 可以改进，但要保留原版输出、变更假设、试验记录和样本外对照。

调用 `abu_breakout_analyze` 或运行 `node scripts/baseline.mjs examples/input.json`。输出里的信号只是下一时段可观察的研究事件，不是成交、订单或收益承诺。

原生工具会自动登记输入和输出数据集；CLI 只做本地计算，不登记数据集。
