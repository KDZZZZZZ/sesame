# QMT market and stock account adapter — API 1

Optional plugin `sesame/qmt`. Runs fixed XtQuant calls against an existing authorized Windows x64 MiniQMT. Installation and platform access are explicit; loading the plugin neither downloads dependencies nor starts a broker terminal.

| Contract | Implemented capabilities |
| --- | --- |
| `sesame.market@1`, provider `market` | configured native mainland stock search/describe; quote polling (1-second target, up to 50 symbols); unadjusted regular D1 local history and forming daily-bar polling |
| `sesame.account@1`, provider `account` | one configured STOCK account; asset snapshot, verified mainland stock positions, raw current-day orders/fills (normalized time-dependent queries unsupported) |
| Plugin tools | inspect/configure/verify/prepare; explicit history download; native current-day reads; main-Agent explicitly authorized limit orders and cancellation of accepted Sesame orders |

Quote timestamps retain the actual SDK timestamp or Shanghai wall time. Quote depth sizes are unknown because the native field's unit has not been established for every terminal. Native prices are binary floating point; conversion to decimal text preserves that representation, not decimal arithmetic equivalence. Account mode, buying power, missing P&L and unsupported history stay unknown. Queries returning `None` fail explicitly because XtQuant documents it as either failure or empty result. Only an actual list can prove emptiness.

Daily reads use existing local `get_market_data_ex` data with `fill_data=False`. An explicit `qmt_download_history` requests a bounded daily range; it does not run during load or reads. Forming D1 OHLC is updated from native `get_full_tick` source time, with 09:30–15:00 Asia/Shanghai session bounds. Closure requires a later native trading-day observation or an explicit source closed flag; polling/reception time never proves closure. No minute bars are fabricated. Daily volume remains unknown until native units are verified; the original value remains in `native`. Missing local history is incomplete coverage, not proof that no bars existed.

`queryOrders`/`queryFills` are not declared: native order_time/traded_time units are unverified and cannot satisfy mandatory SourceTime. They explicitly reject normalized calls. `qmt_read orders/fills` preserve current-day raw fields, not historical data or a normalized timestamp contract. Unknown timestamp units and broker-return order types remain unknown. No ticks history, account event stream/ledger, native strategy runner or SVL equivalence is claimed.

Only the main Agent, following an explicit user trading instruction, may call `qmt_order` for limit buy/sell with exact account/revision and positive integer shares. Actual broker validation governs permissions, T+1 available shares, lot rules, session and price limits. `qmt_cancel` accepts only a previous accepted Sesame order and checks its current-day account/remark. A durable intent is stored before native submission: same-operation retries return its stored receipt, including `outcome_unknown`, without sending another command. Unknown outcomes require reading native orders/fills and operator review; never silently issue a new operation ID. Native accepted or cancel-requested is not a fill or cancellation guarantee. No real orders were placed during development.

Configuration lives in plugin-scoped storage. Managed dependencies live below its `environments` directory; existing Python/SDK installations are reused and never mutated. Explicit preparation needs Windows x64 CPython 3.12; the pinned requirements use exact wheel hashes and no arbitrary index or shell arguments. Requirements include third-party packages obtained from their publishers under their own licenses; no vendor binaries or license grant for them are included in this repository.

Validation uses contract fixtures and the real failure path on other platforms. Windows process lifecycle, dependency installation and broker access require the opt-in native test on an authorized Windows machine. A fixture is not proof of live QMT integration.

Maintainer checks: run `node --import "$SESAME_PLUGIN_SDK_LOADER" --test plugins/optional-api-v1/tests/qmt.test.mjs` and `python -B -I plugins/optional-api-v1/tests/qmt_bridge_test.py`. On the authorized Windows host, set `QMT_NATIVE_TESTS=1`, `QMT_PYTHON`, the verified `QMT_MARKET_PORT`, and `QMT_TEST_SYMBOL`, then run `node --test plugins/optional-api-v1/tests/qmt-native.test.mjs`. The native test only imports the SDK and reads one actual quote; it neither installs dependencies nor calls the order API.

API mapping audited against [official quick start](https://dict.thinktrader.net/nativeApi/start_now.html), [XtData](https://dict.thinktrader.net/nativeApi/xtdata.html), [XtTrader](https://dict.thinktrader.net/nativeApi/xttrader.html), and the publisher's [250807.1.2 wheel](https://pypi.org/project/xtquant/250807.1.2/) (SHA-256 `91f19ff9a92971c5abe64fbd077e5212e0418f0820aa3427aef3444230f72921`). See the bundled skill for the operational procedure.

## Environment setup

Installation does not initialize dependencies or download them at startup. Inspect and reuse an existing configured environment first; explicitly prepare missing dependencies only when needed.
