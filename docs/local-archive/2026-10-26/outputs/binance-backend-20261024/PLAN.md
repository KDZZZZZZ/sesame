# Binance Spot backend implementation

New package: `sesame/binance`; no existing package files were present at the start. The before snapshot is therefore an empty package. Only the new package, binance-prefixed tests and this evidence directory are owned by this task.

Scope: Binance Spot production and Spot Testnet, explicit distinct source/account identities; public market search, exact decimal candles, shared WebSocket subscriptions, account balances and order/fill observations, HMAC signed market/limit orders, reduce-quantity amend, cancel and durable recovery. No futures, margin, withdrawals, automatic portfolio strategy execution or actual test trades.

Reuse: Plugin API 2 declarations, public SDK decimal/protocol/capability helpers, environment-bound shared configuration, standard market/account sources and execution-adapter service. Node fetch, crypto, WebSocket and sqlite; no dependency additions or host changes. Generic portfolio-execution currently supports MT5/QMT only and must not be advertised as accepting Binance.

Validation: schema/binding/configuration checks; strict transport fixtures for signing, clock skew, rate limit, timeout ambiguity and idempotency; source cache/range/pagination and subscription sharing/disposal; account identity and exact decimal mappings; optional public read-only production/testnet smoke. Authentication/trading live validation needs a separately configured account and is not performed by this task.
