# MT5 JS quote-clock sidecar verification

- Final targeted fixture tests: **60 passed, 0 failed** (`final-tests.log`).
- Before implementation: **33 of 53 failed**, exposing missing proof consumption, wrong raw-time freshness, and missing revision requirement (`red-tests.log`).
- Oxlint: **6 files, 96 rules, 0 diagnostics** (`oxlint.json`); scoped `git diff --check` passed.
- Same raw tick is returned and journaled; a +3 hour server-wall tick can be fresh after verified normalization. Explicit UTC proof remains unchanged. Missing, unverified, cross-account/server, inconsistent, excessive-offset and oversized-revision proofs fail closed.
- UI position close uses normalized source time for its existing 5 second budget and passes the exact rule revision into the native execution guard; local decision observation and expiry semantics remain unchanged. Freshness boundary, final account/config changes, exact position guard, duplicate dispatch, receipt correlation and cancellation schema regressions pass.
- Scope is fixture JavaScript validation. No real SDK, network, live app/account/database, business command, installation or commit was used. Python rule conversion and final native checks are owned by the separate integration lane.

See `verification.json` for exact commands, file hashes, and scope; `before/` and `changes.diff` preserve only this lane's baseline and edits. The public preparation output schema was updated by the parent and is covered by the passing schema regression.
