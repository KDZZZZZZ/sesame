# Optional Plugin API 1 integrations

These are independent development packages for a matching Plugin API 1 host. They are not in Sesame 0.1.4's stable website catalog or the 19-package official application lock. Plugin load/inspection does not silently download a trading terminal or large Python environment.

| Exact name | Actual role | Prerequisites and tested scope |
| --- | --- | --- |
| `sesame/akshare` | Research instrument search and historical daily bars | Reuses compatible Python; explicit private setup. Real macOS install/import and one EastMoney daily-history request passed. Other endpoints encountered actual TLS/proxy errors. No real-time trading. |
| `sesame/vnpy` | Actual CTA backtesting of authored Python against fixed DataRefs | Reuses native VeighNa 4.5.0 / CTA 1.4.1. Real macOS engine, simulated matching, errors, warmup and frozen artifacts verified. Not a broker bridge or SVL equivalence claim. |
| `sesame/qmt` | Read-only MiniQMT market and account adapter | Requires existing broker-authorized Windows MiniQMT and compatible Python/XtQuant. Contract fixtures and actual unsupported-platform behavior verified. No native Windows broker validation or trading claim. |

## Install through a matching development host

The plugin-manager package's `plugin_catalog` reads `catalog.json` here. Give the Agent an exact name, inspect the returned metadata and `catalog_digest`, then call `plugin_install_catalog`. That tool downloads files only at the catalog's fixed source commit, checks every byte and tree digest, calls `plugin_test`, installs the exact tested digest, reads activation status and loads the package into the current session. Native `plugin_test` is static manifest/schema/JavaScript validation; it does not execute tools or certify behavior. Explicit environment inspection and actual capability checks follow loading.

The directory is development-only and requires Plugin API 1. A stable 0.1.4 installation cannot use these native packages. The stable catalog is deliberately unchanged. A previously installed different version requires an explicit update/rollback with its expected digest; catalog installation does not silently replace it or enable a disabled plugin.

Dependencies, configuration and platform adapters live in each plugin. Check existing installations and saved configuration, reuse them where compatible, prepare only missing dependencies for the requested task, then verify actual calls. Native code uses the current system user's permissions with task process cleanup; it is not an OS sandbox. Trading permissions are not inferred from a successful import or read-only query.

## Reproduce and review

Use Node 24 and set `SESAME_PLUGIN_SDK_LOADER` to the matching public SDK loader, then `npm test`. `npm run test:python` runs controlled Python adapter checks; set `SESAME_VNPY_PYTHON` to an actual compatible environment to also run real engine tests. QMT has a separate explicit Windows native opt-in test; it never runs automatically against a brokerage account. The code and fixtures copy no private application implementation.

`npm run lock` / `npm run check` use the shared data-only package validator. `node scripts/catalog.mjs --check` validates metadata and byte indices; maintainers regenerate with an explicit source commit after reviewing package changes. The separate optional archive uses the same deterministic lock/files structure as the official archive, but is never automatically assembled into the 19-package application set. Each package retains its own MIT license and dependency/source notices; this does not relicense third-party runtimes or the private application.

The current recorded checks are 24 JavaScript tests (23 passed, one explicitly gated Windows native case), 13 Python tests with the real vn.py interpreter (six native engine tests and seven QMT controlled fixtures), and four actual application catalog/session/install/activation/data tests. See individual package VALIDATION.md/README.md for network, precision and target limitations. Review metadata keeps automated identity checks and human review separate; no human security approval is fabricated.
