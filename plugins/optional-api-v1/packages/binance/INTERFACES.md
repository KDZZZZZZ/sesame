# Public interfaces

All IDs below are in `sesame/binance`. All inputs are JSON objects. Decimal quantities/prices are exact strings. No capability accepts credentials directly.

| Capability | Input | Result / effects |
| --- | --- | --- |
| `binance_catalog` | `{}` | Configured environment, credential presence booleans, production/testnet source identities; no network |
| `binance_account` | `{}` | Exact account identity, balances by asset, canTrade and observation time; signed read |
| `binance_order` | `{operation_id,environment,symbol,action:"market"|"limit",side:"buy"|"sell",quantity,limit_price?,time_in_force?,price_limit?,user_authorized:true}` | Durable normalized receipt; submits an order |
| `binance_order_test` | Same order inputs; user_authorized may be omitted | Native validation only, status validated and createsOrder false; no matching-engine order |
| `binance_order_status` | `{operation_id}` | Query the original command identity; updates the local receipt; never resends |
| `binance_cancel` | `{operation_id,original_operation_id,user_authorized:true}` | Cancel the matching working order; preserve fill/cancel race evidence |
| `binance_amend` | `{operation_id,original_operation_id,quantity,user_authorized:true}` | Reduce original quantity, keeping client identity; symbol must allow keep-priority amendment |
| `binance_execution_identity` | `{}` | Standard execution contract and account |
| `binance_execution_snapshot` | `{symbol?}` | Account, balances, open orders and optional source ticker/filter specification |
| `binance_execution_prepare` | `{symbol,account,commandId,userAuthorized:true}` | Read-only preparation for the exact account; no permission mutation |
| `binance_execution_submit` | `{observation,intent}` | Standard adapter facade around guarded direct submission |
| `binance_execution_recover` | `{record,expectedCurrent?}` | Exact order evidence and saved receipt; other ledger coverage remains explicit |
| `binance_execution_command` | `{record}` | Local durable command receipt |
| `binance_execution_cancel` | `{record,operationId}` | Cancel the saved order identity |
| `market_bind` / `market_unbind` | `{binding}` | Internal source lifetime; optional explicit environment/connection |
| `market_searchInstruments` | `{binding,query:{query,assetClasses?,venues?},page}` | Stable instrument page |
| `market_describeInstrument` | `{binding,query:{instrument}}` | Exact tick/lot filters, UTC and supported series specifications |
| `market_queryBars` | `{binding,query:{instrument,spec,range,includeForming?,direction?},page}` | Standard candle page; cache observation age, coverage and snapshot metadata |
| `market_subscribeBars` | `{binding,query:{instrument,spec,tailLimit,includeForming?}}` | Standard AsyncIterable initial snapshot and bars.upsert/bars.closed/stream.gap |
| `market_subscribeQuotes` | `{binding,query:{instruments}}` | Initial quote snapshot and quotes.upsert; max 20 instruments |
| `account_bind` / `account_unbind` | `{binding}` | Exact authenticated account source lifetime |
| `account_listAccounts` | `{binding,query:{},page}` | The explicitly configured account, no unrelated key enumeration |
| `account_snapshot` | `{binding,query:{account}}` | Per-asset quantities and same-environment USDT valuation; incomplete pricing explicitly exposes priced subset, never fabricated full equity |
| `account_queryOrders` | `{binding,query:{account,scope,range?,instruments?},page}` | Working/all/historical normalized orders; historical requires symbols and <=24h range |
| `account_queryFills` | `{binding,query:{account,range,instruments,orderIds?},page}` | Normalized fills and exact commission assets; <=24h range |
| `binance_dispose` | `{}` | Host-only cleanup, waits for pending work, retains business records |

`market` and `account` capabilities are consumed by existing host source adapters. Agent-facing entrypoints are the `binance_*` tools and the existing data-access/canvas tools. Trading effects are declared separately from backend reads. Only the main conversation can send a trade, amend or cancel. The execution service does not imply that the MT5/QMT portfolio workflow accepts Spot.

The normalized receipt contains `contract:"sesame.execution-adapter/1"`, `backend:"binance"`, `status`, `submissionAttempted` and `raw`. A private ledger records the intent before dispatch. On a timeout, network failure after dispatch, HTTP 5xx or Binance ambiguous status, the operation is `outcome_unknown`. Repeat the same operation ID to read its receipt, then use status recovery; do not replay under another ID. A successful cancellation request is `cancel_requested`; the confirmed native status remains in the receipt. A subsequent query can observe a fill racing with cancellation.

`price_limit` checks the current quote before a market send and is not an exchange-enforced fill-price cap. A limit order is required when an actual price boundary matters. No automatic quantity or price rounding is performed.
