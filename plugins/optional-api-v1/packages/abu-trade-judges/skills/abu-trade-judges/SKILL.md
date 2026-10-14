---
name: abu-trade-judges
description: Score a query trade against prior completed trades with transparent nearest neighbors.
---

Use this skill when an Agent needs an auditable judge baseline using completed trades and timestamped features.

Read `references/method.md` first. This code is a baseline, not a standard answer. It is deliberately not ABU UMP/GMM equivalence. Improvements must preserve original output, hypothesis, change, trials, fixed holdout and evidence that labels were known before query decisions.

说明：这里的具体代码是基线，不是标准答案；Agent 可以根据需求改进或修改，但必须保留来源、假设、变化、试验和固定对照。
