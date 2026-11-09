# 因子研究模块接口

2026-11-09。本文描述 2.0.0 实现采用的模块边界与数据结构；能力入口以包内 `capabilities.json` 为准，运行和证据约定见 [运行说明](runtime.md)、[搜索说明](search.md) 与 [评价说明](evaluation.md)。旧接口不再保留。

## 1. 产品与包边界

唯一实现包采用 `sesame/plugins/optional-api-v1/packages/auto-factor-mining/`，保留 ID `sesame/auto-factor-mining`，显示名改为“因子研究”；全量替换旧工具和实现，吸收并移除独立 `factor-evaluator` 安装项。稳定包 ID 不承诺旧工具、AST、回执或运行的兼容。宿主 `mt5agent`、SDK 不改。
流程：策略需求 → 查库 → 复用／补评／搜索 → Qlib → 纯因子评价 → 入库；外部策略明确决定池成员。挖掘完成不依赖策略回测，不改策略池。
一个包内直接调用模块；不建消息总线、常驻服务、MongoDB、共享 Redis、外部 Qlib 服务或迁移框架。Python 每次执行一个有界工作块，真正调用 Qlib/DEAP/Optuna。

## 2. 共享 JSON 类型

以下定义落成 `contracts.js` 的 JSON 校验与 `references/contracts.md`；Python 按同一固定 fixture 验证，不另设计协议。所有对象拒绝未知字段，JSON 禁止 NaN/Infinity，时间是 UTC ISO 字符串，摘要是 canonical-JSON/真实字节 SHA-256。

```ts
type Ref = {id:string; revision:string; digest:string; kind:string; schemaVersion:string}; // 固定 ArtifactRef
type JsonValue = null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
type Page<T> = {items:T[]; cursor:string|null};
type Error = {code:string; message:string; retryable:boolean};
type Item<T> = {id:string; status:'ok'; value:T}|{id:string; status:'failed'; error:Error};
type Expr = {field:string}|{constant:number}|{call:Op; args:Expr[]};
type Op = 'Add'|'Sub'|'Mul'|'Div'|'Abs'|'Log'|'Ref'|'Mean'|'Std'|'Min'|'Max'|'Sum'|'Rank';
type Formula = {dsl:'qlib-expr/1'; tree:Expr};
type Candidate = {id:string; formula:Formula; hypothesis:string;
  origin:{method:'seed'|'template'|'random'|'deap'|'optuna'; parents:string[]; parameters:Record<string,number>}};
type ParameterExpr = {field:string}|{constant:number}|{parameter:string}|{call:Op;args:ParameterExpr[]};
type Template = {tree:ParameterExpr; domains:Record<string,number[]>};
type Space = {fields:string[]; operators:Op[]; windows:number[]; lags:number[]; constants:number[];
  maxNodes:number; maxDepth:number; maxLookbackBars:number; seeds:Formula[]; templates:Template[]};
type Source = {datasetId:string}|{ref:Ref};
type Target = {kind:'forward_return'|'forward_volatility'; field:string; horizonBars:number}
  |{kind:'provided'; field:string; scale:'continuous'|'categorical'; horizonBars:number};
type Profile = {id:string; version:1; kind:'alpha'|'risk'|'state'; axis:'time_series'|'cross_section';
  minPairs:number; minCoverage:number; stabilityWindows:number; maxReferenceCorrelation:number;
  score:'abs_rank_ic'|'eta_squared'; diagnostics:Diagnostic[]};
type Diagnostic = {kind:'placebo'|'bootstrap'|'walk_forward'|'regimes'|'sensitivity'|'quantiles';
  required:boolean; repetitions:number; options:Record<string,number|string|number[]>};
type Budget = {maxCandidates:number; batchSize:number; maxWorkers:number; maxSeconds:number;
  maxInputBytes:number; maxOutputBytes:number; seed:number};
type Layout = {universe:string[]; frequency:string; timezone:string; availableAt:'bar_close';
  development:[string,string]; holdout:[string,string]; target:Target};
type Draft = {requestId:string; need:string; source:Source; layout:Layout; space:Space; profile:Profile;
  references:string[]; budget:Budget; strategyId?:string; poolId?:string};
type Shards = {manifest:Ref; digest:string; rows:number; bytes:number}; // manifest 引用多个独立资源
type Snapshot = {id:string; manifest:Ref; source:Ref; layout:Layout; fields:string[]; calendarDigest:string;
  development:Shards; holdout:Shards; provider:Ref; usageLedgerRef:Ref};
type SearchRequest = {requestId:string; need:string; development:{snapshotId:string;source:Ref;
  layout:Omit<Layout,'holdout'>;fields:string[];calendarDigest:string};
  space:Space; profile:Profile; references:string[]; budget:Budget};
type Feedback = {candidateId:string; evaluationId:string; developmentScore:number|null;
  status:'valid'|'invalid'; reasons:string[]};
type SearchBatch = {candidates:Candidate[]; checkpoint:Ref; exhausted:boolean};
type DiagnosticValues = {covariates:Shards|null; sensitivityMatrix:Shards|null;
  sensitivity:{candidateId:string; argumentPath:number[]; neighbors:{value:number; column:string}[]}[]};
type Values = {id:string; manifest:Ref; snapshotId:string; snapshotRef:Ref; partition:'development'|'holdout'; matrix:Shards;
  candidates:Item<{candidate:Candidate; column:string; computeKey:string}>[]; labels:Shards;
  diagnosticValues:DiagnosticValues; engine:{name:'qlib'; version:string; environmentDigest:string; operatorDigest:string}};
type EvidenceContext = {snapshotId:string; sourceDigest:string; layoutDigest:string;
  profileDigest:string; engineDigest:string; referenceDigest:string};
type Metric = {value:number|null; status:'computed'|'unavailable'; reason?:string};
type Evaluation = {id:string; candidateId:string; valuesId:string; valuesRef:Ref; context:EvidenceContext; profile:Profile;
  partition:'development'|'holdout'; pairs:number; coverage:Metric; ic:Metric; rankIC:Metric;
  stability:Metric; maxReferenceCorrelation:Metric; complement:Metric; score:Metric;
  diagnostics:{kind:Diagnostic['kind']; status:'passed'|'failed'|'incomplete'; evidence:Ref|null; reason?:string}[];
  eligibility:'supported'|'insufficient'|'invalid'; reasons:string[]; details:Ref};
type Factor = {id:string; formula:Formula; definitionDigest:string; evaluationIds:string[]; annotations:string[]};
type Query = {fields?:string[]; kind?:Profile['kind']; axis?:Profile['axis']; universe?:string[];
  frequency?:string; profileId?:string; minCoverage?:number; evidenceMatch?:EvidenceContext; cursor?:string; limit?:number};
type Job = {id:string; runId:string; status:'queued'|'running'|'pausing'|'paused'|'interrupted'|'cancelled'|'completed'|'failed';
  epoch:number; completed:number; proposed:number; report:Ref|null; error:Error|null};
type PoolChange = {operationId:string; poolId:string; strategyId:string; expectedVersion:number;
  decision:'add'|'replace'|'remove'; factorIds:string[]; replaces:string[]; purpose:string; reason:string;
  strategyVersion:string; applicationEvidence:Ref[]};
type Pool = {id:string; strategyId:string; version:number; factorIds:string[]; history:Ref};
```

ArtifactRef revision is a string (verified in `mt5agent/modules/plugins/host-v2/agent-tools.js`); digest matches `^sha256:[a-f0-9]{64}$`. Private durable ResourceRef `{id,kind,version}` is an implementation handle, never accepted in place of `Ref`.
`Diagnostic.options` has a closed per-kind schema: placebo/bootstrap `{blockBars,seed,confidence}`; walk_forward `{foldBars}`; regimes `{field,bins:number[]}`; sensitivity `{argumentPath:number[],neighbors:number[]}`; quantiles `{count}`. argumentPath follows tree.args indices and must end at a numeric constant; no name inference or executable expressions. `repetitions` is required only for resampling; implementation uses a proper discriminated union.

## 3. Minimal public tools

All are ordinary declared API2 capabilities with exact action schemas. `factor_research` and `factor_measure` return `Job` promptly; one host-only resumable `factor_workflow({jobId})` executes both. No public internal submit/context/propose endpoints.

| Tool | Exact entry shape → result | Purpose |
|---|---|---|
| `factor_environment` | `{action:'inspect'|'prepare',pythonPath?:string}` → `{ready,pythonPath,versions,environmentDigest,reason?}` | Inspect existing or create package-private environment; never pip-install into global Python. |
| `factor_research` | `{draft:Draft}` → `{resolution:'reuse',factors:Factor[]}` or `{resolution:'research',job:Job}` | Query matching evidence first; missing evidence causes reevaluation, absent formulas causes mining. |
| `factor_measure` | `{requestId,source,layout,profile,formulas:Candidate[],references:string[],budget,mode:'compute'|'evaluate'|'both',valuesRef?:Ref}` → `Job` | Independent existing-formula computation/evaluation; evaluate requires frozen valuesRef, compute does not require search. |
| `factor_job` | `{action:'read'|'pause'|'resume'|'cancel'|'report',jobId,interruptIds?:string[],cursor?:string,limit?:number}` → `Job` plus paged evidence/report | Native run control; resume uses observed interrupt IDs. |
| `factor_library` | `{action:'query',query:Query}` / `{action:'read',factorId,cursor?,limit?}` / `{action:'annotate',factorId,note,operationId}` → page / `{factor,evaluations:Page<Evaluation>}` / factor | Query, reuse, inspect and annotate evidence; never accepts caller-supplied numerical metrics. |
| `factor_pool` | `{action:'read',poolId}` / `{action:'decide',change:PoolChange}` / `{action:'feedback',poolId,strategyVersion,poolVersion,applicationEvidence:Ref[],note,operationId}` → `Pool`/feedback ref | Explicit strategy selection and external application evidence. Mining cannot invoke mutation methods. |

For `factor_measure`, schemas are a discriminated union: compute needs source/layout/formulas; evaluate needs valuesRef/profile/references; both needs all computation and evaluation fields. No unused required fields. Public receipts contain references and bounded summaries, never full vectors. Library reuse requires matching data/target/profile versions and declared thresholds; otherwise return the evidence gap, not an ungrounded claim of suitability. Caller can create a new request/branch to change scope.

## 4. Exact internal exports and dependency injection

```ts
// Context is local execution state, never JSON or passed into the mathematics.
type Context = {jobId:string; epoch:number; attemptId:string; signal:AbortSignal};
// Each factory is the sole exported module constructor; dependencies are injected, never global host lookup.
createSearch({python}): {
  propose(request:SearchRequest, checkpoint:Ref|null, feedback:Feedback[], limit:number, ctx:Context):Promise<SearchBatch>
};
createCompute({python}): {
  prepare(source:Source, layout:Layout, budget:Budget, ctx:Context):Promise<Snapshot>;
  compute(snapshot:Snapshot, candidates:Candidate[], partition:'development'|'holdout', ctx:Context, diagnostics?:ComputeDiagnostics):Promise<Values>
};
createEvaluator({python}): {
  evaluate(values:Values, profile:Profile, referenceValues:Values[], ctx:Context):Promise<Item<Evaluation>[]>
};
createLibrary({state,artifacts}): {
  query(query:Query):Promise<Page<Factor>>; read(factorId:string):Promise<Factor>;
  evaluations(factorId:string,page:{cursor?:string;limit?:number}):Promise<Page<Evaluation>>;
  record(candidates:Candidate[], evaluations:Evaluation[], fence:{jobId:string; epoch:number}):Promise<Factor[]>;
  annotate(factorId:string,note:string,operationId:string):Promise<Factor>;
  pool(poolId:string):Promise<Pool>; decide(change:PoolChange):Promise<Pool>;
  feedback(input:{poolId:string; strategyVersion:string; poolVersion:number; applicationEvidence:Ref[]; note:string; operationId:string}):Promise<Ref>
};
createRuntime({search,compute,evaluator,library,journal,runs,reports}): {
  research(draft:Draft):Promise<{resolution:'reuse';factors:Factor[]}|{resolution:'research';job:Job}>;
  measure(input:MeasureRequest):Promise<Job>; execute(jobId:string,execution:NativeExecution):Promise<Job>;
  control(jobId:string,action:'read'|'pause'|'resume'|'cancel'|'report',interruptIds?:string[]):Promise<Job>
};
```

`MeasureRequest` is exactly the public discriminated union above; `NativeExecution` is existing API2 execute third argument. Injected host ports retain SDK shapes. Thin numerical JS adapters call only `python.execute(command,input,ctx)`: high-level inputs are propose `{request,checkpoint,feedback,limit}`, prepare `{source,layout,budget}`, compute `{snapshot,candidates,partition,diagnostics?}`, evaluate `{values,profile,referenceValues}`. Root bridge alone resolves/freezes dataset Sources, translates refs/files, registers attempt budgets, invokes existing process capability, verifies output and publishes results. Numerical owners implement fixed worker inputs and thin wrappers, not duplicate IO bridges or hidden host.data access.
`ComputeDiagnostics={covariateFields:string[],sensitivity:{candidateId:string,argumentPath:number[],neighbors:{value:number,column:string,formula:Formula}[]}[]}`. Root constructs neighbor formulas, B computes them with Qlib. Covariates contain only declared regime fields with frozen availability. Missing/inapplicable auxiliary input yields that diagnostic's incomplete result; evaluate-only does not fetch new data. Required incomplete diagnostics cannot pass; all auxiliary matrices require matching row order and keys.
Python exports are `search.propose(request,checkpoint,feedback,limit)->dict`, `compute.prepare(request)->dict`, `compute.compute(request)->dict`, and pure `evaluate.evaluate(keys,factors,labels,references,profile,diagnosticValues)->list[dict]`. CLI loader handles file IO/metadata; pure evaluator consumes aligned arrays without Qlib, host, search, persistence, trading or process dependencies. Search gets development metadata/feedback but no data files. Shared `formula.validate_and_compile(formula,space)->{expression,lookback,digest}` never computes values; search uses Space, independent measure uses frozen DSL safety limits and snapshot fields, not an invented search request.

Root-owned file adapter is fixed: `readJSON(ref:Ref,ctx):Promise<JsonValue>`, `publishJSON(value:JsonValue,write:ArtifactWrite,ctx):Promise<Ref>`, `importFile(file:LocalFile,write:ArtifactWrite,ctx):Promise<Ref>`, `materialize(ref:Ref,ctx):Promise<LocalFile>`, where `ArtifactWrite={schema:string,dependencies:Ref[],operationId:string}`. Root alone composes dependency manifests and materializes referenced children before dispatch. Both publishers call resources.create then resources.publish and return the latter's `.ref`; materializers verify ref manifest identity and separate bytes digest. No field-renaming ResourceRef into ArtifactRef.
Finite schemas are `factor-snapshot/1`, `factor-source-rows/1`, `factor-provider/1`, `factor-provider-features/1`, `factor-symbol-map/1`, `factor-calendar/1`, `factor-matrix/1`, `factor-values/1`, `factor-search-state/1`, `factor-evidence/1`, `factor-usage/1`, `factor-history/1`, `factor-provider-file/1`. All publish as declared `kind:'resource',schemaVersion:'1.0.0'` with closed content `{format,path,bytesDigest,schema}`; JSON schemas use format `factor-json/1`, path `payload.json`, mediaType `application/json`; provider-file uses `factor-binary/1`, `payload.bin`, `application/octet-stream`. Original source remains a real `kind:'data'` json-rows artifact. ArtifactRef.digest hashes the published manifest; bytesDigest/LocalFile.digest hashes payload bytes; they need not match. Durable manifests contain only immutable Ref dependencies, never old attempt absolute paths; execution manifests substitute approved LocalFile dependencies. Snapshot/Values manifest content omits its returned `manifest` handle to avoid a self-reference.

### Fixed Python file protocol

One `request.json` and one `result.json` per process; argv is `[python,'-I',workerPath,requestPath,resultPath]`. Request envelope is `{schema:'factor-worker/1',command,limits:{maxInputBytes,maxOutputBytes,timeoutMs,maxDiagnosticWork},input}`. Root records these finite attempt limits from the job's remaining budget/profile before launch; workers do not infer budgets from global state or Context. Response is `{schema:'factor-worker/1',command,status:'ok'|'failed',output,error:Error|null}`. `LocalFile={path:string,digest:string,bytes:number}` names a canonical owned path, never outside that attempt's approved roots. Host adapter verifies then publishes files and substitutes immutable ArtifactRefs.

| command | exact `input` keys | exact success `output` keys |
|---|---|---|
| prepare | `{sourceRef,rows:LocalFile[],layout,budget,outputDir}` | `{snapshot:{id,layout,fields,calendarDigest},development:LocalFile,holdout:LocalFile,provider:LocalFile,usageLedger:LocalFile}` |
| propose | `{request:SearchRequest,checkpoint:LocalFile|null,feedback:Feedback[],limit,outputDir}` | `{candidates:Candidate[],checkpoint:LocalFile,exhausted:boolean}` |
| compute | `{snapshot:LocalFile,candidates:Candidate[],partition,diagnostics?:ComputeDiagnostics,outputDir}` | `{values:{id,snapshotId,partition,candidates,engine},matrix:LocalFile,labels:LocalFile,diagnosticValues:DiagnosticValues}`; Shards in diagnosticValues are LocalFile manifests before publication |
| evaluate | `{values:LocalFile,referenceValues:LocalFile[],profile:Profile,context:EvidenceContext,valuesRef:Ref,outputDir}` | `{evaluations:Item<Evaluation>[]}`; details/diagnostic evidence use LocalFile until publication; per-item failure preserves siblings |

Source rows are `{time:string,symbol:string,availableAt:string,fields:Record<string,number|null>}`. A source-partition manifest is `{schema:'factor-source-rows/1',snapshotId,partition,rows,shards:Ref[]}` with source-row arrays as shards. Snapshot manifest is Snapshot without `manifest`; its provider manifest is `{schema:'factor-provider/1',frequency,calendar:Ref,symbolMap:Ref,features:{symbol,field,file:Ref}[]}` for at most 128 feature files. Larger providers replace `features` with `featureGroups:Ref[]` (at most 128). Each referenced index is exactly `{schema:'factor-provider-features/1',features:{symbol,field,file:Ref}[]}` or `{schema:'factor-provider-features/1',groups:Ref[]}`, with 1–128 entries. Repeated index levels bound every provider manifest to at most 130 direct dependencies without reducing the declared universe or source fields. Calendar contains ordered `{barIndex,time,qlibTime}`; symbolMap contains `{original,synthetic}`. Each feature file is Qlib little-endian float32 start-index+values; filenames derive only from validated synthetic symbols/fields. Root republishes all provider children and materializes them under a new attempt's provider root on resume, never reuses an old absolute path. Source rows retain warmup and target-endpoint bars needed by frozen partitions. Search development metadata excludes Snapshot.manifest/provider/usageLedger refs and all holdout metadata; the search bridge never materializes a full snapshot.
Matrix/label manifest is `{schema:'factor-matrix/1',snapshotId,partition,rowOrderDigest,rows,columns:string[],shards:Ref[]}` (LocalFile[] only in execution form); each shard is ordered `{keys:[{symbol,barIndex,time}],columns:{columnId:(number|null)[]}}`. Equal rowOrderDigest and explicit key equality are required before evaluation; labels/reference/covariate/sensitivity matrices align or fail. UTC instants map to one frozen calendar grid; horizon/window N mean N grid positions, never N observed bars or elapsed minutes. Preserve normalized→original timestamp mapping. JSON nonfinite values become null plus invalidity counts. Search materializes no data files. Shared planning fixture: `factor-contract-fixture-20261109.json`.

All `references:string[]` mean library factor IDs. Root reads definitions, reuses or computes values on this same snapshot, then fixes referenceDigest over definitions+compute identities. EvidenceContext.layoutDigest covers universe/frequency/calendar/splits/target/availability; profileDigest covers full profile; engineDigest covers Qlib/environment/operator versions. Root fills Values.snapshotRef from Snapshot.manifest at publication; no Python math change. Evaluator receives context and valuesRef from the bridge. Library.record follows valuesRef→snapshotRef to verify source/layout and other context, including standalone evaluate-only, without hidden job lookups or trusting caller metrics. Query.evidenceMatch enables exact reuse; changed source/target/profile/engine/reference requires new evidence. Read returns paged evaluations. Compute-only Job evidence returns Values.manifest so evaluate-only can consume it.

Pin genuine `pyqlib==0.9.7` (verified available Windows wheel), DEAP and Optuna plus validated transitive dependencies in a dedicated E: venv; Qlib init retains its required MLflow dependency with an explicit owned local URI. No torch dependency is required for this D.features path. Because0.9.7 internally evaluates expressions, the typed-tree compiler allowlist is mandatory.

## 5. Invariants that make these contracts sufficient

- Formula identity is canonical typed tree + DSL/operator version; computation identity adds immutable data/calendar/universe/frequency, engine/environment and partition. Evaluation identity adds target/profile/reference versions. Formula identity is not data identity.
- Validate typed trees before reconstructing Qlib expressions. For features, `Ref` lag and rolling windows are positive integers; no `Ref(0)`, negative lag, future fields, arbitrary Python, custom imports or label access. `Rank` always means rolling time-series rank. Trusted target construction is separate.
- Freeze calendar, field availability, source revision, splits and target before search. In development, drop labels whose future endpoint crosses development end; never make holdout labels visible to feedback. Historical feature warmup may precede a split. Holdout selection and direction/transform fitting freeze once, before holdout access.
- Time-series metrics use within-symbol temporal pairs and fixed chronological windows; cross-sectional IC uses same-time eligible symbols and minimum breadth, with excluded dates counted. Constant/insufficient groups yield unavailable metrics, not zero. Correlations use finite pairwise overlap; coverage denominator is declared eligible rows. Risk profiles use continuous risk labels; state profiles use categorical separation (`eta_squared`), not universal RankIC ranking. Store axis, pair counts and conventions.
- Stability is the distribution of fixed-window association/separation; redundancy is aligned reference correlation; complement reports residual association only when reference rank/sample size permit it. No predictive-complement claim from correlation alone. Required incomplete diagnostics cannot be marked passed. Sensitivity asks compute for declared neighbor formulas; evaluator does not compute formulas.
- Optional implemented diagnostics: paired block placebo/bootstrap, fixed-formula walk-forward, declared available-at regimes, Qlib-computed sensitivity, and future-label quantile summaries. No positions, costs, PnL, Sharpe, drawdown, old Monte Carlo, DSR or PBO in factor results. Record whole trial/failed/duplicate history and prior holdout exposure; no claim that these diagnostics remove whole-search bias.
- Search supports seed/template/random baseline, real DEAP typed structural operations, and real Optuna ask/tell for declared template parameters. JSON checkpoint stores population/trial history/sequence and random state or deterministic per-step seeds; no untrusted pickle. Record asynchronous feedback order and package versions. No independent searcher budget expansion.
- Dispatcher is a bounded continuously draining queue, not per-round `Promise.all` barriers. Reserve candidate/trial identity before launch; compute success can reach evaluation before another candidate finishes. Batch input is real (multiple formulas per Qlib invocation); per-item failures do not discard successful siblings. One snapshot/config per process, Qlib `kernels=1`, shared writable caches disabled.
- Each process ≤540 seconds, host maximum600 seconds; stdout/stderr safely below1MiB. Separate immutable resource shards ≤16MiB, every publish ≤32MiB. State record≤256KiB, transaction≤64 changes/512KiB, query page≤200. Enforce declared input/output/time budgets before materialization and candidate dispatch; split/shrink work blocks, never inflate host limits.
- `journal` owns lifecycle/trial/attempt records; `library` owns factor/evaluation/pool records. Use fresh collections `factor_research_v1_jobs`, `factor_research_v1_trials`, `factor_research_v1_factors`, `factor_research_v1_evaluations`, `factor_research_v1_pools`, `factor_research_v1_feedback`; never decode old Run/session state as new. `record` reads the active epoch and atomically CAS-rewrites that job/fence record in the same short transaction as factor/evaluation writes; a prior read alone is not a fence and host has no assert operation. Cancel increments epoch and cancels owned process Runs; after acknowledged cancellation no late candidate can enter library. Pause stops dispatch and checkpoints at a safe point; resume reconciles process receipts/artifacts before scheduling an explicitly recorded new pure-compute attempt. Unknown completion is not blind replay.
- Library records immutable definitions and separate evaluations; many evaluations never grow one unbounded record (`Factor.evaluationIds` is only a bounded preview; full list is paged). Pool updates use expectedVersion, strategy ownership and idempotent operationId. A research context has no pool-write permission object; direct external strategy invocation supplies the decision, not a model-generated claim inside mining.
- Root declares host-only configuration read/update capabilities for environment selection if using unified configuration; these are not extra public business tools. Report publishing invokes `host.reports.describe/publish` as capabilities, can use existing document content schema, and keeps the2MiB input/256 dependency limits. Never publish report resources directly. Preserve evidence and retry publication only; include versions, formulas, axis, incomplete diagnostics, trials, holdout exposure, exclusions and library refs. Native progress and rendered report are verified separately.

## 6. Small handoff examples

```json
{"dsl":"qlib-expr/1","tree":{"call":"Div","args":[{"call":"Sub","args":[{"call":"Mean","args":[{"field":"close"},{"constant":12}]},{"field":"close"}]},{"call":"Std","args":[{"field":"close"},{"constant":12}]}]}}
```

This compiles to `(Mean($close,12)-$close)/Std($close,12)` only after validation. Its candidate is evaluated in development; zero deviation produces missing/nonfinite evidence under the explicit coverage policy, not a fallback formula.

```json
{"candidateId":"c-12","evaluationId":"ev-dev-12","developmentScore":0.18,"status":"valid","reasons":[]}
```

Holdout results have no conversion to `Feedback`. A library ID returned after recording remains outside every strategy pool until `factor_pool(action='decide')` receives an explicit strategy decision.
