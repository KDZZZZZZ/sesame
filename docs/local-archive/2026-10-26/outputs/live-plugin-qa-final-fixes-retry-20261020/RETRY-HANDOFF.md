# Plugin ID validation retry

The first attempt stopped during `capture` → `verifyPlan`, before desktop
connection, backup creation or plugin management. The QA-only pattern
`/^sesame\/[a-z-]+$/` rejected the legitimate `sesame/mt5` ID.

The pattern now follows the alphanumeric name shape in
`mt5agent/modules/plugins/official-packages.js:58`, while retaining the
`sesame/` publisher restriction. Package digest and exact manifest ID/version
checks are unchanged. No product, runtime configuration or frozen plan changed.

Only these five files were copied into this separate retry directory:

- `maintenance.mjs`
- `restart.ps1`
- `plan.json`
- `maintenance.test.mjs`
- `check-harness.ps1`

`restart.ps1` now writes evidence to this retry directory. `maintenance.mjs`
uses the separate backup destination
`%LOCAL_USER_PROFILE%
Neither the backup directory nor any phase output was created by this repair.
The original attempt/failure receipts and capture logs remain unchanged.

The copied plan is byte-identical:

`sha256:357b61c3ba77a75dee2d895a0f4b53b3eafa778238d219bf15fa7af63e44c1c9`

It still contains exactly MT5 2.1.4, reports 3.0.4, canvas-control 3.0.2,
CCXT 2.0.3 and the same six reviewed application files. No new source hash or
plugin digest was substituted.

Validation:

- Red: the real frozen plan test rejected only `sesame/mt5`; the other three
  actual targets passed. The unchanged failure receipt is separate from the new
  `../live-plugin-qa-final-fixes-20261020/plugin-id-regression-red.log`.
- Green: 12/12 Node checks, including the four actual target packages and
  malformed/publisher/path negative cases. These tests call only local
  `verifyPlan`, not a maintenance phase.
- PowerShell AST, path normalization, four fallback cases, two fully mocked
  close cases, Node syntax, targeted oxlint and whitespace passed.
- No desktop/model/business connection, SQLite open, phase, deployment or
  commit was performed during repair.

Root may review and run this directory's `restart.ps1`. The earlier
`HARNESS-REVIEW.md` boundary remains applicable: no private UpdateGate
reservation is available, adjacent idle snapshots do not eliminate the
admission window, and ambiguous exit or changed protected state stops copying.
