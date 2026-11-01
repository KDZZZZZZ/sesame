# Binance Spot backend

`sesame/binance` is an optional Plugin API 2 **integration / adapter** package. It connects Binance Spot and Spot Testnet to existing Sesame market, account and execution contracts. It does not replace CCXT's multi-exchange public-market adapter.

## Available operations

| Area | Implementation |
| --- | --- |
| Market | Symbol directory, exact decimal instrument filters, UTC candles with forward/backward snapshot pagination, shared kline and ticker WebSockets |
| Cache | A history request prefetches 100 candles on either side; cached data remains visible after the soft expiry while refresh runs; returned metadata carries the original observation time |
| Account | Authenticated Spot identity, each asset's free/locked balance, native trading permission, open/historical orders and fills |
| Execution | Market/limit base-asset quantity, test-order validation, quantity-reduction amendment, cancellation, durable command receipts and recovery by the known exchange order ID or original client order ID |
| Composition | `sesame.market/1`, `sesame.account/1`, `sesame.execution-adapter/1`, lifecycle disposal, explicit knowledge and configuration declarations |

Spot holdings are multi-asset balances, not per-trading-pair positions; `positions.query` remains undeclared. Account snapshots expose standard `assets` with total/available/reserved quantities and USDT market value. Valuation uses actual last prices from the same environment, direct pairs first and at most one bridge; other stablecoins are not assumed to equal USDT. If any held asset lacks a price, full equity remains unknown and `valuation.pricedValue` / `pricedAvailable` report only the priced subset with explicit `unpricedAssets`. The host displays and records that subset separately. Deposits and Testnet grants lack acquisition costs, so cost-basis PnL remains unknown. Exact original balances remain available through `binance_account` and `native.balances`. `historySourceId` and `historyInstruments` supply editable history suggestions, not an all-trades coverage claim.

Account directory, snapshot, order and fill reads report the actual request sampling window, including rate-limit waits and all requests used by that read. Public cached/paginated market reads use `best_effort`, since they can combine observations made at different times. Quote initialization records its actual sampling window; subscription consistency follows the initial snapshot.

## Configuration

The existing **配置与密钥** window and `configuration_integration_apply` own all three fields:

| Field | Environment binding | Consumers |
| --- | --- | --- |
| `environment` | `BINANCE_ENVIRONMENT` | Optional for private operations; `testnet` default, `production` explicit |
| `api_key` | `BINANCE_API_KEY` | Account and authenticated order operations |
| `api_secret` | `BINANCE_API_SECRET` | HMAC signature for those private operations |

Secrets are write-only and never stored in the plugin's SQLite business records. The package supports HMAC credentials; RSA/Ed25519 keys are not implemented. Configuration presence is separate from Binance account/API-key permissions. Public data needs no credentials. Its binding can explicitly select production even when the configured trading account is testnet.

If a previous agent saved the literal `[redacted]` display placeholder, save the original key and secret again through the configuration tools. Version 1.0.2 rejects that placeholder before contacting Binance; updating the plugin cannot recover the original secret from it. When changing only the environment, omit unchanged key fields.

Production and testnet source IDs, account connection identities, caches, subscriptions and command receipts are separate. Credential rotation changes the account connection revision. An existing binding/command cannot silently change environments or credentials.

## Calling it

Read `binance_catalog`, use the exact source returned by `data_providers`, and select public source binding `{configuration:{environment:"production"}}`. Public production requests use Binance's official market-data-only endpoints. This is the same market, not a fallback to another exchange.

For an authorized trade the main agent can call `binance_order` directly; it obtains account state, filters and a source ticker in parallel. Use string decimals, a stable operation ID and the explicit configured environment. `binance_order_status` reconciles the original command without sending a replacement order. `binance_amend` reduces quantity while keeping the client identity and priority; price changes/increased quantity and cancel-replace are not exposed.

The standard execution service is ready for explicit consumers. **The current portfolio-execution workflow only accepts MT5/QMT and does not accept this Spot backend.** Use this package's direct tools. Adding it to that workflow requires business-level support for asset balances and Spot quantities, not just another backend name.

## Host MCP access

The native backend exports these five tools through Sesame's authenticated MCP endpoint: `binance_catalog`, `binance_account`, `binance_execution_identity`, `binance_execution_snapshot`, and `binance_order_status`. Account tools use the same unified configuration and account identity as native calls. Order status can reconcile a stored operation and update its local receipt; it does not submit an exchange order.

Real order submission, amendment, cancellation, their execution-service aliases, and `binance_order_test` are not exported. This MCP surface is restricted to observations and local receipt reconciliation; the native tools retain their existing caller checks. No MCP argument can change the host-assigned caller identity. Account selection uses the configured account's API key, not an email address supplied as a tool parameter.

## Transport and limits

Node's existing `fetch`, `crypto`, `WebSocket` and `sqlite` provide transport and storage. There are no added packages, Python downloads, background installers or host API changes. Signed requests are restricted to fixed official HTTPS origins, refuse redirects, calibrate to Binance time, and retry a timestamp rejection only once. HTTP 429/418 establish a shared retry deadline; unknown mutation responses are reconciled rather than retried.

Symbol lookup requests only the named symbol, including its trading filters. Full directory searches request Spot symbols without permission-set expansion. Both paths cache successful results for five minutes; response bodies stop at 8 MiB. Native integer IDs larger than JavaScript's exact number range retain every digit as decimal strings.

Market subscription consumers share the same native environment/topic connection. Closing one consumer leaves the others attached; the last closes the socket. Disconnects emit a protocol gap; reconnection uses fresh snapshots and bounded backoff. The native WebSocket implementation handles ping/pong frames. Account observations are REST queries, not a user-data WebSocket stream.

History ranges are bounded to 10000 requested candles, pages to 1000, and memory/disk caches to 16 series of 12000 rows. Monthly candle endings come from Binance's timestamps. Working orders can be queried across the account. Historical orders/fills require 1–5 symbols and a UTC window up to 24 hours; an upstream 1000-row window is marked truncated so the caller can narrow it. It is not presented as a complete ledger.

See [INTERFACES.md](INTERFACES.md), [PROVENANCE.md](PROVENANCE.md) and [VALIDATION.md](VALIDATION.md).
