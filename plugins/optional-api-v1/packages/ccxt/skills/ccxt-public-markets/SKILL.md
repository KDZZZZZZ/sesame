---
name: ccxt-public-markets
description: Use explicit CCXT exchange public spot instruments, UTC candles and dashboard subscriptions; no keys or trading.
---

1. Load `sesame/ccxt`. `ccxt_environment inspect` checks existing native Python; `prepare` first reuses pinned CCXT 4.5.85 and installs private dependencies from official PyPI only if unavailable. Configure an existing executable explicitly when known. Never upgrade a shared environment or install globally.
2. Discover `sesame.market` provider `sesame/ccxt:market`. Bind with explicit `configuration.exchange` = `kraken`, `coinbase` or `okx`. Persist returned exact connection revision. Do not silently switch exchange/source if networking fails.
3. Search/describe an actual spot instrument. Data uses this explicit exchange's normalized CCXT symbol, UTC timestamps, base-asset volume. Supported spec: 1m/5m/15m/1h/1d, last, none, session all/default, calendarRevision unknown. Network or missing dependency errors are not empty success.
4. History is one bounded native window (Kraken <=500, Coinbase/OKX <=300), paged immutably; larger range coverage stays partial/unknown. Backward starts with the latest requested bounded window; pages remain ascending. A later source candle proves prior closure; receipt clock does not. includeForming false is respected.
5. Bind dashboard bars via generic host contracts. The host keeps configured chart subscriptions updating; leave their exact binding on the chart. Close only temporary subscriptions created for bounded agent reads. Polling waits one second after each completed request, subject to network latency and exchange rate limits; it is not an exchange tick feed. Connections, markets and HTTP sessions are reused across symbols. Stream gaps require a fresh snapshot on the same route. No account/order/private API capability exists. Never add exchange credentials.
6. Freeze research data through generic data-access. Read-only public candles do not prove trade permission or a broker session. Native float-derived Decimal strings cannot restore exchange precision lost by CCXT.

`inspect` validates and selects a compatible existing environment by saving only a private selection receipt. It never installs or upgrades dependencies. Ready after inspect is immediately usable; prepare is needed only when no compatible dependency is found.

## Exact public route and dashboard binding

Use `configuration:{exchange:'kraken'}` for an explicitly selected direct route. If the user selects a credential-free proxy, the exact field is `configuration:{exchange:'kraken',publicProxy:'http://127.0.0.1:7897'}`. `proxy`, `proxyUrl`, null/boolean proxy values and unknown fields are rejected; they do not silently select direct access. The local address is an example, not a default. Never read system proxy settings or insert credentials.

The first explicit bind saves only this public configuration in private plugin storage, keyed by its returned exact connection ID/revision. Persist that connection through `canvas_binding`; later dashboard or restarted host connection-only bindings restore exactly the saved route. If the record is missing or mismatched, supply the authorized configuration explicitly instead of guessing or changing routes. `plugin_read` can read this package's `README.md` and `PROVENANCE.md`.
