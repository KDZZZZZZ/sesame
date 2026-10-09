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
