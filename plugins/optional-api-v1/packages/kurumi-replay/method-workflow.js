import { records } from './records.js';
// Replayable MAIN tool workflow. Never installs/loads during activation or role tasks.
import { canonical,sha256 } from './experiment-profiles.js';
import { createAnalysisPlan,PROPOSED_METHODS,verifyMethodUse,generalMethodBrief } from './analysis-plan.js';
const fail=(code,m)=>{throw Object.assign(new Error(m),{code});};
const allowed=new Set(PROPOSED_METHODS.map(m=>m.pluginId));
export async function methodWorkflow(host,service,args,signal){
 const {action,command_id,plugin_id,package_path,package_digest,authorize_install=false,record}=args;
 if(action==='status')return {plan:service.getDocument()?.analysisPlan??createAnalysisPlan(),records:records(host).list('method-workflow').map(r=>({commandId:r.id,input:r.input,status:r.status,error:r.error??null}))};
 if(!command_id||!/^[A-Za-z0-9_-]{1,128}$/.test(command_id))fail('INVALID_ID','Stable workflow command required');
 const input={...args};delete input.command_id;const fingerprint=sha256(canonical(input)),old=records(host).get('method-workflow',command_id,true);
 if(old){if(old.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT','Workflow id content differs');if(old.status==='completed')return old.result;if(['submitting','unknown'].includes(old.status)&&['install','load'].includes(action))fail('METHOD_OPERATION_UNKNOWN','Unknown side-effect result; inspect public status before explicit new operation, no blind replay');}
 if(action!=='adopt'&&!allowed.has(plugin_id))fail('METHOD_NOT_DECLARED','Method must be explicitly declared by portable package plan');
 const row={id:command_id,runId:service.getDocument?.()?.engine.id??null,input,fingerprint,status:'submitting'};records(host).transaction(()=>records(host).put('method-workflow',row));
 try{
  let result;
  if(action==='adopt'){
   const adopted=await verifyMethodUse(host,record,signal),brief=generalMethodBrief({appliedMethods:[adopted]});
   const doc=service.getDocument();if(!doc||doc.control.running||doc.control.active||doc.control.recovery||doc.engine.version!==1)fail('DECISION_PENDING','Adopt general-risk method only before new-run consumption');
   service.mutate(doc.revision,d=>{const plan=d.analysisPlan??createAnalysisPlan();if(!plan.appliedMethods.some(m=>m.outputRef.digest===adopted.outputRef.digest))plan.appliedMethods.push(adopted);d.analysisPlan=plan;d.generalMethodBrief=generalMethodBrief(plan);});result={adopted,roleBrief:brief,predictiveValidity:'unverified'};
  }else{
   signal?.throwIfAborted();let value;
   if(action==='catalog'||action==='discover')value=await host.plugins.search({query:plugin_id,limit:200});
   else if(action==='inspect')value=await host.plugins.read(plugin_id,{part:'status'});
   else if(action==='install'){
    if(!authorize_install||!package_path)fail('INSTALL_NOT_AUTHORIZED','Explicit authorization and a package path are required');
    value=await host.plugins.install({id:plugin_id,path:package_path,...(package_digest?{digest:package_digest}:{})},{operationId:command_id,signal});
   }else if(action==='load')value=await host.plugins.setEnabled(plugin_id,true,{scope:'session',operationId:command_id});
   else fail('INVALID_ACTION','Unknown method workflow action');
   result={action,pluginId:plugin_id,result:value,adopted:false,diagnostic:'Discovery and installation are not method execution or predictive validation'};
  }
  await service.archiveSafe('method_workflow',{commandId:command_id,input,result});records(host).transaction(()=>records(host).put('method-workflow',{...row,status:'completed',result}));return result;
 }catch(error){records(host).transaction(()=>records(host).put('method-workflow',{...row,status:['install','load'].includes(action)?'unknown':'failed',error:{code:error.code??'METHOD_WORKFLOW_FAILED',message:error.message}}));throw error;}
}
