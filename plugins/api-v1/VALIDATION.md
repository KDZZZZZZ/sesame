# Development bundle 4 validation

The final native-execution source suite passed 115 JavaScript checks: 103 passed, 12 explicit platform/opt-in gates, zero failed. It includes the new fixed-catalog byte/identity/activation-failure checks, actual readable web-source delivery paths, preserved research input/output bindings, writable MT5 SDK validation and snapshot-error propagation. All ten MCP sample assertions passed at package version 2.0.1. The six Python dependency boundary checks remain passed.

This revision updates MT5 to 1.1.1, workspace to 1.0.1, and research, web-sources, plugin-manager and the four standard MCP adapters to 2.0.1. Real workspace paths replace old mount assumptions. Native execution snapshot failures are returned to the Agent as incomplete evidence. No report assets changed after bundle 2's verified ResizeObserver fix.

The plugin-manager now owns the optional API 1 catalog lookup and installation flow. It binds the exact catalog digest, source commit, byte counts, per-file hashes and package tree hash, then delegates static native checks and actual installation to the public HostContext. The actual application catalog integration used frozen source bytes through a controlled download port, installed the actual AKShare package, retained the same Pi session object and immediately called the newly loaded tool. Loading refreshes the same Pi session. Static native validation does not execute factories or certify behavior. Runtime activation diagnostics are preserved, and dependency preparation remains a separate explicit operation. The independent optional catalog does not alter stable 0.1.4 metadata or the 19-package archive.

Native research and MT5 lifecycle integration passed six checks against the rebuilt source, including successful native execution followed by output mutation: research_register retained the original frozen result, not the later file. Sixteen final application integration checks passed across catalog/current-session loading, optional package activation, native file/workspace tools, the four MCP adapters, fixed reports and SVL. Optional-package actual manager integration separately passed for AKShare, QMT and vn.py; platform and network limitations are recorded in their package documentation.

## Earlier bundle 3 evidence

# Development bundle 3 validation

The current source was checked with Node 24 and the matching public SDK on macOS arm64:

- 107 combined JavaScript checks: 95 passed, 12 platform/opt-in gates, zero failed. Eleven gates require Windows; the remaining native MetaEditor gate was also run separately by the native integration suite.
- Six Python dependency installer boundary checks passed.
- The actual HostContext and official plugin factories passed two new integration tests: all nine host-file methods perform real file operations and native argv execution; workspace read/write/edit/Bash uses the real cwd and retains completed/failed execution records.
- Three actual report-renderer/Pi repair tests passed again on the native-execution host, including repeated chart hide/show/resize and fixed DataRef permissions. No JavaScript errors were ignored.
- Six authored-plugin integration checks passed, including all ten standard MCP sample calls and immutable reports/SVL evidence.
- The MT5 contributor ran actual macOS MetaEditor success and syntax-error compilations in 23.8 seconds; the private process Job ended with zero active processes. The dependency installer downloaded, verified and prepared 850 files in a temporary private directory and reused that installation. Windows/Linux compilation and the macOS application installer were not natively verified.

The frozen 19-package archive uses `sesame/workspace` instead of `sesame/sandbox`; host-files is 2.1.0, MT5 is 1.1.0, and user-guide/orchestration are 2.0.1. MT5 VM resources, transports and retired probes are not included. They remain explicitly historical under development/mt5-runtime-probes/retired-api-v1. New optional integrations are outside this archive and have separate validation.

Dependency discovery does not start programs or download large runtimes automatically. Native execution is current-user host execution with task process cleanup, not an OS sandbox. Report/indicator frontend isolation remains a separate boundary. No current result implies broker authorization, live order execution or SVL/native-engine equivalence.

## Earlier integration evidence (bundles 1 and 2)

The following records describe the earlier integration revisions, including their then-present VM execution paths. Those historical paths are not part of bundle 3.

# Development validation record

Observed on 2026-10-09 during API 1 integration. This is a record of checks, not a
security certification or a claim that a development bundle is a stable release.

## Source repository

`npm test` passes the six repository checks: deterministic archive identity,
path/link/import boundaries, all ten declared calls across four actual isolated
Python MCP servers, template text escaping and reproducible demo generation.
The test environment uses Node's built-in test runner and Python's `-I` mode.
It does not supply application secrets or install third-party runtime libraries.
SDK-dependent plugin suites use `npm run test:sdk` with the matching application's
public loader supplied explicitly as `SESAME_PLUGIN_SDK_LOADER`; they are not
counted as passing merely because the portable source checks pass.
The combined SDK run has 108 checks: 97 pass and 11 Windows-specific
checks retain their existing platform skips on macOS. Coverage includes MT5
decimal values, identity, native process receipts, transport, connection import
and controlled workspace resources. `npm run test:python` passes 30 compiler
channel, snapshot and entry checks with explicit process fixtures.

The deterministic archive was extracted by the matching application's actual
archive reader into a new temporary directory. All 19 package identities and tree
digests matched. Rebuilding produced identical archive bytes. Modified package
bytes and an extra package file were both rejected by the application verifier.

The PR workflow reads candidate plugin files as data using the trusted base
validator. It does not launch candidate MCP servers or native plugin code.

## Reports and strategy authoring

The matching application integration tests use its actual artifact store, public
HostContext, official-package loader and SVL evaluator. Checked behavior includes:

- Fixed report data retains source decimal strings and remains unchanged if a
  transient dataset changes. A forged artifact digest and demo-to-observed
  relabelling are rejected.
- Authored HTML and packaged assets publish with fixed references. Publication
  returns `not_checked`; it does not self-certify successful rendering.
- In an actual Pi reply, `report_check` rendered the authored template, returned
  the JavaScript failure, and the Agent repaired and published a new fixed
  revision before checking again. The new receipt was `rendered` at 1000 and
  390 pixels; the original failing revision and its diagnostics remained readable.
  Duplicate late feedback stored one diagnostic without creating a user message.
- A subagent publishes a report, then its workspace and transient dataset are
  cleaned. The main conversation can still read the same report, data rows, HTML
  bytes and artifact digest.
- The SVL example validates, publishes and produces one intent from its explicit
  fixed-event fixture. The result is evaluator evidence, not a native backtest.
  Unsupported extensions remain errors.

A real Chromium session opened the report through the versioned application
renderer and paged read-only bridge. Initial open and reopen produced `rendered`
receipts with no reported issues. Filtering, empty results, keyboard selection,
linked table rows, theme changes and 390-pixel layout were inspected. The exact
string `9007199254740993.0000000000001` survived the bridge and table unchanged.
Reading an unbound data ID was rejected.

Development bundle 2 updates only the reports package to 2.0.1. A full host test
run exposed a ResizeObserver delivery loop during chart layout. Chart redraws
now run in animation frames only after positive width changes; replacing or
destroying a chart disconnects its observer and cancels pending work. The three
actual report-renderer integration tests passed with the new fixed bundle,
including repeated hiding, reopening and 280/310-pixel resizing at both desktop
and mobile widths, initial rendering in a hidden view, destroying a resized chart,
and reopening the same fixed report. JavaScript-error checks remained strict.

The standalone fictional chart gallery was opened with browser networking offline;
chart switching and row filtering still worked. Line gaps, zero-based signed bars,
missing matrix cells and exact unit counts were inspected. Decimal unit counting
uses exact integer arithmetic: `0.3 / 0.1` creates three dots, while fractional
dots, zero-sized units and incomplete matrix grids fail explicitly. SVG coordinates
remain approximate display values; financial calculations belong in registered
results, and the original text remains available in tooltips and tables.

## Plugin installation and remaining target scope

Eight application lifecycle/MCP checks passed with the verified matching
`0.2.0-dev.0` execution bundle. A real Pi reply created, validated, sandbox-tested,
installed and called an MCP plugin in the same reply while retaining the same
session and history. Version updates, rollback, exports, restart, dependency locks,
disabled policy, readonly package files, persistent plugin data and host-secret
isolation passed. HTTP credentials stayed bound to the exact connection URL;
schema failures and disconnected calls did not trigger automatic call replay.

A separate macOS integration ran three real isolated MetaEditor compilation
cases, including rejection of a host include path. This is compiler evidence;
broker execution, native backtesting and translation equivalence still require
their own target evidence and are not inferred from parser samples or SVL replay.
That run used the verified integration execution bundle. The final guest-resource
extraction and deadline fix passed the Python boundary checks above; a rebuilt
native runtime with those final resources still needs a separate native run.

The actual Electron frame-policy test confirmed that an authored subframe
navigation made zero requests to its target, while the permitted fixed local
document loaded once. The host blocks navigation before sending a request; iframe
CSP and revoking a bridge after navigation are not sufficient by themselves.
Twelve additional Electron renderer checks passed, covering network, file and
WebRTC isolation, desktop/mobile rendering, trusted clicks, concurrent inspection,
loop and memory limits, cancellation and utility-process IPC. These checks apply
to the matching development host, not to an arbitrary HTML viewer.
