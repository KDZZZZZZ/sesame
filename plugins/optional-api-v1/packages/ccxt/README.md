# CCXT optional public spot provider

Discoverable, never default. Implements generic market search/description and UTC historical/forming bar queries plus one-second polling subscriptions. Explicit exchanges: Kraken, Coinbase and OKX. No API key, account, order or trading tools. Network availability and exchange-specific histories differ; a native response is limited to 500 rows for Kraken and 300 for Coinbase/OKX and never claims full range coverage. CCXT latest candles may be incomplete: only a later source candle confirms prior closure, never the HTTP observation clock.

Configured public connections reuse a bounded Python worker, CCXT exchange, market directory and HTTP session across refreshes and symbol changes. Reads are serialized on each exact exchange/proxy route so the exchange's rate limiter remains effective. The first snapshot is read immediately; the one-second refresh interval starts after each completed read. Each route keeps its native CCXT rate limiter shared by charts, history and internal market-directory requests; endpoint costs can require longer waits. Network latency and upstream limits may make updates slower, and other programs sharing the same public IP can still cause rate limiting. This is public HTTP polling, not an exchange tick feed. The latest tail is aligned to current UTC candles and each source's real request cap.

An upstream failure leaves the configured route intact and reports a stream gap for the host to restore from a snapshot. Restarting a failed native worker uses the same selected environment and exact route. Canceling one chart never terminates other reads sharing its session. Up to eight routes are retained, idle connections expire after five minutes, and unloading the plugin closes its processes. Market metadata refreshes every five minutes while in use.

`ccxt_environment` inspects/reuses existing 64-bit native Python >=3.11 and CCXT 4.5.85. Explicit prepare installs into this plugin's private data only, with persistent pip cache and official PyPI download hashes/report. Failure retains the private dependency cache for explicit retry; no startup/global installs or shared-environment upgrade. Agent skill gives the generic host bind/read/live/data-access path rather than duplicate dashboard tools.

Adapter: MIT. CCXT library: MIT, obtained separately from official PyPI, not bundled. References: [CCXT manual](https://docs.ccxt.com/docs/manual), [CCXT source/license](https://github.com/ccxt/ccxt), [pinned distribution](https://pypi.org/project/ccxt/4.5.85/). Data licenses and exchange usage terms remain upstream-specific. Precision and coverage limitations are explicit.

If direct exchange connectivity is unavailable, the user may explicitly select `configuration.publicProxy` as a credential-free HTTP(S) URL. The plugin never reads system proxy settings or account keys; the selected route contributes to the connection revision. No exchange fallback occurs automatically.

`inspect` validates and selects a compatible existing environment by saving only a private selection receipt. It never installs or upgrades dependencies. A missing optional library returns `ready:false`; prepare is needed only when no compatible dependency is found. `ready:true` proves dependency readiness, not exchange connectivity. This adapter does not inherit `HTTPS_PROXY`: when the existing authorized network route requires a proxy, explicitly supply it as `configuration.publicProxy`.

Display decimals are derived from the source CCXT precisionMode: DECIMAL_PLACES uses its declared count and TICK_SIZE uses the exact decimal tick's scale (maximum 20 places). Significant-digit or missing modes and greater precision are explicitly unsupported by describeInstrument; there is no blanket eight-decimal assumption. This is display metadata, not a claim that the exchange accepts an executable order at that tick.

Version 1.0.1 strictly accepts only configuration.exchange and optional configuration.publicProxy. First explicit bind persistently records the exact credential-free public route in plugin-private storage. A subsequent connection-only bind, including after host restart, restores only the matching connection ID/revision; missing records or wrong fields fail before any request. Explicit direct example: `{configuration:{exchange:'kraken'}}`; explicit proxy example: `{configuration:{exchange:'kraken',publicProxy:'http://127.0.0.1:7897'}}`. Never use `proxy` or `proxyUrl` aliases.

Upgrade from 1.0.0: no route can be recovered from a hash alone. Once the user/Agent explicitly binds the same authorized exchange/publicProxy configuration, its unchanged CCXT library+route connection revision is registered persistently. Existing chart connectionRefs matching that exact revision can then bind again. An unknown older reference is rejected until its authorized public configuration is supplied; there is no fallback or implicit proxy discovery.

## Internal responsibilities

The public `CCXTProvider` class, `descriptor` and `displayDecimals` exports remain available from `provider.js`. Package-local modules receive that same provider instance; they do not create parallel binding, cursor or subscription state.

| Module | Responsibility |
| --- | --- |
| `provider.js` | Class facade and sole owner of bindings, frozen pages, revision cache, monotonic sequence, confirmed closure boundaries and stream handles. Retains pagination, unbind and disposal. |
| `connection.js` | Explicit route validation and private persistence, connection-only restoration, bound-source checks, native request receipt and metadata. |
| `instruments.js` | Public spot directory search, instrument mapping and source precision interpretation. |
| `history.js` | Supported intervals and source caps, exact UTC bounds, OHLC/volume validation, source-confirmed candle closure and partial coverage. |
| `stream.js` | Initial tail/backfill, serial polling, revision deltas, gap detection and owned stream cancellation. |

`worker.js` and `worker-call.js` retain the existing bounded pool of long-lived processes, exact route isolation and cancellation behavior. `records.js` retains its original private database and connection pool. No new SDK, installer, shared plugin or API dependency is introduced.

From the host repository, set `SESAME_HOST_ROOT` to that repository and run the deterministic regressions:

```text
node --import ./modules/plugins/sdk-loader.js --test ../sesame/plugins/optional-api-v1/tests/ccxt-provider.test.mjs ../sesame/plugins/optional-api-v1/tests/ccxt-worker.test.mjs ../sesame/plugins/optional-api-v1/tests/ccxt-route-host.test.mjs
node --import ./modules/plugins/sdk-loader.js --test --test-name-pattern="CCXT formal install/load" ../sesame/plugins/optional-api-v1/tests/ccxt-backtrader-host.test.mjs
```

From the public plugin repository:

```text
python -B -I plugins/optional-api-v1/tests/ccxt-bridge.test.py
```

The worker fixture runs a local JSONL Python process with synthetic responses. The HostContext fixture installs the real package and overrides only its installed native read boundary; it verifies exact-route recovery after Runtime/private-store restart, canvas connection-only binding and a real host data subscription. These tests do not contact exchanges, install CCXT or prepare an environment. An unset `SESAME_HOST_ROOT` skips the host test and is not proof that restart recovery passed.
