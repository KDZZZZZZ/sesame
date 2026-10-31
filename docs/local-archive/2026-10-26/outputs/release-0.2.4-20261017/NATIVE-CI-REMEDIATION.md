# Native release CI remediation

Initial final-source build: host `a45b1440fca79d6e0d93c544f4ad7157366ab50a`, plugin source `4e153a4474285e162d88a484d517fa37283a465c`, run `39048710800`, attempt 1.

- macOS arm64 completed tests, native packaging, extracted-installer verification and private staging.
- Windows' first backend group ended after about 847 seconds: 249 passing, 3 failing, 2 cancelled tests (254 including nested cases). Logs: `native-ci-windows-39048710800.log`.
- The run was cancelled after Windows failed and Linux remained in that group for over 19 minutes, to obtain Linux diagnostics. This run is not eligible for publication; no installer from it was uploaded to the public draft.

Test fixes preserve the intended behavior checks:

- The unbounded Agent regression now asserts at least 35 turns, retaining exactly 34 successful tool calls and the exact final response. Its purpose is to demonstrate continued execution beyond the removed limits, not require an exact number of SDK turns. Fresh local case passed in 53.6 seconds (`host-unbounded-loop-ci-fixed.tap`).
- Recovery compaction fixtures reopen their persisted SDK session before the existing 20-second state observation starts. The actual summary failure, original reply state and absence of tool replay remain checked.
- Model transport's outer deadline includes fixture initialization and all seven cases. Windows spent about 32 seconds initializing under load, then the 40-second parent cancelled the last case. The total fixture deadline is now 90 seconds; each transport idle, connection and cancellation assertion is unchanged.
- Message queue fixtures use the same 90-second outer deadline on every platform. Their 124 assertion/wait lines are unchanged. All 14 local regression tests passed (`host-message-queue-ci-fixed.tap`). Linux's cancelled run had no reported test failure, but stopped producing TAP output immediately before these streaming fixtures; the new native run must verify the fix.
- All four files run in a separate serial CI step to avoid competing with four concurrent application fixtures. The original 47-file union is retained. The installer-preparation helper requires this additional step; all 121 helper tests passed again.
- The full model retry and transport files passed 19/19 cases without skips (`host-model-fixture-deadlines-fixed.tap`). Independent review confirmed retained behavioral assertions and no omitted tests at 2026-10-17T16:47:37Z.

Second candidate: host `b9c5bef39e18c44bb3048fd8ddb3854c4117d430`, unchanged plugin source `4e153a4474285e162d88a484d517fa37283a465c`, native run `39051008871`.

No runtime deadline, retry policy or user task limit was changed by those test corrections.

Run `39051008871` completed all macOS and Linux checks, but was cancelled after Windows produced schema timeout failures and then leaked configuration fixture HTTP servers. Full diagnosis is in `NATIVE-CI-39051008871-DIAGNOSIS.md`. No assets from the cancelled run were prepared or publicly uploaded.

The final repair separates Worker initialization (30 seconds) from the existing schema execution deadline (3 seconds). A ready/start handshake ensures untrusted schema compilation starts only after the execution timer begins. No-result exit rejects instead of hanging. Configuration fixture initialization failures now dispose the app before propagating the original error. Windows' two parallel batches use concurrency 2 instead of 4. The CI file union grew from 47 to 48 with the new schema regression; none were removed.

Fresh validation: configuration 12/12, schema/MCP/workflow/MT5 31/31, native and bundled plugin lifecycle 33/33: 76 passing cases, no skips. The actual expensive-regex test still terminated at about 3.10 seconds. Independent final-diff review completed at 2026-10-17T17:21:35Z. Syntax, targeted lint and diff checks passed.

Final candidate: host `9a1d5cbba8062b82b72f92a961fe360103c6ae60`, unchanged plugin source `4e153a4474285e162d88a484d517fa37283a465c`, native run `39053516020`.
