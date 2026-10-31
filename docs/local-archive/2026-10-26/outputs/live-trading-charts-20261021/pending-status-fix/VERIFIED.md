# Pending order status refresh fix

This local change is limited to `portfolio-execution/adapters.js`, `tests/portfolio-clock-receipts.test.mjs`, and the portfolio README. It does not change service submission states, submit/cancel behavior, plugin versions, installation, or Git state.

## Behavior

- For a confirmed native order ticket, read current orders and positions concurrently. A unique current row must match the ticket and symbol; a pending-limit row must retain the expected side, active state and positive remaining volume. Use that current evidence without querying historical orders.
- Only when the current order is absent, query `history_orders_get(ticket)` and validate the exact historical identity. Required native read failures retain their SDK diagnostics.
- Query deals only from an actual positive native `position_id`; return fills belonging to the exact order. Do not equate order, deal and position identifiers or broaden account history.
- Preserve checked native history rows in `evidence.historicalOrders`, including a canceled row with zero position ID. Empty arrays do not prove cancellation, absence of submission or absence of fills. A skipped historical query also yields an empty array.
- Original `execution_reported` and `cancel_requested` command states and receipts are unchanged. The existing service persists the additional evidence without changes.
- Unknown order IDs retain the existing bounded UTC history query. Account/configuration bracketing and cancellation checks remain active.

## Frozen evidence and fixtures

Fixtures derive from `../pending-python/frozen-files/order-after-modify.json` and `order-history-final.json`. The native times, state, prices, quantities and remaining fields are retained; ticket, symbol and remark are replaced with fixture identities. The active-refresh failure is represented by the existing native failure fixture; the frozen `status-refresh-active-error.json` itself contains the exposed text but no native numeric error code, so it is not claimed to prove `-2` for that particular refresh invocation.

Tests use a fictional backend and, for two service persistence checks, newly created temporary fixture stores only. They do not open the actual workspace, live child databases, terminal, SDK, model, or UI. All adapter dispatches in this test fixture refuse `order_send`.

## Validation

Before the product change, the new test file produced **26 passing / 18 failing / 44 total**; `red-tests.log` preserves the failure output.

After the change:

- Targeted `portfolio-clock-receipts.test.mjs`: **44/44 pass** (`targeted-tests.log`).
- Related `portfolio-fast-prepare.test.mjs`, `trading-decision.test.mjs`, `trading-decision-portfolio.test.mjs`, `portfolio-python-unavailable.test.mjs`: **61/61 pass** (`related-tests.log`).
- Oxlint over both changed JavaScript files: **0 diagnostics** (`lint.json`).
- `node --check` on both changed JavaScript files: **exit 0** (`syntax-check.json`).
- `git diff --check` restricted to the three owned files: **exit 0** (`diff-check.log`).

All tests use `node --import file:///E:/brief2great/sesame/mt5agent/modules/plugins/sdk-loader.js --test ...`.

The test boundaries cover active-order query scheduling, partial fills filtered by exact order, historical terminal-state propagation through original and cancellation status calls, missing-record uncertainty, duplicate/wrong/malformed identities, required read failures, final account/configuration changes, cancellation, and the unchanged zero-order/deal paths.

## Handoff

`before/` and `baseline.json` preserve full starting files; `changes.diff` contains only this iteration's changes; `file-hashes.json` records before/after SHA-256 values. Real terminal acceptance remains for the parent-controlled Sesame Agent test. No commit, build, version update or installation was performed here.

## Parent integration and actual acceptance

The parent committed the scoped patch as `c0564e1`, re-ran the 44 targeted tests, and installed portfolio-execution 2.0.5 alongside MT5 2.1.10. Real gpt-6.1-sol then refreshed old canceled order REDACTED_IDENTIFIER, created one new USDJPY 0.01 pending order REDACTED_IDENTIFIER, read its active state, canceled it once with the native guard, and refreshed its CANCELED historical state. Original submission receipts were unchanged. Final native USDJPY orders and positions were empty.

Both Agent-saved full status files exactly match the actual tool results. Evidence: [parent verification](E:/brief2great/sesame/outputs/live-trading-charts-20261021/pending-status-acceptance/verified.json). The initial post-update IPC error was retained and recovered through public prepare; offline and partial-fill cases remain outside this actual acceptance.
