---
name: ccxt-public-markets
description: Use explicit CCXT exchange public spot instruments, UTC candles and dashboard subscriptions; no keys or trading.
---

1. Load `sesame/ccxt`. `ccxt_environment inspect` checks existing native Python; `prepare` first reuses pinned CCXT 4.5.85 and installs private dependencies from official PyPI only if unavailable. Configure an existing executable explicitly when known. Never upgrade a shared environment or install globally.
2. Discover `sesame.market` provider `sesame/ccxt:market`. Bind with explicit `configuration.exchange` = `kraken`, `coinbase` or `okx`. Persist returned exact connection revision. Do not silently switch exchange/source if networking fails.
3. Search/describe an actual spot instrument. Data uses this explicit exchange's normalized CCXT symbol, UTC timestamps, base-asset volume. Supported spec: 1m/5m/15m/1h/1d, last, none, session all/default, calendarRevision unknown. Network or missing dependency errors are not empty success.
4. History is one bounded native window of <=500 rows, paged immutably; larger range coverage stays partial/unknown. Backward starts with the latest requested bounded window; pages remain ascending. A later source candle proves prior closure; receipt clock does not. includeForming false is respected.
5. Bind dashboard bars via generic host contracts; polling is 60s, not exchange ticks. Close subscriptions/unbind on completion. Stream gaps require resnapshot. No account/order/private API capability exists. Never add exchange credentials.
6. Freeze research data through generic data-access. Read-only public candles do not prove trade permission or a broker session. Native float-derived Decimal strings cannot restore exchange precision lost by CCXT.

`inspect` validates and selects a compatible existing environment by saving only a private selection receipt. It never installs or upgrades dependencies. Ready after inspect is immediately usable; prepare is needed only when no compatible dependency is found.
