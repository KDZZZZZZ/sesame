# Binding reconnect: isolated review delta

Base: `ed7c46d27634dc00bd1a91b62d98ccbb2ccb4a08`.

`head-minimal.patch` contains only the explicit binding reconnect change in the three owned files. It excludes the earlier uncommitted per-consumer idle grace behavior and its two tests. `preimage-exact.patch` is the exact normalized-text delta from the snapshots taken immediately before this task.

The candidate was produced by removing the earlier grace changes from both the preimage and current snapshots. An assertion verifies that the reduced preimages exactly equal HEAD. No current working files or the real Git index were written. Their SHA-256 checks stayed unchanged.

Validation:

- `git apply --cached --check head-minimal.patch`: passed against an isolated `GIT_INDEX_FILE` initialized from the stated HEAD; the real index was not used for mutation.
- `head-candidate`: 14/14 tests passed (8 HEAD tests plus 6 new reconnect regressions).
- `fixture-with-existing-grace`: 16/16 tests passed (the same reconnect candidate with the two pre-existing idle grace cases and their implementation restored).
- `verification.json` records the base SHA, patch/file hashes, test counts and unchanged-index/worktree checks. TAP output is saved beside it.

The HEAD candidate cannot honestly run the two 180-second per-consumer grace tests successfully without including that unrelated prior implementation. Those cases are therefore verified separately in the complete current-behavior fixture; they are not omitted silently or folded into this patch.

`head-check.index` is disposable local verification state. `prepare-delta.mjs` records the generation procedure and refuses to overwrite that index. The candidate directories are isolated test fixtures, not a checkout to deploy. No commit or deployment was performed.
