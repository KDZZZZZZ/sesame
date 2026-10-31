# Report activity projection fix

Changed only `mt5agent/modules/agent/report-library.js` and `mt5agent/tests/report-library.test.js`.

Report authorship previously projected the author's current conversation status onto every published report. A ready, unbound main-Agent report therefore appeared busy whenever its author started unrelated work. The DTO now keeps conversation navigation while inheriting activity only for the conversation's owned report/file binding. Other published reports project idle with no run, stage or progress. No persisted report data or live workspace was changed.

The three new regressions cover multiple main reports, user-edited drafts, restart, reserved/legacy task ownership, all existing conversation states, completed and subsequent task runs, parent-report contributions and stale report/file/no-output bindings.

Validation:

- `report-lifecycle-red.log`: original implementation, 2 failing regressions and 1 passing preservation case.
- `report-lifecycle-green.log`: all 3 regressions pass after the fix.
- `report-lifecycle-regressions.log`: 73 tests across report library, task library/binding, delegated/parent output, task finalization and capability resume; 70 pass, 3 fail before report execution because old test actors lack host-constructed principal/origin lineage.
- `report-lifecycle-baseline-failures.log`: all 3 permission failures also reproduced against the unmodified before snapshot using a read-only Node loader; repository files were not reverted.
- `node --check` on both changed files and `git diff --check` pass. Oxlint reports only existing warnings at report-library.js:20, :35 and :679 (control regexes and an empty spread fallback).

Exact before/after snapshots are under `before/host/` and `after/host/`. The two `report-lifecycle-*.patch` files contain only this task's delta, excluding earlier uncommitted work.

Separate classification finding for the parent task: runtime.js:822 routes an unbound new report to Strategy only when related evidence has role=strategy; otherwise it uses Research and preserves the first kind in later revisions. Reports prompt.md:29 and report-writing/backtest.md:3 say backtests belong to Strategy, but strategy-research/SKILL.md:17 still leads with a research output example. No classification code or plugin was edited in this subtask.
