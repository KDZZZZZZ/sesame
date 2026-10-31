# Sesame 0.2.4 host release verification

Completed 2026-10-17 on Windows x64, Node 24.18.0, Electron 44.5.1. Final local host commit observed: `fddce23eff517194e9753d210ab803614e327583`.

All 167 Node test files were executed. Complete coverage totals 1,171 tests, including nested tests: 1,161 have passing evidence after the remediations and isolated reruns below; 10 require explicit live/native/published-source opt-ins and were skipped. This is full coverage with repairs and reruns, not a claim that the first complete run was green. No unresolved assertion or runtime defect remains in this verification lane.

Source assembly used 9 core and 46 optional candidate packages, including unchanged HEAD Kurumi solely for test coverage. The release excludes Kurumi. Later plugin manifest fixes and the final immutable release pin are verified separately by the plugin lane and native release CI. This lane did not access the installed user application, user history, trading accounts, live trading or paid models.

## Complete suite evidence

| Group | Files | First complete result | Resolution |
| --- | ---: | --- | --- |
| Non-Electron, concurrency 4 | 162 | 1,163 tests: 1,131 pass, 17 fail, 5 cancelled by deadlines, 10 skip | Every failed/cancelled case has passing evidence below |
| Electron, concurrency 1 | 5 | 8 tests: 7 pass, 1 fail | Unchanged renderer test passed independently, all 12 internal scenarios |

Exact disjoint file lists: `host-parallel-files.txt`, `host-electron-files.txt`. First complete logs: `host-full-parallel.tap`, `host-full-electron.tap`. The earlier fixed-concurrency npm test run was intentionally stopped with its log retained as `host-full-suite.tap`; it is not counted as completed.

The 10 opt-in skips cover real MetaEditor compilation (3), live configured model execution (1), and published-catalog/candidate/installed-native-engine optional-package acceptance (6). Ordinary API2 optional-plugin tests and fixture MT5 compilation did execute. The skipped tests provide no evidence of real terminal, live model or real vn.py behavior.

## Additional checks

| Check | Result | Evidence |
| --- | --- | --- |
| Focused host regressions | 123/123 passed | `host-targeted.tap` |
| Focused capability/runtime/report regressions | 120/120 passed | `host-targeted-runtime.tap` |
| Frontend lint | Exit 0; existing react only-export-components warning | `host-lint.log` |
| TypeScript + Vite frontend build | Exit 0; existing bundle-size warning | `host-frontend-build.log` |
| OpenAPI consistency | Exit 0; 110 operations, 174 schemas, 44 examples, 34 rejection cases | `host-openapi.log` |
| Browser UI | All 6 passed | host logs for run-workspace-ui, desktop-updates-ui, internal-messages-ui, paused-agent-resume-ui, report-task-navigation-ui, conversation-turns-ui |
| Patch whitespace | git diff --check passed | Terminal verification |

UI checks used temporary profiles and cover workflow visualization, internal Agent messages, pause/resume, report/work binding and navigation, conversation-turn grouping, and update/restart controls.

## Remediation ledger

| Finding | Change or explanation | Passing evidence |
| --- | --- | --- |
| RECOVER_TOOL fixture lost its task after an internal process-failure notice; overflow fixture expected removed failed states | Retain original fixture input, verify one projected visible reply, original key, errors and tool side effects; assert interrupted/waiting | `host-agent-errors-fixed.tap`: 3/3; later full run passed |
| MCP registration assumed package major 2 for API2 plugins | Assert the selected manifest version without conflating protocol/package versions | `host-builtin-research-fixed.tap`: 1/1; later full run passed |
| Published-recipe fixture had a ready revision under a queued report | Set report ready/current/last-ready revision consistently | `host-execution-recipe-fixed.tap`: 17/17 |
| Partial/truncated/auth-error/retry-exhausted replies expected failed | Assert interrupted/waiting; retain content, final-marker, error, request-count and idempotency checks | `host-resumable-message-states-fixed.tap`: 15/15 |
| Sibling blocked Run, steering-error response and compile terminal wait used failed | Update current Agent/Run states only; retain actual business failures and legacy migration checks | `host-resumable-other-states-fixed.tap`: relevant sibling case and 4/4 steering passed; compile passed final isolated run |
| Existing self-update 1-second cleanup deadline flaked under load | No deadline or behavior change | Veto case passed in `host-resumable-other-states-recheck.tap` |
| MT5 provider fixtures expected old config-version connection identity and retained unbound caches | Assert stable account/endpoint identity, unchanged binding after unrelated settings, account-change rejection, released snapshots, unchanged returned data, declared missing-wall-time error | `host-mt5-provider-contract-fixed.tap`: 13/13 |
| Handwritten tester fixture omitted frozen connection_version | Supply the real run field and assert its frozen environment connection | `host-mt5-lifecycle-prompt-fixed.tap`: lifecycle passed |
| Prompt-load test hardcoded removed prose | Read selected plugin prompt opening sentence and retain before/after and skill checks | `host-mt5-lifecycle-prompt-fixed.tap`: prompt passed; 2/2 total |
| Windows short temporary path differed from Store physical root | Canonicalize fixture root and deletion boundary using realpathSync.native; preserve external-file safety assertions | `host-workspace-resource-path-fixed.tap`: 3/3 |
| Late response pump accessed Store after shutdown | Parent fixed production early closing guard and added regression; this lane only reported it | Parent's `host-late-pump-fixed.tap`: full plugin-host-execution + task-resource-lifecycle files, 20/20 |
| Five total deadlines expired under parallel fixture load; targeted compile also timed out | Run unchanged cases serially after load ended; no deadline increase or assertion weakening | `host-full-deadlines-isolated.tap`: 6/6, zero skips |
| Electron fixed-width overflow check failed once | Unchanged original renderer checks passed independently; exact 700px document rejected in five further inspections at 390px | `host-electron-report-recheck.tap`: 1/1, all 12 scenarios; `diagnose-electron-overflow-repeat.json` |

Final isolated timings and original limits: MT5 compiler 34.8s/45s, plugin lifecycle 32.9s/60s, exported MCP 32.7s/60s, plugin busy policy 30.3s/45s, provider setup 20.8s/30s, session release 10.6s/15s. A diagnostic-only MT5 timing copy showed setup alone delayed to 54.1s during earlier load; its expanded diagnostic deadline was never applied to source tests and is not used as final passing evidence.

Files changed by this lane: tests/agent.test.js, tests/fixture-provider.js, tests/builtin-research-plugins.test.js, tests/execution-snapshot-lifecycle.test.js, tests/message-segments-runtime.test.js, tests/model-retry.test.js, tests/mt5-compile-recovery.test.js, tests/plugin-self-update.test.js, tests/safe-steering.test.js, tests/mt5-plugin-lifecycle.test.js, tests/mt5-plugin-providers.test.js, tests/plugins.test.js, tests/workspace-resource-integration.test.js. Test/fixture changes only; parent owns production, version, lock, workflow, commits and publication.

## Reproduce from the host repository

```powershell
$testFiles = Get-Content E:/brief2great/sesame/outputs/release-0.2.4-20261017/host-parallel-files.txt
node --test --test-concurrency=4 --test-reporter=tap @testFiles
$electronFiles = Get-Content E:/brief2great/sesame/outputs/release-0.2.4-20261017/host-electron-files.txt
node --test --test-concurrency=1 --test-reporter=tap @electronFiles
```

Final low-load deadline recheck:

```powershell
node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern='compiler boundary fixture|failed servers, malicious paths|exported MCP uses Bearer|busy sessions reject policy changes|first-run provider setup|application close drops cached Pi' tests/mt5-compile-recovery.test.js tests/plugin-lifecycle.test.js tests/plugin-mcp.test.js tests/plugins.test.js tests/providers.test.js tests/runtime-resource-release.test.js
```

Other remediation commands use node --test --test-reporter=tap on the corresponding ledger files. Source packages must be assembled using the release's fixed source and locks. Native CI remains responsible for Linux/macOS/Windows installer builds and extracted-installer verification; this local Windows lane does not substitute for cross-platform checks.
