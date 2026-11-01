# Validation

## Version 1.0.4 — 2026-11-01

51 focused Binance checks pass, including exact direct/inverse/bridge valuation, reserved quantities, missing prices, quote failures, empty accounts and unchanged trading/MCP boundaries. Account presentation now supplies standard asset rows, scoped-history suggestions, and USDT valuation from the selected environment. Missing acquisition cost is not synthesized. Companion host changes display assets, respect the declared history window/instrument requirements, and separate partial-valuation history from full equity. Six live GET-only checks through the real host pass: account discovery, snapshot/asset valuation, orders, scoped fills, persisted valuation history and production candles. Two price-less test assets remain explicitly outside the valued subset. No order, test order, amendment or cancellation was issued. Local evidence: sibling host `output/account-fix-20261101/account-valuation-live.json`.

## Version 1.0.3 — 2026-11-01

47 focused Binance tests passed. The account regression measures request time (including transport waits) separately from the requested history period. The bundled-host integration now exercises the actual account presentation provider used by the picker and panel: bind, account list, snapshot, working orders and explicitly scoped fills. This catches missing sampling windows that direct service/MCP observation tests did not cover.

Five live read-only checks passed through the real host ProviderRegistry and presentation adapter: Testnet account binding/list, snapshot with per-asset balances, working-order page, BTCUSDT fills for an explicit day, and production BTCUSDT instrument/candles (10 bars). Credentials remained in process memory; evidence includes no balances or account IDs. No order/test-order, amendment or cancellation was sent. Evidence: sibling host ignored `output/account-fix-20261101/live-provider.json`.

The host account projection also needs its accompanying dev fix to wrap order/fill/history pages as documented. Binance fill history still requires explicit symbols and a UTC window up to 24 hours; it does not claim to supply unfiltered all-symbol 30-day history. Common-currency equity and cost-basis PnL remain unavailable.

## Version 1.0.2 — 2026-11-01

The five Binance suites and configuration integration suite passed 48 focused tests. New regressions cover placeholder credentials, original-value forwarding, exact large account/order IDs, reduced Spot directory queries, single-symbol queries and cache sharing/expiry, and streaming cancellation above the 8 MiB response limit. The MCP fixture still verifies the five observation-only exports and their paired package version.

Six live read-only checks passed using the package's actual service entry points:

- Spot Testnet account read, execution identity, and account-source bind/list using an explicitly supplied Testnet account.
- Production BTC/USDT directory lookup, ten one-minute candles, and live quote subscription snapshot/update without credentials.

No test order, trade, amendment or cancellation was sent. Testnet credentials stayed in memory and were absent from evidence. Authenticated production access and live order behavior remain untested. The observed `-2014` occurred with literal `[redacted]` values saved as keys; no Testnet URL or signing change was needed. Authenticated testing then exposed a separate large account-ID precision failure, now covered by a regression.

The reduced production directory returned HTTP 200 at 6,709,941 bytes during this check. Local live evidence is in the sibling host workspace's ignored `output/binance-fix-20261101/live-readonly.json`; it records only check names, times and outcomes.

## Earlier validation — 2026-10-24

Validated on 2026-10-24. Evidence is recorded in `outputs/binance-backend-20261024` outside the package. Transport fixtures use synthetic credentials and deterministic Binance-format responses. No live authenticated request, test-order request or trade was sent.

## Local checks

- 42/42 focused tests passed: the original 40 native checks plus two MCP checks in version 1.0.1. Native coverage includes declarations and all 28 bindings, source/account normalization, HMAC signing, environment and credential separation, clock recalibration, shared HTTP 429/418 backoff, exact decimal filters, caller authorization, durable idempotency and unknown-outcome recovery, order/amend/cancel/status, and non-trading test-order outcomes.
- Market regressions cover viewport prefetch, unaligned and empty ranges, soft-expired cache retention, concurrent loads, monthly endings, frozen pagination, shared sockets, disconnect/backoff, initialization cancellation cleanup and the 16-series persistent cache limit across plugin lifetimes.
- `node --check` passed for all 10 JavaScript source files. Host-installed `oxlint` passed for the package and six fixture/test files with no diagnostics.

Run from the plugin repository using the existing host SDK loader:

```powershell
node --import ../mt5agent/modules/plugins/sdk-loader.js --test plugins/optional-api-v1/tests/binance-client.test.mjs plugins/optional-api-v1/tests/binance-market.test.mjs plugins/optional-api-v1/tests/binance-execution.test.mjs plugins/optional-api-v1/tests/binance-account-contract.test.mjs plugins/optional-api-v1/tests/binance-mcp.test.mjs
```

## MCP regression in 1.0.1

The test assembles a trusted official-plugin bundle in an isolated directory and calls the real host `handleMCP`; it does not bypass the host's bundled-export allowlist. `initialize`, discovery of exactly the five declared Binance exports, and calls to all five pass. Missing credentials fail before transport, configured synthetic secrets are absent from replies, and trading/test-order/service mutation names remain unavailable. All exchange transport is an in-process GET-only fixture; no credential or order is sent to Binance. MCP-specific snapshots and transcripts are in `outputs/binance-mcp-20261024`.

## Public network smoke

The read-only smoke used the package transport and standard market operations without any API key:

| Environment | Evidence |
| --- | --- |
| Spot Testnet | BTCUSDT directory, 10 one-minute historical candles, and a live `bars.upsert` WebSocket event passed. Source remained `binance:testnet:spot`. |
| Production | Official market-data-only catalog request timed out after 10 seconds in this environment. Production network reachability is unverified; no other exchange or Testnet data was substituted. |

Full timestamps and outcomes are in `live-public-smoke.json`. Authenticated production/Testnet permission and trading behavior still require an explicitly configured account and authorized external validation. Futures, margin, account user-data WebSockets and portfolio-execution workflow integration are outside this package's Spot scope.
