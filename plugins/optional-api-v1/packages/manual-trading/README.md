# Agent manual trading

`sesame/manual-trading` coordinates user-directed manual trading with existing supported backend plugins. It requires Sesame 0.2.1+. Before using a backend, read that plugin's own prompt, skill and declared trading resources. Its tool schemas and documentation define its actual order types, parameters, account configuration, platform requirements and recovery procedure. This package does not redefine them or imply support for every backend.

Only an explicit trading instruction or a clearly bounded authorized task permits an order. Installation, research, a backtest and account permissions are not trading instructions. Reuse valid authorization for the current task; do not ask again for each necessary check. Keep the selected account, quantity and price bounds aligned with that instruction.

Use M5 or longer. This release refuses M1. A model can take minutes even when an API takes milliseconds. Measure observation-to-decision-to-submission age separately from quote request, quote-to-send and send-to-receipt durations. No real M1 execution benchmark is claimed.

Decision expiry is 60 seconds from the original quote's source time. A newly read quote may be at most 5 seconds old. Recheck account, order constraints, source time and expiry after any queue or startup delay, immediately before submission; at most 1 second may pass after the final quote. A 10-second wait can expire while the broker processes a send, so timeout becomes unknown, never automatic retry. A quote-price boundary does not guarantee a market fill price.

Stable operation IDs and durable receipts prevent duplicate submissions through this plugin. One observation supports one order. An unresolved account order blocks replacement IDs; an empty broker query is not proof of rejection. Distinguish dispatch, acceptance, partial fill, completed fill, cancellation request and confirmed cancellation. Recover against the same account using exact native identities and verified records, following the selected backend's own instructions. Preserve uncertainty when the evidence is incomplete.

State survives reload. This is not a claim of broker-level exactly-once delivery or atomicity against external account changes. No real order, account change or live latency benchmark was used in the controlled validation.

Report account, instrument, direction, quantity, requested bounds, actual outcome and native IDs. Show source time, model decision age, quote-to-send and send-to-receipt durations separately. State missing evidence plainly. Read the selected backend's declared resources for its concrete API and recovery steps.
