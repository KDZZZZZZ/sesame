import { records } from './records.js';
// Persistent actual-MAIN coordinator; background hosts never borrow main ports.
import {canonical,sha256} from './experiment-profiles.js';import {initializeObservedH1} from './warmup-h1.js';

const fail=(code,m)=>{throw Object.assign(new Error(m),{code});};
export async function audienceDriver(host,service,args,signal){
 if(host.context?.kind!=='main')fail('SCOPE_DENIED','Real current main handler required');const e=service.getState(),id=e?.id;if(!id)fail('RUN_REQUIRED','Create paused bounded fresh/terminal50 first');const config=records(host).get('main-audience-config',id,true),todos=records(host).list('main-audience-todo').filter(r=>r.runId===id);
 if(args.action==='status')return {config:config??null,todos,hold:service.getDocument().control.audienceHold??null,paidRequested:false};
 if(args.action==='bootstrap')return initializeObservedH1(host,service,{lookback:20},signal);
 if(args.action==='configure'){
  if(service.getDocument().control.running||service.getDocument().control.active)fail('DECISION_PENDING','Configure audience while paused');
  const scene=await host.views.inspect({surface:'canvas'}),chart=scene.charts?.find(c=>c.id===args.chart_id);if(!chart||chart.binding?.instrument?.sourceId!==`kurumi:${id}`)fail('SOURCE_MISMATCH','Real own replay chart binding required');
  // Public 0.2.2: inspect.rendering + exact current binding/instance/artifact.
  // No script(read) renderer fields, per-point receipt keys or report open tool.
  const record={id,chartId:chart.id,layoutVersion:scene.version,scopeConversationId:host.context.sessionId,mode:'persistent-main-tool-driver-no-hidden-trigger',clientReceiptMode:'public_layout_inspect_rendering_exact_mount',reportReceiptMode:'public_artifacts_receipts_native_page',automaticReportOpen:false,ignoredObsoleteContracts:{nativeReportBridge:!!args.native_report_bridge,clientReceiptContract:!!args.client_receipt_contract}};
  records(host).transaction(()=>records(host).put('main-audience-config',record));await service.archiveFileSafe(`audience/${id}/driver-config-${sha256(canonical(record)).slice(7)}.json`,canonical(record));return {configured:true,record,paidRequested:false};
 }
 if(args.action==='release'){
  const d=service.getDocument(),hold=d.control.audienceHold;if(!hold)return {released:true,idempotent:true};if(d.control.active||d.control.recovery)fail('DECISION_PENDING','Reconcile actual role before release');
  if(!hold.jobIds.length)fail('BOUNDARY_SNAPSHOT_REQUIRED','UTC report job must exist before release');
  const reports=hold.jobIds.map(k=>records(host).get('round2-weekly',k,true));if(reports.some(r=>r?.status!=='sealed'||r.nativeUiStatus!=='opened'||r.nativeUiReceipt?.availableLevel!=='native_page_rendered_pixel_unverified'||!r.nativeUiRawArchive||!r.nativeUiBindingArchive||r.input?.period?.toMs!==hold.cutoffMs||canonical(r.nativeUiReceipt?.derivedBinding?.ref)!==canonical(r.reportRef)||r.nativeUiReceipt?.derivedBinding?.inputDigest!==r.inputDigest))fail('NATIVE_REPORT_PENDING','Real generated UTC report + actual public native opened receipt required before new tick');
  if(records(host).list('round2-pk').some(r=>r.runId===id&&r.engineVersion===e.version&&r.cutoffMs===hold.cutoffMs&&r.status==='ready'&&r.deliveryStatus!=='public_main_message_acknowledged'))fail('MAIN_CHAT_PENDING','Current fixed PK facts require actual ordinary main message acknowledgement, not just absence of a claim');
  if(records(host).list('pk-main-chat').some(r=>r.runId===id&&r.status!=='acknowledged_public_message'))fail('MAIN_CHAT_PENDING','Ack/reconcile ordinary native main paragraph first');
  if(hold.preStepId){const row=records(host).get('pre-step-boundaries',hold.preStepId);records(host).transaction(()=>records(host).put('pre-step-boundaries',{...row,status:'released',releasedBy:{conversationId:host.context.sessionId,reportRefs:reports.map(r=>r.reportRef),nativeReceipts:reports.map(r=>r.nativeUiReceipt)}}));}
  service.mutate(d.revision,next=>{next.control.audienceHold=null;next.control.running=false;next.control.phase='audience_acknowledged_explicit_resume_required';});return {released:true,modelRequested:false,next:'Resume existing continuation/recover frozen intent, not a new paid role'};
 }
 if(!['pump','resume'].includes(args.action))fail('INVALID_ACTION','Use bootstrap/configure/status/pump/resume/release');
 if(!config)fail('MAIN_DRIVER_REQUIRED','Configure actual chart before persistent main consumer');
 const d=service.getDocument(),view=service.getReplayPresentation();if(d.control.running||d.control.active||d.control.recovery)fail('DECISION_PENDING','Wait bounded financial/presentation boundary, no main consumer during mutable trading');
 const token=`${id}:${e.version}:${view.cutoffMs}`,existing=records(host).get('main-audience-todo',token,true);if(existing?.status==='completed')return {...existing.result,idempotent:true};
 const oldWeeklyRequests=new Set(records(host).list('round2-weekly').map(j=>j.requestId).filter(Boolean));
 await service.drainConfiguredWeekly(signal,{kind:'automatic_committed_utc_week',automatic:true,caller:'main-audience-driver',engineVersion:e.version,cutoffMs:view.cutoffMs});
 const row={id:token,runId:id,engineVersion:e.version,cutoffMs:view.cutoffMs,chartId:config.chartId,status:'consuming',noRoleModelCalls:true,noNarratorModelCalls:true};records(host).transaction(()=>records(host).put('main-audience-todo',row));
 const presentation=await import('./replay-presentation.js');let bridgeOptions={chartId:config.chartId};
 // UI receiver now directly validates raw {inspect,script} chart runtime and
 // artifacts.receipts(exactRef) native pages, archives originals and derived
 // frozen-job bindings. Legacy selectors are ignored, never called/migrated.
 // Native pixel/source-vs-fill comparison stays a separate main acceptance.

 try{const result=await presentation.consumeMainAudience(host,service,bridgeOptions,signal),jobs=records(host).list('round2-pk').filter(r=>r.runId===id&&r.engineVersion===e.version&&r.cutoffMs===view.cutoffMs&&r.status==='ready'&&r.deliveryStatus==='pending');
  const outcome={...result,mainChatEvents:jobs.map(r=>({id:r.id,inputRef:r.inputRef,cutoffMs:r.cutoffMs})),next:jobs.length?'Claim -> YOUR ordinary native main paragraph -> ACK before next H1':'Handle raw client/report receipt before explicit release/resume',nativeUiVerified:false,receiptModes:{chart:'runtime_exact_mount_not_pixels',report:'native_page_not_inspector_no_automatic_open'},ignoredObsoleteContracts:{nativeReportBridge:!!config.nativeReportBridge,clientReceiptContract:!!config.clientReceiptContract},paidRequested:records(host).list('round2-weekly').some(j=>j.requestId&&!oldWeeklyRequests.has(j.requestId)),newWeeklyRequestIds:records(host).list('round2-weekly').map(j=>j.requestId).filter(x=>x&&!oldWeeklyRequests.has(x))};
  await service.archiveFileSafe(`audience/${id}/${sha256(token).slice(7)}/main-consumer-${sha256(canonical(outcome)).slice(7)}.json`,canonical(outcome));records(host).transaction(()=>records(host).put('main-audience-todo',{...row,status:result.pending||jobs.length?'pending_receipt_or_main_reply':'completed',result:outcome}));return outcome;
 }catch(error){const previous=records(host).get('main-audience-todo',token,true),failures=(previous?.publicPortFailures??existing?.publicPortFailures??0)+1;records(host).transaction(()=>records(host).put('main-audience-todo',{...row,status:'pending_reconcile',publicPortFailures:failures,error:{code:error.code??'MAIN_CONSUMER_FAILED',message:error.message}}));if(failures>=2){const saved=service.getDocument();service.mutate(saved.revision,next=>{next.control.running=false;next.control.phase='main_audience_public_port_failure_paused';next.control.mainAudienceCheckpoint={todoId:token,engineVersion:e.version,cutoffMs:view.cutoffMs};});}throw error;}
}
