import { AsyncLocalStorage } from 'node:async_hooks';
const calls=new AsyncLocalStorage(),locks=new Map();
export const capability=(name,execute)=>({name,execute:(input,signal,execution)=>calls.run(execution,()=>execute(input,signal))});
export const currentExecution=()=>calls.getStore();
export function currentTask() {const agent=currentExecution()?.provenance?.agent;return agent?{id:agent.runId,pluginId:agent.pluginId,status:agent.status,conversationId:agent.sessionId,input:agent.input}:null;}
export async function exclusive(host,action){const key=host.context.storageRoot,task=(locks.get(key)??Promise.resolve()).catch(()=>{}).then(action);locks.set(key,task);try{return await task;}finally{if(locks.get(key)===task)locks.delete(key);}}
