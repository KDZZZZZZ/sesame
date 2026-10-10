# QMT manual trading interface

Requires existing authorized native Windows MiniQMT and a STOCK account. Reuse qmt_environment inspect's configuration/revision. Installation, readiness and read access are not trading instructions.

| Tool | Actual parameters and scope |
| --- | --- |
| qmt_order | operation_id, user_authorized:true, exact account_id/connection_revision, mainland symbol (NNNNNN.SH/SZ/BJ), side buy/sell, positive integer shares and positive decimal price. Native order_stock with FIX_PRICE; limit stock orders only. |
| qmt_cancel | New operation_id, authorization/account/revision, original_operation_id and positive order_id. Original must be an accepted Sesame order or an unknown order with a retained original intent. The native process rechecks ownership before cancel_order_stock. |
| qmt_command | Existing operation_id; private durable receipt, no native submission/retry. Main conversation only. |
| qmt_read asset/positions | Actual configured account cash/assets and STOCK positions/available shares. |
| qmt_read orders/fills | Current-day raw native records/IDs/remarks/status; page limit ≤200, cursor in retained 60-second snapshot. Not complete multi-day history. |
| qmt_read describe/quotes | Exact symbols list; native stock conditions and get_full_tick. Source timestamp determines quote age. |

No amend, attached SL/TP, market order, derivative/credit/short-sale request or dedicated close action exists. Reduce a position with an explicit sell limit order within available shares; native T+1, lots, limits and sessions govern acceptance. Do not promise liquidation. Cancel cannot reverse a fill; amendment requires a new authorized intent after confirmation, never automatic cancel/reissue.

operation_id is `[A-Za-z0-9_-]{1,100}`. Identical input returns saved state; changed input/account revision raises conflict. The receipt is persisted as outcome_unknown before submission; timeout/crash never permits automatic resend. submitted means a positive order ID, cancel_requested means cancel acceptance, neither proves a fill/cancel. qmt_command exposes the exact remark for current-day reconciliation. An empty/truncated query, especially across a day boundary, does not prove no order.

New order records retain symbol, side, shares and price privately. To cancel an outcome_unknown order, query current-day orders on the same account/revision and find its exact remark and positive order ID. Pass that ID with the original operation ID. In the same connected native process, cancellation requires one matching account/remark record, exact symbol/side/original quantity, matching ID, remaining quantity and active status (48/49/50/55). Duplicate remarks, another account, filled/cancelled/cancel-pending orders and altered intent are refused before sending. Legacy unknown records without retained intent cannot use this recovery path; inspect/manage them in the terminal. The original order is never replayed or relabeled as a confirmed fill.

## Optional execution_guard (1.2.0)

qmt_order accepts `execution_guard:{observed_at,expires_at,max_quote_age_ms,max_quote_to_send_ms,price_limit}`. Times are UTC milliseconds: lifetime ≤60 seconds, quote age ≤5 seconds, quote-to-send ≤1 second. In the same connected Python process after startup and before order_stock, it checks account cash/available shares, native price tick/bounds, source epoch tick and side-specific bid/ask. Stale/unknown time, expired decision and price-boundary crossing reject before submission. Cash checks exclude final fees; broker rules remain authoritative. Unsupported volume-step data is not invented.

Rejection before submission is stored as rejected; other unconfirmed failures remain unknown. The receipt reports native quote/read/send/response times without promising a fill or latency. Old unguarded calls remain compatible. The independent manual-trading plugin measures model age and uses M5+; no Windows broker acceptance test ran on this Mac development host.

The manual-trading helper requires Sesame 0.2.1+ and this package 1.2.0+ on the existing authorized Windows session. Its QMT mapping supports limit buy/sell, status and cancellation only. Its query results must retain the exact connection/account/symbol, and cancellation refuses a truncated order page because it cannot prove uniqueness. No attached SL/TP, market order, dedicated close or automatic strategy hosting is added by the helper; native D1 history is not minute history.

Primary reference: [XtQuant trading API](https://dict.thinktrader.net/nativeApi/xttrader.html).
