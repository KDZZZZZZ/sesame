# Actual backend boundaries

| Plugin | Existing broker operations | This plugin uses | Not provided |
| --- | --- | --- | --- |
| MT5 | Terminal MCP market/pending orders, SL/TP, pending cancellation, position close and close-by; Python official `order_send` and account/order/deal queries | Guarded Python market, limit, targeted close, pending cancel and recovery | Pure MCP source freshness assurance; automatic installation/login; arbitrary execution; all advanced order types in this wrapper |
| QMT | `qmt_order` STOCK limit buy/sell; `qmt_cancel` owned accepted-order cancellation; `qmt_read` account/positions/current-day orders/fills | Guarded limit buy/sell, cancellation and native-day recovery | Amend, attached SL/TP, market orders, dedicated close, short selling, all-history recovery, strategy hosting |
| CCXT | Public spot market data | None | Private accounts and broker trading in the current plugin |
| AKShare | Research/market data | None | Broker orders |
| vn.py | Actual CTA backtesting on fixed inputs | None | Live gateway/account/order integration in the current plugin |
| Backtrader | Actual Cerebro backtesting on fixed inputs | None | Live broker integration in the current plugin |

MT5's broader native `order_send` supports broker-specific requests, but this wrapper deliberately uses only the above verified mapping. Native MCP tool names and inputSchema must be discovered using mt5_catalog, not guessed from SDK parameter names. The MT5 market provider's broker wall timestamps cannot be compared to UTC without a verified mapping; the manual wrapper therefore uses documented Python tick.time_msc. QMT's source tick must carry epoch milliseconds; timetag-only snapshots cannot pass its execution guard.

The wrapper uses the installed plugins' existing configurations through the public tool-composition port. It neither reads another plugin's private storage nor imports another package's implementation. Native guards live with the backend that owns the SDK call. The host has no MT5 or QMT branches.

Broker support is different from a live trading test: the automated suites use fixed native SDK fakes to verify ordering, rejected/unknown outcomes, expiry, stale ticks and deduplication. Real broker acceptance, network jitter and model latency require explicit separate observation on the user's intended setup. No such measurement can be extrapolated to all accounts or market sessions.
