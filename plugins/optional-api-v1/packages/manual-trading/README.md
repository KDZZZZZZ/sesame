# Agent manual trading

`sesame/manual-trading` provides five main-Agent tools on top of existing configured trading backends. It stores no broker password and installs no terminal or Python environment. It requires Sesame 0.2.1+ with the public `host.tools.call({pluginId,name,arguments}, signal)` port; older hosts fail explicitly before calls.

| Tool | Result |
| --- | --- |
| `manual_trade_inspect` | Actual supported channels and latency policy; no connection or trading. |
| `manual_trade_observe` | Account, symbol conditions, positions, fresh native quote and one-use observation ID. |
| `manual_trade_execute` | One user-authorized market/limit/position-close on MT5, or limit STOCK order on QMT. |
| `manual_trade_status` | Durable receipt; optional actual order/fill queries. Never resends. |
| `manual_trade_cancel` | Cancellation request for a confirmed pending order previously created here. |

The accepted decision timeframes are 5m, 15m, 30m, 1h, 4h and 1d (default 5m). This release refuses M1. A model can take minutes even when an API takes milliseconds. Observe→model decision→native send age is recorded separately from quote-request, quote-to-send and send-to-receipt durations. No real M1 execution benchmark is claimed.

Decision expiry is 60 seconds from the original quote's source time. A newly read tick may be at most 5 seconds old. The native guard checks again after process startup/queueing and before SDK send; at most 1 second may pass after the final quote. A 10-second wrapper wait can expire while the broker processes a send, so timeout becomes **unknown**, never automatic retry. Cancellation does not recall an already received order.

Stable operation IDs and private durable receipts prevent duplicate submissions through this plugin. One observation supports one order. An unresolved account order blocks replacement IDs; an empty broker query is not negative proof. State survives reload, and in-process duplicate requests are serialized in the plugin's own queue. This does not hold the host configuration lock across another plugin's tool. It is not a claim of broker-level exactly-once delivery or atomicity against a user changing accounts directly in a terminal.

MT5 requires `sesame/mt5 >=1.3.0` with its existing official Python SDK channel. QMT requires `sesame/qmt >=1.2.0` on authorized native Windows MiniQMT. The actual native account and existing permissions remain authoritative. No live call, account change or trade was used for the package's controlled validation. QMT broker acceptance remains unverified on this Mac development host.

Read [backend coverage](BACKENDS.md), the skill and each backend's TRADING.md. Tests are in `../../tests/manual-trading.test.mjs` and `../../tests/execution_guard_test.py`; run with the matching host public SDK loader and Python 3. Fixtures are fictional and never contact a broker.
