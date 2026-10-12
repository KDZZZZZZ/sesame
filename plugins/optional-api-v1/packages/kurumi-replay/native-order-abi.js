// Shared CORE producer ABI guard. Viewer owns DTO projection; this never invents
// legacy requests/working state or demands callbacks the native engine didn't emit.
export const NATIVE_ORDER_ABI='kurumi.native-order-trace@1';
const statuses={INITIALIZED:'pending',SUBMITTED:'pending',ACCEPTED:'working',TRIGGERED:'working',PARTIALLY_FILLED:'partially_filled',FILLED:'filled',PENDING_CANCEL:'cancel_pending',CANCELED:'cancelled',REJECTED:'rejected',DENIED:'rejected',EXPIRED:'expired',PENDING_UPDATE:'working'};
const fail=m=>{throw Object.assign(Error(m),{code:'NATIVE_ORDER_ABI_MISMATCH'});};
function integer(s){if(typeof s!=='string'||!/^\d+$/.test(s))fail('Native request/filled/remaining must retain nonnegative integer base units');return BigInt(s);}
export function validateNativeOrderABI(state,{asOfMs=state?.nativeOrderTraceCoverage?.asOfMs}={}){
 const rows=state?.nativeOrderTrace,c=state?.nativeOrderTraceCoverage;if(!Array.isArray(rows)||c?.complete!==true)return {complete:false,reason:'No actual native lifecycle coverage; legacy remains unknown'};
 if(c.engineVersion!==state.version||!Number.isSafeInteger(asOfMs)||c.asOfMs!==asOfMs||c.eventCount!==rows.length||(c.abi&&c.abi!==NATIVE_ORDER_ABI))fail('Exact version/cutoff/event-count native coverage required');
 const seen=new Map(),ids=new Set();for(const r of rows){if(typeof r.id!=='string'||ids.has(r.id))fail('Unique actual native event identity required');ids.add(r.id);if(typeof r.nativeClientOrderId!=='string'||!r.nativeClientOrderId||!Number.isSafeInteger(r.chapter)||r.chapter<0||!state.chapters?.[r.chapter]||typeof r.parentDecisionId!=='string'||!r.parentDecisionId||typeof r.decisionId!=='string'||!r.decisionId)fail('Actual chapter/native order/parent attribution required');
  if(!Number.isSafeInteger(r.time)||!Number.isSafeInteger(r.createdAt)||r.createdAt>r.time||r.time>asOfMs)fail('Actual lifecycle source clock exceeds consumed frontier');if(r.instrument!==state.chapters[r.chapter].symbol||typeof r.nativeInstrumentId!=='string'||!r.nativeInstrumentId||!['buy','sell'].includes(r.side)||statuses[r.nativeStatus]!==r.status)fail('Actual instrument/side/native lifecycle state mismatch');
  const q=integer(r.quantity),f=integer(r.filledQuantity),remain=integer(r.remainingQuantity);if(q<=0n||q!==f+remain)fail('Requested != accumulated filled + actual remaining');if(r.status==='filled'&&remain!==0n)fail('FILLED requires no remaining');if(!['market','stop'].includes(r.orderType)||(r.orderType==='stop'&&(typeof r.stopPrice!=='string'||!r.reduceOnly)))fail('Actual protective order type/stop/reduce-only required');
  const key=r.chapter+':'+r.nativeClientOrderId,old=seen.get(key);if(old&&(r.time<old.time||r.createdAt!==old.createdAt||r.parentDecisionId!==old.parentDecisionId||r.side!==old.side||r.instrument!==old.instrument||f<integer(old.filledQuantity)))fail('Actual identity/chronology/cumulative fill changed');seen.set(key,r);
 }
 return {abi:NATIVE_ORDER_ABI,complete:true,eventCount:rows.length,orders:seen.size,asOfMs,source:'actual native order objects/callbacks; no inferred working state'};
}
