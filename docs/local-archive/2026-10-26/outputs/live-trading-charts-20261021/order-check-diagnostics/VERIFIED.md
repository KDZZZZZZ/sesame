# MT5 order_check rejection diagnostics

Completed 2026-10-21. Scope: native preflight failure receipts only. No real SDK, terminal, account, model, UI, network or database access. No version, package installation, Git index or commit changes.

## Root cause and change

`execution_guard.py` previously discarded the native `order_check` object by replacing any nonzero retcode or `None` with a fixed `GuardRejected`. `python-worker.py` then serialized only the error code, generic message and `submission_attempted:false`.

The failed-check branch now retains the original check object and immediately reads `last_error`, before any other SDK call. The worker serializes these through its existing native cleaner. No second check, retry, send, filling/time selection, request conversion or guard relaxation was added. Other guard rejections retain their existing three-field wire shape.

Failure wire contract, inside the existing command `result`:

```text
error: "ORDER_CHECK_REJECTED"
message: "Native order_check rejected the request"
submission_attempted: false
order_check: original native object, including actual retcode/comment/request, or null
last_error: actual native last_error tuple serialized as an array
```

When the native result is `None`, no retcode/comment is invented. A native check retcode can indicate rejection while `last_error` remains success; both are retained without reinterpretation. Existing redaction in the official command layer remains in effect.

## Files

- `plugins/optional-api-v1/packages/mt5/backend/execution_guard.py`
- `plugins/optional-api-v1/packages/mt5/backend/python-worker.py`
- `plugins/optional-api-v1/tests/execution_guard_test.py`

Full pre-edit baselines are in `before/`, with `baseline-paths.txt` and hashes. `changes.diff` is relative to those baselines, so it excludes the pre-existing Python `initialize` portable-mode change. That change was preserved.

## Verification

- Regression first: 34 tests, 30 passed and 4 newly added diagnostic tests failed, proving the missing object/error capture. See `red-tests.log`.
- `python -B plugins/optional-api-v1/tests/execution_guard_test.py -v`: **34/34 passed**.
- `python -B plugins/optional-api-v1/packages/mt5/tests/python-worker-dispatch.test.py -v`: **5/5 passed**.
- `python -B plugins/optional-api-v1/tests/mt5_positions_guard_test.py -v`: **2/2 passed**.
- Total: **41/41**. Unit and actual-worker fixture regressions cover nonzero check retcode and `None`, complete native diagnostics, exactly one check followed by one `last_error`, zero sends on rejection, and unchanged other rejection envelopes.
- Syntax compilation of all three edited files: passed without executing their imports.
- Scoped `git diff --check`: passed.

Logs and file hashes are retained alongside `verification.json`.

## Limits

This fixes future diagnostic receipts; it cannot recover the discarded object from the already completed USDJPY operation. The actual pending-order rejection reason still requires the real Agent's native evidence. No filling/time policy was changed or inferred from the fixture error comments.
