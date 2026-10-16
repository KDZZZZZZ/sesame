import { records } from './records.js';
// LEGACY facts-only compatibility module, NOT the production normal-player path.
// Production canonical facts are round2-pk, public main read workflow only.
import { canonical,sha256 } from './experiment-profiles.js';
const C='experience-narration',clone=x=>structuredClone(x);
const fail=(code,m)=>{throw Object.assign(new Error(m),{code});};
function subtract(a,b){const d=x=>{const[w,f='']=x.split('.');return {n:BigInt(w+f),s:f.length};},x=d(a),y=d(b),s=Math.max(x.s,y.s);let n=x.n*10n**BigInt(s-x.s)-y.n*10n**BigInt(s-y.s),t=(n<0n?-n:n).toString().padStart(s+1,'0');if(s)t=t.slice(0,-s)+'.'+t.slice(-s);return(n<0n?'-':'')+t.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');}
export function queueNarration(host,service,context){
 const doc=service.getDocument();if(!doc?.experience)return {queued:false,reason:'not bounded experience'};
 const s=context.engine,hours=s.version-1,delta=s.fills.slice(context.previousEngine.fills.length),risk=delta.some(f=>['stop','stopout','bankruptcy_close'].includes(f.reason));
 if(hours%4!==0&&!risk&&!context.terminal&&!context.experiencePartial)return {queued:false,reason:'bounded key-event cadence'};
 const id=`${s.id}:narration:${s.version}`,old=records(host).get(C,id,true);if(old)return {queued:true,id,status:old.status,duplicate:true};
 const rows=records(host).list(C).filter(r=>r.runId===s.id);if(rows.length>=doc.experience.content.limits.maxNarrationEvents)return {queued:false,reason:'event budget'};
 const market=service.getReplayPresentation();
 const input={schemaVersion:1,runId:s.id,engineVersion:s.version,cutoffMs:context.replayCutoffMs,quoteTimeMs:context.quoteCutoffMs,
  event:risk?'risk_exit':context.experiencePartial?'bounded_partial_pause':context.terminal?'terminal':'4h_key_market_and_attack_defense',
  account:clone(context.account),targetJPY:'20000000',distanceToSettledTargetJPY:subtract('20000000',s.balance),
  market:(market?.bars??[]).filter(b=>b.asOf<=context.replayCutoffMs).slice(-12),actualFills:clone(s.fills.slice(-12)),actualOrders:clone(s.orders.slice(-12)),
  roleDecisions:clone(s.decisions.filter(r=>!r.decision.continuationOf).slice(-3)),originalComparison:clone(context.originalComparison??[]),
  evidence:{dataDigests:clone(s.dataDigests),profile:clone(s.rules.experimentProfile),classification:'spectator input; not a second trading role'},
  restrictions:['Chinese vivid PK commentary about evidenced market/actions/risk/errors/PnL pressure/goal distance only','Original claims remain uncertain intervals, no invented original account or fills','No future prices, no advice sent into trading-role context','Commentary cannot block/repeat/authorize a trade']};
 for(const f of input.actualFills)if(f.time>input.cutoffMs)fail('NARRATION_FUTURE_DATA','Future fill');
 const digest=sha256(canonical(input));records(host).transaction(()=>records(host).put(C,{id,runId:s.id,input,digest,status:'queued'}));return {queued:true,id,status:'queued'};
}
export function narrationStatus(host,runId){return records(host).list(C).filter(r=>!runId||r.runId===runId).map(r=>({id:r.id,status:r.status,inputDigest:r.digest,cutoffMs:r.input.cutoffMs,error:r.error??null,delivery:r.delivery??null}));}
// Deprecated extra-inference/writer worker: production always uses canonical
// round2-pk facts + actual main claim/ordinary response/read ACK. Keep old input
// archive/status inspection only; no second queue draining or implicit migration.
export async function drainNarration(){fail('NATIVE_MAIN_REPLY_REQUIRED','Use main-only kurumi_narration claim -> YOUR ordinary native paragraph -> ack/reconcile. No injected writer or extra inference worker exists in the player workflow.');}
