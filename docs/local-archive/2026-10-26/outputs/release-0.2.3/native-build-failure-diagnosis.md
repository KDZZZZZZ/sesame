# Native build failure diagnosis — run 38910570705

Source before the fix: `d01c3f25cd839005cbb59045743e7727c51395ed`.

## Linux: cancelled Host contexts could become usable after GC

The only failed test was `hung cleanup has a shared deadline, revokes the old host and leaves versioned repair usable`, at `tests/native-plugin-lifecycle.test.js:269` before this change. It expected an `AbortError`, but the retained Host accepted the call. The job completed 241 tests: 236 passed, 1 failed, 4 skipped.

Node 24.18.0 represents the sources of `AbortSignal.any()` using weak references and lazily updates a composite that has no abort observer. After plugin cleanup removes the source controller's disposer, GC can collect the already aborted source before the retained Host checks its composite. This loses the cancellation state. The standalone `diagnose-native-cleanup.mjs` reproduced the same missing exception by forcing GC after `stopService()`.

`modules/plugins/host-v2/context.js` now uses the built-in `util.aborted(signal, signal)` weak resource observer. It records cancellation while the source still exists, including the original cancellation reason, and does not retain an unused Host when its parent task remains alive. Each retained Host port already holds this signal through its guard.

The added regression runs a separate Node process with `--expose-gc`. It retains only the `runs` port, aborts and discards its source controller, forces GC, and requires the port to reject. It also discards an uncancelled Host while retaining its source controller, forces GC, and requires the composite signal to be collectable. Before the implementation fix, the revocation assertion failed. Both assertions pass with the final implementation.

The activation timeout assertion now requires the preserved original `plugin_activation_timeout` code rather than the incidental default `AbortError`. No timeout budget or cancellation rule was weakened.

## Windows: the report recovery fixture used a short-path alias

The only failed test was `ambiguous legacy wrapper flatten recovery refuses to bind a colliding target`, at `tests/report-library.test.js:406` before this change. It expected collision status 409, but validation first returned `Invalid report recovery path` with status 422. The job completed 55 tests: 54 passed, 1 failed.

`mkdtemp()` returned a Windows short-path alias, such as `C:\Users\ADMINI~1\...`. `Store` correctly resolves the actual root with `realpathSync.native()`. This test manually constructed journal entries using the alias, making a textual `relative()` check appear to escape the normalized root.

The report test fixture now returns `store.directory` for filesystem and journal construction. The implementation's recovery path checks remain unchanged. The original failure reproduced locally before the fixture fix, and the complete CI report group now passes 55/55 tests.

## Validation and scope

- The two original failures and the forced-GC regression passed together: 3/3.
- The final port-only and retained-parent GC regression passed after strengthening the resource lifetime check.
- Full report and segmented-reply CI group: 55/55 passed (`reports-native-fix-verification.tap`).
- `oxlint`, JavaScript syntax checks, and `git diff --check` passed.
- Final complete Host port and native lifecycle group: 60/60 passed, zero failures, cancellations, or skips (`host-native-final-verification.tap`, 94.9 seconds).

Only three host repository files were modified: the Host context implementation and the two associated test files. No paid provider or trading calls were made. No commits, pushes, workflow dispatches, or release mutations were performed by this diagnostic task. Because the implementation changed, the final installers need a new build from the final source on all three platforms; the previous macOS result remains useful as prior build evidence.
