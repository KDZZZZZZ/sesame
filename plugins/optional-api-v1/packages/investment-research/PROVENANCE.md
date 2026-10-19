# Provenance

Original Sesame JavaScript implementation, MIT. This package separates the research responsibility previously held by Sesame's combined manual-trading package. Its native workflow, fixed artifacts and report binding use the public Sesame host interfaces; no third-party execution engine is bundled.

The previous package recorded the following architecture reference, retained here with the research responsibility:

- [TradingAgents](https://github.com/TauricResearch/TradingAgents), MIT, commit `1394a3f72aa4393e1a98f51b382434c4b4c2d972`: analyst evidence, bull/bear scenarios, risk review and manager synthesis. [Referenced graph](https://github.com/TauricResearch/TradingAgents/blob/1394a3f72aa4393e1a98f51b382434c4b4c2d972/tradingagents/graph/setup.py). This is an adapted communication pattern, not a Python-engine import or a claim to reproduce its benchmark results.

Sources and numerical methods remain separately selected plugins with their own provenance and licenses. The research manager uses the independent reports plugin; this package does not copy its renderer. No account credentials, user research or market dataset is included in the package.
