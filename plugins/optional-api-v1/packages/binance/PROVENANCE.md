# API provenance

Checked against Binance's official documentation on 2026-10-24. This is an independently authored adapter, with no copied vendor SDK or added dependency.

- [Spot REST API](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md): endpoints, HMAC, timestamps, request weight, order client IDs, account/order/fill fields and ambiguous outcomes.
- [Spot WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md): raw stream URLs, kline/ticker payloads, 24-hour lifetime and ping/pong.
- [Spot Testnet REST API](https://github.com/binance/binance-spot-api-docs/blob/master/testnet/rest-api.md): distinct test endpoint and signed request semantics.
- [Symbol filters](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md): price ticks, lot sizes and notional filters.
- [Order amend keep priority](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/order_amend_keep_priority.md): quantity reduction and client-ID retention.
- [Market-data-only endpoints](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md): public production REST/WebSocket domains.

The plugin uses the installed Sesame public SDK for protocol and decimal helpers. Source schema shapes follow the repository's existing CCXT/QMT API 2 declarations; no imports cross package implementation boundaries.
