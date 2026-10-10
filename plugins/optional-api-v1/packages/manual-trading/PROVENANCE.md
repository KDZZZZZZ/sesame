# Provenance

Original Sesame implementation, MIT within this package. No credential, customer order or third-party strategy is included. Interface facts were checked against the installed backend source and primary documentation on 2026-10-10:

- [MetaTrader MCP capabilities](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities) — native terminal and dynamic catalog boundaries.
- [MetaTrader Python order_send](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py) — official request and receipt; implementation delegates to the existing backend.
- [XtQuant trading documentation](https://dict.thinktrader.net/nativeApi/xttrader.html) — limit order, cancellation and native account queries.

The package policy (M5 minimum, 60-second decision lifetime, 5-second source quote age and 1-second quote-to-send budget) is a conservative product default, not an empirical claim or a vendor guarantee. Fixtures validate enforcement rather than market performance.
