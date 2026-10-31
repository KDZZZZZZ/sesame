# Native CI 39057554832 diagnosis

Read-only verification lane. No source changes, retries, cancellations, installer preparation, uploads, publication or installation performed by this lane.

- Host: `fcc3cf76ca7ecff3e37a5b91ac88a4e023e89263`
- Plugin: `4e153a4474285e162d88a484d517fa37283a465c`
- Run/attempt: `39057554832` / `1`
- macOS job `117468612783`: fully successful.
- Windows job `117468613000`: first backend batch failed.
- Linux job `117468613012`: passed the shared backend, isolated model/queue/Agent and report checks and reached packaging/update-browser setup. The parent subsequently cancelled the already-failed run to release the workflow concurrency queue for run `39059008826`; no installers from this run are eligible for preparation.

## Windows root failure

`tests/capability-service.test.js:50`: `concurrent operation admission remains idempotent across awaited readiness`.

The parent test's 10,000 ms deadline expired at 10,009.1685 ms (`testTimeoutFailure`). Its `same input` subtest was cancelled by the parent at 10,008.7883 ms; the later `conflicting input` subtest reports `parentAlreadyFinished`. These are one root timeout and two consequent cancelled child results, not three independent behavioral failures.

First backend batch: 233 tests, 230 pass, 1 fail, 2 cancelled, 0 skipped, total 509.164 seconds. The batch exited normally; no leaked fixture blocked the process. Windows never reached the isolated model/queue/Agent test step.

The two previously repaired configuration integration tests both passed in this run:

- Reply language / credential form: 28.129 seconds.
- Deferred model configuration: 34.585 seconds.

## Timing and code evidence

The failing parent serially runs two child scenarios. Each starts two concurrent immediate capability invocations with the same operation ID; a readiness handler waits until both probes have entered, and the assertions check one mutation effect, one durable mutation record, same-input result reuse, and conflicting-input rejection. These behavior assertions are valuable and should remain.

There is a separate 5-second readiness-barrier timer started before capability registration/invocation. The log does not report `Readiness barrier timed out`; the observed root error is the 10-second parent deadline. No last probe/effect count was printed, so the precise awaited operation at timeout cannot be determined from logs.

The path uses actual schema Worker validation repeatedly: `CapabilityService.invoke` validates input, readiness checking validates inputs and dependencies, and execution validates output. Neither the idempotency contract nor readiness barrier establishes a 5- or 10-second product latency guarantee. Those deadlines also cover Worker startup and shared hosted-runner resource contention.

| Comparison | Outcome | Duration |
| --- | --- | ---: |
| Current Windows parent | outer timeout | 10.009 s |
| Current macOS parent | pass | 1.150 s |
| Previous Windows run 39055913876 parent | pass | 6.928 s |
| Previous Windows run 39053516020 parent | pass | 6.701 s |
| Current Windows adjacent cancellation/readiness test | pass | 9.184 s |
| Previous Windows run 39055913876 adjacent cancellation/readiness test | pass | 3.880 s |

The adjacent test is also capped at 10 seconds and was close to that deadline. Other schema-validation tests in the same file also slowed considerably, supporting a test-time assumption sensitive to shared runner load. This is evidence for a narrowly scoped fixture/timing repair or test isolation, not proof that the timed-out invocation eventually met all behavior assertions. No product changes or global time-limit changes are recommended solely from this log.

## Evidence

- `native-ci-windows-39057554832.log`: official completed-job log; failure around lines 566–634, totals around 1809–1817.
- `native-ci-mac-39057554832.log`: matching successful macOS job.
- `native-ci-39057554832-latest.json` and `native-ci-39057554832-history.ndjson`: exact-source run state.

Focused reproduction command:

```text
node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern="concurrent operation admission remains idempotent" tests/capability-service.test.js
```

No redundant local test rerun was started by this lane.
