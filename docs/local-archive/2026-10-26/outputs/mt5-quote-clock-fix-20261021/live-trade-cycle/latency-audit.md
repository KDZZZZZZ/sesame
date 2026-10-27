# Bounded manual-trade preparation latency audit

The measured gap is **15,058 ms before the outer Run completes**, not a delayed post-completion message. The frozen receipt does not contain per-stage spans, so it cannot identify one cleanup routine as the measured culprit.

| Boundary | Evidence |
|---|---|
| Tool invoked / accepted envelope | 09:56:29.679Z / 09:56:29.795Z (116 ms) |
| Backend prepared snapshot | 09:56:31.594Z |
| Portfolio observation captured | 09:56:31.688Z |
| Portfolio counters | total_request_ms=1658; preparation_request_ms=1192 |
| Outer function Run started / completed | 09:56:29.781Z / 09:56:46.746Z (16,965 ms) |
| Observation → outer completion | 15,058 ms |
| Quote age by outer completion | 17,638 ms (already beyond the 5 second quote budget) |

The counters are portfolio wrapper intervals, not isolated SDK or HTTP timing. `portfolio-execution/service.js:111` calculates them before its final durable `records.put` at line 112. That write is one unmeasured boundary too.

Source ordering:

- `mt5agent/modules/plugins/capability-service.js:281` awaits output schema validation after the handler returns. `runExecutor` lines 155–168 then awaits child settlement, lifecycle hooks and resource release before returning the result.
- `mt5agent/modules/agent/plugin-registry.js:374` broadcasts release hooks sequentially to eligible enabled services. This is deliberate lifecycle ordering; the current snapshot does not contain individual hook timing.
- `mt5agent/modules/agent/run-service.js:267` persists completedAt only after the executor and children settle. Notification delivery follows at line 273. Therefore model reasoning, notice delivery and later polling cannot explain the 15,058 ms already embedded in completedAt.
- `mt5agent/modules/agent/plugin-system/mcp-client.js:29` calls `void worker.terminate()` and resolves immediately after validation; no awaited worker shutdown or fixed 15 second success wait exists there. Worker startup and validation themselves remain unmeasured.

A concrete source-level performance hotspot is present: `WorkspaceResources.releaseRun` (`modules/agent/workspace-resources.js:88`) always calls `ResourceLifecycle.releaseRun` (`modules/agent/resource-lifecycle.js:109`). Even with no matching run pins, this calls `collect` (`:121`), which calls `discover` (`:31`), synchronously scans/stats the entire artifact blob directory, and scans all resource references/blobs. Each small function Run therefore pays workspace-wide garbage collection on its completion path. The periodic collector already exists (`:24`). **This avoidable work is proven by source; its share of this specific gap is not measured.**

The release hook paths also include MT5 run sealing/cleanup (`sesame/plugins/optional-api-v1/packages/mt5/backend/lifecycle.js:26` and `:79`) and memory candidate cleanup (`sesame/plugins/api-v1/packages/memory/repository.js:390`). Do not infer that either performed expensive work here without their actual spans.

Minimal next diagnostic: emit bounded stage duration metadata for final record persistence, output validation, each release hook, resources.releaseRun and final Run write. Existing lifecycle events only record end timestamps, so consecutive events can bracket candidates but do not independently measure a hook's body. If global collection dominates, restrict release to that Run's pins/resources and leave unrelated discovery/expiry sweeps to the existing periodic collector; retain completion-after-required-cleanup semantics and all final native trading guards.

Relevant tests to extend after a separate approved fix: `tests/runtime-resource-release.test.js`, `tests/artifact-resource-lifecycle.test.js`, `tests/capability-service.test.js`, `tests/run-service.test.js`. Use a fixture with many unrelated blobs and zero/one run pins: completion must avoid unrelated scans, retained artifacts stay live, targeted run resources are released, and periodic collection still handles expired orphans.

Read-only audit only: frozen receipt/progress and source; no live database (including child runtime.sqlite), SDK, network, app mutation, process operation or trade. No product changes or tests were performed.
