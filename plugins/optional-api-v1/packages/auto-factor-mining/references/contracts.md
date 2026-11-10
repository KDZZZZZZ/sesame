# 因子研究接口 3.1

Agent/Agent 工作流调度，插件执行明确步骤。宿主和 SDK 不变。公共工具以 capabilities.json 的闭合 schema 为准；旧总控工具已移除。

## 公共输入与输出

Ref 为完整固定 ArtifactRef `{id,revision,digest,kind,schemaVersion:"1.0.0"}`。除了外部原始数据 kind:data，其余阶段产物为 kind:resource。不得用路径或私有 ResourceRef 替代。

```ts
type ResourceBudget = {maxSeconds:number; maxInputBytes:number; maxOutputBytes:number};
type SearchBudget = ResourceBudget & {maxCandidates:number; batchSize:number; seed:number};
type Source = {datasetId:string} | {ref:Ref};
type Layout = {universe:string[]; frequency:string; timezone:'UTC'; availableAt:'bar_close';
  development:[string,string]; holdout:[string,string]; target:Target};
type Target = {kind:'forward_return'|'forward_volatility'; field:string; horizonBars:number}
  | {kind:'provided'; field:string; scale:'continuous'|'categorical'; horizonBars:number};
type Formula = {dsl:'qlib-expr/1'; tree:Expr};
type Expr = {field:string} | {constant:number} | {call:Op; args:Expr[]};
type Candidate = {id:string; formula:Formula; hypothesis:string;
  origin:{method:'seed'|'template'|'random'|'deap'|'optuna'; parents:string[]; parameters:Record<string,number>}};
```

| 工具 | 输入 → 最终输出 |
|---|---|
| factor_environment | `{action:'inspect'|'prepare',pythonPath?}` → `{ready,pythonPath,versions,environmentDigest,reason?}` |
| factor_prepare | `{requestId,source,layout,budget:ResourceBudget}` → `{snapshotRef,snapshotId,fields,layout,rows:{development,holdout}}` |
| factor_search open | `{action:'open',requestId,snapshotRef,need,space,profile,references:string[],budget:SearchBudget}` → SearchResult |
| factor_search propose | `{action:'propose',requestId,searchId,limit,feedback:{factorId,evaluationId}[]}` → SearchResult |
| factor_search read | `{action:'read',searchId}` → SearchResult |
| factor_compute | `{requestId,snapshotRef,formulas:Candidate[],partition:'development'|'holdout',budget:ResourceBudget,diagnostics?:Diagnostic[]}` → `{valuesRef,valuesId,snapshotId,partition,candidates:({id,status:'ok',computeKey}|{id,status:'failed',error})[]}` |
| factor_evaluate | `{requestId,valuesRef,profile,referenceValues:Ref[],budget:ResourceBudget}` → `{valuesRef,partition,evaluations:Item<Evaluation>[],factorIds:string[]}` |
| factor_library | register: `{action:'register',operationId,formula,name,hypothesis,sources,changes}`；query: `{action:'query',query}`；read: `{action:'read',factorId,cursor?,limit?}`；annotate: `{action:'annotate',factorId,note,operationId}` |
| factor_pool | read: `{action:'read',poolId}`；decide: `{action:'decide',change}`；feedback: `{action:'feedback',poolId,strategyVersion,poolVersion,applicationEvidence:Ref[],note,operationId}` |

SearchResult 为 `{searchId,snapshotRef,checkpoint:Ref|null,attempted,exhausted,candidates:Candidate[]}`。open/read 不产生候选；propose 至多 min(limit,batchSize) 个，limit=0 仅记录反馈。新候选、重复及失败都计入 maxCandidates；next/propose 不触发计算。references 是预先选定的库因子 ID，用来约束开发评价的参考身份。

compute 一次 1–64 个不重复 ID 的候选。referenceValues 至多 32 个，必须是已计算的相同快照/分区/引擎 Values，工具不会代算。diagnostics 只准备明确声明的辅助值，evaluate 再按 profile 执行诊断。prepare/search/compute/evaluate 是公开 native function Run，最终结果在 completed run.output；状态控制使用宿主既有 Run 工具。

## 搜索空间与评价

Space 固定 `{fields,operators,windows,lags,constants,maxNodes,maxDepth,maxLookbackBars,seeds,templates}`。可用算子 Add/Sub/Mul/Div/Abs/Log/Ref/Mean/Std/Min/Max/Sum/Rank。Ref 与窗口为正整数；Rank 是滚动时序百分位排名。模板为 `{tree,domains}`，树中使用 `{parameter:name}`，域是明确有限数值列表；不接受可执行代码。

Profile 固定 `{id,version:1,kind:'alpha'|'risk'|'state',axis:'time_series'|'cross_section',minPairs,minCoverage,stabilityWindows,maxReferenceCorrelation,score,diagnostics}`。alpha/risk 的 score 是 abs_rank_ic；state 是 eta_squared 且须分类标签。

Diagnostic 为 `{kind,required,options,repetitions?}`：

| kind | options |
|---|---|
| placebo / bootstrap | `{blockBars,seed,confidence}`，另有 repetitions |
| walk_forward | `{foldBars}` |
| regimes | `{field,bins:number[]}` |
| sensitivity | `{argumentPath:number[],neighbors:number[]}` |
| quantiles | `{count}` |

Evaluation 保存 candidateId、valuesId/valuesRef、完整 Profile、partition、pairs、coverage/ic/rankIC/stability/maxReferenceCorrelation/complement/score、diagnostics、eligibility/reasons 与 details 引用。Metric 是 `{value:number|null,status:'computed'|'unavailable',reason?}`；诊断保留 passed/failed/incomplete。精确 EvidenceContext 覆盖 snapshotId、sourceDigest、layoutDigest、profileDigest、engineDigest、referenceDigest。搜索只接受真实库内同一上下文的 development 评价，不接受 caller 分数或 holdout 评价。

## 库与策略池

Factor 保存 `{id,formula,definitionDigest,evaluationIds,annotations,registrations?}`；evaluationIds 为有界预览，read 返回分页完整评价。query 可按 text/evaluated/fields/kind/axis/universe/frequency/profileId/minCoverage/evidenceMatch 过滤，cursor/limit 分页；空页仍可能有下一页。text 最多 256 字符，匹配登记名称和假设；evaluated 表示是否已有实际评价，不表示评价通过。依赖评价的筛选仍只匹配符合条件的 supported 证据。

register 是立即写入用户工作区的定义操作，不访问网络、运行 Python 或评价。formula 使用现有类型树；operationId 最多 128 字符；name 1–128 字符；hypothesis 和 changes 各 1–4000 字符。sources 为 0–4 个 `{url,revision,license}`，url 为不含用户名密码的 HTTPS 链接（最多 2048 字符），revision 和 license 各 1–128 字符。外部定义记录固定版本，原创定义 sources=[]。

registrations 为至多 8 份去重的 `{name,hypothesis,sources,changes}`。公式及算子语义决定 factorId，名称不决定身份；别名和不同来源附在同一数学定义下。新定义 evaluationIds=[]，后续真实评价合并到同一 ID 并保留登记来源；改公式产生新的定义。同 operationId 同请求返回固定结果，不覆盖后来证据；同 ID 改请求会拒绝。登记条目满时明确报错，不丢弃来源。

PoolChange 为 `{operationId,poolId,strategyId,expectedVersion,decision:'add'|'replace'|'remove',factorIds,replaces,purpose,reason,strategyVersion,applicationEvidence}`。replace 明确命名被替换成员，其他操作 replaces=[]。Pool 返回 `{id,strategyId,version,factorIds,history}`。应用反馈附着精确策略/池版本，不改因子数值。计算、评价、搜索都不变更池成员。

## 内部模块边界

- search.propose(request,checkpoint,feedback,limit,ctx)：只生成一批，使用真实 DEAP/Optuna；看不到原始数据或 holdout。
- compute.prepare(source,layout,budget,ctx) → Snapshot；compute.compute(snapshot,candidates,partition,ctx,diagnostics?) → Values。
- evaluator.evaluate(values,profile,referenceValues,ctx) → Item<Evaluation>[]。
- library.register(input,signal)：登记定义及来源；library.record(candidates,evaluations,ctx)：校验证据并合并归档；其余读写按明确调用执行。
- execution.execute(kind,input,signal,nativeExecution,work)：只管理本次操作的身份、活动预算、恢复与固定结果，不决定研究顺序。
- search-session.handle(input,signal,nativeExecution)：维护固定空间、checkpoint 和累计预算，仅在 propose 时调用搜索器。

Python 文件协议仍为 `{schema:'factor-worker/1',command,limits,input}` → `{schema,command,status,output,error}`，命令 prepare/propose/compute/evaluate。bridge 负责校验进程回执、资源发布和重新物化。纯数学模块不访问宿主状态。

资源使用 factor-snapshot/source-rows/provider/provider-features/calendar/symbol-map/matrix/values/search-state/evidence/usage/history/provider-file 等 /1 schema。JSON 与二进制分片分别记录真实字节摘要；provider 分层每份依赖不超宿主上限。矩阵按显式行键与 rowOrderDigest 对齐，固定引用不保存旧 attempt 路径。更多数值行为见 [评价](evaluation.md)、[搜索](search.md)，运行控制见 [执行](execution.md)。
