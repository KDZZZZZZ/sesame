import { createHash } from 'node:crypto';
import { chartRuntimeReceipt } from './presentation-receipts.js';
import { buildMarkerSnapshot, createMarkerIndicator, compute } from './markers.js';

// Public plugin-owned presentation state only. No engine/control imports,
// timers, paid tasks, UI private code, native caches or broker operations.
export const HOUR = 3600000;
export const canonical = x => x === undefined ? 'null' : x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
export const digest = x => 'sha256:' + createHash('sha256').update(canonical(x)).digest('hex');
export const check = (ok, message, code = 'INVALID_ARGUMENT') => { if (!ok) throw Object.assign(new Error(message), { code }); };
const copy = x => structuredClone(x);
const utc = unixMs => { check(Number.isSafeInteger(unixMs)&&Number.isFinite(new Date(unixMs).getTime()),'Source UTC milliseconds required, never UTC(null)','SOURCE_DATA_INVALID');return { basis: 'utc', unixMs }; };
const decimal = x => { check(typeof x === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(x) && /[1-9]/.test(x), 'Quote requires positive exact Decimal', 'SOURCE_DATA_INVALID'); return x; };
const cmp = (a,b) => { const [aw,af='']=a.split('.'),[bw,bf='']=b.split('.'),n=Math.max(af.length,bf.length); const x=BigInt(aw+af.padEnd(n,'0')),y=BigInt(bw+bf.padEnd(n,'0')); return x<y?-1:x>y?1:0; };
const COLLECTION = 'round2-presentation';
const serial = new WeakMap();
function queued(host,key,fn) { let map=serial.get(host.storage); if(!map)serial.set(host.storage,map=new Map()); const work=(map.get(key)??Promise.resolve()).catch(()=>{}).then(fn);map.set(key,work);return work.finally(()=>{if(map.get(key)===work)map.delete(key);}); }
export function readSpectatorCheckpoint(host,runId){return host?.storage?.get('round2-spectator-checkpoint',runId,true)??null;}
export const ticksPrefixDigest=(rows,previous=digest([]))=>rows.reduce((h,row)=>digest([h,row]),previous);
export function readConsumedView(host,runId) { return host?.storage?.get(COLLECTION,runId,true) ?? null; }

/** CORE supplies bytes ONLY after verifying the owned steps path/no symlink.
 * Digest/count check is additional, not path permission. This function never
 * reads files. A committed nativeJournal suffix, not an input slice, is required. */
export function batchFromCommittedJournal(engine,previousEngine,step,bytes,options={}) {
  check(engine.id===previousEngine.id && engine.version===previousEngine.version+1, 'Not one committed H1', 'VERSION_CONFLICT');
  check(engine.nativeJournal?.length===previousEngine.nativeJournal?.length+1 && canonical(engine.nativeJournal.at(-1))===canonical(step), 'Not the committed journal suffix', 'SOURCE_MISMATCH');
  let rows=step.ticks;
  if(step.ticksRef) { check(bytes!==undefined,'CORE must resolve immutable consumed ticksRef','CONSUMED_TICKS_REQUIRED'); const raw=Buffer.from(bytes);check(raw.length<=128*1024*1024 && raw.length===step.ticksRef.bytes && 'sha256:'+createHash('sha256').update(raw).digest('hex')===step.ticksRef.digest,'Consumed ref digest/bytes mismatch','HASH_MISMATCH'); rows=JSON.parse(raw.toString('utf8'));check(rows.length===step.ticksRef.rowCount,'Consumed ref count mismatch','HASH_MISMATCH'); }
  check(Array.isArray(rows)&&rows.length,'Consumed ticks unavailable; lastQuote cannot reconstruct OHLC','CONSUMED_TICKS_REQUIRED');
  const chapter=previousEngine.chapter, symbol=previousEngine.chapters[chapter].symbol;
  const complete=!engine.bankrupt, cutoff=complete?step.to:rows.at(-1).time;
  return {batchId:`${engine.id}_${engine.version}_${chapter}_${step.from}`,runId:engine.id,commitVersion:engine.version,chapter,symbol,from:step.from,toExclusive:step.to,cutoffMs:cutoff,sequenceStart:0,intervalComplete:complete,rows:copy(rows),sourceRefs:copy(step.coverage?.sources??[]),sourceDigest:step.ticksRef?.digest??digest(rows),classification:options.classification??'native-consumed-journal'};
}

/** Actual consumed rows only, chronological delta batches with stable IDs.
 * A one-row lastQuote batch may be displayed only as incomplete/sparse, never
 * a complete H1. A finalized H1 cannot subsequently be rewritten. */
export function reduceConsumedTicks(previous,batch) {
  check(batch && typeof batch.runId==='string' && batch.runId && typeof batch.batchId==='string' && batch.batchId, 'Batch run/id missing');
  for(const field of ['commitVersion','chapter',`from`,'toExclusive','cutoffMs','sequenceStart'])check(Number.isSafeInteger(batch[field]),`Invalid ${field}`);
  check(batch.from%HOUR===0 && batch.toExclusive===batch.from+HOUR && batch.cutoffMs>=batch.from && batch.cutoffMs<=batch.toExclusive && batch.sequenceStart>=0,'Invalid consumption bounds');
  check(typeof batch.intervalComplete==='boolean' && (!batch.intervalComplete || batch.cutoffMs===batch.toExclusive),'Complete interval requires exact closed boundary');
  check(/^[A-Z]{6}$/.test(batch.symbol) && /^sha256:[a-f0-9]{64}$/.test(batch.sourceDigest??'') && Array.isArray(batch.sourceRefs),'Source identity/evidence missing','SOURCE_MISMATCH');
  check(Array.isArray(batch.rows)&&batch.rows.length>0&&batch.rows.length<=500000,'Consumed row budget/empty data','RESOURCE_EXHAUSTED');
  const fingerprint=digest(batch), old=previous??{id:batch.runId,revision:0,runId:batch.runId,cutoffMs:batch.from,commitVersion:batch.commitVersion,bars:[],batches:{},sources:[]};
  check(old.runId===batch.runId,'Cannot carry old run supplement/view into new run','SOURCE_MISMATCH');
  if(old.batches[batch.batchId]) {check(old.batches[batch.batchId]===fingerprint,'Same batch id with different input','IDEMPOTENCY_CONFLICT');return copy(old);}
  check(batch.cutoffMs>=old.cutoffMs && batch.commitVersion>=old.commitVersion,'Consumption rewind/version conflict','VERSION_CONFLICT');
  const next=copy(old),key=`${batch.chapter}:${batch.symbol}:${batch.from}`, prior=next.bars.find(b=>b.key===key);
  check(!prior?.isClosed,'Closed consumed bar is immutable','VERSION_CONFLICT');
  check(batch.sequenceStart===(prior?.consumedCount??0),'Tick gap or duplicate delta: rehydrate committed prefix','SNAPSHOT_REQUIRED');
  let last=prior?.lastTickMs??batch.from, bid=prior?.bid,ask=prior?.ask;
  const aggregate=(ohlc,v)=>!ohlc?{open:v,high:v,low:v,close:v}:{...ohlc,high:cmp(v,ohlc.high)>0?v:ohlc.high,low:cmp(v,ohlc.low)<0?v:ohlc.low,close:v};
  for(const row of batch.rows){check(Number.isSafeInteger(row.time)&&row.time>=last&&row.time>=batch.from&&row.time<batch.toExclusive&&row.time<=batch.cutoffMs,'Tick later than consumed cutoff or out of order','FUTURE_DATA_FORBIDDEN');const b=decimal(row.bid),a=decimal(row.ask);check(cmp(b,a)<=0,'Crossed quote','SOURCE_DATA_INVALID');bid=aggregate(bid,b);ask=aggregate(ask,a);last=row.time;}
  const bar={key,chapter:batch.chapter,symbol:batch.symbol,from:batch.from,toExclusive:batch.toExclusive,asOf:batch.cutoffMs,lastTickMs:last,consumedCount:(prior?.consumedCount??0)+batch.rows.length,bid,ask,isClosed:batch.intervalComplete,sourceDigest:batch.sourceDigest,sourceRefs:copy(batch.sourceRefs),prefixDigest:ticksPrefixDigest(batch.rows,prior?.prefixDigest)};
  if(prior)next.bars[next.bars.indexOf(prior)]=bar;else next.bars.push(bar);
  next.bars.sort((a,b)=>a.from-b.from);next.batches[batch.batchId]=fingerprint;next.sources.push({batchId:batch.batchId,sourceDigest:batch.sourceDigest,sourceRefs:copy(batch.sourceRefs)});next.cutoffMs=batch.cutoffMs;next.commitVersion=batch.commitVersion;next.revision++;next.lastBatch=copy(batch);
  check(Buffer.byteLength(JSON.stringify(next))<=16*1024*1024,'Presentation budget exceeded; pause/archive explicitly, do not truncate','RESOURCE_EXHAUSTED');return next;
}
/** Metadata-only enrichment from immutable prepared history. No price lookup,
 * no account/current-state reconstruction. Only already disclosed closed H1. */
export function observedH1Limitations(view,data){
 if(!view?.bars?.some(b=>b.sourceKind==='observed_native_h1_preheat_not_execution_ticks'&&!b.h1Limitation))return copy(view);
 const next=copy(view);for(const b of next.bars){
  if(b.sourceKind!=='observed_native_h1_preheat_not_execution_ticks'||b.h1Limitation)continue;
  check(b.isClosed&&b.toExclusive<=view.cutoffMs,'Metadata enrichment requires a disclosed closed H1','FUTURE_DATA_FORBIDDEN');
  const ci=data?.chapters?.findIndex(c=>c.symbol===b.symbol),rows=Array.isArray(data?.frames)?data.frames[ci]:data?.frames?.[b.symbol]??data?.frames?.[data?.chapters?.[ci]?.id];
  const source=rows?.find(f=>f.time===b.from&&f.time+HOUR<=view.cutoffMs);
  if(source?.h1Limitation)b.h1Limitation=copy(source.h1Limitation);
 }return next;
}
export function consumedBars(view,symbol,basis,seriesId,includeForming=true) {
  check(['bid','ask'].includes(basis),'Unsupported price basis');
  check(Number.isSafeInteger(view?.revision)&&view.revision>=0,'Actual nonnegative safe integer presentation revision required','SOURCE_REVISION_REQUIRED');
  return (view?.bars??[]).filter(b=>b.symbol===symbol&&(b.isClosed||includeForming)).map(b=>{
    const h1=b.sourceKind==='observed_native_h1_preheat_not_execution_ticks';
    check(Number.isSafeInteger(b.from)&&Number.isSafeInteger(b.toExclusive)&&Number.isSafeInteger(b.asOf)&&b.asOf<=(view?.cutoffMs??b.asOf),'Invalid/future bar clock','FUTURE_DATA_FORBIDDEN');
    check(!h1||b.isClosed===true&&b.toExclusive===b.from+HOUR&&b.asOf===b.toExclusive&&b.lastTickMs==null&&b.consumedCount==null,'Observed H1 preheat must stay closed with unknown execution tick metadata','SOURCE_DATA_INVALID');
    check(b.lastTickMs==null||Number.isSafeInteger(b.lastTickMs)&&b.lastTickMs<=b.asOf,'Invalid/future consumed tick clock','FUTURE_DATA_FORBIDDEN');
    check(b.consumedCount==null||Number.isSafeInteger(b.consumedCount)&&b.consumedCount>=0,'Invalid consumed count','SOURCE_DATA_INVALID');
    const native={revealedThrough:utc(b.asOf),lastConsumedTick:b.lastTickMs==null?null:utc(b.lastTickMs),consumedCount:b.consumedCount??null,sourceDigest:b.sourceDigest,sourceRefs:copy(b.sourceRefs??[]),sourceKind:b.sourceKind??'native_consumed_execution_ticks',sourceResolution:b.sourceResolution??'quote_ticks',
      ...(b.lastTickMs==null?{lastTickTimeStatus:copy(b.lastTickTimeStatus??{status:'unknown',reason:'Source supplies no last consumed tick timestamp'})}:{}),
      ...(b.consumedCount==null?{tickCountStatus:copy(b.tickCountStatus??{status:'unknown',reason:'Source supplies no consumed execution tick count'})}:{}),
      ...(h1||b.h1Limitation?{h1Limitation:copy(b.h1Limitation??'Observed closed native H1 preheat, not execution ticks/path/liquidity; no inferred tick timestamp/count or volume')}: {})};
    const body={id:`${seriesId}:${b.from}`,openTime:utc(b.from),endTime:utc(b.toExclusive),...b[basis],isClosed:b.isClosed,closure:b.isClosed?'source':'unknown',volume:{default:'none',real:{status:'unknown',reason:'No declared traded volume'},tick:{status:'unknown',reason:'No declared volume unit'}},turnover:{status:'unknown',reason:'No turnover'},native};return {...body,revision:String(view.revision)};
  });
}

/** Actual public 0.2.2 inspect rendering[] is chart-level runtime evidence.
 * script(read) is only the descriptor/source. Keep both original responses.
 * Missing receipt instance/generation/visible-key fields do not invent a gate.
 * Optional CORE verifier receives {inspect,script}; extension cannot turn source
 * keys into pixel visibility nor override the verified built-in contract. */
export async function presentationGate(host,chartId,instanceId,artifact,signal,verifyClientReceipt,comparisonKeys) {
  signal?.throwIfAborted();const before=await host.layout.inspect(),chart=before.charts?.find(c=>c.id===chartId),instance=before.scripts?.find(s=>s.id===instanceId);
  if(!chart?.script_ids?.includes(instanceId)||!instance||canonical(instance.artifact)!==canonical(artifact))return {status:'pending',reason:'Current exact instance/artifact not mounted',layoutVersion:before.version};
  const descriptor=await host.layout.script({action:'read',chart_id:chartId,script_id:instanceId});
  const scene=await host.layout.inspect();
  const expected={chartId,instanceId,artifact,binding:copy(chart.binding),...(instance.generation===undefined?{}:{generation:copy(instance.generation)}),layoutVersion:before.version,...(comparisonKeys?{comparisonKeys:copy(comparisonKeys)}:{})};
  const raw={inspect:scene,script:descriptor},result=chartRuntimeReceipt(raw,expected);
  if(verifyClientReceipt){const extension=await verifyClientReceipt(copy(raw),copy(expected),signal);check(['rendered','pending','failed'].includes(extension?.status),'Invalid client verifier result','SOURCE_DATA_INVALID');check(extension.status!=='rendered'||extension.evidence,'Rendered extension requires actual receipt evidence','SOURCE_DATA_INVALID');result.contractExtension=copy(extension);}
  return result;
}
async function refreshChart(host,service,context,signal) {
  if(!context.chartId)return {status:'pending',reason:'Audience chart not opted in'};
  if(host.scope?.kind!=='main')return {status:'pending',reason:'Service scope cannot mutate session layout; enqueue main refresh'};
  let scene=await host.layout.inspect(),chart=scene.charts?.find(c=>c.id===context.chartId);
  if(!chart)return {status:'pending',reason:'Chart deleted; explicit main display/reconnect needed'};
  if(chart.locked)return {status:'pending',reason:'User chart lock retained'};
  const symbol=chart.binding?.instrument?.instrumentId;
  if(chart.binding?.instrument?.sourceId!==`kurumi:${context.runId}`)return {status:'pending',reason:'Binding changed; no overwrite'};
  const projection={...service,getState:()=>copy(context.engine),getData:()=>service.getData(),getReplayPresentation:()=>readConsumedView(host,context.runId)};
  const markerOptions={instrument:symbol,to:context.replayCutoffMs,eventEvidence:context.eventEvidence,includeEvents:true,includeAudienceContext:true,chapterEnded:context.chapterEnded,from:context.markerFromMs};
  const snapshot=buildMarkerSnapshot(projection,markerOptions);
  const snapshotDigest=digest(snapshot);
  const sourceComparison={originalKeys:snapshot.rows.filter(r=>r.kind==='original-interval').map(r=>r.key),actualKeys:snapshot.rows.filter(r=>r.kind==='actual').map(r=>r.key),riskKeys:snapshot.rows.filter(r=>r.eventType==='risk-exit').map(r=>r.key)};
  const computed=compute({presentationAnalysis:true,inputs:{price:{rows:consumedBars(readConsumedView(host,context.runId),symbol,chart.binding?.spec?.priceBasis??'bid','comparison-local',true)},overlay:{rows:snapshot.rows}}});
  const calculatedKeys=computed.series.flatMap(s=>(s.markers??[]).map(m=>m.key));
  const calculated=keys=>keys.some(k=>calculatedKeys.some(p=>p===k||p.startsWith(k+':')));
  const visibility={status:'pending',sourceReady:sourceComparison.originalKeys.length>0&&sourceComparison.actualKeys.length>0,calculationReady:calculated(sourceComparison.originalKeys)&&calculated(sourceComparison.actualKeys),requiredKeys:sourceComparison,calculatedKeys,calculationLevel:'local_pure_indicator_not_frontend',nativeVisibility:{status:'pending',level:'pixel'},reason:'Local source/calculation and current chart runtime are program evidence only; native pixel comparison is independent'};
  check(Buffer.byteLength(JSON.stringify(snapshot.rows))<=16*1024*1024,'Marker data budget exceeded; request explicit bounded range','RESOURCE_EXHAUSTED');
  const overlayBlob=await host.artifacts.blob(JSON.stringify(snapshot.rows));
  const overlayRef=await host.artifacts.publish({operationId:`round2_marker_data_${snapshotDigest.slice(7)}`,manifest:{kind:'data',schemaVersion:'1.0.0',content:{format:'json-rows',path:'markers.json',rowCount:snapshot.rows.length,columns:[...new Set(snapshot.rows.flatMap(r=>Object.keys(r)))],provenance:{kind:'demo',references:[]}},dependencies:[],blobs:[{...overlayBlob,path:'markers.json',mediaType:'application/json'}],provenance:{kind:'demo',references:[]}}});
  const bundle=createMarkerIndicator(projection,{...markerOptions,overlayRef});
  // Frozen annotations have no forming bars. Publication identity pins the exact code/definition.
  const bundleDigest=digest({definition:bundle.definition,files:bundle.files});
  const id=`chart_${context.runId}_${context.chartId}`,memo=host.storage.get(COLLECTION,id,true);
  const current=(scene.scripts??[]).filter(s=>chart.script_ids?.includes(s.id));
  const owned=current.find(s=>s.id===memo?.instanceId && canonical(s.artifact)===canonical(memo.artifact));
  if(owned && memo.snapshotDigest===bundle.snapshotDigest&&memo.bundleDigest===bundleDigest)return {comparison:copy(visibility),status:'unchanged',instanceId:owned.id,gate:await presentationGate(host,chart.id,owned.id,memo.artifact,signal,context.verifyClientReceipt,sourceComparison)};
  // Reconnection after a lost response: recover only exact published artifact.
  const matching=current.filter(s=>memo?.artifact&&canonical(s.artifact)===canonical(memo.artifact));check(matching.length<=1,'Multiple owned artifacts require explicit reconciliation','INSTANCE_AMBIGUOUS');
  if(matching[0] && memo.snapshotDigest===bundle.snapshotDigest&&memo.bundleDigest===bundleDigest){host.storage.transaction(()=>host.storage.put(COLLECTION,{...memo,instanceId:matching[0].id,mountPending:false}));return {comparison:copy(visibility),status:'unchanged',instanceId:matching[0].id,gate:await presentationGate(host,chart.id,matching[0].id,memo.artifact,signal,context.verifyClientReceipt,sourceComparison)};}
  const ref=await host.artifacts.publish({operationId:`round2_markers_${bundleDigest.slice(7)}`,manifest:{kind:'indicator',schemaVersion:'1.0.0',content:bundle.definition,dependencies:[overlayRef],blobs:[{...await host.artifacts.blob(bundle.files['markers.js']),path:'markers.js',mediaType:'text/javascript'},{...await host.artifacts.blob(JSON.stringify(bundle.snapshot)),path:'revealed-markers.json',mediaType:'application/json'}],provenance:{kind:'demo',references:[]}}});
  scene=await host.layout.inspect();chart=scene.charts?.find(c=>c.id===context.chartId);check(chart&&!chart.locked&&chart.binding?.instrument?.sourceId===`kurumi:${context.runId}`,'Layout changed/locked after publication','LAYOUT_CONFLICT');
  const exactCurrent=(scene.scripts??[]).filter(s=>chart.script_ids?.includes(s.id)&&canonical(s.artifact)===canonical(ref));
  check(exactCurrent.length<=1,'Duplicate exact current indicator instances require reconciliation','INSTANCE_AMBIGUOUS');
  if(exactCurrent[0]){host.storage.transaction(()=>host.storage.put(COLLECTION,{id,artifact:ref,snapshotDigest:bundle.snapshotDigest,bundleDigest,instanceId:exactCurrent[0].id,mountPending:false}));return {comparison:copy(visibility),status:'unchanged',instanceId:exactCurrent[0].id,gate:await presentationGate(host,chart.id,exactCurrent[0].id,ref,signal,context.verifyClientReceipt,sourceComparison)};}
  if(!memo && chart.script_ids?.length)return {status:'pending',reason:'UI ownership memo missing; reconcile existing exact artifact before adding; no duplicate growth',artifact:ref};
  const replacing=owned??matching[0];check(!replacing||chart.script_ids?.includes(replacing.id),'Instance removed after publication','LAYOUT_CONFLICT');
  // Keep a publication intent before the async mount so lost replies can be
  // reconciled without continuously creating instances.
  host.storage.transaction(()=>host.storage.put(COLLECTION,{id,artifact:ref,snapshotDigest:bundle.snapshotDigest,bundleDigest,instanceId:replacing?.id??null,mountPending:true}));
  const mounted=await host.layout.script({action:'put',command_id:`round2_mount_${digest([ref,chart.id,scene.version]).slice(7)}`,expected_version:scene.version,chart_id:chart.id,...(replacing?{script_id:replacing.id}:{}),artifact:ref,parameters:{}});
  const after=await host.layout.inspect(),actual=after.scripts?.filter(s=>after.charts?.find(c=>c.id===chart.id)?.script_ids?.includes(s.id)&&canonical(s.artifact)===canonical(ref));check(actual?.length===1,'Mount result requires exact one host instance','SNAPSHOT_REQUIRED');
  host.storage.transaction(()=>host.storage.put(COLLECTION,{id,artifact:ref,snapshotDigest:bundle.snapshotDigest,bundleDigest,instanceId:actual[0].id,mountPending:false}));
  return {comparison:copy(visibility),status:'mounted',instanceId:actual[0].id,artifact:ref,layoutVersion:after.version,mounted,gate:await presentationGate(host,chart.id,actual[0].id,ref,signal,context.verifyClientReceipt,sourceComparison)};
}

/** Await after atomic H1 commit and before provider emit. It does not trade.
 * context.consumedTicks is one validated batch, NEVER future OHLC/next slice.
 * service scope persists an audience todo; a main host later calls same hook.
 * Original annotations are spectator-only and must not be fed to role DTOs. */
function checkedComparison(result){const c=result?.comparison;if(!c)return result;
  c.runtimeStatus=result.gate?.status??'pending';
  if(c.sourceReady&&c.calculationReady&&result.gate?.status==='rendered')c.status='program_evidence_ready';
  c.visibleComparison=false;c.nativeVisibility={status:'pending',level:'pixel',reason:'No raw per-point visible keys exist in public script/inspect contract'};return result;
}
export async function onReplayCommitted(host,service,context,signal) {
  signal?.throwIfAborted();check(context.engine?.id===context.runId&&Number.isSafeInteger(context.replayCutoffMs),'Committed context identity/cutoff required');
  return queued(host,context.runId,async()=>{
    signal?.throwIfAborted();let view=readConsumedView(host,context.runId);
    if(context.consumedTicks){check(context.consumedTicks.runId===context.runId&&context.consumedTicks.commitVersion===context.engine.version&&context.consumedTicks.cutoffMs===context.replayCutoffMs,'Batch/context mismatch','SOURCE_MISMATCH');
      const batch=context.consumedTicks,originalDigest=digest(batch);let next;
      if(view?.completedInputs?.[batch.batchId]){check(view.completedInputs[batch.batchId]===originalDigest,'Committed suffix changed after presentation finalize','IDEMPOTENCY_CONFLICT');next=copy(view);}
      else{
        const prior=view?.bars.find(b=>b.chapter===batch.chapter&&b.symbol===batch.symbol&&b.from===batch.from);
        if(prior&&!prior.isClosed&&batch.intervalComplete&&batch.sequenceStart===0){
          check(batch.rows.length>=prior.consumedCount&&ticksPrefixDigest(batch.rows.slice(0,prior.consumedCount))===prior.prefixDigest,'Consumed prefix is not the actual committed journal prefix','SOURCE_MISMATCH');
          const remaining=batch.rows.slice(prior.consumedCount);
          if(remaining.length)next=reduceConsumedTicks(view,{...batch,batchId:batch.batchId+'_finalize',sequenceStart:prior.consumedCount,rows:remaining});
          else {next=copy(view);const b=next.bars.find(x=>x.key===prior.key);b.isClosed=true;b.asOf=batch.cutoffMs;b.sourceDigest=batch.sourceDigest;b.sourceRefs=copy(batch.sourceRefs);next.cutoffMs=batch.cutoffMs;next.commitVersion=batch.commitVersion;next.revision++;}
          next.completedInputs={...next.completedInputs,[batch.batchId]:originalDigest};
        }else next=reduceConsumedTicks(view,batch);
      }
      host.storage.transaction(()=>{const current=readConsumedView(host,context.runId);check((current?.revision??0)===(view?.revision??0),'Presentation CAS conflict','VERSION_CONFLICT');host.storage.put(COLLECTION,next);});view=next;
    }
    if(!view)return {status:'pending',reason:'Consumed-tick bridge not connected; lastQuote cannot reconstruct an H1',formingReady:false};
    check(view.cutoffMs===context.replayCutoffMs,'Presentation cutoff differs from commit','SOURCE_MISMATCH');
    // A committed H1 releases the temporary spectator checkpoint, never the financial ledger.
    if((context.consumedTicks?.intervalComplete||(context.previousEngine&&context.engine.version===context.previousEngine.version+1))&&host.storage.get('round2-spectator-checkpoint',context.runId,true))host.storage.transaction(()=>host.storage.delete('round2-spectator-checkpoint',context.runId));
    const todo={id:`todo_${context.runId}`,runId:context.runId,version:context.engine.version,cutoffMs:view.cutoffMs,chapterEnded:!!context.chapterEnded,terminal:!!context.terminal,needsMainRefresh:true};host.storage.transaction(()=>host.storage.put(COLLECTION,todo));
    const refreshed=checkedComparison(await refreshChart(host,service,context,signal));
    if(refreshed.gate?.raw){const raw={expected:refreshed.gate.expected,raw:refreshed.gate.raw,availableLevel:refreshed.gate.availableLevel};const receipt=await service.archiveFileSafe(`audience/${context.runId}/chart-runtime-canonical-${digest(raw).slice(7)}.json`,canonical(raw));check(receipt,'Full actual layout rawreceipt archive required','ARCHIVE_UNAVAILABLE');refreshed.runtimeArchive=receipt;}
    if(['mounted','unchanged'].includes(refreshed.status))host.storage.transaction(()=>{const current=host.storage.get(COLLECTION,todo.id,true);if(current?.version===todo.version&&current.cutoffMs===todo.cutoffMs)host.storage.put(COLLECTION,{...current,needsMainRefresh:false,clientGate:copy(refreshed.gate),instanceId:refreshed.instanceId});});
    return {status:'committed',viewRevision:view.revision,cutoff:utc(view.cutoffMs),formingReady:view.bars.some(b=>!b.isClosed),refresh:refreshed};
  });
}

/** Main-session consumer for the durable service-scope audience todo.
 * Await from a real display/tool handler; no agents.submit, timers or private
 * main-session injection. Deletion/lock/binding change remains pending. */
export async function refreshReplayAudience(host,service,options={},signal){
  check(host.scope?.kind==='main','Audience refresh needs an actual main-session host','SCOPE_DENIED');
  const committed=service.getSpectatorState?.()??service.getState(),engine=copy(readSpectatorCheckpoint(host,committed?.id)?.engine??committed),view=readConsumedView(host,engine?.id);
  check(view&&view.commitVersion===engine.version,'Latest atomic consumed view not available','SNAPSHOT_REQUIRED');
  const todo=host.storage.get(COLLECTION,`todo_${engine.id}`,true);
  return onReplayCommitted(host,service,{...options,engine,runId:engine.id,replayCutoffMs:view.cutoffMs,chapterEnded:todo?.chapterEnded??false,terminal:todo?.terminal??false,consumedTicks:undefined},signal);
}

// Independent spectator commentary queue. It never requests a trader, changes
// a decision, or injects into private main-session/DOM APIs.
const PK='round2-pk';
const exactParts=x=>{check(typeof x==='string'&&/^-?\d+(\.\d+)?$/.test(x),'Financial Decimal required','SOURCE_DATA_INVALID');const [w,f='']=x.split('.');return {n:BigInt(w+f),s:f.length};};
const exactText=({n,s})=>{let t=(n<0n?-n:n).toString().padStart(s+1,'0');if(s)t=t.slice(0,-s)+'.'+t.slice(-s);return (n<0n?'-':'')+t.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');};
const exactSub=(a,b)=>{const x=exactParts(a),y=exactParts(b),s=Math.max(x.s,y.s);return exactText({n:x.n*10n**BigInt(s-x.s)-y.n*10n**BigInt(s-y.s),s});};
const exactAdd=(a,b)=>exactSub(a,b.startsWith('-')?b.slice(1):'-'+b);
const exactMul=(a,b)=>{const x=exactParts(a),y=exactParts(b);return exactText({n:x.n*y.n,s:x.s+y.s});};
const exactRatio=(a,b)=>{const x=exactParts(a),y=exactParts(b);return y.n>0n?exactText({n:x.n*10n**BigInt(y.s+8)/(y.n*10n**BigInt(x.s)),s:8}):null;};
function pkCAS(host,id,revision,change){let next;host.storage.transaction(()=>{const old=host.storage.get(PK,id);check(old.revision===revision,'PK commentary CAS conflict','VERSION_CONFLICT');next={...old,...copy(change),revision:old.revision+1};host.storage.put(PK,next);});return next;}

async function sealPKInput(host,service,job){
 const archived=await service.archiveFileSafe(`pk/${job.id}/input.json`,JSON.stringify(job.input));check(archived,'PK input archive unavailable','ARCHIVE_UNAVAILABLE');
 const ref=await host.artifacts.publish({operationId:job.id+'_facts',manifest:{kind:'resource',schemaVersion:'1.0.0',content:{type:'kurumi-fixed-spectator-pk',path:'facts.json'},dependencies:[],blobs:[{...await host.artifacts.blob(JSON.stringify({input:job.input,text:job.text})),path:'facts.json',mediaType:'application/json'}],provenance:{kind:'demo',references:[]}}});
 return pkCAS(host,job.id,job.revision,{status:job.status==='cadence_capped'?'cadence_capped':'ready',inputRef:ref,inputArchive:archived});
}

/** Every committed H1 hook may call this, but only genuine 4H decisions,
 * evidenced risk exits, UTC report boundaries and terminal/chapter events
 * create commentary. NOT called by consumed-prefix/tick animation refresh.
 * Fixed facts, version and cutoff are identical to weekly/price/account input. */
export async function onPKBoundary(host,service,context,signal){
 signal?.throwIfAborted();const e=context.engine,p=context.previousEngine;
 check(e?.id===context.runId&&p?.id===e.id,'PK run identity required');
 if(e.version!==p.version+1)return {status:'skipped',reason:'Not a committed H1; no per-tick commentary'};
 const a=context.account,view=readConsumedView(host,e.id);
 check(a?.asOfMs===context.replayCutoffMs&&a.engineVersion===e.version&&a.balance===e.balance&&view?.commitVersion===e.version&&view.cutoffMs===context.replayCutoffMs,'PK/market/account frontier mismatch','SOURCE_MISMATCH');
 const newFills=e.fills.slice(p.fills.length);check(canonical(e.fills.slice(0,p.fills.length))===canonical(p.fills),'PK fill prefix changed','SOURCE_MISMATCH');
 for(const field of ['fills','orders','ledger','equity'])for(const r of e[field]??[])check(Number.isSafeInteger(r.time)&&r.time<=context.replayCutoffMs,'Future/unknown PK financial event','FUTURE_DATA_FORBIDDEN');
 check(a.quoteTimeMs==null||Number.isSafeInteger(a.quoteTimeMs)&&a.quoteTimeMs<=context.replayCutoffMs,'Future PK account quote','FUTURE_DATA_FORBIDDEN');
 for(const b of view.bars??[])check(b.asOf<=context.replayCutoffMs&&(b.lastTickMs==null||b.lastTickMs<=context.replayCutoffMs),'Future PK market source','FUTURE_DATA_FORBIDDEN');
 for(const r of e.decisions??[])check(Number.isSafeInteger(r.executionTime)&&r.executionTime<=context.replayCutoffMs,'Future/unknown PK decision time','FUTURE_DATA_FORBIDDEN');
 const decision=context.decisionBoundary===true;
 const last=decision?(context.roleDecision??e.decisions.filter(d=>!d.decision?.continuationOf).at(-1)??null):null;
 if(last)check(!last.decision?.continuationOf&&Number.isSafeInteger(last.executionTime)&&last.executionTime<=context.replayCutoffMs&&e.decisions.some(d=>canonical(d)===canonical(last)),'PK role decision is not a real disclosed non-continuation','SOURCE_MISMATCH');
 const block=last?e.fills.filter(f=>f.time>=last.executionTime&&f.time<context.replayCutoffMs):newFills;
 if(decision&&context.decisionBlockFills!==undefined)check(canonical(context.decisionBlockFills)===canonical(block),'PK entire decision-block fills must equal real ledger range','SOURCE_MISMATCH');
 const fills=decision?copy(context.decisionBlockFills??block):newFills,risk=newFills.filter(f=>/stop|bankrupt|liquidat/.test(f.reason??''));
 const reasons=[...(decision?['decision_boundary']:[]),...(risk.length?['risk_exit']:[]),...((context.weeklyJobs??[]).length?['utc_week_report']:[]),...(context.chapterEnded?['chapter_end']:[]),...(context.terminal?['terminal']:[])];
 if(!reasons.length)return {status:'skipped',reason:'Bounded event cadence; no new decision/risk/week/chapter'};
 const chapter=context.chapter??p.chapter,id=`pk_${digest([e.id,e.version,context.replayCutoffMs]).slice(7)}`,existing=host.storage.get(PK,id,true);if(existing){const saved=existing.inputRef?existing:await sealPKInput(host,service,existing);return {id,status:saved.status,inputRef:saved.inputRef,duplicate:true};}
 const originals=copy(context.originalComparison??[]);for(const o of originals)check((o.knownAt?.unixMs??o.time?.unixMs??Infinity)<=context.replayCutoffMs,'Future original plot forbidden','FUTURE_DATA_FORBIDDEN');
 const profile=e.rules?.experimentProfile?.content??e.experimentProfile??e.rules??{},initial=profile.initialBalance??'300000',goal=profile.victoryBalance??'20000000',equity=typeof a.equity==='string'?a.equity:null;
 const claims=fills.map((f,i)=>({id:`F${i+1}`,type:'actual-fill',actor:'Sesame',rawFillId:f.id,nativeOrderId:f.nativeClientOrderId??null,decisionId:f.orderId,time:utc(f.time),quantity:f.signedQuantity,price:f.price,reason:f.reason,realizedJpy:f.realizedJpy,commission:f.commission}));
 const input={schemaVersion:'1.0.0',audienceOnly:true,runId:e.id,engineVersion:e.version,chapter,asOf:utc(context.replayCutoffMs),quoteTimeMs:a.quoteTimeMs??null,reasons,account:copy(a),position:copy(e.position),claims,decision:decision?copy(last):null,decisionBlock:decision?{fromMs:last?.executionTime??null,toExclusiveMs:context.replayCutoffMs,fillIds:fills.map(f=>f.id),source:'real committed ledger range; never last continuation only'}:null,originals,
  goal:{initialJPY:initial,targetJPY:goal,initialTargetFactor:exactRatio(goal,initial),remainingJPY:equity?exactSub(goal,equity):{status:'unknown'},currentTargetFactor:equity?exactRatio(goal,equity):null},
  methods:copy(context.methods??[]),sourceDigests:copy(e.dataDigests??null),sourceRefs:copy(view.sources),linkedWeeklyReports:copy(context.weeklyJobs??[]),plugin:copy(host.plugin),limits:['同历史知情重放，非样本外；无前瞻已验证规则','原作未知成交/盈亏/总资产不补造；拟合不记入账本','预训练模型可能记得历史；没有独立第二交易角色']};
 const count=host.storage.list(PK).filter(j=>j.runId===e.id&&j.chapter===chapter&&j.id.startsWith('pk_')).length,cap=context.maxCommentariesPerChapter??32;
 check(Number.isSafeInteger(cap)&&cap>0&&cap<=200,'Invalid bounded PK cadence cap');
 let text=`【观众PK · ${new Date(context.replayCutoffMs).toISOString()} · 已提交H1】\nSesame，别被原作光环镇住！现在余额 ${a.balance} JPY、权益 ${typeof a.equity==='string'?a.equity:'未知'} JPY；从 ${initial} 到 ${goal} 的压力是约66.7倍（精确 ${input.goal.initialTargetFactor} 倍），距目标 ${typeof input.goal.remainingJPY==='string'?input.goal.remainingJPY:'未知'} JPY。[A1 账户v${e.version}]\n`;
 text+=claims.length?claims.map(c=>`[${c.id} ${c.rawFillId}] ${c.quantity.startsWith('-')?'卖':'买'} ${c.quantity.replace(/^-/,'')} @ ${c.price}，${c.reason??'真实账本成交'}；已实现 ${c.realizedJpy}、费用 ${c.commission} JPY。`).join('\n'):'这一界没有新成交。稳住不等于赢了，也不能把一句决定算成交易。[F0 fill-prefix]';
 text+=`\n保证金 ${typeof a.margin==='string'?a.margin:'未知'}、可用保证金 ${typeof a.freeMargin==='string'?a.freeMargin:'未知'} JPY；仓位 ${e.position?JSON.stringify(e.position):'空仓'}。[A1] `;
 text+=risk.length?'止损/强平已经在账本里响过，失误的压力就看真实退出和损益，不替模型编借口。[F]':'别为追目标扩大风险；当前没有证据证明下一笔会赢。[A1]';
 text+=originals.length?'\n原作侧只能比较已经释放且有来源的区间/拟合注释；不制造对手的逐笔成交与浮盈。':'\n原作侧尚无已释放的精确逐笔证据，绝不靠捏造对手战绩烘托PK。';
 text+='\n这是观众解说，不是交易指令；观点与假设不是已验证策略。';
 let job={id,revision:1,runId:e.id,chapter,engineVersion:e.version,cutoffMs:context.replayCutoffMs,inputDigest:digest(input),input,text,status:count>=cap?'cadence_capped':'input_frozen',deliveryStatus:'pending',generatedOutput:null};
 host.storage.transaction(()=>{check(!host.storage.get(PK,id,true),'Concurrent PK create; reconcile existing key','VERSION_CONFLICT');host.storage.put(PK,job);});
 job=await sealPKInput(host,service,job);return {id,status:job.status,inputRef:job.inputRef,paidRequested:false,nativeChat:'pending-main-consumer-and-real-message-proof'};
}

/** Optional future-authorized narration inference, separate from trading
 * requests/allowlists and never per tick. Complete output is stored before
 * archival; ambiguous submission cannot be retried automatically. */
export async function generatePKCommentary(host,service,id,options={},signal){
 check(options.authorizeGeneration===true,'PK generation not authorized','GENERATION_NOT_AUTHORIZED');
 // Current native-main route writes its own ordinary response. Never creates
 // an additional inference task, even if an old caller sets authorization.
 check(false,'Use CORE public main claim/visible-message ack route; separate spectator inference disabled','NATIVE_MAIN_REPLY_REQUIRED');
}

/** REAL main tool/display handler consumes the fixed commentary and writes its
 * own normal native-chat response. No public direct chat-injection API exists
 * in the consulted HostContext; the hook must not invent one. Optional delivery
 * adapter is supplied only by matching public main/chat workflow. Without an
 * actual adapter+receipt verifier we return pending, NOT displayed. */
export async function consumePKCommentary(host,service,options={},signal){
 check(host.scope?.kind==='main','Native main-chat commentary is main-only','SCOPE_DENIED');const committed=service.getSpectatorState?.()??service.getState(),engine=readSpectatorCheckpoint(host,committed.id)?.engine??committed,view=readConsumedView(host,engine.id);
 check(view?.commitVersion===engine.version,'Current spectator source/asof mismatch','SNAPSHOT_REQUIRED');
 const rows=host.storage.list(PK).filter(j=>j.runId===engine.id&&j.engineVersion===engine.version&&j.cutoffMs===view?.cutoffMs&&['ready','generated'].includes(j.status));
 const out=[];for(let j of rows){signal?.throwIfAborted();
  if(j.deliveryStatus==='public_main_message_acknowledged'){
   const ref=j.nativeMessageRef,valid=ref?.kind==='resource'&&typeof ref.id==='string'&&typeof ref.revision==='string'&&/^sha256:[a-f0-9]{64}$/.test(ref.digest??'')&&ref.schemaVersion==='1.0.0';
   out.push({id:j.id,status:valid?'public_main_message_acknowledged':'pending',...(valid?{nativeMessageRef:copy(ref),publicMessage:{status:'acknowledged',level:'public_persisted_message_text'}}:{diagnostic:'Canonical ack is missing its actual immutable nativeMessageRef'}),nativeVisibility:{status:'pending',level:'native_chat_ui',reason:'Persisted public message text is not native client visibility'},modelRequested:false});continue;
  }
  if(j.deliveryStatus!=='pending'){out.push({id:j.id,status:j.deliveryStatus,nativeVisibility:{status:'pending',reason:'Delivery adapter state is not separately verified native pixels'}});continue;}
  const packet={id:j.id,asOf:utc(j.cutoffMs),sourceDigest:j.inputDigest,inputRef:j.inputRef,text:j.generatedOutput?.text??j.text,claims:copy(j.input.claims),account:copy(j.input.account),nativeMainReplyRequired:true};
  if(!options.deliverNativeChat||!options.verifyNativeChatReceipt){out.push({...packet,status:'pending',diagnostic:'Main must publish its normal native-chat reply; no private session API/website fallback. Real message/asof/source proof required.'});continue;}
  j=pkCAS(host,j.id,j.revision,{deliveryStatus:'delivering'});
  try{const raw=await options.deliverNativeChat(copy(packet),signal),proof=await options.verifyNativeChatReceipt(raw,{id:j.id,cutoffMs:j.cutoffMs,inputDigest:j.inputDigest,inputRef:j.inputRef},signal);check(proof?.status==='displayed'&&proof.evidence,'Real main native message proof required','NATIVE_CHAT_PENDING');j=pkCAS(host,j.id,j.revision,{deliveryStatus:'displayed',nativeChatReceipt:copy(proof)});out.push({id:j.id,status:'displayed',receipt:proof});}
  catch(error){pkCAS(host,j.id,j.revision,{deliveryStatus:'unknown',deliveryError:{code:error.code??'UNKNOWN',message:error.message}});throw error;}
 }return {items:out};
}

/** Restart recovery never resubmits a model or an unknown chat delivery. */
export async function recoverPKArchives(host,service,signal){const results=[];for(let j of host.storage.list(PK)){
 signal?.throwIfAborted();if(j.status==='generating')j=pkCAS(host,j.id,j.revision,{status:'unknown',error:{code:'RESTART_SUBMISSION_UNKNOWN',message:'Do not resubmit narrator'}});
 else if(!j.inputRef)j=await sealPKInput(host,service,j);
 else if(j.status==='output_saved'){const receipt=await service.archiveFileSafe(`pk/${j.id}/full-output.json`,JSON.stringify(j.generatedOutput));check(receipt,'PK full output archive pending','ARCHIVE_UNAVAILABLE');j=pkCAS(host,j.id,j.revision,{status:'generated',outputArchive:receipt});}
 results.push({id:j.id,status:j.status,deliveryStatus:j.deliveryStatus});}return {results};}

export async function reconcilePKNativeDelivery(host,id,revision,raw,verify,signal){check(host.scope?.kind==='main','Main-only native-chat reconciliation','SCOPE_DENIED');const j=host.storage.get(PK,id);check(['delivering','unknown'].includes(j.deliveryStatus)&&typeof verify==='function','Existing delivery and real verifier required','RECONCILIATION_REQUIRED');const proof=await verify(raw,{id,cutoffMs:j.cutoffMs,inputDigest:j.inputDigest,inputRef:j.inputRef},signal);check(proof?.status==='displayed'&&proof.evidence,'Actual existing message proof required','RECONCILIATION_REQUIRED');return pkCAS(host,id,revision,{deliveryStatus:'displayed',nativeChatReceipt:copy(proof)});}

/** Real consumed-prefix callback. CORE must provide the actual native partial
 * engine/account checkpoint, not final-hour state paired with an earlier chart.
 * Trading service.getState/observe remain unchanged; only provider spectators
 * read this own immutable asof checkpoint until the H1 commit clears it. */
export async function onConsumedPrefix(host,service,context,signal){
 signal?.throwIfAborted();const e=context.engine,b=context.consumedTicks,a=context.account;
 check(e?.id===context.runId&&b?.runId===e.id&&b.intervalComplete===false&&b.cutoffMs===context.replayCutoffMs,'Actual incomplete native consumption batch required','SOURCE_MISMATCH');
 check(a?.engineVersion===e.version&&a.asOfMs===b.cutoffMs&&a.balance===e.balance,'Final-hour account cannot be paired with an earlier forming bar','SOURCE_MISMATCH');
 check(context.nativeConsumedProof?.kind==='native-consumed-checkpoint'&&context.nativeConsumedProof.engineDigest===digest(e)&&context.nativeConsumedProof.accountDigest===digest(a)&&context.nativeConsumedProof.batchDigest===digest(b),'CORE actual native checkpoint proof missing; no manufactured intermediate account','CONSUMED_CHECKPOINT_REQUIRED');
 check(!e.lastQuote||e.lastQuote.time<=b.cutoffMs,'Prefix lastQuote reveals future price','FUTURE_DATA_FORBIDDEN');
 for(const field of ['fills','ledger','orders','equity'])for(const row of e[field]??[])check(Number.isSafeInteger(row.time)&&row.time<=b.cutoffMs,'Prefix checkpoint contains future financial event','FUTURE_DATA_FORBIDDEN');
 let balance=e.rules?.initialBalance??'300000';for(const row of e.ledger??[]){balance=exactSub(exactSub(exactAdd(balance,row.realizedJpy),row.commission),row.financing);check(exactSub(balance,row.balanceAfter)==='0','Prefix monetary ledger row mismatch','LEDGER_MISMATCH');}check(exactSub(balance,e.balance)==='0','Final-hour balance mixed into earlier prefix','LEDGER_MISMATCH');
 if(['balance','equity','unrealizedJpy'].every(k=>typeof a[k]==='string'))check(exactSub(exactAdd(a.balance,a.unrealizedJpy),a.equity)==='0','Prefix equity does not reconcile','LEDGER_MISMATCH');
 if(['equity','margin','freeMargin'].every(k=>typeof a[k]==='string'))check(exactSub(exactSub(a.equity,a.margin),a.freeMargin)==='0','Prefix free margin does not reconcile','LEDGER_MISMATCH');
 check(e.lastQuote===null||e.lastQuote===undefined||e.lastQuote.time<=b.cutoffMs,'Prefix quote later than cutoff','FUTURE_DATA_FORBIDDEN');
 return queued(host,context.runId,async()=>{const old=readConsumedView(host,e.id),next=reduceConsumedTicks(old,b);host.storage.transaction(()=>{check((readConsumedView(host,e.id)?.revision??0)===(old?.revision??0),'Prefix CAS conflict','VERSION_CONFLICT');host.storage.put(COLLECTION,next);host.storage.put('round2-spectator-checkpoint',{id:e.id,runId:e.id,cutoffMs:b.cutoffMs,engine:copy(e),account:copy(a),proof:copy(context.nativeConsumedProof)});});
  // No PK/weekly/model calls: this is presentation-only progress.
  service.emitSpectator?.();return {status:'prefix_consumed',cutoffMs:b.cutoffMs,viewRevision:next.revision,accountAsOfMs:a.asOfMs,financialLedgerMutated:false,paidRequested:false};});
}

/** Main public handler coordinator. CORE calls this after display/status/one
 * bounded step; service writes only durable todo. No event.emit/timer/summary
 * is claimed to wake the main Agent or prove actual rendered UI. */
export async function consumeMainAudience(host,service,options={},signal){
 check(host.scope?.kind==='main','Packaged audience consumer requires real main host','SCOPE_DENIED');
 const scene=await host.layout.inspect(),e=service.getSpectatorState?.()??service.getState();
 const charts=(scene.charts??[]).filter(c=>c.binding?.instrument?.sourceId===`kurumi:${e.id}`&&(!options.chartId||c.id===options.chartId));
 const refresh=[];for(const c of charts)refresh.push(await refreshReplayAudience(host,service,{chartId:c.id,verifyClientReceipt:options.verifyClientReceipt},signal));
 const {consumeNativeWeeklyReports}=await import('./weekly-reports.js');
 const reports=await consumeNativeWeeklyReports(host,service,options,signal);
 const commentary=await consumePKCommentary(host,service,options,signal);
 return {refresh,reports,commentary,paidRequested:false,layoutOnlyInMain:true,nativeVisibleAcceptance:{status:'pending',reason:'Program/runtime/page receipts do not certify actual chart/account/chat/report pixels'},pending:!charts.length||refresh.some(r=>r.refresh?.gate?.status!=='rendered')||reports.items.some(r=>r.status!=='opened')||commentary.items.some(r=>!['public_main_message_acknowledged','displayed'].includes(r.status))};
}

/** Public claim -> full normal reply output -> actual native message ack.
 * Main can write its OWN usual reply using this packet, without direct private
 * chat/session injection or background role summary. No model is requested.
 * CORE must expose these through packaged main tool/Skill + actual SDK ack. */
export function claimPKNativeReply(host,service,id,{claimId},signal){
 signal?.throwIfAborted();check(host.scope?.kind==='main'&&typeof claimId==='string'&&claimId.length>0,'Main stable claim required','SCOPE_DENIED');let j=host.storage.get(PK,id);const e=service.getSpectatorState?.()??service.getState(),view=readConsumedView(host,e.id);
 check(j&&['ready','generated'].includes(j.status)&&j.runId===e.id&&j.engineVersion===e.version&&j.cutoffMs===view?.cutoffMs,'Claim needs current fixed event/source/asof','SOURCE_MISMATCH');
 if(j.mainClaim){check(j.mainClaim.claimId===claimId,'Existing main claim cannot be replaced; reconcile first','RECONCILIATION_REQUIRED');return copy(j.mainClaim);}
 check(j.deliveryStatus==='pending','Event already delivered/unknown; no second paid reply','RECONCILIATION_REQUIRED');
 const token=digest([id,j.inputDigest,claimId]);const claim={claimId,token,eventId:id,inputRef:j.inputRef,inputDigest:j.inputDigest,asOf:utc(j.cutoffMs),text:j.generatedOutput?.text??j.text,claims:copy(j.input.claims),account:copy(j.input.account),modelRequested:false,requiresNormalMainReply:true};
 j=pkCAS(host,id,j.revision,{deliveryStatus:'claimed',mainClaim:claim});return copy(claim);
}
export async function recordPKNativeReply(host,service,id,{token,text},signal){
 signal?.throwIfAborted();check(host.scope?.kind==='main','Normal reply record is main-only','SCOPE_DENIED');let j=host.storage.get(PK,id);
 check(j?.mainClaim?.token===token&&typeof text==='string'&&text.length>0,'Full matching main normal output required','RECONCILIATION_REQUIRED');
 if(j.normalMainOutput){check(j.normalMainOutput.text===text,'Claim output cannot change after save','IDEMPOTENCY_CONFLICT');if(j.normalMainOutput.ref)return copy(j.normalMainOutput);}
 else j=pkCAS(host,id,j.revision,{normalMainOutput:{text,token,inputDigest:j.inputDigest,asOf:utc(j.cutoffMs)},deliveryStatus:'normal_output_saved'});
 const receipt=await service.archiveFileSafe(`pk/${id}/normal-main-output.json`,JSON.stringify(j.normalMainOutput));check(receipt,'Normal full main output archive pending; do not regenerate','ARCHIVE_UNAVAILABLE');
 const blob=await host.artifacts.blob(JSON.stringify(j.normalMainOutput)),ref=await host.artifacts.publish({operationId:id+'_normal_main_output',manifest:{kind:'resource',schemaVersion:'1.0.0',content:{format:'json',path:'normal-output.json'},dependencies:[j.inputRef],blobs:[{...blob,path:'normal-output.json',mediaType:'application/json'}],provenance:{kind:'derived',references:[j.inputRef]}}});
 j=pkCAS(host,id,j.revision,{normalMainOutput:{...j.normalMainOutput,archive:receipt,ref}});return copy(j.normalMainOutput);
}
export async function acknowledgePKNativeReply(host,service,id,{token,rawReceipt,verifyNativeMessage},signal){
 check(host.scope?.kind==='main','Actual normal reply ack is main-only','SCOPE_DENIED');const j=host.storage.get(PK,id);
 check(j?.normalMainOutput?.token===token&&j.normalMainOutput.ref&&typeof verifyNativeMessage==='function','Public actual message verifier + saved full output required; no summary/event assumption','NATIVE_CHAT_PENDING');
 if(j.deliveryStatus==='displayed')return copy(j.nativeChatReceipt);
 const expected={id,inputDigest:j.inputDigest,inputRef:j.inputRef,outputRef:j.normalMainOutput.ref,textDigest:digest(j.normalMainOutput.text),asOf:utc(j.cutoffMs)};
 const receipt=await verifyNativeMessage(rawReceipt,expected,signal);check(receipt?.status==='displayed'&&receipt.evidence,'Actual main normal chat receipt missing','NATIVE_CHAT_PENDING');
 pkCAS(host,id,j.revision,{deliveryStatus:'displayed',nativeChatReceipt:copy(receipt)});return copy(receipt);
}

/** Real pre-play warmup only: CORE supplies actually read/consumed historical
 * ticks before initial frontier. Does not alter financial state or query new
 * data. Actual data acquisition/owned-file proof belongs to CORE provider. */
export async function initializeReplayAudience(host,service,{engine,warmupBatches,cutoffMs},signal){
 check(engine?.version===1&&engine.id===service.getState()?.id&&Array.isArray(warmupBatches)&&warmupBatches.length,'Initial real consumed warmup source required','WARMUP_REQUIRED');
 let view=readConsumedView(host,engine.id);for(const b of warmupBatches){signal?.throwIfAborted();check(b.runId===engine.id&&b.commitVersion===1&&b.intervalComplete&&b.cutoffMs<=cutoffMs&&b.rows.every(r=>r.time<cutoffMs),'Warmup contains future/nonclosed source','FUTURE_DATA_FORBIDDEN');view=reduceConsumedTicks(view,b);}
 check(view.cutoffMs===cutoffMs,'Warmup must end exactly at pre-play disclosure frontier','SOURCE_MISMATCH');host.storage.transaction(()=>host.storage.put(COLLECTION,view));return {status:'warmup_consumed',closedBars:view.bars.filter(b=>b.isClosed).length,cutoffMs,paidRequested:false,financialStateChanged:false};
}
