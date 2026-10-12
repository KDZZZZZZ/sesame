// Actual new native subprocess tests. Synthetic QuoteTicks, NOT historical/SDK/client acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun,decideAndAdvance,snapshot,validateDecision,consumedInterval } from '../native-engine.js';
import { getExperimentProfile,ROUND2_PROFILE_ID,canonical,sha256 } from '../experiment-profiles.js';
const root=dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const evidence=await fs.mkdtemp(join(root,'.round2-core-native-evidence-'));let serial=0;
const python=process.env.KURUMI_CORE_TEST_PYTHON;
assert.ok(python,'Explicit KURUMI_CORE_TEST_PYTHON required; no author environment assumption');
const H=3600000,T=Date.UTC(2024,0,8,10),f=Array.from({length:5},(_,i)=>({time:T+i*H}));
const decision=(s,target='1000',stop=null)=>({id:`d${s.version}`,runId:s.id,stepId:`${s.id}:${s.chapter}:${s.index}`,expectedVersion:s.version,target,stop,reason:'50x native fixture',utterance:'合成报价测试，不是真实角色'});
const tick=(time,bid='100',ask='100.02',fx)=>({time,bid,ask,...(fx?{fx}:{})});
const state=(profileId=ROUND2_PROFILE_ID,end=3)=>createRun('kurumi-00000000-0000-0000-0000-000000000002',[{symbol:'AUDJPY',startIndex:0,endIndex:end},{symbol:'USDJPY',startIndex:0,endIndex:end},{symbol:'EURCHF',startIndex:0,endIndex:end}],{kind:'synthetic-native50-fixture'},profileId?{profileId}:{});
async function invoke(request){
 const id=++serial;await fs.writeFile(join(evidence,`${id}-stdin.json`),JSON.stringify(request),{flag:'wx'});
 return new Promise((resolve,reject)=>{const c=spawn(python,[join(root,'native-engine.py')],{cwd:evidence,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});let out='',err='';c.stdout.setEncoding('utf8');c.stderr.setEncoding('utf8');c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x);c.on('error',reject);c.on('close',async code=>{try{await fs.writeFile(join(evidence,`${id}-stdout.json`),out,{flag:'wx'});await fs.writeFile(join(evidence,`${id}-stderr.log`),err,{flag:'wx'});const result=JSON.parse(out);if(code||!result.ok)throw Object.assign(Error(result.message),{code:result.code});resolve(result.state);}catch(e){reject(e);}});c.stdin.end(JSON.stringify(request));});
}
async function advance(s,ticks,target='1000',stop=null){const from=f[s.index+1].time;return decideAndAdvance(s,decision(s,target,stop),f,{invokeImpl:invoke,quoteTicks:ticks,coverage:{from,to:from+H,complete:true,dataKind:'quote_ticks',liquidityAssumption:'unbounded_top_of_book',provenance:'synthetic-fixture'}});}
test('50x frozen profile JS/Python matching/snapshot and legacy500 remain distinct',async()=>{
 const initial=state(),s=await advance(initial,[tick(f[1].time)]),snap=snapshot(s,f[1]);assert.equal(snap.leverage,'50');assert.equal(snap.stopout,'0.2');assert.equal(snap.margin,'2000.4');assert.equal(snap.freeMargin,'297976.6');assert.equal(s.equity.at(-1).margin,snap.margin);assert.equal(s.balance,'299997');assert.equal(s.fills[0].commission,'3');assert.deepEqual(s.nativeReceipt.chapterRules,getExperimentProfile(ROUND2_PROFILE_ID).content.chapterRules);
 const legacy=state(null);assert.deepEqual(legacy.rules.chapterRules.map(r=>r.leverage),['500','25','25']);const old=await advance(legacy,[tick(f[1].time)]);assert.equal(snapshot(old,f[1]).margin,'200.04');assert.equal(legacy.rules.experimentProfile,undefined);
 console.log(JSON.stringify({classification:'native_fixture',margin50:snap.margin,marginLegacy:snapshot(old,f[1]).margin,evidence}));
});
test('50x insufficient margin rejects target that legacy500 admits, no fee/fill on rejection',async()=>{
 const newRun=await advance(state(),[tick(f[1].time)],'1000000');assert.equal(newRun.orders[0].status,'rejected');assert.equal(newRun.position,null);assert.equal(newRun.balance,'300000');assert.equal(newRun.fills.length,0);
 const old=await advance(state(null),[tick(f[1].time)],'1000000');assert.equal(old.position.quantity,'1000000');assert.equal(old.equity.at(-1).margin,'200040');
});
test('native50 stopout uses unchanged chapter ratio on actual quote, no future suffix',async()=>{
 const ticks=[tick(f[1].time),tick(f[1].time+1000,'97.4','97.42'),tick(f[1].time+2000,'99','99.02')];
 const s=await advance(state(),ticks,'100000');assert.equal(s.fills[1].reason,'stopout');assert.equal(s.fills[1].price,'97.4');assert.equal(s.fills[1].time,ticks[1].time);assert.equal(s.position,null);assert.equal(s.balance,'37400');assert.equal(s.nativeReceipt.processedQuotes,3);
 console.log(JSON.stringify({classification:'native_fixture',stopoutRatio:'0.2',balance:s.balance,fillTime:s.fills[1].time}));
});
test('new50 chapter2 and CHFchapter3 margins agree, financing/FX60s unchanged',async()=>{
 let s=state(ROUND2_PROFILE_ID,1);s=await advance(s,[tick(f[1].time)],'0');assert.equal(s.chapter,1);s.chapters[1].endIndex=3;
 s=await advance(s,[tick(f[1].time)]);assert.equal(snapshot(s,f[1]).leverage,'50');assert.equal(s.equity.at(-1).margin,'2000.4');assert.equal(snapshot(s,f[1]).stopout,'0.5');
 // A checkpoint metadata change cannot pass native replay. Use independently created consistent chapters.
 let chf=state(ROUND2_PROFILE_ID,1);chf.chapters[2].endIndex=3;chf=await advance(chf,[tick(f[1].time)],'0');chf=await advance(chf,[tick(f[1].time)],'0');assert.equal(chf.chapter,2);
 const fx={time:f[1].time,bid:'160',ask:'160.2'};chf=await advance(chf,[tick(f[1].time,'1','1.0002',fx)]);const snap=snapshot(chf,f[1]);assert.equal(snap.margin,'3204.6408');assert.equal(snap.stopout,'0.3');assert.equal(chf.equity.at(-1).margin,snap.margin);
 const denied=await advance(chf,[tick(f[2].time,'1','1.0002',{time:f[2].time-60001,bid:'160',ask:'160.2'})]);assert.equal(denied.status,'missing_data');assert.equal(denied.version,chf.version);assert.deepEqual(denied.ledger,chf.ledger);
});
test('tampered50 content/digest/rules rejected JS and actual Python; no leverage patch bypass',async()=>{
 const legacy=state(null);for(const invalid of [null,0,{},[]]){const x=structuredClone(legacy);x.rules.experimentProfile=invalid;assert.throws(()=>validateDecision(x,decision(x)),{code:'RULES_MISMATCH'});}
 const original=state(),d=decision(original),bad=structuredClone(original);bad.rules.chapterRules[0].leverage='500';assert.throws(()=>validateDecision(bad,d),{code:'RULES_MISMATCH'});assert.throws(()=>snapshot(bad,f[0]),{code:'RULES_MISMATCH'});
 await assert.rejects(invoke({state:bad,step:{decision:d,previousTime:T,from:T+H,to:T+2*H,ticks:[tick(T+H)],coverage:{complete:true,from:T+H,to:T+2*H,dataKind:'quote_ticks',liquidityAssumption:'unbounded_top_of_book'}}}),{code:'RULES_MISMATCH'});
});
test('consumed-tick bridge after chapter transition and native checkpoint restart; duplicate decision no subprocess',async()=>{
 let s=state(ROUND2_PROFILE_ID,1),d=decision(s,'0');s=await advance(s,[tick(f[1].time),tick(f[1].time+1000)],'0');assert.equal(s.lastQuote,null);assert.equal(s.chapter,1);const info=await consumedInterval(evidence,s);assert.equal(info.interval.chapter,0);assert.equal(info.interval.lastTime,f[1].time+1000);assert.equal(info.ticks.length,2);
 const n=serial;assert.deepEqual(await decideAndAdvance(s,d,null,{invokeImpl:invoke}),s);assert.equal(serial,n);
 const restored=JSON.parse(canonical(s));const next=await advance(restored,[tick(f[1].time)],'0');assert.equal(next.chapter,2);assert.equal(next.rules.experimentProfile.digest,s.rules.experimentProfile.digest);
});
test('bounded immutable tick ref bridge verifies hash/identity without reading future execution data',async()=>{
 const s=await advance(state(),[tick(f[1].time),tick(f[1].time+1000)],'0'),step=s.nativeJournal.at(-1),bytes=Buffer.from(JSON.stringify(step.ticks));
 const dir=join(evidence,'kurumi-native','steps');await fs.mkdir(dir,{recursive:true});const file=join(dir,'consumed.json');await fs.writeFile(file,bytes);step.ticksRef={path:file,digest:sha256(bytes),bytes:bytes.length,rowCount:step.ticks.length};delete step.ticks;
 assert.equal((await consumedInterval(evidence,s)).ticks.length,2);await fs.writeFile(file,'[]');await assert.rejects(consumedInterval(evidence,s),{code:'HASH_MISMATCH'});
});
