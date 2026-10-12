// Explicit terminal seal -> immutable history -> independently funded new run.
// Uses public synchronous storage transactions and Recorder's dual immutable files.
// No agent/model/backend execution, reset, recharge or resurrection.
import * as fs from 'node:fs/promises';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { canonical, sha256, ROUND2_PROFILE_ID } from './experiment-profiles.js';
import { createRun } from './native-engine.js';
import { auditLedger } from './ledger.js';
import { createExperiencePlan } from './experience-plan.js';
const inFlight=new WeakMap();
function deduplicate(service,key,input,fn){let map=inFlight.get(service);if(!map)inFlight.set(service,map=new Map());const old=map.get(key);if(old){assert(isDeepStrictEqual(old.input,input),'Concurrent command content differs','IDEMPOTENCY_CONFLICT');return old.promise;}const promise=Promise.resolve().then(fn);map.set(key,{input:clone(input),promise});promise.then(()=>map.delete(key),()=>map.delete(key));return promise;}
const C='experiment-commands', H='experiment-history', E='experiments';
const clone=x=>structuredClone(x);
const assert=(ok,message,code='EXPERIMENT_GATE')=>{if(!ok)throw Object.assign(new Error(message),{code});};
const get=(host,c,id)=>host.storage.get(c,id,true);
const pending = host => (host.storage.list(C)??[]).filter(r=>r.status!=='committed');
const safeId=id=>assert(typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id),'Invalid stable command/run id','INVALID_ID');
export function terminalGate(doc,service) {
  assert(doc?.engine?.status==='complete' && ['victory','not_reached','bankrupt'].includes(doc.engine.outcome),'Only explicitly terminal experiments may be sealed');
  const c=doc.control;
  assert(c && !c.running&&!c.active&&!c.recovery&&!c.continuation&&!c.archiveFailed&&!c.hookFailure,'Active task/recovery/continuation/archive/hook failure blocks terminal sealing');
  assert(!/unknown|matching|submitting|requires/.test(c.phase??''),'Unknown transaction must be reconciled explicitly');
  assert(!service.closed&&!service.preparing&&!service.recovering&&!service.jobs?.size&&!service.launching&&!service.waiting?.size,'In-flight or unknown operations block terminal sealing');
  assert(!doc.engine.position,'Terminal engine must be settled flat');
  assert(!(service.host.storage.list('committed-hooks')??[]).some(r=>r.runId===doc.engine.id&&r.status!=='done'),'Pending committed hooks must be reconciled before sealing');
  assert(!(doc.roleEvidence??[]).some(r=>r.status==='matching'),'Unknown role decision reservation');
  assert(!(doc.recoveries??[]).some(r=>r.status==='matching'||r.requiresReconcile),'Unknown recovery transaction');
  assert(!(service.host.storage.list('round2-weekly')??[]).some(r=>r.id.startsWith('weekly_')&&r.input?.opening?.runId===doc.engine.id&&r.status!=='sealed'),'Unfinished/unknown weekly output/archive blocks sealing');
  auditLedger(doc.engine);
}
function same(row,input) {assert(isDeepStrictEqual(row.input,input),'Same command_id with changed content rejected','IDEMPOTENCY_CONFLICT');}
async function ordinary(path,max=512*1024*1024) {
  path=path instanceof URL?fileURLToPath(path):path;
  const st=await fs.lstat(path);assert(st.isFile()&&!st.isSymbolicLink()&&st.size<=max,'Archive input must be a bounded ordinary file','ARCHIVE_INCOMPLETE');
  assert(await fs.realpath(path)===resolve(path),'Archive input symlink ancestry rejected','UNSAFE_PATH');return fs.readFile(path);
}
async function dual(recorder,item) {
  assert(item?.path&&!isAbsolute(item.path)&&!item.path.split('/').some(x=>x==='..'||x===''),'Invalid archive reference','UNSAFE_PATH');
  for(const base of [recorder.root,recorder.mirror]) {const bytes=await ordinary(join(base,item.path));assert(bytes.length===item.bytes&&sha256(bytes)===item.digest,'Both terminal archive copies must match immutable digest','ARCHIVE_INCOMPLETE');}
}
export async function verifyHistory(host,service,runId) {
  const row=get(host,H,runId);assert(row?.status==='sealed','Old experiment is not completely sealed','HISTORY_UNSEALED');
  assert(sha256(canonical(row.document))===row.documentDigest && sha256(canonical(row.manifest))===row.manifestDigest,'Immutable history bytes/digest changed','HISTORY_CHANGED');
  for(const item of [...row.manifest.files,...(row.archiveRefs??[])])await dual(service.recorder,item);
  return row;
}
async function roleSeals(doc,recorder) {
  const ids=new Set(doc.control.taskIds??[]);for(const r of [...(doc.roleTasks??[]),...(doc.roleEvidence??[])])if(r.taskId)ids.add(r.taskId);
  const files=[];
  for(const id of ids) {
    const task=doc.roleTasks?.find(r=>r.taskId===id);
    assert(task?.actorRunId&&['succeeded','completed','failed','cancelled','canceled','expired','interrupted','timed_out'].includes(task.status),'Role task final output/identity not completely recorded','ROLE_UNSEALED');
    safeId(task.actorRunId);const rel=`runs/${task.actorRunId}/sealed.json`,bytes=await ordinary(join(recorder.root,rel)),m=JSON.parse(bytes);
    assert(m.runId===task.actorRunId,'Role seal identity changed','ROLE_UNSEALED');
    const refs=[{path:rel,digest:sha256(bytes),bytes:bytes.length}];
    for(const e of m.files??[]) {assert(e.digest&&e.bytes!==undefined,'Role archive manifest skipped a file','ROLE_UNSEALED');refs.push({path:`runs/${task.actorRunId}/task-files/${e.path}`,digest:e.digest,bytes:e.bytes});}
    if(m.sqlite)refs.push(m.sqlite);
    for(const e of refs) {await dual(recorder,e);files.push(e);}
    const sidecar=await ordinary(join(recorder.root,`runs/${task.actorRunId}/sealed.digest`));assert(sidecar.toString().trim()===sha256(bytes),'Role seal sidecar changed','ROLE_UNSEALED');
    await dual(recorder,{path:`runs/${task.actorRunId}/sealed.digest`,digest:sha256(sidecar),bytes:sidecar.length});
  }
  return files;
}
async function archiveInputs(service,doc,prefix,signal) {
  const data=service.getData();assert(data&&isDeepStrictEqual(doc.engine.dataDigests,data.digests),'Fixed source snapshot unavailable/changed','SOURCE_CHANGED');
  const files=[];const put=async(rel,bytes)=>{signal?.throwIfAborted();const item=await service.recorder.file(`${prefix}/${rel}`,bytes);await dual(service.recorder,item);files.push({path:item.path,digest:item.digest,bytes:item.bytes});};
  await put('document.json',canonical(doc));await put('engine.json',canonical(doc.engine));
  await put('weekly-records.json',canonical((service.host.storage.list('round2-weekly')??[]).filter(r=>r.input?.opening?.runId===doc.engine.id)));
  await put('presentation-records.json',canonical((service.host.storage.list('round2-presentation')??[]).filter(r=>r.runId===doc.engine.id)));
  for(const collection of ['round2-pk','pk-main-chat','round2-visible-state','round2-spectator-checkpoint','committed-hooks','method-workflow'])await put(`collections/${collection}.json`,canonical((service.host.storage.list(collection)??[]).filter(r=>r.runId===doc.engine.id||r.engine?.id===doc.engine.id||(collection==='method-workflow'&&r.runId==null))));
  await put('sources.json',canonical({digests:data.digests,provenance:data.provenance??null,chapters:data.chapters}));
  // Every fixed viewing frame and observed source byte is retained, not just DTO previews.
  for(let i=0;i<data.frames.length;i++)await put(`frames/chapter-${i}.json`,canonical(data.frames[i]));
  const sourceRefs=[...(data.digests.sourceFiles??[]),...(data.digests.executionFiles??[])];
  assert(data.provenance?.kind==='demo'||sourceRefs.length>0,'Observed history must include actual raw source file inventory','SOURCE_UNSEALED');
  const seen=new Set();
  for(const r of sourceRefs) {
    assert(typeof r.path==='string'&&!isAbsolute(r.path)&&!r.path.split('/').includes('..'),'Source path escape','UNSAFE_PATH');
    if(seen.has(r.path))continue;seen.add(r.path);
    const root=resolve(data.storageRoot??join(service.host.storage.directory,'kurumi-data-v1')),path=resolve(root,r.path);
    assert(path.startsWith(root+sep),'Source path escape','UNSAFE_PATH');const bytes=await ordinary(path);
    assert(bytes.length===r.bytes&&sha256(bytes)===r.digest,'Fixed source bytes changed','SOURCE_CHANGED');await put(`observed/${r.path}`,bytes);
  }
  for(const step of doc.engine.nativeJournal??[])if(step.ticksRef) {
    const r=step.ticksRef,root=resolve(service.host.storage.directory,'kurumi-native','steps'),p=resolve(r.path);assert(p.startsWith(root+sep),'Journal ref not in owned steps','UNSAFE_PATH');
    const bytes=await ordinary(p);assert(bytes.length===r.bytes&&sha256(bytes)===r.digest,'Consumed quote ref changed','SOURCE_CHANGED');await put(`ticks/${r.digest.slice(7)}.json`,bytes);
  }
  for(const supplement of doc.fxSupplements??[])for(const key of ['manifest','raw','zip','quotes']) {
    const r=supplement.index?.[key];assert(r,'Incomplete supplemental index','SOURCE_UNSEALED');const root=resolve(service.host.storage.directory,'kurumi-data-v1'),p=resolve(root,r.path);assert(p.startsWith(root+sep),'Supplement path escape','UNSAFE_PATH');
    const bytes=await ordinary(p);assert(bytes.length===r.bytes&&sha256(bytes)===r.digest,'Supplement bytes changed','SOURCE_CHANGED');await put(`supplements/${r.path}`,bytes);
  }
  for(const name of ['plugin.json','package.json','tools.json','service.js','engine.js','native-engine.js','native-engine.py','experiment-profiles.js','experiment-lifecycle.js','experience-plan.js','recording-selection.js','recording.js','committed-playback.js','main-chat-workflow.js','method-workflow.js','data-windows.json','native-dependencies.json','providers.js','markers.js','replay-presentation.js','weekly-reports.js','analysis-plan.js','skills/kurumi-replay/SKILL.md','PORTABLE-EXPERIENCE.md'])await put(`code/${name}`,await ordinary(new URL(name,import.meta.url)));
  files.push(...await roleSeals(doc,service.recorder));return files;
}
export function archiveTerminal(service,args,signal){return deduplicate(service,`seal:${args.command_id}`,args,()=>archiveTerminalOnce(service,args,signal));}
async function archiveTerminalOnce(service,{command_id,expected_version,run_id},signal) {
  safeId(command_id);safeId(run_id);const host=service.host,input={kind:'archive_terminal',expected_version,run_id};
  const oldCommand=get(host,C,command_id);if(oldCommand){same(oldCommand,input);if(oldCommand.status==='committed'){await verifyHistory(host,service,run_id);return clone(oldCommand.result);}}
  const before=service.getDocument();assert(before?.engine.id===run_id,'Current run identity differs','RUN_MISMATCH');
  terminalGate(before,service);assert(before.revision===expected_version,'Stale document revision','VERSION_CONFLICT');
  assert(!get(host,H,run_id),'History already sealed; read history instead','HISTORY_SEALED');
  assert(pending(host).every(r=>r.id===command_id),'Another unknown lifecycle transaction blocks creation/sealing','TRANSACTION_UNKNOWN');
  const digest=sha256(canonical(before));
  host.storage.transaction(()=>{const prior=get(host,C,command_id);if(prior){same(prior,input);assert(prior.documentDigest===digest,'Original seal input changed','SOURCE_CHANGED');}else host.storage.put(C,{id:command_id,input,status:'archiving',documentDigest:digest,runId:run_id});});
  try {
    const prefix=`experiments/${run_id}/terminal`,files=await archiveInputs(service,before,prefix,signal);
    const manifest={schemaVersion:1,runId:run_id,documentDigest:digest,engineVersion:before.engine.version,dataDigests:before.engine.dataDigests,files};
    const manifestBytes=canonical(manifest),manifestFile=await service.recorder.file(`${prefix}/manifest.json`,manifestBytes);await dual(service.recorder,manifestFile);
    const sidecarFile=await service.recorder.file(`${prefix}/manifest.digest`,sha256(manifestBytes)+'\n');await dual(service.recorder,sidecarFile);
    signal?.throwIfAborted();const result={sealed:true,runId:run_id,documentDigest:digest,manifestDigest:sha256(manifestBytes),manifestFile,historyCollection:H,oldDocumentUnchanged:true};
    host.storage.transaction(()=>{
      const current=service.getDocument();assert(sha256(canonical(current))===digest,'Terminal document changed during seal','VERSION_CONFLICT');terminalGate(current,service);
      assert(!get(host,H,run_id),'History CAS conflict','VERSION_CONFLICT');
      host.storage.put(H,{id:run_id,status:'sealed',document:clone(before),documentDigest:digest,manifest,manifestDigest:result.manifestDigest,archiveRefs:[manifestFile,sidecarFile],sealCommandId:command_id});
      host.storage.put(C,{...get(host,C,command_id),status:'committed',result});
    });return result;
  }catch(error){host.storage.transaction(()=>host.storage.put(C,{...get(host,C,command_id),status:'archive_failed',error:{code:error.code??'ARCHIVE_FAILED',message:error.message}}));throw error;}
}
export function createExperiment(service,args,signal){return deduplicate(service,`new:${args.command_id}`,args,()=>createExperimentOnce(service,args,signal));}
async function createExperimentOnce(service,{command_id,expected_version,previous_run_id,profile_id=ROUND2_PROFILE_ID},signal) {
  safeId(command_id);if(previous_run_id!==undefined&&previous_run_id!==null)safeId(previous_run_id);assert(profile_id===ROUND2_PROFILE_ID,'New experiment requires explicit frozen 50x profile','PROFILE_NOT_ALLOWED');
  const host=service.host,input={kind:'create_experiment',expected_version,previous_run_id:previous_run_id??null,profile_id},existing=get(host,C,command_id);
  if(existing){same(existing,input);if(existing.status==='committed')return clone(existing.result);}
  const old=service.getDocument(),fresh=!old;
  assert(service.recorder&&service.getData(),'Prepare private recorder/data first; no author directory','SOURCE_NOT_READY');
  if(fresh){assert(previous_run_id==null&&expected_version===0&&host.storage.list('challenge').length===0,'Fresh install must be truly empty; never hide an old run','RUN_MISMATCH');}
  else{assert(old.engine.id===previous_run_id,'Current run differs; no silently chained experiment','RUN_MISMATCH');terminalGate(old,service);assert(old.revision===expected_version,'Stale document revision','VERSION_CONFLICT');}
  assert(pending(host).every(r=>r.id===command_id),'Unknown/unsealed lifecycle transaction blocks new experiment','TRANSACTION_UNKNOWN');
  const history=fresh?{manifestDigest:null,documentDigest:null}:await verifyHistory(host,service,previous_run_id),oldDigest=sha256(canonical(old));if(!fresh)assert(history.documentDigest===oldDigest,'Old terminal document changed after sealing','HISTORY_CHANGED');
  let row;
  host.storage.transaction(()=>{assert(pending(host).every(r=>r.id===command_id),'Concurrent unknown lifecycle transaction blocks reservation','TRANSACTION_UNKNOWN');row=get(host,C,command_id);if(row){same(row,input);assert(row.oldDigest===oldDigest,'Old terminal source changed','HISTORY_CHANGED');}else{row={id:command_id,input,status:'creating',oldDigest,newRunId:`kurumi-${randomUUID()}`};host.storage.put(C,row);}});
  assert(fresh||isDeepStrictEqual(old.engine.dataDigests,service.getData()?.digests),'New experiment must explicitly use the sealed fixed source; no changed snapshot silently reused','SOURCE_CHANGED');
  const engine=createRun(row.newRunId,service.getData().chapters,service.getData().digests,{profileId:profile_id});
  const doc={id:engine.id,revision:1,engine,model:null,settings:{decisionIntervalHours:4},commands:{},
    experience:createExperiencePlan(),
    experiment:{previousRunId:previous_run_id??null,freshPortableInstall:fresh,profileId:profile_id,initialFunding:{amount:'300000',currency:'JPY',kind:'separate_experiment_capital',notRecharge:true},historyDigest:history.manifestDigest,interpretation:'informed replay of same historical window; not independent out-of-sample'},
    control:{phase:'created_paused',running:false,remaining:0,active:null,recovery:null,continuation:null,attempt:0}};
  const initial=await service.recorder.file(`experiments/${engine.id}/initial/document.json`,canonical(doc));await dual(service.recorder,initial);signal?.throwIfAborted();
  const result={created:true,runId:engine.id,previousRunId:previous_run_id??null,freshPortableInstall:fresh,profile:engine.rules.experimentProfile,revision:1,initialBalanceJPY:'300000',goalJPY:'20000000',initialArchive:initial,modelRequested:false,independentCapital:true};
  host.storage.transaction(()=>{
    assert(sha256(canonical(service.getDocument()))===oldDigest,'Old/current CAS changed during creation','VERSION_CONFLICT');
    assert(!get(host,'challenge',engine.id),'New run identity already exists','VERSION_CONFLICT');
    host.storage.put('challenge',doc);
    // Empty consumed view enables an honest flat initial account, not invented warmup/quotes.
    const initialDisclosureMs=service.getData().frames[0][engine.index].time+3600000;
    host.storage.put('round2-presentation',{id:engine.id,revision:0,runId:engine.id,commitVersion:1,cutoffMs:initialDisclosureMs,bars:[],batches:{},sources:[],sourceStatus:'awaiting_first_consumed_interval'});
    host.storage.put(E,{id:'current',runId:engine.id,documentId:engine.id,previousRunId:previous_run_id??null});
    host.storage.put(C,{...row,status:'committed',result});
  });service.emit();return result;
}
export function experimentHistory(service) {
  return {currentRunId:service.getState()?.id??null,history:(service.host.storage.list(H)??[]).map(r=>({runId:r.id,status:r.status,documentDigest:r.documentDigest,manifestDigest:r.manifestDigest,engineVersion:r.document.engine.version,outcome:r.document.engine.outcome})),
    pendingTransactions:pending(service.host).map(r=>({commandId:r.id,status:r.status,input:r.input,error:r.error??null}))};
}
