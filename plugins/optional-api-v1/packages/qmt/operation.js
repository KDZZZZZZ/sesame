import { records } from './records.js';
const pending=new Map();
export async function once(host,key,fingerprint,action) {
 const db=records(host),old=db.get('operations',key,true),identity=host.context.storageRoot+'#'+key;
 if(old){if(old.fingerprint!==fingerprint)throw Object.assign(new Error('Operation ID belongs to different inputs'),{code:'IDEMPOTENCY_CONFLICT'});if(old.status==='completed')return old.result;if(pending.has(identity))return pending.get(identity);throw Object.assign(new Error(old.error?.message??'Prior operation did not complete; inspect its evidence before choosing a new operation ID'),{code:old.error?.code??'OUTCOME_UNKNOWN'});}
 db.put('operations',{id:key,fingerprint,status:'running'});
 const task=Promise.resolve().then(action).then(result=>{db.put('operations',{id:key,fingerprint,status:'completed',result});return result;},error=>{db.put('operations',{id:key,fingerprint,status:'failed',error:{code:error.code??'FAILED',message:error.message}});throw error;});pending.set(identity,task);try{return await task;}finally{pending.delete(identity);}
}
