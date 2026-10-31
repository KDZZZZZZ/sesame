# Portfolio manual preparation / fast execution

Implementation is complete and files are handed back to the parent for version, lock, inventory, packaging and live integration. No live account/model/SQLite operations, installation or Git writes were performed in this lane.

## Files

- `sesame/plugins/optional-api-v1/packages/portfolio-execution/adapters.js`: normalized existing snapshot structure from one MT5 preparation capability after its account identity read; QMT uses existing read-only snapshot. Retains source and receive timestamps, validates actual account, permissions, symbol rows, timing and ready receipt. No catalog or individual Python round trips on the new MT5 path.
- `service.js`: main-only `prepare`; mutually exclusive observed or backend+symbol `execute`; original input fingerprint, account lock, durable pre-effect intent, unresolved order block, prepared account revision, final identity and unchanged native execution guards. Preparation bound is 180 seconds, ordinary reads/dispatch remain 10 seconds. Preparation and total timings are distinct; model round trip is zero for fast execution. Pre-send failures preserve original code/message/details and explicit non-submission.
- `index.js`, `plugin.json` tool list and `capabilities.json`: new main tool and formal schemas/usage. MT5 shortcut requires 2.1.6 with `mt5_trading_prepare`. Version field was not changed.
- `prompt.md`, `README.md`: immediate manual preparation, direct fast execution when all exact intent fields exist, no research/team/deployment/history detour, no false native concurrency claims. Rejected status is not equated with no send; rely on submission_attempted and native receipt.
- `sesame/plugins/optional-api-v1/tests/portfolio-fast-prepare.test.mjs`: 19 meaningful synthetic cases, using independent temporary stores and public capability fixtures.

## Validation

`verification.json` retains fresh results: 94/94 targeted tests passed, oxlint passed, diff whitespace check passed. Related suites include portfolio execution, records, account locks, Python unavailable, trading decision, portfolio targets and backend guards.

New cases cover single preparation, 95-second startup before last tick, distinct timeout, total request timing, durable intent visibility from a separate temporary database connection before native effects, same-input concurrent/restarted deduplication, main-only authorization, account/revision drift, unknown prior sends, raw stale/future times, native failures, incomplete preparation receipts, malformed clocks, cancellation, uncertain outcomes, pre-send rejection versus broker rejection after send, incomplete intent, QMT read-only behavior, pure observation, and schema mutual exclusion.

## Parent integration

The MT5 contract is `mt5_trading_prepare({symbol,command_id,user_authorized:true,expected_account})`. Preparation uses one initial identity plus this call under the exact existing account lock; fast execution allows one additional identity comparison immediately before native submit. No MT5 guard schema extension or host change is needed.

MT5 may return a new revision for the same account after enabling its application permission; that revision is stored and compared at final dispatch. An invalid/future raw broker time still rejects; this lane does not infer UTC or shift the clock. Latest-quote/price/position guards remain in the backend.

The baseline of the seven existing files is in `before/`. New tests were added separately. Synthetic success does not establish real terminal/broker acceptance; the parent owns that next verification.
