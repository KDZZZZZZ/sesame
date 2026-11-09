# Search proposals and recovery

`createSearch({python}).propose(request, checkpoint, feedback, limit, ctx)` delegates exactly to `python.execute('propose', {request,checkpoint,feedback,limit}, ctx)`. The host bridge resolves and publishes checkpoint artifacts. The numerical entry point is `search.propose(request, checkpoint, feedback, limit)`: its checkpoint is decoded JSON, and it returns `{candidates,checkpoint,exhausted}`. It opens no dataset, provider, or holdout file.

Search accepts the frozen `SearchRequest` development metadata, declared feature space, and development feedback. Unknown request/development/layout fields, including holdout or provider fields, are rejected. Provided target columns cannot be features. Every candidate is validated by the shared `formula.validate_and_compile` policy before it is returned; positive lag/window, field/operator allowlists, scalar domains, depth/node limits, and cumulative lookback limits apply to every method.

## Methods

| Origin | Actual proposal operation |
| --- | --- |
| `seed` | Each declared typed seed is attempted in order. |
| `template` | Each explicit template is instantiated once using the first value in each declared domain. |
| `random` | A bounded typed grammar generates a baseline tree using an independent deterministic attempt seed. |
| `deap` | DEAP `PrimitiveSetTyped`/`PrimitiveTree`, `selTournament`, `mutUniform`, and `cxOnePoint` perform actual typed selection, subtree mutation, and crossover. Series, scalar, positive-window, and lag positions have distinct types. |
| `optuna` | A private in-memory `TPESampler` study per parameterized template uses actual `Study.ask`, categorical suggestions from declared domains, and `Study.tell`. Startup sampling uses three trials. Only explicitly named `{parameter: ...}` nodes are tuned. |

After the seed/template baseline and one random attempt, DEAP, Optuna, and random proposals alternate. Templates with no domains have a baseline but no Optuna study. If no usable genetic parent exists, the corresponding attempt is correctly labeled `random`. At most 64 valid or pending candidates form the genetic population; finite development scores rank it, and terminal invalid/unavailable candidates are excluded. Failed or unchanged genetic operations are recorded, rather than relabeled as successful proposals. Repeated finite-domain Optuna suggestions remain duplicate attempts and consume budget.

DEAP only manipulates trees: no expression strings, `gp.compile`, `eval`, pickle, or callable template input are used. The emitted formula identity comes from the shared compiler, including the DSL/operator policy digest. Integral floats and negative zero use the same canonical identity as JavaScript.

## JSON checkpoint

The checkpoint has these exact top-level fields:

```text
schema: "factor-search-state/1"
version: 1
requestDigest: canonical digest of the entire frozen SearchRequest
engines: {python,deap,optuna,numpy,scipy,operatorDigest}
seed: the frozen budget seed
attempts: ordered Attempt[]
feedback: ordered FeedbackRecord[]
events: ordered OptunaEvent[]
population: candidate IDs, at most 64
budget: {used,proposed,failed,duplicates,remaining}
exhausted: boolean
stopReason: null | "candidate_budget" | "checkpoint_bytes"
```

`Attempt` is `{sequence,method,operation,parents,parameters,formula,candidateId,definitionDigest,status,reason,duplicateOf,trial}`. Sequence numbers start at zero. `operation` is `mutation`, `crossover`, or null. Status is `proposed`, `duplicate`, or `failed`. Invalid formulas and their bounded error reason remain in history. A duplicate retains its formula/digest and `duplicateOf` original candidate ID; it does not reserve another candidate. `trial` is null or `{templateIndex,number}` for an actual Optuna trial.

`FeedbackRecord` is `{sequence,value,disposition}`. `value` is the shared `Feedback` object. Disposition is `accepted`, `late`, or `unknown`. The first terminal feedback for a reserved candidate wins; exact repeated evaluation IDs are no-ops, and reusing an evaluation ID with different content raises `FEEDBACK_CONFLICT`. Later terminal evaluations are retained as `late`, without changing fitness or telling Optuna twice. Unknown IDs are retained but ignored, even if that formula is proposed later. Invalid feedback or a null score tells an owned Optuna trial `FAIL`; valid finite scores tell it `COMPLETE` with that score. Rejected candidates leave the genetic population. Each feedback item is capped at 16 KiB.

`OptunaEvent` is `{kind:'ask',attempt}` or `{kind:'tell',attempt,state:'COMPLETE'|'FAIL',value:number|null}`. These events preserve the actual asynchronous ask/tell order. Recovery creates fresh in-memory studies and replays every ask and tell, comparing each suggested parameter set with its recorded result. Missing or contradictory outcomes are rejected. Sampler state is never pickled, and studies have no shared database or mutable cross-job storage.

Each structural/random attempt uses SHA-256 of the frozen seed and its sequence to seed a saved/restored Python random state. Stable type hashes preserve DEAP's crossover type choice across fresh interpreters. Engine version or request changes reject the checkpoint; they require a new search branch. A caller must still journal candidate reservation and fence process commits: replay alone does not decide which external process attempt has committed.

## Budgets

`budget.used` equals `attempts.length`, including invalid and duplicate proposals. `maxCandidates` is an attempt budget. One call returns at most `min(limit,batchSize)` candidates and performs at most four attempts per requested candidate; it can return fewer candidates without exhaustion. `limit=0` applies feedback only, including after exhaustion.

Before starting another attempt, search reserves enough bytes for the worst-case resulting tree, returned candidate, history metadata, and terminal feedback for pending candidates. It stops with `checkpoint_bytes` before losing history. The effective cap is at most `min(budget.maxOutputBytes,16 MiB)` and also leaves room for the frozen request in the next input. An input or already supplied feedback batch that exceeds its declared byte budget fails explicitly; history is never silently truncated. The worker/host enforce process time and transport budgets.

## Dependencies and verification

The package-private validated runtime uses DEAP 1.4.4 and Optuna 5.0.0. Implementations follow the upstream [DEAP typed GP API](https://deap.readthedocs.io/en/master/api/gp.html) and [Optuna Study ask/tell API](https://optuna.readthedocs.io/en/stable/reference/generated/optuna.study.Study.html). Dependency pins and transitive versions are maintained in the package Python requirements, and each checkpoint records the actual installed search versions.

`tests/search_test.py` runs the real packages: all five methods, typed mutation and crossover, feedback-dependent TPE continuation, positive/invalid/late/duplicate feedback, bounded failed/duplicate history, byte-budget headroom, tampered replay rejection, and fresh-interpreter replay with different hash seeds. The shared contract fixture and JavaScript canonical serializer verify formula identity. `tests/search.test.js` verifies only the thin adapter boundary; its injected port is not numerical-engine evidence.
