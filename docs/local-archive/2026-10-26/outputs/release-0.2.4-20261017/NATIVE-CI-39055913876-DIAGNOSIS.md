# Native CI 39055913876 diagnosis

This verification lane made no source changes and did not prepare, upload, publish or install assets.

- Host: `5a2caab819f02b578c1b4250ba78f780917c2079`
- Plugin: `4e153a4474285e162d88a484d517fa37283a465c`
- Run/attempt: `39055913876` / `1`
- Windows job: `117463723610`; failed in the first backend batch.
- macOS job: `117463723617`; fully successful, including private staging.
- Linux job: `117463723406`; fully successful by 18:20 UTC, including installer verification and private staging. Official log contains no further failures: backend 229 pass / 4 platform skips, isolated model/queue/Agent 40 pass, reports 55 pass.

## Sole Windows failure

`tests/configuration.test.js:83`: `the Agent can change reply language and open the existing credential form`.

The official job log records `testCodeFailure`, `Condition timed out`, duration `77563.707` ms. The stack identifies `fixture-provider.js:213` -> `configuration.test.js:60` (`ask`) -> test line 86. The failed condition was `message.status === 'completed'` in the shared `eventually` helper, which defaults to 20 seconds. The test had not yet reached its assertions that locale became `en` and that `configuration.updated` and `configuration.open` events were emitted.

The batch completed normally: 233 tests, 232 pass, 1 fail, 0 cancelled, 0 skipped, total 690.969 seconds. Fixture disposal completed; there was no hanging server. The subsequent isolated model/queue/Agent batch was skipped on Windows, so this run gives no Windows evidence for the long-loop deadline adjustment. No schema-worker validation failure was reported in this job.

## Evidence boundaries and relevant code

The 77.564-second test duration includes fixture initialization, plugin loading, the failed wait and cleanup. It is not the duration of the completed-message wait alone. The log contains no last response status, model request count, tool trace or persisted fixture snapshot. `app.dispose()` removes the temporary fixture directory. The evidence cannot prove that this particular configuration operation eventually completed, nor establish its exact in-flight stage at timeout.

The fixture's `plugin_load` calls session-scoped `host.plugins.setEnabled`. `modules/plugins/host-v2/plugins.js:57` updates an already-created session if one exists; it does not create a session. Therefore the existing `ask()` completion wait may include cold SDK session creation as well as two capability calls and the final model response. Its completed-only condition also waits the entire timeout when the response has already ended in another terminal state.

`modules/agent/runtime.js:396` schedules the pump after accepting the message. An initial suggestion to await/call `runtime.pump()` directly was not adopted: independent review identified a reentry window during the configuration flush. The chosen fixture repair instead prewarms the SDK and uses a narrowly scoped terminal-state observation. Preserve the actual locale and event assertions; do not relax global `eventually` semantics.

Cross-run comparison, with no product code difference in this test path:

| Run / platform | Outcome | Full test duration |
| --- | --- | ---: |
| Current 39055913876 macOS | pass | 7.306 s |
| Current 39055913876 Linux | pass | 48.041 s |
| Current 39055913876 Windows | completed-message wait timeout | 77.564 s |
| Previous 39053516020 Windows | pass | 37.408 s |
| Previous 39053516020 Linux | pass | 39.670 s |

The parent chose to prewarm the main SDK session, use a 60-second observation deadline only in configuration's `ask`, and report interrupted/canceled terminal states immediately while retaining all 51 prior assertions and adding explicit terminal-state assertions. The two integration cases get a 180-second outer test deadline and `t.after` disposal. Parent reported independent review passed and local configuration 12/12 passed in 105.064 seconds with no skips/failures. Those changes are in a new source and new run, not this failed run: `fcc3cf76ca7ecff3e37a5b91ac88a4e023e89263`, run `39057554832`.

## Official evidence and reproduction

- `native-ci-windows-39055913876.log`: official completed-job log; failure around lines 737–752, final totals around lines 1805–1813.
- `native-ci-mac-39055913876.log`: corresponding fully successful macOS job.
- `native-ci-linux-39055913876.log`: fully successful Linux job, retrieved after completion; no new failure.
- `native-ci-39055913876-latest.json` and `native-ci-39055913876-history.ndjson`: source-pinned status evidence.

`gh run view --job --log` refuses while the overall run is still active, even when one job has completed. The official completed-job endpoint succeeds:

```text
gh api repos/KDZZZZZZ/mt5agent/actions/jobs/117463723610/logs
```

Focused test command:

```text
node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern="the Agent can change reply language" tests/configuration.test.js
```

No redundant local test rerun was started by this lane.
