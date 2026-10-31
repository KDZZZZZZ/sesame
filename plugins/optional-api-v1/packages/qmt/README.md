# QMT market and stock account adapter — API 2

Optional plugin `sesame/qmt`. Runs fixed XtQuant calls against an existing authorized Windows x64 MiniQMT. Installation and platform access are explicit; loading the plugin neither downloads dependencies nor starts a broker terminal.

| Contract | Implemented capabilities |
| --- | --- |
| `sesame.market@1`, provider `market` | configured native mainland stock search/describe; quote polling (1-second target, up to 50 symbols); unadjusted regular D1 local history and forming daily-bar polling |
| `sesame.account@1`, provider `account` | one configured STOCK account; asset snapshot, verified mainland stock positions, raw current-day orders/fills (normalized time-dependent queries unsupported) |
| Plugin tools | inspect/configure/verify/prepare; explicit history download; native current-day reads; main-Agent explicitly authorized limit orders and cancellation of accepted Sesame orders |

Quote timestamps retain the actual SDK timestamp or Shanghai wall time. Quote depth sizes are unknown because the native field's unit has not been established for every terminal. Native prices are binary floating point; conversion to decimal text preserves that representation, not decimal arithmetic equivalence. Account mode, buying power, missing P&L and unsupported history stay unknown. Queries returning `None` fail explicitly because XtQuant documents it as either failure or empty result. Only an actual list can prove emptiness.

Daily reads use existing local `get_market_data_ex` data with `fill_data=False`. An explicit `qmt_download_history` requests a bounded daily range; it does not run during load or reads. Forming D1 OHLC is updated from native `get_full_tick` source time, with 09:30–15:00 Asia/Shanghai session bounds. Closure requires a later native trading-day observation or an explicit source closed flag; polling/reception time never proves closure. No minute bars are fabricated. Daily volume remains unknown until native units are verified; the original value remains in `native`. Missing local history is incomplete coverage, not proof that no bars existed.

`queryOrders`/`queryFills` are not declared: native order_time/traded_time units are unverified and cannot satisfy mandatory SourceTime. They explicitly reject normalized calls. `qmt_read orders/fills` preserve current-day raw fields, not historical data or a normalized timestamp contract. Unknown timestamp units and broker-return order types remain unknown. No ticks history, account event stream/ledger, native strategy runner or SVL equivalence is claimed.

Only the main Agent, following an explicit user trading instruction, may call `qmt_order` for limit buy/sell with exact account/revision and positive integer shares. Actual broker validation governs permissions, T+1 available shares, lot rules, session and price limits. `qmt_cancel` accepts a previous accepted Sesame order or a retained unknown intent that the native adapter can match, and checks its account/remark. A durable intent is stored before native submission: same-operation retries return its stored receipt, including `outcome_unknown`, without sending another command. Unknown outcomes require reading native orders/fills and operator review; never silently issue a new operation ID. Native accepted or cancel-requested is not a fill or cancellation guarantee. No real orders were placed during development.

Configuration lives in plugin-scoped storage. Managed dependencies live below its `environments` directory; existing Python/SDK installations are reused and never mutated. Explicit preparation needs Windows x64 CPython 3.12; the pinned requirements use exact wheel hashes and no arbitrary index or shell arguments. Requirements include third-party packages obtained from their publishers under their own licenses; no vendor binaries or license grant for them are included in this repository.

Validation uses contract fixtures and the real failure path on other platforms. Windows process lifecycle, dependency installation and broker access require the opt-in native test on an authorized Windows machine. A fixture is not proof of live QMT integration.

Maintainer checks: run `node --import "$SESAME_PLUGIN_SDK_LOADER" --test plugins/optional-api-v1/tests/qmt.test.mjs` and `python -B -I plugins/optional-api-v1/tests/qmt_bridge_test.py`. On the authorized Windows host, set `QMT_NATIVE_TESTS=1`, `QMT_PYTHON`, the verified `QMT_MARKET_PORT`, and `QMT_TEST_SYMBOL`, then run `node --test plugins/optional-api-v1/tests/qmt-native.test.mjs`. The native test only imports the SDK and reads one actual quote; it neither installs dependencies nor calls the order API.

API mapping audited against [official quick start](https://dict.thinktrader.net/nativeApi/start_now.html), [XtData](https://dict.thinktrader.net/nativeApi/xtdata.html), [XtTrader](https://dict.thinktrader.net/nativeApi/xttrader.html), and the publisher's [250807.1.2 wheel](https://pypi.org/project/xtquant/250807.1.2/) (SHA-256 `91f19ff9a92971c5abe64fbd077e5212e0418f0820aa3427aef3444230f72921`). See the bundled skill for the operational procedure.

## Shared configuration

Settings → Integrations exposes the existing six fields: `python_path`, `userdata_directory`, `account_id`, `broker`, `market_port`, and `sector`. All six use the same saved QMT configuration, version, operation records and path validation as `qmt_configure`; there is no second settings store. Account IDs remain strings, including leading zeros. These are connection settings rather than API keys, so their existing public values remain readable.

The host-only immediate `configuration.read` adapter reads saved configuration without discovering Python paths, importing the SDK or checking connectivity. `configuration.update` is restricted to the main conversation's immediate execution and maps the shared `command_id` unchanged to the existing `operation_id`. The original `qmt_configure` and `qmt_environment` schemas remain unchanged. Shared saves retain CAS, exact-input idempotency, existing-path validation, and the original receipt; saving never prepares dependencies, starts MiniQMT, logs in or submits an order. A stale version still returns `STALE_REVISION`.

| Field group | Consuming capabilities |
| --- | --- |
| `python_path`, `market_port` | Native market searches, descriptions, bars, quotes and explicit history downloads. Market-only configuration does not require an account or account directory. |
| `account_id`, `userdata_directory` | Native account reads and explicitly authorized order/cancel paths. Trading identity reads only need the configured account; full snapshots additionally need native access. |
| `broker` | Optional label on account listing and snapshots; the existing display fallback remains. |
| `sector` | Stock catalog searches; the existing `沪深京A股` default remains. |

Requirements attach to the capability and relevant input branch. The saved Python is only an optional candidate for environment verification/preparation, which can select an explicit or discovered candidate. Native reads still require the saved Python as before. Optional dependencies also describe paths that may return a retained receipt without a native call: the original operation still enforces all connection and execution guards when a new native call is needed. Missing market settings do not block account asset reads; missing account settings do not block market reads. Unbind, dispose and main-conversation stored command reads have no new configuration prerequisites.

Clearing `python_path`, `userdata_directory`, `account_id`, `broker` or `market_port` with `null` retains the original null-based behavior. `sector` cannot be cleared, as in the existing API. Configuration presence does not establish SDK availability, broker login, market connectivity or trading authorization.

## Internal responsibilities

`index.js` keeps the same capability factory and one service per plugin storage root. `service.js` assembles the following package-local modules without changing public capability names, descriptors, return values or persistence paths:

| Module | Responsibility |
| --- | --- |
| `provider-state.js` | Sole owner of bindings, frozen pages, item revisions, confirmed daily closure boundaries, polling handles and the service abort lifetime. Unbind releases only that binding; dispose closes all owned streams and clears transient state. |
| `connection.js` | Current configuration, exact connection/binding checks, fixed native transport, read receipts and raw native reads. Late responses cannot cross a configuration revision. |
| `market.js` | Stock catalog mapping, quotes, daily history and polling, forming/closed-bar semantics, and explicit bounded history downloads. |
| `account.js` | Configured account listing, asset snapshot and positions. Unsupported normalized order/fill history remains an explicit error. |
| `commands.js` | Main/workflow authorization, serial submission, account/revision checks, operation fingerprints, durable intent and receipt recovery. |

`records.js` remains the only owner of the private `execution.sqlite` connection pool and synchronous transactions. `configuration.js` retains its existing CAS and preparation behavior; `configuration-adapter.js` only projects that authority into shared settings. The main-Agent `qmt_order`/`qmt_cancel`, lineage-verified `qmt_trading_*`, and host-only positions service retain their distinct authorization checks before sharing the command boundary. `positions.js`, `trading-context.js`, `bridge.py` and `execution_guard.py` retain their T+1, integer quantity and final native validation responsibilities.

The refactor regression commands below use fake transport and synthetic broker objects; they perform no downloads, terminal launches or real trading. From the host repository, set `SESAME_HOST_ROOT` to that repository and run:

```text
node --import ./modules/plugins/sdk-loader.js --test ../sesame/plugins/optional-api-v1/tests/qmt-host.test.mjs ../sesame/plugins/optional-api-v1/tests/qmt-configuration-host.test.mjs ../sesame/plugins/optional-api-v1/tests/qmt.test.mjs ../sesame/plugins/optional-api-v1/tests/qmt-positions-v2.test.mjs ../sesame/plugins/optional-api-v1/tests/trading-decision-backends.test.mjs
```

From the public plugin repository, also run:

```text
python -B -I plugins/optional-api-v1/tests/qmt_bridge_test.py
python -B -I plugins/optional-api-v1/tests/qmt_positions_guard_test.py
```

The HostContext test installs the real package, verifies the declared capability factory, closes and reopens the plugin's private database together with Runtime/Store, and confirms that a retained `outcome_unknown` order is returned without another dispatch. It must run with `SESAME_HOST_ROOT` set; an environment skip does not verify persistence.

The configuration HostContext test also installs the real package, exercises shared catalog/apply/check paths, proves shared and legacy writes reuse one operation receipt, and reopens both stores before retrying an older command. It covers market/account dependency scope, null clearing, absent Python candidates, stored receipts and service-context write rejection. A guarded process entry ensures none of these configuration operations invokes Python or QMT.

## Environment setup

Installation does not initialize dependencies or download them at startup. Inspect and reuse an existing configured environment first; explicitly prepare missing dependencies only when needed.
