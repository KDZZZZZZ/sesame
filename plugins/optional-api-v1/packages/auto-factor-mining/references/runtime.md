# Runtime orchestration and recovery

The factory is `createRuntime({search,compute,evaluator,library,journal,runs,reports,capabilities,artifacts,environment})`. The additional host ports are the existing API2 `capabilities`, the package artifact adapter, and `python.selection` as `environment`; they implement actual native Run admission and immutable checkpoint access. Numerical module signatures stay unchanged. Local numerical contexts carry `jobId`, `epoch`, `attemptId`, `signal`, and the native workflow `nativeAttempt` number so the process bridge can distinguish an explicit resumed host attempt from an unacknowledged retry.

`research(draft)` queries the library first. Direct reuse requires explicit seed definitions, a fixed immutable source ref and matching formula, full frozen layout/target/calendar, profile, current Qlib/environment/operator identity, reference definitions and compute identities, and supported development evidence. An empty seed list always continues into search: matching fields and evidence cannot establish that a different natural-language need is satisfied. A mutable dataset ID is queued before numerical work and matched only after preparation freezes its snapshot. Existing explicit definitions with missing evidence are evaluated again; absent definitions enter search. Queries follow cursors even across empty filtered pages.

`research` and `measure` admit durable jobs and invoke `sesame/auto-factor-mining#factor_workflow` with a stable operation ID and a report destination in the research space, returning the accepted native Run promptly. The job stores its frozen input artifact. Compute-only and compute-plus-evaluate measurements produce development Values; evaluate-only consumes the supplied Values partition and its original snapshot without fetching a new source. Values refs are exposed on the job and as paged journal entries. An already frozen Values manifest is evaluated as one aligned input, within its byte/candidate budget, even when it contains more columns than the compute batch size.

## Durable records

The job records `snapshot`, `searchCheckpoint`, `attemptsUsed`, `initialized`, `referenceDefinitionsRef`, `selection`, `holdoutExposureRef`, `numericalComplete`, `valuesRef`, `reportStatus`, and `reportError` in addition to its public lifecycle fields. `attemptsUsed` comes from `checkpoint.budget.used`, including duplicate and invalid proposals; `proposed` counts unique reserved candidates.

Journal kinds used by the runtime are:

| Kind | Purpose |
| --- | --- |
| `proposal` | Immutable proposal request/receipt refs and requested/received/committed state. |
| `candidate` | Reserved candidate plus separate development/holdout outcomes, Values refs, evaluation, library IDs, and acknowledged development feedback ID. |
| `batch` | Candidate IDs, partition, mode, queued/computing/computed/evaluating/completed/failed state, and retained Values ref. |
| `values` | Paged immutable Values refs for independent computation/evaluation. |
| `reference` | Frozen reference Values per partition and bounded group. |
| `process` | Owned by the Python bridge: actual child Run attempts and receipts. |

A proposal request is persisted before invoking search. Its returned receipt is persisted before candidate reservation or advancing the job checkpoint. Recovery finishes pending proposal commits first, then resumes partial batches. A retained `valuesRef` skips formula computation; existing terminal candidate outcomes survive a partially committed batch. Development outcomes receive a monotonic journaled feedback sequence, and only unacknowledged development feedback is delivered to search. The immutable search checkpoint retains the complete failed/duplicate attempt history.

## Queue and selection

The queue continuously fills free worker slots. Each batch proceeds directly from compute to evaluation and library recording while other batches are still computing; there is no round-wide barrier. Search is serialized and occupies a free slot within the same `maxWorkers` limit. All dispatched tasks are observed before a safe pause or failure returns.

All valid numerical evaluation records, including insufficient evidence, can enter the library under the job epoch fence. Candidate-level failures preserve successful siblings. After development ends, the top eight supported candidates are frozen by development score with an ID tie break. An immutable usage record is saved before holdout reference/formula access. Holdout evaluations never become search feedback. Standalone evaluation of frozen holdout Values records that existing exposure before computing declared references. The runtime has no strategy-pool mutation call.

## Controls and publication

Pause marks the job `pausing`, stops new dispatch (including subsequent reference batches), drains existing compute/evaluation chains, checkpoints, and interrupts the same native workflow Run. Resume requires the outstanding IDs from `Run.interrupts` and calls `runs.resume` on that Run. A native UI interrupt revokes the workflow Host ports; the execution catch therefore rethrows without attempting further journal writes. A fresh `factor_job` control caller reconciles the durable job with the native Run. Native interruption becomes resumable, native cancellation fences the epoch, and an unknown or prematurely completed native workflow requires inspection rather than automatic replay. The process bridge is responsible for inspecting retained child receipts and for explicitly registering any new pure-compute attempt after native recovery; the runtime does not blindly relaunch unknown processes.

Cancel increments the epoch and marks the job cancelled before cancelling owned child Runs. It waits for the child and workflow cleanup observations using the control caller's un-aborted ports. Repeated cancels from a fresh caller still observe cleanup before returning, even when the durable job was already fenced. Late computation cannot pass the active-job or library transaction fence, and publication callbacks/completion also check the captured epoch before updating the job. A cancelled job cannot be resumed.

Numerical completion is durable before report publication. `reports.publish(job,onPublished)` records the publication receipt through the callback before checking the rendered report. Publication failures retain all numerical evidence and any receipt, set `reportStatus/reportError`, and interrupt the original native Run. The report action resumes that Run using its observed interrupt IDs, preserving its task report binding. The next attempt sees `numericalComplete` and only publishes/checks; it cannot restart search, computation, or holdout selection. A completed native Run may only recheck an existing pinned report. An unknown native outcome cannot trigger fresh publication through an unrelated caller.

`tests/runtime.test.js` uses the real journal with controlled port fakes for deterministic scheduling and lifecycle faults. These tests prove orchestration behavior; actual DEAP/Optuna/Qlib evidence belongs to the separate engine and host integration tests.
