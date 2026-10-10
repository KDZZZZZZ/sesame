# MT5 manual trading interface

The installed terminal's `mt5_catalog {server:"terminal"}` (or `server:"python"`) is authoritative for tool inputSchema, availability and permissions. Do not guess MCP parameters from Python field names.

Every routed call takes `{server,tool,arguments,command_id}` and optional `save_as`. command_id is a stable 16–128 character `[A-Za-z0-9_-]` ID. Identical requests return saved results; different input/configuration raises conflict. `mt5_command {command_id}` reads the existing receipt without replay. `returned` describes transport, not order acceptance or fill.

| Operation | Terminal tool through mt5_trade | Python equivalent |
| --- | --- | --- |
| Market buy/sell | trade_send_market_order | order_send: TRADE_ACTION_DEAL, BUY/SELL, symbol, volume |
| Pending | trade_send_pending_order; types/expiry follow current inputSchema | TRADE_ACTION_PENDING with native pending type/prices/expiry |
| Modify | trade_modify_sl_tp: SL/TP on a position/pending order; no generic entry-price amendment is inferred | TRADE_ACTION_SLTP or TRADE_ACTION_MODIFY, exact position/order and fields |
| Cancel | trade_delete_order: pending order | TRADE_ACTION_REMOVE with order ticket |
| Close | trade_close_single_position: exact position ticket | Opposite DEAL with exact position, symbol and volume; partial-close rules are native |
| Close-by | trade_close_by_position: two opposite positions | TRADE_ACTION_CLOSE_BY with position/position_by; broker/account must permit |
| Current queries | get_trading_open_positions through mt5_call | orders_get / positions_get through mt5_python; symbol/group/ticket filters |
| History | get_trading_history_orders / get_trading_history_positions through mt5_call | history_orders_get / history_deals_get through mt5_python; timezone-qualified date_from/date_to or supported ticket/position filters |
| Check | Native permissions and receipts | account_info, terminal_info, symbol_info, symbol_info_tick, order_calc_margin, order_check through mt5_python |

**Python order_send routes through mt5_trade**, because trading permission takes precedence. initialize/login also use that route. Ordinary Python reads use mt5_python. Do not switch transport to bypass disabled plugins or permissions. Scripts and EA deployment are separate actions, not a shortcut for unapproved orders.

Python `request` fields are action, magic, order, symbol, volume, price, stoplimit, sl, tp, deviation, type, type_filling, type_time, expiration, comment, position and position_by. Supply only fields appropriate to the action. Quantities are native lots; tickets/magic/position/order use decimal strings. Enums accept documented constant names. Time bounds require timezone-qualified ISO; expiration is UTC seconds. Native prices are binary floats. Keep native retcode/request/order/deal/price/volume; order_check success does not guarantee execution.

## Optional execution_guard (1.3.0)

Python order_send accepts `execution_guard` next to request, consumed only by the Sesame worker. Required fields: observed_at/expires_at (UTC milliseconds; lifetime ≤60s), max_quote_age_ms (1–5000), max_quote_to_send_ms (1–1000), positive decimal price_limit, side, expected_account and expected_server.

It supports market/limit and targeted position reduction. Inside the serialized native process it checks account/channel permission, volume bounds/step, target position, source tick.time_msc, quote boundary, order_check, a second fresh tick and expiry before sending once. Preparation after worker queuing is included. Rejection returns `submission_attempted:false`; no send occurs. `execution_timing` reports source/read/send/receipt times separately. The checked request is unchanged after order_check. A bounded quote is not guaranteed market fill/slippage; use limit orders for a native order-price bound. Existing unguarded calls retain their behavior.

Broker wall time or reception time cannot replace a verified UTC source time. The independent manual-trading plugin measures the model round trip and defaults to M5+; M1 has not been benchmarked.

## Failure and recovery

Inspect transport status, native isError/error and retcode. Accepted order, partial fill, rejection and unknown are distinct. A timeout may happen after acceptance. Keep command_id, read mt5_command, then query real pending orders/positions and bounded historical orders/deals using native IDs and the exact remark. Missing/empty queries do not prove no order. Never change ID/channel to replay an unknown send. Cancellation can race fills and also needs final order/fill evidence.

Primary references: [MCP capabilities](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities), [Python order_send](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py). Package fixtures do not certify all live brokers.
