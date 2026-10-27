# MT5 status history selector repair

Known positive order IDs now resolve the exact native `position_id` with `history_orders_get(ticket=orderId)`, optionally corroborated by the unique current order with that same ticket and symbol. Only that proved position is used with `history_deals_get(position=...)`. Current/history identity conflicts fail closed. Returned fills are filtered to the exact known order, so another order on the same position does not qualify even with the same comment.

Missing/zero position identity does not trigger an account-wide query or order/position-ID assumption. The existing coverage field explicitly says deal history was not queried and absence does not prove no submission. Native failures retain the method, code and message. Unknown order IDs keep their original bounded UTC history branch. Native account and configuration bracketing remain intact.

- Before implementation: 26 tests, 23 failed against the observed ticket-selector failure fixture.
- Targeted file plus trading-decision: **45/45 passed**.
- Additional requested portfolio-fast-prepare, trading-decision and trading-decision-portfolio regressions: **58/58 passed**. These sets contain **84 distinct tests**; trading-decision is included in both runs.
- Oxlint: **2 files, 96 rules, 0 diagnostics**. Scoped `git diff --check` passed.
- Exact commands, hashes and boundaries: `verification.json`; baseline: `before/`; turn-only changes: `changes.diff`.

Only the assigned adapters.js status section and existing portfolio-clock-receipts.test.mjs changed. No live app/database/SDK, network or trading operation was used. No product version, installation, Git index or commit changes were made.
