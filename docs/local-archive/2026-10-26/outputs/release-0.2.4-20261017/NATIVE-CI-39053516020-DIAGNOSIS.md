# Native CI 39053516020 diagnosis

Observed at 2026-10-17 17:53 UTC. This is a read-only diagnosis; no source changes, retry, cancellation, installer preparation, upload, publication or installation were performed by this verification lane.

- Host: `9a1d5cbba8062b82b72f92a961fe360103c6ae60`
- Plugin: `4e153a4474285e162d88a484d517fa37283a465c`
- Run/attempt: `39053516020` / `1`
- macOS job `117456724585`: success, including verification and private staging.
- Linux job `117456724715`: success, including verification and private staging.
- Windows job `117456724747`: failure in the isolated model/queue/Agent step. Subsequent packaging was skipped. These assets cannot satisfy the same-run three-platform preparation gate.

## Sole Windows failure

`tests/plugin-agent-tasks.test.js:117`: `the real Agent loop can exceed its former default tool and turn limits`.

Official TAP output reports `testTimeoutFailure`, `test timed out after 120000ms`, duration `125433.4205` ms. It is an outer Node test timeout, not a failed behavioral assertion. The isolated batch ended normally after the subsequent model-error test passed: 40 tests, 39 pass, 0 fail, 1 cancelled, 0 skipped. The preceding configuration/schema/native batch passed all 233 tests. This run did not reproduce the preceding schema-startup or fixture-cleanup failures.

The timed-out test includes fixture startup, 34 `data_read` calls, at least 35 model turns, and cleanup. `settled()` repeatedly observes the same run with a 30-second wait until the run settles; that observation timeout does not stop the Agent. Completion assertions require completed status, at least 35 turns, exactly 34 returned tools, and the expected final text. The official output contains no calls count or Run snapshot at timeout, so the precise in-flight point cannot be established from this log alone.

## Cross-platform timing evidence

| Test / measure | Windows | Linux | macOS |
| --- | ---: | ---: | ---: |
| 34-tool / 35-turn loop | 125.433 s (outer timeout) | 62.268 s (pass) | 32.816 s (pass) |
| Service Agent identity and completion | 32.335 s | 13.968 s | 7.690 s |
| Main Agent Run control | 33.523 s | 13.300 s | 7.712 s |
| Sibling Agents | 23.873 s | 11.623 s | 6.683 s |
| Explicit tool scope / observation | 20.896 s | 10.651 s | 5.934 s |
| Restart receipt recovery | 16.597 s | 9.119 s | 5.072 s |
| Agent model-error preservation | 18.300 s | 9.224 s | 5.172 s |

Across 32 passing comparable top-level isolated tests over one second, the Windows/Linux median is 2.032. Applying that observed multiplier to the loop's Linux duration predicts about 126.5 seconds, above its 120-second test deadline. The prior local Windows focused pass was 53.612 seconds (`host-unbounded-loop-ci-fixed.tap`). This strongly supports a test-fixture deadline that is too tight for the hosted Windows runner, but is not direct proof of forward progress at the instant of timeout.

Suggested bounded repair: change only this long-loop test's outer deadline to 180 seconds, preserve its behavior assertions and observation semantics, and optionally emit compact call/Run progress at timeout for unambiguous next-run evidence. Do not increase all timeouts or change product limits on this evidence.

## Evidence and reproduction

- `native-ci-windows-39053516020.log` (sole failure around lines 2041–2066).
- `native-ci-linux-39053516020.log` (matching loop pass around line 2075).
- `native-ci-mac-39053516020.log` (matching loop pass around line 2073).
- `native-ci-39053516020-isolation-timings.json`: complete extracted timings and ratios.
- `native-ci-39053516020-latest.json`: terminal source run status.

Native isolated command:

```text
node --test --test-concurrency=1 --test-reporter=tap tests/model-transport.test.js tests/model-retry.test.js tests/message-queue.test.js tests/plugin-agent-tasks.test.js
```

Focused loop command:

```text
node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern="the real Agent loop can exceed" tests/plugin-agent-tasks.test.js
```

Only official CI logs were retrieved for this diagnosis; no redundant local test rerun was started.
