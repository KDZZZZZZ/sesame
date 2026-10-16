import { execute } from './worker.js';
export async function runWorker(host,payload,{signal,timeoutMs=120000}={}) {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Object.assign(new Error('Source worker deadline exceeded'),{code:'TIMEOUT'})),timeoutMs);
 try { return await execute(payload,{directory:host.context.storageRoot,pythonPath:host.context.pythonPath,signal:AbortSignal.any([controller.signal,...(signal?[signal]:[])])}); } finally {clearTimeout(timer);}
}
