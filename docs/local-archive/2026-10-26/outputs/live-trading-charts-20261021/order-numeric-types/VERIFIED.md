# MT5 request numeric types

Completed 2026-10-21. Changed only `python-worker.py` and its existing `python-worker-dispatch.test.py`. No real SDK, account, UI, model or database access; no package install, version, inventory or commit changes.

## Evidence and scope

The real Agent's retained `QA20261021_PYPENDING_check_01` request contained numeric `price:157`. SDK 5.0.6231 returned `result:null` and `last_error:[-2,"Invalid \"price\" argument"]`. Evidence is in the pending-python `receipts.json` and the Agent's `QA20261021/pending-python/native-order-check.json`; this subagent read those files and did not rerun the operation.

The official [MqlTradeRequest structure](https://www.mql5.com/en/docs/constants/structures/mqltraderequest), read on 2026-10-21, defines exactly five double fields in the existing request schema: `volume`, `price`, `stoplimit`, `sl`, `tp`. Order/position IDs and deviation are integer fields, actions/order/filling/time types are enums, and expiration is a datetime integer. Only the public documentation URL was accessed; project/account data was not transmitted.

## Change

`convert_input` now normalizes Python `int` values to `float` only inside a `request` object and only for those five fields. Thus the original price 157 becomes 157.0 at the SDK boundary, without moving it to another price or tick.

- Existing fractional numbers remain unchanged.
- Missing fields are not added.
- Boolean, null and string inputs are not coerced into numeric orders.
- Integers that cannot be represented exactly as a native double are rejected before SDK dispatch rather than silently rounded.
- Tickets, magic IDs, actions, deviation, expiration, time/filling policy and non-request inputs remain unchanged.
- The existing diagnostic receipt fix and pre-existing portable initialization change are preserved.
- No guard, quote, retry, send count, filling policy or order lifetime logic changed.

## Verification

Regression first: 11 dispatch tests, 7 passed and 4 failed as expected before the product change. The failures reproduced integer double-field rejection for native check, guarded pending send, and modification, plus the absent inexact-conversion rejection. See `red-tests.log`.

Final targeted validation:

- `python -B plugins/optional-api-v1/packages/mt5/tests/python-worker-dispatch.test.py -v`: **11/11 passed**.
- `python -B plugins/optional-api-v1/tests/execution_guard_test.py -v`: **34/34 passed**.
- `python -B plugins/optional-api-v1/tests/mt5_positions_guard_test.py -v`: **2/2 passed**.
- Total: **47/47**.
- Syntax compilation of both edited files passed without executing imports.
- Scoped `git diff --check` passed.

The new tests run the worker's actual converter and dispatch branches against offline CPython C-call fixtures. The pending test also uses the actual native guard with a fictional SDK, verifying one check and one send with the same request and unchanged value. Modification tests retain exact integer tickets above 2^53 and integer action/time values while converting integer price and zero protection fields to doubles. Invalid types, non-request data and fractional prices remain unchanged.

Full baselines are under `before/`; `changes.diff` contains only this task's delta, excluding the pre-existing portable initialization change. File hashes and machine-readable results are in `verification.json`. These fixture results are not a new real-broker acceptance test.
