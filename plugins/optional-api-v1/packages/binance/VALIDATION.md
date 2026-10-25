# Validation

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
