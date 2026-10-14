# Provenance

Original Sesame JavaScript implementation, MIT. No customer credentials, accounts, orders or third-party strategy is included. No new runtime dependency.

Architecture references inspected 2026-10-13:

- [TradingAgents](https://github.com/TauricResearch/TradingAgents), MIT, commit `1394a3f72aa4393e1a98f51b382434c4b4c2d972`: parallel analyst reports, bounded bull/bear debate, risk/portfolio-manager handoff and decision/outcome/reflection memory. [Graph implementation](https://github.com/TauricResearch/TradingAgents/blob/1394a3f72aa4393e1a98f51b382434c4b4c2d972/tradingagents/graph/setup.py). Adapted communication pattern for Sesame tasks; no import of its Python engine or claim of equivalent benchmark results.
- [META paper](https://arxiv.org/abs/2609.28771) and [published implementation](https://github.com/KriXord/Agent-Memory-with-Episodic-Retrieval-for-Financial-Decision-Making): episodic decision/outcome/reflection retrieval. Sesame uses explicit account/symbol/time filtering; this is not a claimed reproduction of embedding retrieval.
- [Rallies official product report](https://rallies.beehiiv.com/p/we-are-building-an-ai-hedge-fund): research coverage and shared portfolio/research visibility. Rallies internals are not represented as open source.
- [Rallies Arena](https://rallies.ai/arena): visual reference for the white canvas, compact navigation, horizontal model summaries and readable activity below the main visualization. The collaboration UI, native task observation, event transport and replay are original Sesame implementations; no Rallies code or assets are bundled.
- judgment/ incorporates Sesame's existing MIT judgment-evolution service with namespaced tools/storage and grounded review. Old user data is not overwritten.

M5 cadence, five-minute portfolio target lifetime, 60-second atomic observation lifetime, five-second quote age and one-second quote-to-send budget are product defaults, not empirical vendor guarantees. Fixtures validate enforcement, not market performance. Unknown broker effects remain unknown and are not automatically replayed.

Version 2.1 adds optional per-plan ABU topic selection. This MIT file contains only plugin/tool identity metadata and public-port composition; the independent GPL-3.0-only ABU algorithm packages retain their own source and license. Selection adds research tools to analyst/manager tasks only, and persists their datasets in the existing decision evidence.
