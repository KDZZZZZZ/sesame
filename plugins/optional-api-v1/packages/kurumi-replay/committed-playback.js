// Display committed real native facts as bounded chronological prefixes.
// Never matches/replays trades, requests models or derives prices from H1 OHLC.
import {validateNativeOrderABI} from './native-order-abi.js';
import { isDeepStrictEqual } from 'node:util';
import { snapshot } from './native-engine.js';
import { sha256,canonical } from './experiment-profiles.js';
const check=(ok,m)=>{if(!ok)throw Object.assign(new Error(m),{code:'PLAYBACK_EVIDENCE_MISMATCH'});};
export function playbackFrames(before,after,ticks,interval){
 const trace=after.lastPresentationTrace;if(!Array.isArray(trace)||!trace.length){const s=structuredClone(after);if(s.chapter!==interval.chapter){s.chapter=interval.chapter;s.index=interval.index;s.revealedFrameTime=interval.from;s.lastQuote=structuredClone(ticks.at(-1));delete s.nativeJournal;}s.visibleCutoffMs=interval.complete?interval.toExclusive:interval.lastTime;s.visibleQuoteTimeMs=interval.lastTime;return [{engine:s,sequence:ticks.length-1,cutoffMs:s.visibleCutoffMs,intervalComplete:interval.complete,unanimated:true}];}
 check(trace.length<=8,'Bounded actual mark trace exceeded');const frames=[];let seq=-1;const counts={fillCount:before.fills.length,orderCount:before.orders.length,ledgerCount:before.ledger.length,nativeOrderTraceCount:before.nativeOrderTrace?.length??0};
 for(let i=0;i<trace.length;i++){
  const p=trace[i];check(Number.isSafeInteger(p.sequence)&&p.sequence>seq&&p.sequence<ticks.length&&p.time===ticks[p.sequence].time&&isDeepStrictEqual(p.quote,ticks[p.sequence]),'Trace is not an actual consumed prefix');seq=p.sequence;
  for(const[key,max]of [['fillCount',after.fills.length],['orderCount',after.orders.length],['ledgerCount',after.ledger.length]])check(Number.isSafeInteger(p[key])&&p[key]>=counts[key]&&p[key]<=max,'Native trace count mismatch');
  for(const key of ['fillCount','orderCount','ledgerCount'])counts[key]=p[key];
  const final=i===trace.length-1;check(!final||seq===ticks.length-1,'Final trace must end at last consumed quote');
  const s=structuredClone(after);s.chapter=interval.chapter;s.index=interval.index;s.revealedFrameTime=interval.from;s.lastQuote=structuredClone(p.quote);s.position=structuredClone(p.position);s.balance=p.account.balance;
  if(s.nativeOrderTrace){check(Number.isSafeInteger(p.nativeOrderTraceCount)&&p.nativeOrderTraceCount>=counts.nativeOrderTraceCount&&p.nativeOrderTraceCount<=s.nativeOrderTrace.length,'Native lifecycle prefix count missing');s.nativeOrderTrace=s.nativeOrderTrace.slice(0,p.nativeOrderTraceCount);counts.nativeOrderTraceCount=p.nativeOrderTraceCount;}
  s.fills=s.fills.slice(0,p.fillCount);s.orders=s.orders.slice(0,p.orderCount);s.ledger=s.ledger.slice(0,p.ledgerCount);s.equity=structuredClone(before.equity);s.equity.push({chapter:interval.chapter,index:interval.index,time:p.time,...structuredClone(p.account),quantity:p.position?.quantity??'0',source:'actual-native-consumed-trace'});s.history=s.history.filter(h=>h.time!==undefined&&h.time<=p.time);s.bankrupt=!!p.bankrupt;s.outcome=s.bankrupt?'bankrupt':final?after.outcome:null;s.status=s.bankrupt?'complete':final&&after.chapter===interval.chapter?after.status:'paused';s.nativeReceipt=null;delete s.nativeJournal;delete s.lastPresentationTrace;
  const cutoff=final&&interval.complete?interval.toExclusive:p.time;s.visibleCutoffMs=cutoff;s.visibleQuoteTimeMs=p.time;if(s.nativeOrderTraceCoverage)s.nativeOrderTraceCoverage={...s.nativeOrderTraceCoverage,engineVersion:s.version,asOfMs:cutoff,actualQuoteTimeMs:p.time,eventCount:s.nativeOrderTrace.length};
  validateNativeOrderABI(s,{asOfMs:cutoff});
  const actual=snapshot(s,{time:interval.from});for(const k of ['balance','equity','unrealizedJpy','margin','freeMargin'])check(actual[k]===p.account[k],'Independent exact JS snapshot differs from native consumed mark '+k);
  frames.push({engine:s,sequence:seq,cutoffMs:cutoff,intervalComplete:final&&interval.complete});
 }return frames;
}
export function deltaBatch(engine,previousEngine,step,ticks,point,sequenceStart){
 const rows=ticks.slice(sequenceStart,point.sequence+1);check(rows.length>0,'Missing consumed delta');
 return {batchId:`${engine.id}_${engine.version}_${previousEngine.chapter}_${step.from}:p:${point.sequence}`,runId:engine.id,commitVersion:engine.version,chapter:previousEngine.chapter,symbol:previousEngine.chapters[previousEngine.chapter].symbol,from:step.from,toExclusive:step.to,cutoffMs:point.cutoffMs,sequenceStart,intervalComplete:point.intervalComplete,rows,sourceRefs:structuredClone(step.coverage?.sources??[]),sourceDigest:sha256(canonical(rows)),classification:'actual-native-consumed-prefix-playback'};
}
export function waitPlayback(ms,signal){if(!ms)return Promise.resolve();return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(t);reject(Object.assign(Error('Playback paused, no trading replay'),{code:'CANCELLED'}));};const t=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});}
