# QMT read adapter — API 1

Optional plugin `sesame/qmt`, not part of the 19 official package archive. Runs fixed, read-only XtQuant calls against an existing authorized Windows x64 MiniQMT. Installation and platform access are explicit; loading the plugin neither downloads dependencies nor starts a broker terminal.

| Contract | Implemented capabilities |
| --- | --- |
| `sesame.market@1`, provider `market` | configured native mainland stock sector search/describe; `get_full_tick` quote snapshots polled without overlap, 1 second target; up to 50 symbols |
| `sesame.account@1`, provider `account` | one configured STOCK account, asset snapshot, verified mainland stock positions |
| Plugin tools | inspect/configure/verify/prepare; native current-day orders and trades without guessed timestamp units or order type conversion |

Quote timestamps retain the actual SDK timestamp or Shanghai wall time. Quote depth sizes are unknown because the native field's unit has not been established for every terminal. Native prices are binary floating point; conversion to decimal text preserves that representation, not decimal arithmetic equivalence. Account mode, buying power, missing P&L and unsupported history stay unknown. Queries returning `None` fail explicitly because XtQuant documents it as either failure or empty result. Only an actual list can prove emptiness.

There is no bars/ticks history, account event stream/ledger, trading, native strategy runner or SVL target. Native orders/trades expose current-day coverage and unconverted source fields. No claimed normalized contract capability silently degrades to these raw results.

Configuration lives in plugin-scoped storage. Managed dependencies live below its `environments` directory; existing Python/SDK installations are reused and never mutated. Explicit preparation needs Windows x64 CPython 3.12; the pinned requirements use exact wheel hashes and no arbitrary index or shell arguments. Requirements include third-party packages obtained from their publishers under their own licenses; no vendor binaries or license grant for them are included in this repository.

Validation uses contract fixtures and the real failure path on other platforms. Windows process lifecycle, dependency installation and broker access require the opt-in native test on an authorized Windows machine. A fixture is not proof of live QMT integration.

Maintainer checks: run `node --import "$SESAME_PLUGIN_SDK_LOADER" --test plugins/optional-api-v1/tests/qmt.test.mjs` and `python -B -I plugins/optional-api-v1/tests/qmt_bridge_test.py`. On the authorized Windows host, set `QMT_NATIVE_TESTS=1`, `QMT_PYTHON`, the verified `QMT_MARKET_PORT`, and `QMT_TEST_SYMBOL`, then run `node --test plugins/optional-api-v1/tests/qmt-native.test.mjs`. The native test only imports the SDK and reads one actual quote; it neither installs dependencies nor calls the order API.

API mapping audited against [official quick start](https://dict.thinktrader.net/nativeApi/start_now.html), [XtData](https://dict.thinktrader.net/nativeApi/xtdata.html), [XtTrader](https://dict.thinktrader.net/nativeApi/xttrader.html), and the publisher's [250807.1.2 wheel](https://pypi.org/project/xtquant/250807.1.2/) (SHA-256 `91f19ff9a92971c5abe64fbd077e5212e0418f0820aa3427aef3444230f72921`). See the bundled skill for the operational procedure.
