# CCXT diagnostic preservation

This bounded change repairs diagnostic loss; it does not establish the cause of the three historical R5 network failures. No real exchange, account, model, application or live database was accessed. All tests use fixed local fixtures; no installation or package/version/lock/inventory/git-index change was made.

Changed source files:

- `plugins/optional-api-v1/packages/ccxt/bridge.py`: map actual CCXT `RequestTimeout` to `TIMEOUT`; emit the original exception type (80 characters), at most four cause/context types, and numeric HTTP status only when present on the exception or its response. Suppressed context and cause cycles remain bounded. Cause messages, stacks and arbitrary properties are not copied. Visible messages include the original type and retain URL-userinfo redaction.
- `plugins/optional-api-v1/packages/ccxt/worker.js`: retain the bounded diagnostic fields in `Error.details`, preserve a single visible type prefix, and distinguish known request/source deadlines (`TIMEOUT`) from user cancellation (`ABORTED`). Existing pooling, backoff, dispatch, route binding and data behavior remain in place.
- `plugins/optional-api-v1/tests/ccxt-bridge.test.py`, `plugins/optional-api-v1/tests/ccxt-worker.test.mjs`: regression coverage for the above behavior.

`worker-call.js` was captured before review but remains byte-identical. Its existing explicit `TIMEOUT` reason now survives the worker cancellation boundary.

Validation evidence:

- `bridge-red.log`: the pre-fix serializer fails the new diagnostic/type/timeout checks.
- `worker-red.log`: the pre-fix worker drops structured diagnostics and misclassifies definite deadlines.
- `bridge-green.log`: 8 Python tests pass, without importing installed CCXT or using network.
- `worker-green.log`: 14 local JSONL-worker tests pass, including all existing rate-limit cooldown, session reuse, route isolation and cancellation tests.
- `provider-regression.log`: 32 provider/package tests pass; sources, history, streams and missing-environment behavior remain covered by isolated fixtures.
- `node --check plugins/optional-api-v1/packages/ccxt/worker.js`: syntax check passes.

`before/`, `after/`, `baseline.json`, `delta.json` and `task-delta.patch` isolate this change from the pre-existing backoff and architecture changes. These snapshots are review evidence, not installation input. Root decides when to install normally; no live retry has been made or claimed.
