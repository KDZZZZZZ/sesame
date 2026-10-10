# CCXT optional public spot provider

Preview requires Sesame >=0.2.0-0 (target stable 0.2.0). Discoverable, never default. Implements generic market search/description and UTC historical/forming bar queries plus 60s polling subscriptions. Explicit exchanges: Kraken, Coinbase and OKX. No API key, account, order or trading tools. Network availability and exchange-specific histories differ; one response is <=500 rows and never claims full range coverage. CCXT latest candles may be incomplete: only a later source candle confirms prior closure, never the HTTP observation clock.

`ccxt_environment` inspects/reuses existing 64-bit native Python >=3.11 and CCXT 4.5.85. Explicit prepare installs into this plugin's private data only, with persistent pip cache and official PyPI download hashes/report. Failure retains the private dependency cache for explicit retry; no startup/global installs or shared-environment upgrade. Agent skill gives the generic host bind/read/live/data-access path rather than duplicate dashboard tools.

Adapter: MIT. CCXT library: MIT, obtained separately from official PyPI, not bundled. References: [CCXT manual](https://docs.ccxt.com/docs/manual), [CCXT source/license](https://github.com/ccxt/ccxt), [pinned distribution](https://pypi.org/project/ccxt/4.5.85/). Data licenses and exchange usage terms remain upstream-specific. Precision and coverage limitations are explicit.

If direct exchange connectivity is unavailable, the user may explicitly select `configuration.publicProxy` as a credential-free HTTP(S) URL. The plugin never reads system proxy settings or account keys; the selected route contributes to the connection revision. No exchange fallback occurs automatically.

`inspect` validates and selects a compatible existing environment by saving only a private selection receipt. It never installs or upgrades dependencies. Ready after inspect is immediately usable; prepare is needed only when no compatible dependency is found.

Display decimals are derived from the source CCXT precisionMode: DECIMAL_PLACES uses its declared count and TICK_SIZE uses the exact decimal tick's scale (maximum 20 places). Significant-digit or missing modes and greater precision are explicitly unsupported by describeInstrument; there is no blanket eight-decimal assumption. This is display metadata, not a claim that the exchange accepts an executable order at that tick.
