# Provenance

Original Sesame JavaScript implementation, MIT. No customer credentials, accounts, orders or third-party strategy is included. No new runtime dependency.

Architecture references inspected 2026-10-13:

- [TradingAgents](https://github.com/TauricResearch/TradingAgents), MIT, commit `1394a3f72aa4393e1a98f51b382434c4b4c2d972`: parallel analyst reports, bounded bull/bear debate, risk/portfolio-manager handoff and decision/outcome/reflection memory. [Graph implementation](https://github.com/TauricResearch/TradingAgents/blob/1394a3f72aa4393e1a98f51b382434c4b4c2d972/tradingagents/graph/setup.py). Adapted communication pattern for Sesame tasks; no import of its Python engine or claim of equivalent benchmark results.
- [META paper](https://arxiv.org/abs/2609.28771) and [published implementation](https://github.com/KriXord/Agent-Memory-with-Episodic-Retrieval-for-Financial-Decision-Making): episodic decision/outcome/reflection retrieval. Sesame uses explicit account/symbol/time filtering; this is not a claimed reproduction of embedding retrieval.
- [Rallies official product report](https://rallies.beehiiv.com/p/we-are-building-an-ai-hedge-fund): research coverage and shared portfolio/research visibility. Rallies internals are not represented as open source.
- [Rallies Arena](https://rallies.ai/arena): reference for a light canvas, horizontal model summaries and readable activity below the main visualization. Sesame uses its own light layout without Rallies branding or navigation, matching the application's `#fafafa` background. The collaboration UI, native task observation, event transport and saved records are original implementations; no Rallies code or assets are bundled.
- judgment/ incorporates Sesame's existing MIT judgment-evolution service with namespaced tools/storage and grounded review. Old user data is not overwritten.
- [ChatDev 2.0](https://github.com/OpenBMB/ChatDev/tree/4fb2db0ea90375ce1059f44fe03ffbd191a7a169), Apache-2.0, inspected 2026-10-14: [real node events](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/frontend/src/pages/LaunchView.vue#L2236-L2317), [SVG path movement](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/frontend/src/pages/LaunchView.vue#L1971-L2092), and [busy node actions](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/frontend/src/components/WorkflowNode.vue#L47-L88) informed the event-driven animation. Sesame's own implementation moves model badges on successful structured report reads, without copying ChatDev code, characters or branding. SSE remains the read-only transport; reconnects do not replay old animation. Only the whole run produces a final summary file.

M5 cadence, five-minute portfolio target lifetime, 60-second atomic observation lifetime, five-second quote age and one-second quote-to-send budget are product defaults, not empirical vendor guarantees. Fixtures validate enforcement, not market performance. Unknown broker effects remain unknown and are not automatically replayed.

Version 2.1 adds optional per-plan ABU topic selection. This MIT file contains only plugin/tool identity metadata and public-port composition; the independent GPL-3.0-only ABU algorithm packages retain their own source and license. Selection adds research tools to analyst/manager tasks only, and persists their datasets in the existing decision evidence.

## 3.0 组合边界

调度和研究工具选择不再依赖后端品牌或 ABU 名称白名单。原生适配、目标差额和下单保护移入独立 portfolio-execution；工作流只接受能力工具引用与真实回执。宿主调用链证明替代新路径对特定工作流名称的反向依赖，旧后端签名路径仍保留兼容。没有新增第三方运行依赖。
