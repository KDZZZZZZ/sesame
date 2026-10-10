# Optional quantitative backend skill boundaries

Both packages target API1 / Sesame >=0.2.0-0 (stable minimum 0.2.0), are discoverable and do not download at startup. They are not members of the default bundle. No account credentials or trading APIs are exposed.

| Existing host skill | New package-specific addition | Duplication avoided |
| --- | --- | --- |
| orchestration / plugin management | `ccxt_environment` or `backtrader_environment`: inspect configured/existing Python first, explicit private prepare only if absent | No replacement plugin installer, global Python manager, implicit startup download |
| data-access | CCXT explicit exchange/source and UTC spot OHLCV constraints; Backtrader accepts exact immutable json-rows DataRef | No second artifact store, market router or hidden source fallback |
| reports | Backtrader returns actual equity/trades/orders DataRefs and strategy.result | No second dashboard/report renderer |
| native strategy research | One authored `backtrader.Strategy`; fixed stocklike cash simulation | No SVL compiler/equivalence claim, broker or MT5/QMT/vn.py duplication |

License boundaries: CCXT adapter files are original MIT; the separately installed CCXT dependency is MIT. Backtrader adapter files are original GPL-3.0-or-later; the separately installed Backtrader engine is GPL-3.0-or-later. The engine is downloaded separately and runs in an independent process; these are component license declarations, not a legal conclusion about host distribution. Python libraries are fetched on demand, not vendored into these packages.

Host integration test: `SESAME_HOST_ROOT=/absolute/host SESAME_QUANT_PYTHON=/absolute/native/python node --import /absolute/host/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/tests/ccxt-backtrader-host.test.mjs`. It uses only owned temporary Store/workspace/data, the formal manager test/install/activate flow and actual Cerebro. Its synthetic six-bar input is explicitly `demo`; it is not evidence of market performance. CCXT contract fixtures are fixed responses and are not real network evidence.
