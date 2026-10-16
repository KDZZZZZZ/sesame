import { resolve } from 'node:path';
import { FileAccess } from './file-access.js';
export async function readUserFile(host,action,name,_content,signal) {if(action!=='read')throw new Error('This plugin only reads authored workspace inputs');return(await new FileAccess(host.context).bytes(resolve(host.context.workspaceRoot,name),{whole:true,signal})).bytes;}
export async function runProcess(host,argv,{cwd,signal,timeout=120,env}) {
 const launched=await host.capabilities.invoke('host.process.exec',{argv,cwd,timeoutMs:timeout*1000,...(env?{env}:{})},{signal});
 if(launched.type!=='run')throw new Error('Host process must create a Run');
 const abort=()=>{void Promise.resolve(host.runs.cancel(launched.run,{reason:'Caller cancelled'})).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try {if(signal?.aborted)abort();for(;;){const result=await host.runs.wait(launched.run,{until:'settled',timeoutMs:30000});if(result.reason==='timeout')continue;const run=result.run;if(run.status==='completed')return{...run.output,runId:run.id};if(run.error?.code==='PROCESS_EXIT')return{...run.error.details,runId:run.id};throw Object.assign(new Error(run.error?.message??run.status),{code:run.error?.code??'PROCESS_FAILED',details:run.error?.details});}}finally{signal?.removeEventListener('abort',abort);}
}
