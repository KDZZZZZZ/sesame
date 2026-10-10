# Optional plugins for Sesame 0.2.0 / Plugin API 1

**Optional plugins for Sesame 0.2.0; installable entries are identified by the published catalog.** These twenty-two packages require `>=0.2.0-0`
(formal minimum 0.2.0, including compatible development builds). Their reviewed
archive identities remain fixed; application installers are listed on the
[release page](https://github.com/KDZZZZZZ/sesame/releases/tag/v0.2.0). They do not
enter the nine-package default lock or the
historical 0.1.4 catalog. Installation/inspection does not silently download a
terminal or a large Python environment.

The optional set contains six backends (MT5, AKShare, QMT, vn.py, CCXT and
Backtrader), eight independent analysis methods, separate strategy and factor
research workflows, judgment-evolution, four web/reference MCP packages and
web-sources. Each method is its own installable package; selecting ICT does not
load Price Action, Elliott Wave, Wyckoff or Dow Theory.
`bundle-profile.json` and the lock enforce this set. The three source moves into
core are described in the [package review](../api-v1/REORGANIZATION.md).
MT5 and judgment start with private plugin storage; neither asks the host for
legacy collection/directory grants. MT5 imports existing native connection
settings only through an explicit action. Frozen historical ArtifactRefs remain
host-readable without granting access to old mutable application collections.

| Exact name | Actual role | Prerequisites and tested scope |
| --- | --- | --- |
| `sesame/akshare` | Research search/history and polled quote/daily-bar subscriptions | Reuses compatible Python; explicit private setup. Real Tencent observations/history, host SSE and downstream vn.py backtest passed. Quotes have unknown freshness and at least 60-second polling; no exchange tick or trading claim. Other endpoints failed explicitly. |
| `sesame/vnpy` | Actual CTA backtesting of authored Python against fixed DataRefs | Reuses native VeighNa 4.5.0 / CTA 1.4.1. Real macOS engine, simulated matching, errors, warmup and frozen artifacts verified. Not a broker bridge or SVL equivalence claim. |
| `sesame/qmt` | MiniQMT daily market/account adapter and explicit stock order/cancel tools | Requires existing broker-authorized Windows MiniQMT and compatible Python/XtQuant. Contract/host fixtures are separate from native Windows broker acceptance, which has not occurred. Readiness never grants trading authorization. |
| `sesame/mt5` | Native terminal, account, compiler, Tester and target workflows | Existing compatible terminal and explicit connection/configuration. No terminal distribution is embedded. |
| `sesame/judgment-evolution` | Private prediction/outcome ledger | Local SQLite; no default legacy-data import. |
| `sesame/web-sources` | Fetch source-labelled web evidence | Network access to the selected source; not a parser or brokerage feed. |
| `sesame/web-extract`, `sesame/rss-collect`, `sesame/market-data-parser` | Parse supplied HTML/feed/JSON/XML | Existing Python 3, standard-library MCP processes; explicit file boundaries. |
| `sesame/quantskills-catalog` | Curated skill reference index | Existing Python 3; guidance, not an execution engine. |
| `sesame/ccxt` | Public spot market data from an explicit Kraken, Coinbase or OKX source | Reuses or explicitly prepares native CCXT 4.5.85. 60-second polling; no private accounts or trading tools. |
| `sesame/backtrader` | Real Cerebro with an authored native Strategy and fixed DataRef | Reuses or explicitly prepares Backtrader 1.9.78.123. Explicit feed timeframe/compression; stocklike cash simulation, no broker connection or SVL equivalence. Optional wrapper and engine are GPL-3.0-or-later. |
| `sesame/ict`, `sesame/price-action`, `sesame/elliott-wave`, `sesame/wyckoff`, `sesame/dow-theory` | Five independently selected technical methods | Each retains its own sources, evidence rules and counterexamples. Only ICT/Price Action include bounded observation helpers; no performance claim. |
| `sesame/behavioral-finance`, `sesame/institutional-analysis`, `sesame/narrative-analysis` | Three independently selected social and interpretive methods | Dated primary evidence, competing explanations and explicit limits; no automatic inference of motives or causation. |
| `sesame/strategy-research` | Separate experiment planning and evidence-ledger workflow | Existing Node.js 22+ for bounded resource checks; actual backtests use a separately selected engine. No algorithm is preselected. |
| `sesame/factor-research` | Separate point-in-time factor diagnostics and fixed-selection holdout workflow | Existing Node.js 22+; descriptive statistics, explicit cost assumptions and trial records. No significance or live execution claim. |

## Install through Sesame 0.2.0 or a compatible API 1 host

The new plugin-manager reads the unified `../api-v1/catalog.json`; the old three-entry
catalog here is retained as historical metadata. The unified directory selects
actually published core dev.14 and optional dev.8: nine defaults and these twenty-two
optional packages. Each entry fixes its source, files, package tree and
publication review. Check the application release page for available installers.

For a released entry, give the Agent an exact name, inspect its metadata and
`catalog_digest`, then call `plugin_install_catalog`. It downloads only fixed source
files, verifies every byte/tree, calls formal `plugin_test`, installs the tested digest,
checks activation and refreshes the current session. Updates explicitly supply the
current `expected_digest`; identical version/bytes return already-installed. Native
tests are manifest/schema/JavaScript checks, not behavioral or environment approval.

The directory requires Plugin API 1 and accepts Sesame 0.2.0 through each package's declared engines range. Its fixed plugin archive tags and existing channel remain unchanged. A 0.1.4 installation cannot use these packages; its historical catalog is deliberately preserved. A previously installed different version requires an explicit update/rollback with its expected digest; catalog installation does not silently replace it or enable a disabled plugin.

Dependencies, configuration and platform adapters live in each plugin. Check existing installations and saved configuration, reuse them where compatible, prepare only missing dependencies for the requested task, then verify actual calls. Native code uses the current system user's permissions with task process cleanup; it is not an OS sandbox. Trading permissions are not inferred from a successful import or read-only query.

## Reproduce and review

Use Node 24 and set `SESAME_PLUGIN_SDK_LOADER` to the matching public SDK loader, then `npm test`. `npm run test:python` runs controlled Python adapter checks; set `SESAME_VNPY_PYTHON` to an actual compatible environment to also run real engine tests. QMT has a separate explicit Windows native opt-in test; it never runs automatically against a brokerage account. The code and fixtures copy no private application implementation.

`npm run lock` / `npm run check` use the shared data-only package validator. The historical three-package catalog is checked against its own fixed Git source, independently of current membership. The separate optional archive uses the same deterministic lock/files structure as the core archive, but is never automatically assembled into the nine-package default set. Each package retains its declared license and dependency/source notices; Backtrader is GPL-3.0-or-later and the other current wrappers are MIT. This does not relicense third-party runtimes or the private application. See [ecosystem organization](ECOSYSTEM.md) and each package's provenance for the reviewed scope.

## Historical release evidence

The following records describe the earlier three-package bundles, not the current
previously published ten-package development bundle. See package VALIDATION files and the new package
review for current source-specific results and limitations.

The earlier Python checks comprised six real vn.py engine tests and seven QMT
controlled fixtures. Actual application checks covered catalog/current-session
loading and frozen results. AKShare 1.0.1 added real Tencent quote/history,
HTTP/SSE and downstream CTA evidence. No human security approval is fabricated.

The optional bundle 2 source suite passed 25 JavaScript checks with one explicit
Windows native QMT gate (26 total). All three current packages also passed actual
host static-test/install/activation and environment/result calls; the vn.py case
ran the real engine and reopened frozen successful and failed results. Bundle 1's
three exact names were independently installed from the live public catalog and
immediately called in the same Pi session. Publication evidence is recorded in the
[official bundle validation](../api-v1/VALIDATION.md).

AKShare 1.0.2 corrects the Tencent history venue for Beijing's 920-series codes
and adds request-level coverage for Shanghai, Shenzhen, and both Beijing code
ranges (11 AKShare checks). The actual `bj920002` probe returned no usable
upstream daily payload; the adapter surfaces that error and does not fabricate
history or switch providers. QMT 1.0.0 and vn.py 1.0.0 are unchanged. New release
publication requires the [pre-merge semantic review gate](../api-v1/PUBLISHING.md),
with exact-head identity and actual reviewer/timestamp evidence.

The optional bundle 4 updates only vn.py to 1.0.1. Explicit preparation retains
its private environment, audited wheel partials and pip cache across bounded
requests. Range/body boundaries and full archive hashes are verified, partial
growth survives failed reads, and three unchanged failures stop automatic retry
advice. Seven JavaScript and eight Python targeted checks passed. Actual official
network tests observed retained ranges and complete small engine wheels, plus
private-environment progress and reuse of the existing real CTA engine; this did
not repeat a complete 300+MB Qt installation or Windows/Linux native setup. See
[the preparation evidence](packages/vnpy/PREPARATION-VALIDATION.md) for its limits.
