import { invokeValue } from '@sesame/plugin-sdk/capabilities';
import { roleTask, submitRole, waitRole } from './role-runs.js';
import { publicationFile, publishFiles } from './publications.js';
import { records } from './records.js';
import { nativeReportReceipt } from './presentation-receipts.js';
import { canonical, digest, check, readConsumedView, observedH1Limitations } from './replay-presentation.js';
import { publishWeeklyReport } from './report.js';
import { freezeSourceClassification, weeklyProvenanceKind, weeklySourceEvidence, weeklySourceReferences } from './report-provenance.js';
const WEEK=7*86400000, MONDAY=Date.UTC(1970,0,5), COLLECTION='round2-weekly';
const copy=x=>structuredClone(x), utc=unixMs=>({basis:'utc',unixMs});
export const weekStartUTC=t=>MONDAY+Math.floor((t-MONDAY)/WEEK)*WEEK;
const n=v=>{check(typeof v==='string'&&/^-?\d+(\.\d+)?$/.test(v),'Expected exact financial Decimal','SOURCE_DATA_INVALID');const [a,b='']=v.split('.');return {n:BigInt(a+b),s:b.length};};
const text=({n,s})=>{const neg=n<0n;let t=(neg?-n:n).toString().padStart(s+1,'0');if(s)t=t.slice(0,-s)+'.'+t.slice(-s);return (neg?'-':'')+t.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');};
const add=(a,b,sub=false)=>{const x=n(a),y=n(b),s=Math.max(x.s,y.s);return text({n:x.n*10n**BigInt(s-x.s)+(sub?-1n:1n)*y.n*10n**BigInt(s-y.s),s});};
const cmp=(a,b)=>n(add(a,b,true)).n;
const ratio=(a,b)=>{const x=n(a),y=n(b);check(y.n!==0n,'Zero ratio denominator');return text({n:x.n*10n**BigInt(y.s+8)*100n/(y.n*10n**BigInt(x.s)),s:8});};
const unknown=reason=>({status:'unknown',reason});
const queues=new WeakMap();
function serial(host,fn){const prev=queues.get(records(host))??Promise.resolve();const work=prev.catch(()=>{}).then(fn);queues.set(records(host),work);return work.finally(()=>{if(queues.get(records(host))===work)queues.delete(records(host));});}
const get=(host,id)=>records(host).get(COLLECTION,id,true);
function cas(host,id,expected,changes){let out;records(host).transaction(()=>{const old=get(host,id);check(old&&old.revision===expected,'Weekly record CAS conflict','VERSION_CONFLICT');out={...old,...copy(changes),id,revision:old.revision+1};records(host).put(COLLECTION,out);});return out;}
function create(host,row){records(host).transaction(()=>{const old=get(host,row.id);check(!old||old.inputDigest===row.inputDigest,'Weekly idempotency conflict','IDEMPOTENCY_CONFLICT');if(!old)records(host).put(COLLECTION,row);});return get(host,row.id);}

/** Frozen chronological account/data frame. Never observes a later service.
 * Account is the actual CORE snapshot marked at this commit; asOfMs is the
 * disclosure frontier, quoteTimeMs (if provided) is independently preserved. */
export function freezeWeeklyFrame(host,service,context){
  const engine=copy(context.engine),cutoff=context.replayCutoffMs,account=copy(context.account);
  check(engine?.id===context.runId&&Number.isSafeInteger(cutoff)&&account?.asOfMs===cutoff,'Exact boundary account snapshot required; never reconstruct from later account','BOUNDARY_SNAPSHOT_REQUIRED');
  check(account.engineVersion===engine.version&&account.balance===engine.balance,'Account/engine version or balance mismatch','SOURCE_MISMATCH');
  for(const k of ['balance','equity','unrealizedJpy','margin','freeMargin'])check(typeof account[k]==='string'||account[k]?.status==='unknown',`Missing account ${k}`,'SOURCE_DATA_INVALID');
  if(account.quoteTimeMs!=null)check(Number.isSafeInteger(account.quoteTimeMs)&&account.quoteTimeMs<=cutoff,'Future account quote','FUTURE_DATA_FORBIDDEN');
  let view=copy(context.market??readConsumedView(host,context.runId));
  if(view?.bars?.some(b=>b.sourceKind==='observed_native_h1_preheat_not_execution_ticks'&&!b.h1Limitation)){const data=service.getData?.();check(!engine.dataDigests||canonical(engine.dataDigests)===canonical(data?.digests),'Prepared H1 metadata source changed','SOURCE_MISMATCH');view=observedH1Limitations(view,data);}
  check(view&&view.runId===context.runId&&view.cutoffMs===cutoff,'Exact consumed market frontier required','CONSUMED_TICKS_REQUIRED');
  for(const b of view.bars??[])check(Number.isSafeInteger(b.asOf)&&b.asOf<=cutoff&&(b.lastTickMs==null||Number.isSafeInteger(b.lastTickMs)&&b.lastTickMs<=cutoff),'Future forming price in week input','FUTURE_DATA_FORBIDDEN');
  const fields=['orders','fills','ledger','equity','decisions'];for(const field of fields)check(Array.isArray(engine[field]),`Missing ${field}`,'SOURCE_DATA_INVALID');
  for(const field of ['orders','fills','ledger','equity'])for(const row of engine[field])check(Number.isSafeInteger(row.time)&&row.time<=cutoff,`Future or unknown ${field} time`,'FUTURE_DATA_FORBIDDEN');
  for(const row of engine.decisions)check(Number.isSafeInteger(row.executionTime)&&row.executionTime<=cutoff,'Future decision time','FUTURE_DATA_FORBIDDEN');
  check(engine.position!==undefined,'Position unknown','SOURCE_DATA_INVALID');
  if(['balance','equity','unrealizedJpy'].every(k=>typeof account[k]==='string'))check(cmp(add(account.balance,account.unrealizedJpy),account.equity)===0n,'Equity is not balance + unrealized PnL','LEDGER_MISMATCH');
  if(['equity','margin','freeMargin'].every(k=>typeof account[k]==='string'))check(cmp(add(account.equity,account.margin,true),account.freeMargin)===0n,'Free margin is not equity - margin','LEDGER_MISMATCH');
  const methods=copy(context.methods??[]);for(const m of methods){check(m.status!=='adopted'||(m.pluginId&&m.version&&m.method&&m.inputRefs?.length&&m.outputRef),'Adoption requires actual method input/output evidence','METHOD_EVIDENCE_REQUIRED');if(m.asOfMs!==undefined)check(m.asOfMs<=cutoff,'Future method evidence','FUTURE_DATA_FORBIDDEN');}
  const sourceProvenance=freezeSourceClassification(service.getData()?.provenance);
  const frame={schemaVersion:'1.0.0',runId:context.runId,chapter:context.chapter??engine.chapter,cutoffMs:cutoff,engineVersion:engine.version,account,sourceProvenance,market:{runId:view.runId,cutoffMs:view.cutoffMs,bars:copy(view.bars),sources:copy(view.sources??[])},positions:copy(engine.position),orders:copy(engine.orders),fills:copy(engine.fills),costs:copy(engine.ledger),equity:copy(engine.equity),decisions:copy(engine.decisions),methods,
    plugin:copy({id:host.context.pluginId,version:host.context.pluginVersion,revision:host.context.pluginRevision}),methodVersions:methods.map(m=>({pluginId:m.pluginId,version:m.version,method:m.method,status:m.status})),profile:copy(engine.experimentProfile??engine.profile??engine.rules??null),sourceDigests:copy(engine.dataDigests??null),sourceCoverage:copy(context.sourceCoverage??{complete:false,unresolvedEarlyCHFJPYEvents:327,policy:'strict missing-data pause; no old-run bound supplement reuse'}),originalComparison:copy(context.originalComparison??[]),roleEvidence:copy(context.roleEvidence??[]),restrictions:['同一历史的知情重放，非独立样本外；无通过前瞻验证的专属规则','模型预训练可能记得历史；仅限制可显式访问的输入','原作区间/反算/拟合只供观众，不构建原作总资产/账本','缺失CHFJPY保持原60秒政策暂停，不插值/偷看未来']};
  for(const row of frame.originalComparison)check((row.knownAt?.unixMs??row.time?.unixMs??Infinity)<=cutoff,'Unrevealed original story','FUTURE_DATA_FORBIDDEN');
  // Original attachment is not a role input. Reporting generation is isolated
  // with no player tools and no access to a current mutable service.
  check(Buffer.byteLength(JSON.stringify(frame))<=24*1024*1024,'Frozen frame exceeds artifact budget; explicit partition required','RESOURCE_EXHAUSTED');return frame;
}
export function weeklyFinancials(open,close){
  check(open.runId===close.runId&&open.chapter===close.chapter&&open.cutoffMs<close.cutoffMs,'Invalid weekly account pair');
  check(canonical(close.costs.slice(0,open.costs.length))===canonical(open.costs),'Opening cost prefix changed','SOURCE_MISMATCH');
  const ledger=close.costs.slice(open.costs.length);let realized='0',commission='0',financing='0',balance=open.account.balance;
  for(const row of ledger){for(const k of ['realizedJpy','commission','financing','balanceAfter'])n(row[k]);realized=add(realized,row.realizedJpy);commission=add(commission,row.commission);financing=add(financing,row.financing);balance=add(add(add(balance,row.realizedJpy),row.commission,true),row.financing,true);check(cmp(balance,row.balanceAfter)===0n,'Per-row financial reconciliation failed','LEDGER_MISMATCH');}
  check(canonical(close.fills.slice(0,open.fills.length))===canonical(open.fills),'Opening fill prefix changed','SOURCE_MISMATCH');
  for(const fill of close.fills.slice(open.fills.length)){const entry=ledger.find(r=>r.type==='fill'&&r.id===fill.id);check(entry&&entry.commission===fill.commission&&entry.realizedJpy===fill.realizedJpy,'Fill costs/PnL do not match monetary ledger','LEDGER_MISMATCH');}
  check(cmp(balance,close.account.balance)===0n,'Closing balance/fees mismatch','LEDGER_MISMATCH');
  let peak=typeof open.account.equity==='string'?open.account.equity:null,dd='0';
  const equity=close.equity.filter(r=>r.time>open.cutoffMs&&r.time<=close.cutoffMs&&r.chapter===close.chapter);
  for(const row of [...equity,{equity:close.account.equity}])if(typeof row.equity==='string'&&peak!==null){if(cmp(row.equity,peak)>0n)peak=row.equity;if(cmp(peak,'0')>0n){const d=ratio(add(peak,row.equity,true),peak);if(cmp(d,dd)>0n)dd=d;}}
  return {openingBalance:open.account.balance,closingBalance:close.account.balance,openingEquity:open.account.equity,closingEquity:close.account.equity,realizedJpy:realized,commissionJpy:commission,financingJpy:financing,totalCostsJpy:add(commission,financing),netBalanceChangeJpy:add(balance,open.account.balance,true),unrealizedJpy:close.account.unrealizedJpy,marginJpy:close.account.margin,freeMarginJpy:close.account.freeMargin,maxObservedDrawdownPct:peak===null?unknown('No opening equity'):dd,drawdownMethod:'UTC committed H1/last consumed marks + opening/closing; not intra-tick maximum',reconciled:true,ledgerRows:ledger.length};
}
async function archive(host,service,job){
  const receipt=await service.archiveFileSafe(`weekly/${job.id}/input.json`,JSON.stringify(job.input));check(receipt,'Weekly archive unavailable; output must not be silently dropped','ARCHIVE_UNAVAILABLE');
  const kind=weeklyProvenanceKind(job.input),references=weeklySourceReferences(job.input),origin={kind,references};
  const sourceBlob=await publicationFile(JSON.stringify(weeklySourceEvidence(job.input)));
  const sourceRef=await publishFiles(host, {operationId:`${job.id}_source`,manifest:{kind:'resource',schemaVersion:'1.0.0',content:{type:'kurumi-frozen-weekly-sources',path:'source.json',provenance:origin},dependencies:references,blobs:[{...sourceBlob,path:'source.json',mediaType:'application/json'}],provenance:origin}});
  const provenance={kind,references:[sourceRef]};
  const rows=[{type:'weekly-input',...job.input}],blob=await publicationFile(JSON.stringify(rows));
  const ref=await publishFiles(host, {operationId:`${job.id}_data`,manifest:{kind:'data',schemaVersion:'1.0.0',content:{format:'json-rows',path:'rows.json',rowCount:rows.length,columns:Object.keys(rows[0]),provenance},dependencies:[sourceRef],blobs:[{...blob,path:'rows.json',mediaType:'application/json'}],provenance}});
  return cas(host,job.id,job.revision,{status:'queued',inputRef:ref,sourceRef,inputArchive:receipt,error:null});
}
async function queuePeriod(host,service,open,close,reason,signal,extra={}){
  signal?.throwIfAborted();const week=weekStartUTC(open.cutoffMs),period={fromMs:open.cutoffMs,toMs:close.cutoffMs,weekStartMs:week,weekEndMs:week+WEEK,utc:true,chapter:open.chapter,initialPartial:open.cutoffMs!==week,finalPartial:close.cutoffMs!==week+WEEK,partial:open.cutoffMs!==week||close.cutoffMs!==week+WEEK,reason,...extra.period};
  check(close.cutoffMs<=week+WEEK,'Missing exact intermediate weekly snapshot; refuse later data','BOUNDARY_SNAPSHOT_REQUIRED');
  if(reason==='utc_week'){for(const field of ['costs','fills','orders','equity'])for(const row of close[field].slice(open[field].length))check(row.time<period.toMs,'UTC week close contains next-week event; capture before Monday consumption','BOUNDARY_SNAPSHOT_REQUIRED');check(close.account.quoteTimeMs===undefined||close.account.quoteTimeMs<period.toMs,'UTC boundary snapshot marked with next-week quote','BOUNDARY_SNAPSHOT_REQUIRED');}
  const input={schemaVersion:'1.0.0',period,opening:copy(open),closing:copy(close),financial:weeklyFinancials(open,close),...extra.input},id=`weekly_${digest([open.runId,open.chapter,period.fromMs,period.toMs]).slice(7)}`;
  let job=create(host,{id,revision:1,inputDigest:digest(input),input,status:'input_frozen',transport:null,taskId:null,output:null,reportRef:null});
  if(job.status==='input_frozen'||job.status==='input_archive_failed'){try{job=await archive(host,service,job);}catch(e){cas(host,id,job.revision,{status:'input_archive_failed',error:{code:e.code??'ARCHIVE_FAILED',message:e.message}});throw e;}}
  return job;
}

/** Called at initial chapter disclosure, EACH H1, chapter settlement and terminal.
 * Pure queue/freeze: never submits a model. Snapshots skipped over a UTC week
 * require context.boundarySnapshots captured BEFORE later ticks were consumed.
 * Archive failures propagate; CORE must block further commits until recovered. */
export async function onWeeklyBoundary(host,service,context,signal){return serial(host,async()=>{
  signal?.throwIfAborted();const frame=freezeWeeklyFrame(host,service,context),id=`cursor_${context.runId}_${frame.chapter}`,cutoff=frame.cutoffMs;
  let cursor=get(host,id),jobs=[];
  if(!cursor){check(context.openingContext||frame.engineVersion===1||context.engine.rules?.experimentProfile?.id!=='informed-replay-50x-v1','Initial exact pre-consumption account/warmup required; do not invent earlier opening','BOUNDARY_SNAPSHOT_REQUIRED');const open=context.openingContext?freezeWeeklyFrame(host,service,context.openingContext):frame;check(open.chapter===frame.chapter&&open.cutoffMs<=cutoff,'Wrong chapter opening');cursor=create(host,{id,revision:1,inputDigest:digest([context.runId,frame.chapter,open.cutoffMs]),opening:open,last:open,lastCutoff:open.cutoffMs,status:'cursor'});}
  check(cutoff>=cursor.lastCutoff,'Weekly clock rewind','VERSION_CONFLICT');
  if(cursor.closed){check(cutoff===cursor.lastCutoff,'Chapter already sealed','VERSION_CONFLICT');return {jobs:[],status:'already_closed'};}
  let opening=cursor.opening;
  for(const snapshot of [...(context.boundarySnapshots??[]).map(c=>freezeWeeklyFrame(host,service,c)),frame].sort((a,b)=>a.cutoffMs-b.cutoffMs)){
    if(snapshot.cutoffMs<=opening.cutoffMs)continue;const boundary=weekStartUTC(opening.cutoffMs)+WEEK;
    check(snapshot.cutoffMs<=boundary,'Exact week-boundary snapshot missing; no post-boundary data may enter old week','BOUNDARY_SNAPSHOT_REQUIRED');
    if(snapshot.cutoffMs===boundary || (snapshot===frame && (context.chapterEnded||context.terminal))){const job=await queuePeriod(host,service,opening,snapshot,snapshot.cutoffMs===boundary?'utc_week':'chapter_or_terminal_partial',signal);jobs.push({id:job.id,status:job.status,inputRef:job.inputRef,period:job.input.period});opening=snapshot;}
  }
  cursor=cas(host,id,cursor.revision,{opening,last:frame,lastCutoff:cutoff,closed:!!(context.chapterEnded||context.terminal)});
  return {status:'frozen',cursorRevision:cursor.revision,jobs,generationSubmitted:false};
});}

export function listWeeklyJobs(host){return records(host).list(COLLECTION).filter(x=>x.id.startsWith('weekly_'));}
const instructions='用中文自由撰写投资周报，可表达观点、情景、解释与反思，不限定段落、图形或长度。只能根据固定截止输入；这是原作久留美与Sesame实际模拟动作的观众对照，不是第二交易角色。报告财务基线及决定/订单/成交证据由固定数据提供。说明市场解读、风险和下周条件计划；未知保持未知，不补造原作总资产或精确成交时间。不得使用当前行情、修改交易或访问下一周输入。同历史知情重放不是样本外；模型预训练历史记忆无法排除。';

/** Explicit future-authorized worker, never invoked by queue hook. Unknown
 * inference submission is NOT retried; full outputs saved before archive/UI.
 * Agents require a public final-artifact collector that attests full output;
 * a task summary alone cannot satisfy the complete-output archive contract. */
export async function drainWeeklyQueue(host,service,options={},signal){
  check(options.authorizeGeneration===true,'Weekly generation requires later acceptance authorization','GENERATION_NOT_AUTHORIZED');
  return serial(host,async()=>{const results=[];
    for(let job of listWeeklyJobs(host)){
      signal?.throwIfAborted();
      if(job.status==='interrupted'&&job.transport==='agents'&&job.taskId){
        const existing=roleTask(host,job.taskId);
        if(['queued','running','completed'].includes(existing.status))job=cas(host,job.id,job.revision,{status:'submitted',taskReceipt:copy(existing),error:null});
      }
      if(['sealed','failed','unknown','cancelled','interrupted'].includes(job.status)){results.push({id:job.id,status:job.status});continue;}
      if(['input_frozen','input_archive_failed'].includes(job.status))job=await archive(host,service,job);
      if(job.status==='submitting'){job=cas(host,job.id,job.revision,{status:'unknown',error:{code:'SUBMISSION_UNKNOWN',message:'Restart/lost reply; reconcile existing request; never auto-resubmit inference'}});results.push({id:job.id,status:job.status});continue;}
      if(job.status==='queued'){
        weeklyProvenanceKind(job.input); // Missing legacy provenance needs explicit evidence repair before any generation.
        const model=options.model,configured=host.context.models;check(configured.some(m=>canonical(m)===canonical(model)),'Exact configured model descriptor required','MODEL_UNAVAILABLE');
        const transport=options.transport??'inference';check(['inference','agents'].includes(transport),'Unsupported transport');
        if(transport==='agents')check(typeof options.collectFullAgentOutput==='function','Public complete final-output collector required','FULL_AGENT_OUTPUT_REQUIRED');
        const requestId=job.id+'_generation',request=transport==='inference'?{requestId,model,systemPrompt:instructions,input:weeklyGenerationInput(job),maxTokens:options.maxTokens??32768,timeoutMs:options.timeoutMs??900000}:{requestId,model,title:'模拟UTC投资周报',kind:'research',instructions,input:weeklyGenerationInput(job),tools:[],lane:`weekly:${job.input.opening.runId}`,queue:'fifo'};
        check(Buffer.byteLength(JSON.stringify(request)) <= (transport==='agents'?40000:1024*1024), 'Complete fixed input exceeds model transport budget; partition explicitly before generation', 'RESOURCE_EXHAUSTED');
        job=cas(host,job.id,job.revision,{status:'request_archive_pending',transport,request,requestId,generationTrigger:options.generationTrigger??{kind:'explicit_worker',automatic:false}});
      }
      if(job.status==='request_archive_pending'){
        const {request,requestId,transport}=job,model=request.model;
        check(canonical(options.model)===canonical(model),'Retry must retain the frozen request model','MODEL_UNAVAILABLE');
        if(options.transport!==undefined)check(options.transport===transport,'Retry must retain the frozen request transport','INVALID_ARGUMENT');
        if(transport==='agents')check(typeof options.collectFullAgentOutput==='function','Public complete final-output collector required','FULL_AGENT_OUTPUT_REQUIRED');
        let inputReceipt;
        try{
          inputReceipt=await service.archiveFileSafe(`weekly/${job.id}/request.json`,JSON.stringify(request));check(inputReceipt,'Generation request archive unavailable','ARCHIVE_UNAVAILABLE');signal?.throwIfAborted();
        }catch(e){
          // No model call has been attempted. Keep the exact persisted request
          // retryable, including across process restart or pre-submit abort.
          job=cas(host,job.id,job.revision,{status:'request_archive_pending',error:{code:e.code??'ARCHIVE_FAILED',message:e.message}});
          results.push({id:job.id,status:job.status});continue;
        }
        job=cas(host,job.id,job.revision,{status:'submitting',requestArchive:inputReceipt,error:null});
        try{
          if(transport==='inference'){
            const {requestId:_id,...modelInput}=request;const output=await invokeValue(host,'host.model.complete',modelInput,{operationId:requestId,signal});check(typeof output.text==='string','Unknown/incomplete inference output','MODEL_OUTPUT_UNKNOWN');
            job=cas(host,job.id,job.revision,{status:'output_saved',output:copy(output),model:copy(model)});
          }else{const task=await submitRole(host,request,signal);check(task?.id,'Unknown Agent submit receipt','MODEL_OUTPUT_UNKNOWN');job=cas(host,job.id,job.revision,{status:'submitted',taskId:task.id,taskReceipt:copy(task),model:copy(model)});}
        }catch(e){const status=signal?.aborted?'cancelled':e.code==='MODEL_REJECTED'?'failed':'unknown';job=cas(host,job.id,job.revision,{status,error:{code:e.code??'SUBMISSION_UNKNOWN',message:e.message}});results.push({id:job.id,status});continue;}
      }
      if(job.status==='submitted'){
        try{const inspected=roleTask(host,job.taskId);if(['interrupted','cancelled'].includes(inspected.status)){job=cas(host,job.id,job.revision,{status:inspected.status,taskReceipt:copy(inspected),error:copy(inspected.error??null)});results.push({id:job.id,status:job.status});continue;}
          const result=await waitRole(host,job.taskId,signal),full=await options.collectFullAgentOutput(job.taskId,result,signal);
          check(full?.complete===true&&full.output!==undefined&&Array.isArray(full.artifactRefs),'Task summary is not full Agent output','FULL_AGENT_OUTPUT_REQUIRED');job=cas(host,job.id,job.revision,{status:'output_saved',output:copy(full),taskReceipt:copy(result)});
        }catch(e){
          const interrupted=[e.code,signal?.reason?.code].includes('RUN_INTERRUPTED');
          if(interrupted)job=cas(host,job.id,job.revision,{status:'interrupted',error:{code:e.code??'RUN_INTERRUPTED',message:e.message,...(e.details?{details:copy(e.details)}:{})}});
          else if(signal?.aborted){if(!['completed','cancelled'].includes(roleTask(host,job.taskId).status))await host.runs.cancel({id:job.taskId},{reason:'Weekly worker cancelled'});job=cas(host,job.id,job.revision,{status:'cancelled',error:{message:e.message}});}
          else job=cas(host,job.id,job.revision,{status:'unknown',error:{code:e.code??'WAIT_UNKNOWN',message:e.message}});
          results.push({id:job.id,status:job.status});continue;
        }
      }
      if(['output_saved','output_archive_failed','publishing','publish_failed'].includes(job.status)){
        try{signal?.throwIfAborted();const outputArchive=await service.archiveFileSafe(`weekly/${job.id}/full-output.json`,JSON.stringify(job.output));check(outputArchive,'Full output archive unavailable','ARCHIVE_UNAVAILABLE');
          if(!job.authoredPresentation && options.renderWeeklyHTML){
            const authored=await options.renderWeeklyHTML(copy(job.input),copy(job.output),signal);
            check(authored&&typeof authored.html==='string'&&Array.isArray(authored.assets??[]),'Authored HTML/assets required','SOURCE_DATA_INVALID');
            job=cas(host,job.id,job.revision,{authoredPresentation:copy(authored)});
          }
          job=cas(host,job.id,job.revision,{status:'publishing',outputArchive});
          let publication=job.publication;
          if(!publication){publication=await publishWeeklyReport(host,service,job,signal);check(publication?.ref,'Missing report publication','PUBLICATION_UNKNOWN');job=cas(host,job.id,job.revision,{publication:copy(publication)});}
          const final=await service.archiveFileSafe(`weekly/${job.id}/publication.json`,JSON.stringify(publication));check(final,'Publication archive unavailable','ARCHIVE_UNAVAILABLE');
          job=cas(host,job.id,job.revision,{status:'sealed',reportRef:publication.ref,outputRef:publication.outputRef,receipt:publication.receipt,publicationArchive:final});
        }catch(e){job=cas(host,job.id,job.revision,{status:job.status==='publishing'?'publish_failed':'output_archive_failed',error:{code:e.code??'ARCHIVE_FAILED',message:e.message}});throw e;}
      }
      results.push({id:job.id,status:job.status,reportRef:job.reportRef,receipt:job.receipt});
    }return {results};
  });
}
/** Unknown state resolution is explicit evidence, never new model/trade calls. */
export function reconcileWeeklyOutput(host,id,expectedRevision,{requestId,output,evidence}){const job=get(host,id);check(job?.status==='unknown'&&job.requestId===requestId&&evidence&&output!==undefined,'Existing-request evidence required','RECONCILIATION_REQUIRED');return cas(host,id,expectedRevision,{status:'output_saved',output:copy(output),reconciliationEvidence:copy(evidence)});}

/** Public native confirmation receiver. There is NO report open tool in 0.2.2.
 * A normal player card/page click is valid. Read exact artifacts.receipts(ref),
 * not inspector and not a guessed opener operation. Ref/input/period binding
 * is explicitly derived from the immutable job, never inserted into rawreceipt.
 * Actual pixels remain a separate main acceptance check. No models/layout writes.
 */
function weeklyReceiptExpected(job){
 check(job?.status==='sealed'&&job.reportRef?.kind==='report'&&job.inputRef?.kind==='data'&&job.outputRef&&job.inputDigest===digest(job.input),'Sealed frozen job/ref/input digest required','SOURCE_MISMATCH');
 check(!job.publication?.ref||canonical(job.publication.ref)===canonical(job.reportRef),'Publication/job ref mismatch','SOURCE_MISMATCH');
 return {jobId:job.id,ref:copy(job.reportRef),inputRef:copy(job.inputRef),outputRef:copy(job.outputRef),period:copy(job.input.period),inputDigest:job.inputDigest,bindingKind:'derived_from_frozen_job_not_rawreceipt'};
}
async function saveNativeWeeklyReceipt(host,service,job,proof){
 const path=`weekly/${job.id}/native-receipts-${digest(proof.raw).slice(7)}.json`;
 const rawArchive=await service.archiveFileSafe(path,JSON.stringify(proof.raw));check(rawArchive,'Raw native receipt archive unavailable; confirmation not committed','ARCHIVE_UNAVAILABLE');
 const bindingArchive=await service.archiveFileSafe(`weekly/${job.id}/native-receipt-binding-${digest(proof.derivedBinding).slice(7)}.json`,JSON.stringify(proof.derivedBinding));check(bindingArchive,'Frozen-job receipt binding archive unavailable','ARCHIVE_UNAVAILABLE');
 return cas(host,job.id,job.revision,{nativeUiStatus:'opened',nativeUiReceipt:copy(proof),nativeUiRawArchive:rawArchive,nativeUiBindingArchive:bindingArchive,nativeUiError:null});
}
export async function consumeNativeWeeklyReports(host,service,options={},signal){
 check(host.context?.kind==='main','Native report confirmation is main-only','SCOPE_DENIED');const engine=service.getSpectatorState?.()??service.getState(),view=readConsumedView(host,engine.id),items=[];
 for(let job of listWeeklyJobs(host).filter(j=>j.status==='sealed'&&j.input.opening.runId===engine.id)){
  signal?.throwIfAborted();const expected=weeklyReceiptExpected(job),synchronized=view?.cutoffMs===job.input.period.toMs;
  // Re-read the public receipts even for a formerly unknown/opening job: this is
  // a safe read, never a repeat open/model and never edits the frozen financials.
  if(job.nativeUiStatus==='opened'&&job.nativeUiRawArchive&&job.nativeUiReceipt?.availableLevel==='native_page_rendered_pixel_unverified') {items.push({id:job.id,status:'opened',ref:job.reportRef,receipt:copy(job.nativeUiReceipt),synchronized});continue;}
  const raw=await host.resources.read(job.reportRef,{part:'receipts'}),proof=nativeReportReceipt(raw,expected);
  if(proof.status!=='opened'){
   const archived=await service.archiveFileSafe(`weekly/${job.id}/native-receipts-${digest(raw).slice(7)}.json`,JSON.stringify(raw));check(archived,'Pending raw receipt archive unavailable','ARCHIVE_UNAVAILABLE');
   items.push({id:job.id,status:'pending',ref:job.reportRef,diagnostic:proof.reason,expected,raw:copy(raw),synchronized,next:'Open the normal native report card/page, then pump the read-only receiver'});continue;
  }
  job=await saveNativeWeeklyReceipt(host,service,job,proof);items.push({id:job.id,status:'opened',ref:job.reportRef,receipt:copy(job.nativeUiReceipt),synchronized});
 }return {items,automaticOpenRequested:false,modelRequested:false};
}

/** Evidence-only reconcile; ignores obsolete operationId/asOf/evidence selectors.
 * Caller may pass raw actual receipts; no opener retry and no new inference. */
export async function reconcileNativeWeeklyUI(host,id,revision,raw,verify,signal){
 signal?.throwIfAborted();check(host.context?.kind==='main','Main-only native report reconciliation','SCOPE_DENIED');const j=get(host,id);check(j?.status==='sealed'&&j.revision===revision,'Current sealed job required','RECONCILIATION_REQUIRED');
 const proof=nativeReportReceipt(raw,weeklyReceiptExpected(j));check(proof.status==='opened','Actual exact native sesame-report rendered receipt required','RECONCILIATION_REQUIRED');
 return cas(host,id,revision,{nativeUiStatus:'receipt_observed_archive_pending',nativeUiReceipt:copy(proof),nativeUiRawArchive:null,diagnostic:'Evidence stored in own job; consumer archives full original rawreceipt before runtime release'});
}

/** Bounded stop is an explicitly labelled FINAL SEGMENT of a UTC simulation
 * week, not a fabricated seven-day result and not a chapter completion. */
export function onExperiencePartialBoundary(host,service,context,signal){return serial(host,async()=>{
 signal?.throwIfAborted();check(context.experiencePartial===true,'Only real bounded-stop context creates a final partial report','SOURCE_MISMATCH');
 const close=freezeWeeklyFrame(host,service,context),id=`cursor_${context.runId}_${close.chapter}`,cursor=get(host,id);
 check(cursor,'UTC opening clock must exist before bounded partial report','BOUNDARY_SNAPSHOT_REQUIRED');check(close.cutoffMs===cursor.lastCutoff,'Freeze committed H1 before partial report','BOUNDARY_SNAPSHOT_REQUIRED');
 if(close.cutoffMs===cursor.opening.cutoffMs)return {status:'empty_or_already_queued',jobs:[]};
 const job=await queuePeriod(host,service,cursor.opening,close,'bounded_experience_final_partial',signal,{period:{kind:'bounded_partial',finalPartial:true,scope:'bounded final segment, not a completed chapter/7d return'},input:{experience:{partial:true,reason:'bounded committed-decision stop',chapterComplete:false}}});
 cas(host,id,cursor.revision,{opening:close,lastPartialTo:close.cutoffMs});return {status:'partial_queued',jobs:[{id:job.id,status:job.status,inputRef:job.inputRef,period:job.input.period}]};
});}

/** Full evidence is archived separately. A 40KB Agent request never embeds
 * the whole engine/role archives/native journals. All synopsis facts are exact
 * projections of that frozen evidence; bounded excerpts disclose omission. */
export function weeklyGenerationInput(job){
 check(job.inputRef?.id&&typeof job.inputRef.revision==='string'&&job.inputRef.digest,'Full frozen evidence must already exist','FULL_INPUT_REQUIRED');
 const x=job.input,open=x.opening,close=x.closing,delta=(field)=>close[field].slice(open[field].length),take=(rows,n)=>({total:rows.length,shown:Math.min(rows.length,n),omitted:Math.max(0,rows.length-n),rows:rows.slice(-n)});
 const select=(r,keys)=>Object.fromEntries(keys.filter(k=>r[k]!==undefined).map(k=>[k,copy(r[k])]));
 const fill=delta('fills').map(r=>select(r,['id','orderId','nativeClientOrderId','nativeTradeId','chapter','time','instrument','signedQuantity','price','reason','realizedJpy','commission','openedQuantity','closedQuantity']));
 const decisions=delta('decisions').map(r=>({executionTime:r.executionTime,id:r.decision?.id,target:r.decision?.target,stop:r.decision?.stop,reason:String(r.decision?.reason??'').slice(0,240),continuationOf:r.decision?.continuationOf??null}));
 const bars=(close.market.bars??[]).filter(r=>r.asOf<=x.period.toMs).map(r=>select(r,['id','key','symbol',`from`,'toExclusive','asOf','lastTickMs','consumedCount','isClosed','bid','ask','sourceDigest','sourceRefs','sourceKind','sourceResolution','h1Limitation','lastTickTimeStatus','tickCountStatus']));
 let out={schemaVersion:'1.0.0',evidenceMode:'bounded synopsis + complete immutable evidence, not complete engine inline',fullEvidenceRef:copy(job.inputRef),inputDigest:job.inputDigest,runId:open.runId,chapter:open.chapter,asOfMs:x.period.toMs,period:copy(x.period),opening:{account:copy(open.account),positions:copy(open.positions),engineVersion:open.engineVersion},closing:{account:copy(close.account),positions:copy(close.positions),engineVersion:close.engineVersion},financial:copy(x.financial),riskRules:{leverage:close.account.leverage??{status:'unknown'},stopout:close.account.stopout??{status:'unknown'},profileIdentity:copy(close.profile?.experimentProfile??null)},scope:{sourceId:'kurumi:'+open.runId,priceBases:['bid','ask'],timeframe:'1h',timeBasis:'utc',volume:'unknown/none, not synthesized'},sourceRefs:take(close.market.sources??[],8),fills:take(fill,12),decisions:take(decisions,8),market:take(bars,20),methods:take(close.methods.map(r=>select(r,['pluginId','version','method','status','inputRefs','outputRef'])),7),originalComparison:take(close.originalComparison,4),sourceDigests:copy(close.sourceDigests),sourceCoverage:copy(close.sourceCoverage),restrictions:copy(close.restrictions)};
 // Iteratively reduce only explicitly sampled detail, never financial accounts
 // or full evidence refs. Oversized mandatory metadata fails before any model.
 for(const n of [8,4,1,0]){if(Buffer.byteLength(JSON.stringify(out))<=28000)break;for(const k of ['fills','decisions','market','methods','originalComparison','sourceRefs']){const q=out[k];q.rows=q.rows.slice(-n);if(n===0)q.rows=[];q.shown=q.rows.length;q.omitted=q.total-q.shown;}}
 check(Buffer.byteLength(JSON.stringify(out))<=28000,'Fixed mandatory synopsis too large; partition metadata before model','RESOURCE_EXHAUSTED');return out;
}
export function weeklyNativeAcceptance(job){const automatic=job.generationTrigger?.kind==='automatic_committed_utc_week'&&job.generationTrigger.automatic===true;return {status:job.status==='sealed'&&job.input.period.reason==='utc_week'&&automatic&&job.nativeUiStatus==='opened'?'evidence_ready_for_main_review':'pending',automaticUtcWeek:automatic&&job.input.period.reason==='utc_week',finalPartialIsNotReplacement:job.input.period.reason!=='utc_week',inputRef:job.inputRef??null,outputRef:job.outputRef??null,reportRef:job.reportRef??null,receipt:job.nativeUiReceipt??null,nativePixelAcceptance:'pending-independent-native-check',diagnostic:'Sealed automatic UTC job plus native-page receipt is review evidence, not SDK/pixel certification; fixtures never certify acceptance'};}
