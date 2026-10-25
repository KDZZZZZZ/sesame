# Provenance

Original Sesame JavaScript implementation, MIT. No customer credentials, accounts, orders or third-party strategy is included. No new runtime dependency.

Architecture references inspected 2026-10-13:

- [TradingAgents](https://github.com/TauricResearch/TradingAgents), MIT, commit `1394a3f72aa4393e1a98f51b382434c4b4c2d972`: parallel analyst reports, bounded bull/bear debate, risk/portfolio-manager handoff and decision/outcome/reflection memory. [Graph implementation](https://github.com/TauricResearch/TradingAgents/blob/1394a3f72aa4393e1a98f51b382434c4b4c2d972/tradingagents/graph/setup.py). Adapted communication pattern for Sesame tasks; no import of its Python engine or claim of equivalent benchmark results.
- [META paper](https://arxiv.org/abs/2609.28771) and [published implementation](https://github.com/KriXord/Agent-Memory-with-Episodic-Retrieval-for-Financial-Decision-Making): episodic decision/outcome/reflection retrieval. Sesame uses explicit account/symbol/time filtering; this is not a claimed reproduction of embedding retrieval.
- [Rallies official product report](https://rallies.beehiiv.com/p/we-are-building-an-ai-hedge-fund): research coverage and shared portfolio/research visibility. Rallies internals are not represented as open source.
- Judgment verification and criteria are provided by the independent MIT sesame/judgment-evolution plugin. Version 3.1 removes the previously embedded copy, its tools and audit hook; existing private user data is not read, migrated or deleted by this change.

## Trading-decision boundary

The research collaboration is now owned by the independent investment-research plugin. This package retains only authorized manager/executor decisions, explicit fixed research references, personal risk-rule consumption, scheduling, target freezing, genuine execution receipts and outcome-based review. Native execution and order ledgers belong to portfolio-execution; no legacy import bridge or copied research engine remains here. Existing old private data is neither read nor deleted by renaming this package.

The workflow uses the host's native Run view and controls. The post-execution report is a normal report artifact with immutable evidence; no separate live HTML or SSE protocol is supplied. No new third-party runtime dependency is added.
