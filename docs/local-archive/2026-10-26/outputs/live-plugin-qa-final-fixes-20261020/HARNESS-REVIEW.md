# Maintenance harness review and handoff

Only the QA harness and its isolated checks were changed. No maintenance phase,
live desktop connection, database access, deployment or commit was performed by
this review. Root owns `prepare-plan.mjs`, freezing the plan, and execution.

The runnable sequence remains:

1. Confirm the reviewed executable and normalized profile/workspace paths;
   validate source/installed hashes and package digests.
2. Read global idle from main WAL and back up main SQLite.
3. Update the four reviewed packages through the running `/plugins/manage` API.
4. Check two adjacent main-WAL read transactions against the post-update
   baseline. Save both timestamps/counts and state hashes in `pre-close.json`.
5. Request `CloseMainWindow`, record every observed Sesame PID's exit elapsed
   time and exit code, and wait for all processes to disappear.
6. Compare protected state again before backing up stopped main/child stores.
   Only after that comparison succeeds, copy the frozen file hashes and launch
   the same profile/workspace/Pi directory.
7. Verify preserved state, model/authentication, and all 55 ready plugins.

## Fixed harness defects

- Windows slash differences no longer reject the same data directory. Relative
  paths and different directories still fail.
- Paused job protection now hashes the entire job, including model, result,
  input/request digests, bindings and future fields. Before exit it must remain
  byte-for-byte unchanged. After startup only one `version` increment and a
  valid non-decreasing `updated_at` change are allowed; every other field must
  match its stable hash.
- Paused conversation and `task_run` association records are protected in full,
  using only their main-WAL records. No child database is opened while Sesame
  is running.
- New work, changed protected state, an ambiguous/failed exit, or a changed plan
  stops the sequence before copying files. Existing attempt receipts/logs are
  not overwritten and the script never force-kills processes.

## Closure evidence and limitation

`normal-close-request.json` records the method, request timestamp, delay from
the second idle snapshot, installed Electron source hash and log offsets.
`normal-close.json` records acceptance, per-process exit times/codes, and hashes
of at most 256 KiB of new worker stdout/stderr. Raw log text is not copied;
the only content signal is presence of `Sesame shutdown failed:`.

The current desktop's redirected logs are in
`../live-plugin-qa-history-fix-20261020/finalise-v2-desktop.{stdout,stderr}.log`.
They are associated only if that prior launch receipt matches the main PID.
The next launch redirects to this directory's `desktop.{stdout,stderr}.log`.

The installed ordinary Electron quit handler contains a 10-second
`worker.kill()` fallback and does not log when it fires. If every process exits
before 9 seconds measured from before the request, the script can exclude that
timer. Otherwise it records `not_determined` and stops before backup/deployment;
it does not label the exit clean merely because processes disappeared.

There is **no admission reservation**. `UpdateGate.prepare/commit` is exposed
only through private Electron main-to-worker IPC, not the formal HTTP API.
Calling renderer `updater.install` would start a real installer and is not used.
The approved fallback is two adjacent idle checks, no new root business
requests during maintenance, and strict stopped-state comparison. The window
between the final snapshot and shutdown still exists; receipts explicitly set
`updateGateReservation: false` and `admissionIsolation: false`.

## Deployment manifest check

Root's current `prepare-plan.mjs` includes the new required
`modules/agent/report-export-static.js`, the three changed host/runtime files,
and rebuilt frontend differences, with `index.html` last. Keep old frontend
assets. Do not add development-only `report-playwright.js` to the packaged app.
This review did not run plan generation or validate a final `plan.json`.

## Side-effect-free validation

- `node --test outputs/live-plugin-qa-final-fixes-20261020/maintenance.test.mjs`:
  6/6 passed.
- `pwsh -NoProfile -NonInteractive -File outputs/live-plugin-qa-final-fixes-20261020/check-harness.ps1`:
  PowerShell AST parsing, path normalization, four fallback evidence cases,
  and two simulated close cases passed. All close I/O uses in-memory mocks.
- `node --check .../maintenance.mjs`, targeted `oxlint`, and whitespace checks:
  passed.

These checks establish harness behavior only. Actual update, shutdown,
preservation, restart and UI acceptance remain pending root execution.
