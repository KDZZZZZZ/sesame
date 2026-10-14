// Replayable MAIN tool workflow. Never installs/loads during activation or role tasks.
import { canonical,sha256 } from './experiment-profiles.js';
import { createAnalysisPlan,PROPOSED_METHODS,verifyMethodUse,generalMethodBrief } from './analysis-plan.js';
const fail=(code,m)=>{throw Object.assign(new Error(m),{code});};
const allowed=new Set(PROPOSED_METHODS.map(m=>m.pluginId));
function decoded(raw){if(raw?.isError)fail('METHOD_TOOL_ERROR','Public plugin manager returned tool error');const candidates=[raw,raw?.details,raw?.result];for(const item of raw?.content??[])if(item.type==='text'){try{candidates.push(JSON.parse(item.text));}catch{}}
 const out=candidates.find(x=>Array.isArray(x)||(x&&typeof x==='object'&&(x.catalog_digest||x.items||x.plugin_id||x.runtime_status||x.runtimeStatus||x.status||x.plugins))); if(!out)fail('UNSUPPORTED_TOOL_RESULT','Public manager result envelope unavailable; preserve diagnostic, do not infer success');return out;}
export async function methodWorkflow(host,service,args,signal){
 const {action,command_id,plugin_id,catalog_command_id,catalog_digest,authorize_install=false,record}=args;
 if(action==='status')return {plan:service.getDocument()?.analysisPlan??createAnalysisPlan(),records:host.storage.list('method-workflow').map(r=>({commandId:r.id,input:r.input,status:r.status,error:r.error??null}))};
 if(!command_id||!/^[A-Za-z0-9_-]{1,128}$/.test(command_id))fail('INVALID_ID','Stable workflow command required');
 const input={...args};delete input.command_id;const fingerprint=sha256(canonical(input)),old=host.storage.get('method-workflow',command_id,true);
 if(old){if(old.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT','Workflow id content differs');if(old.status==='completed')return old.result;if(['submitting','unknown'].includes(old.status)&&['install','load'].includes(action))fail('METHOD_OPERATION_UNKNOWN','Unknown side-effect result; inspect public status before explicit new operation, no blind replay');}
 if(action!=='adopt'&&!allowed.has(plugin_id))fail('METHOD_NOT_DECLARED','Method must be explicitly declared by portable package plan');
 const row={id:command_id,runId:service.getDocument?.()?.engine.id??null,input,fingerprint,status:'submitting'};host.storage.transaction(()=>host.storage.put('method-workflow',row));
 try{
  let result;
  if(action==='adopt'){
   const adopted=await verifyMethodUse(host,record,signal),brief=generalMethodBrief({appliedMethods:[adopted]});
   const doc=service.getDocument();if(!doc||doc.control.running||doc.control.active||doc.control.recovery||doc.engine.version!==1)fail('DECISION_PENDING','Adopt general-risk method only before new-run consumption');
   service.mutate(doc.revision,d=>{const plan=d.analysisPlan??createAnalysisPlan();if(!plan.appliedMethods.some(m=>m.outputRef.digest===adopted.outputRef.digest))plan.appliedMethods.push(adopted);d.analysisPlan=plan;d.generalMethodBrief=generalMethodBrief(plan);});result={adopted,roleBrief:brief,predictiveValidity:'unverified'};
  }else{
   let name,arguments_;
   if(action==='catalog'){name='plugin_catalog';arguments_={plugin_id};}
   else if(action==='discover'){name='plugin_discover';arguments_={query:plugin_id};}
   else if(action==='inspect'){name='plugin_inspect';arguments_={plugin_id};}
   else if(action==='install'){
    if(!authorize_install)fail('INSTALL_NOT_AUTHORIZED','Future explicit authorization required; no implicit analysis package installation');
    const previous=host.storage.get('method-workflow',catalog_command_id,true),catalog=previous?.result?.decoded;
    if(previous?.status!=='completed'||previous.input.action!=='catalog'||previous.input.plugin_id!==plugin_id||catalog?.catalog_digest!==catalog_digest||!catalog.items?.some(i=>i.id===plugin_id))fail('CATALOG_EVIDENCE_REQUIRED','Exact successful public catalog snapshot required');
    name='plugin_install_catalog';arguments_={command_id,plugin_id,catalog_digest,action:'install'};
   }else if(action==='load'){name='plugin_load';arguments_={plugin_id};}else fail('INVALID_ACTION','Unknown method workflow action');
   signal?.throwIfAborted();const raw=await host.tools.call({pluginId:'sesame/plugin-manager',name,arguments:arguments_},signal);const value=decoded(raw);result={action,pluginId:plugin_id,raw,decoded:value,adopted:false,diagnostic:'Catalog/discovery/install/load not method execution or predictive validation'};
  }
  await service.archiveSafe('method_workflow',{commandId:command_id,input,result});host.storage.transaction(()=>host.storage.put('method-workflow',{...row,status:'completed',result}));return result;
 }catch(error){host.storage.transaction(()=>host.storage.put('method-workflow',{...row,status:['install','load'].includes(action)?'unknown':'failed',error:{code:error.code??'METHOD_WORKFLOW_FAILED',message:error.message}}));throw error;}
}
