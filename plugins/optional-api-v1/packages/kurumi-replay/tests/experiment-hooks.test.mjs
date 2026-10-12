// CORE+UI integration fixture: actual module APIs/awaits + independent storage/files.
// No SDK, client, models or native matching executed by this file.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
import { ReplayService } from '../service.js';
import { createRun } from '../native-engine.js';
import { Recorder } from '../recording.js';
import { ROUND2_PROFILE_ID } from '../experiment-profiles.js';import {createExperiencePlan} from '../experience-plan.js';
import { createTools } from '../index.js';
const root=dirname(fileURLToPath(new URL('../package.json',import.meta.url))),dirs=[];after(async()=>{for(const d of dirs)await fs.rm(d,{recursive:true,force:true});});
const clone=x=>structuredClone(x);
async function fixture(){const directory=await fs.mkdtemp(join(root,'.round2-core-hooks-'));dirs.push(directory);const rows=new Map();let paid=0;
 const host={scope:{kind:'service'},plugin:{id:'sesame/kurumi-replay',version:'0.1.3-dev.1',digest:'sha256:'+'1'.repeat(64)},storage:{directory,get(c,id,optional=false){const v=rows.get(c+':'+id);if(!v&&!optional)throw Error('Missing record');return v?clone(v):null;},list(c){return [...rows].filter(([k])=>k.startsWith(c+':')).map(([,r])=>clone(r));},put(c,r){rows.set(c+':'+r.id,clone(r));},transaction:fn=>fn()},agents:{submit(){paid++;throw Error('Paid forbidden');}},inference:{models(){paid++;throw Error('Paid forbidden');}},artifacts:{blob(b){return {digest:'sha256:'+'2'.repeat(64),size:Buffer.byteLength(b)};},publish(r){return {id:r.operationId,revision:'1',digest:'sha256:'+'2'.repeat(64),kind:r.manifest.kind,schemaVersion:'1.0.0'};}}};
 const s=new ReplayService(host);s.recorder=new Recorder(directory,{mirrorRoot:join(directory,'mirror')});await s.recorder.initialize();return {host,s,rows,get paid(){return paid;}};}
function pair({from=Date.UTC(2024,0,14,23),chapterEnded=false,terminal=false,partial=false}={}){
 const before=createRun('kurumi-00000000-0000-0000-0000-000000000003',['AUDJPY','USDJPY','EURCHF'].map(symbol=>({symbol,startIndex:0,endIndex:3})),{fixture:'hooks'},{profileId:ROUND2_PROFILE_ID}),after=clone(before),decision={id:'fixture-decision',runId:before.id,stepId:before.id+':0:0',expectedVersion:1,target:'0',stop:null,reason:'fixture',utterance:'fixture'};
 const ticks=[{time:from,bid:'95',ask:'95.02'},{time:from+12345,bid:'95.1',ask:'95.12'}];after.version=2;after.index=1;after.lastQuote=ticks.at(-1);after.revealedFrameTime=from;after.bankrupt=partial;
 after.nativeJournal.push({from,to:from+3600000,decision,coverage:{complete:true,sources:[]},ticks});after.decisions.push({decision,executedChapter:0,executedIndex:1,executionTime:from,resultingVersion:2});after.lastConsumedInterval={chapter:0,index:1,from,toExclusive:from+3600000,lastTime:ticks.at(-1).time,complete:!partial,rowCount:2};after.equity.push({chapter:0,index:1,time:ticks.at(-1).time,balance:'300000',equity:'300000',unrealizedJpy:'0',margin:'0',freeMargin:'300000',quantity:'0'});
 if(chapterEnded){after.chapter=1;after.index=0;after.lastQuote=null;after.revealedFrameTime=null;after.history.push({type:'chapter_end',chapter:0,index:1,time:ticks.at(-1).time,balance:'300000'});}
 if(terminal){after.status='complete';after.outcome=partial?'bankrupt':'not_reached';}
 return {before,after};
}
function seed(f,p){f.host.storage.put('challenge',{id:'continuous',revision:1,engine:p.before,settings:{decisionIntervalHours:4},commands:{},control:{running:false,active:null,recovery:null,continuation:null,phase:'paused'}});f.s.data={chapters:p.before.chapters,frames:[Array.from({length:10},(_,i)=>({time:p.after.nativeJournal[0].from+(i-1)*3600000,bid:{open:'95',high:'95',low:'95',close:'95'},ask:{open:'95.02',high:'95.02',low:'95.02',close:'95.02'}})),[],[]],digests:p.before.dataDigests};f.s.mutate(1,d=>{f.s.enqueueCommittedHooks(p.before,p.after);d.engine=p.after;});}
test('atomic committed outbox -> verified consumed-batch UI + weekly exact UTC boundary, no paid calls',async()=>{
 const f=await fixture(),p=pair();seed(f,p);const result=await f.s.dispatchCommittedHooks();assert.equal(result.processed,1);assert.equal(f.paid,0);
 const view=f.s.getReplayPresentation();assert.equal(view.bars.length,1);assert.equal(view.bars[0].bid.high,'95.1');assert.equal(view.bars[0].lastTickMs,p.after.lastConsumedInterval.lastTime);assert.equal(view.cutoffMs,p.after.nativeJournal[0].to);assert.equal(view.bars[0].isClosed,true);
 const weekly=f.host.storage.list('round2-weekly').filter(r=>r.id.startsWith('weekly_'));assert.equal(weekly.length,1);assert.equal(weekly[0].status,'queued');assert.equal(weekly[0].input.period.toMs,p.after.nativeJournal[0].to);assert.equal(weekly[0].input.closing.account.quoteTimeMs,p.after.lastConsumedInterval.lastTime);assert.equal(weekly[0].input.opening.account.balance,'300000');assert.equal(weekly[0].input.financial.reconciled,true);
 assert.equal((await f.s.dispatchCommittedHooks()).processed,0);assert.equal(f.paid,0);assert.equal(f.host.storage.list('round2-weekly').filter(r=>r.id.startsWith('weekly_')).length,1);
});
test('chapter settlement hooks freeze consumed chapter0 not reset chapter1 future clock',async()=>{
 const f=await fixture(),p=pair({from:Date.UTC(2024,0,8,10),chapterEnded:true});seed(f,p);await f.s.dispatchCommittedHooks();assert.equal(f.s.getReplayPresentation().bars[0].chapter,0);
 const row=f.host.storage.list('round2-weekly').find(r=>r.id.startsWith('weekly_'));assert.equal(row.input.period.chapter,0);assert.equal(row.input.period.finalPartial,true);assert.equal(row.input.closing.engineVersion,2);
});
test('terminal partial hour uses actual last consumed tick; no fictional close/future forming price',async()=>{
 const f=await fixture(),p=pair({from:Date.UTC(2024,0,8,10),terminal:true,partial:true});seed(f,p);await f.s.dispatchCommittedHooks();const view=f.s.getReplayPresentation();assert.equal(view.cutoffMs,p.after.lastConsumedInterval.lastTime);assert.equal(view.bars[0].isClosed,false);assert.equal(view.bars[0].consumedCount,2);assert.equal(f.paid,0);
});
test('post-CAS hook failure pauses but keeps financial commit; explicit retry drains same version exactly once',async()=>{
 const f=await fixture(),p=pair();seed(f,p);const publish=f.host.artifacts.publish;f.host.artifacts.publish=()=>{throw Error('isolated artifact failure');};await assert.rejects(f.s.dispatchCommittedHooks());assert.equal(f.s.getState().version,2);assert.equal(f.s.getDocument().control.running,false);assert.ok(f.s.getDocument().control.hookFailure);
 assert.equal(f.s.getReplayPresentation().bars.length,1);f.host.artifacts.publish=publish;
 const args={command_id:'hooks-retry',expected_version:f.s.getDocument().revision};const result=await f.s.retryCommittedHooks(args);assert.equal(result.processed,1);assert.deepEqual(await f.s.retryCommittedHooks(args),result);assert.equal(f.s.getReplayPresentation().bars.length,1);assert.equal(f.paid,0);assert.equal(f.s.getDocument().control.hookFailure,null);
});
test('restart initialize keeps pending hook outbox without any paid/transaction replay',async()=>{
 const f=await fixture(),p=pair();seed(f,p);const restarted=new ReplayService(f.host);restarted.recorder=f.s.recorder;await restarted.initialize();assert.equal(f.paid,0);assert.equal(f.host.storage.list('committed-hooks')[0].status,'pending');assert.equal(restarted.getState().version,2);
});
test('manifest/schema/factory names complete in main and subagent, new controller rejects subagent before service access',async()=>{
 const manifest=JSON.parse(await fs.readFile(join(root,'plugin.json'))),defs=JSON.parse(await fs.readFile(join(root,'tools.json')));
 for(const kind of ['main','subagent']){const host={scope:{kind},tools:{Type:{Optional:s=>({...s,fixtureOptional:true})},define:(name,description,props,handler)=>({name,description,props,handler})}};const tools=createTools(host);assert.deepEqual(tools.map(t=>t.name),manifest.tool_names);assert.deepEqual(defs.map(t=>t.name),manifest.tool_names);if(kind==='subagent')await assert.rejects(tools.find(t=>t.name==='kurumi_new_experiment').handler({}),{code:'SCOPE_DENIED'});}
 for(const n of ['kurumi_new_experiment','kurumi_archive_terminal','kurumi_bind_experiment_fx','kurumi_retry_committed_hooks'])assert.ok(manifest.main_tool_names.includes(n));
 console.log('Factory check is fixture-only; actual SDK/host activation remains pending');
});

test('bounded CORE4H driver pauses audience and freezes honest final partial at hard cap, no model/native calls',async()=>{
 const f=await fixture(),p=pair({from:Date.UTC(2024,0,8,10)});p.before.chapters[0].endIndex=8;p.after.chapters[0].endIndex=8;seed(f,p);f.s.mutate(undefined,d=>{d.experience=createExperiencePlan({maxPaidRoleDecisions:1,maxCommittedHours:4,maxStepsPerCommand:1,maxWeeklyGenerations:1});d.control.running=true;d.control.phase='continuation_ready';d.control.remaining=1;d.control.continuation={decisionId:'fixture-decision',remainingBars:3,committedCount:0};});await f.s.dispatchCommittedHooks();let advances=0;
 f.s.advance=async(directory,engine,decision)=>{advances++;const e=clone(engine),from=engine.nativeJournal.at(-1).to,ticks=[{time:from,bid:'95',ask:'95.02'},{time:from+12345,bid:'95.1',ask:'95.12'}];e.version++;e.index++;e.lastQuote=ticks.at(-1);e.revealedFrameTime=from;e.nativeJournal.push({from,to:from+3600000,decision:clone(decision),coverage:{complete:true,sources:[]},ticks});e.decisions.push({decision:clone(decision),executedChapter:0,executedIndex:e.index,executionTime:from,resultingVersion:e.version});e.lastConsumedInterval={chapter:0,index:e.index,from,toExclusive:from+3600000,lastTime:ticks.at(-1).time,complete:true,rowCount:2};e.equity.push({chapter:0,index:e.index,time:ticks.at(-1).time,balance:'300000',equity:'300000',unrealizedJpy:'0',margin:'0',freeMargin:'300000',quantity:'0'});return e;};
 assert.equal(await f.s.runContinuations({decisionId:'fixture-decision'}),3);assert.equal(advances,3);assert.equal(f.s.getState().version,5);assert.equal(f.s.getDocument().control.running,false);assert.equal(f.s.getDocument().control.continuation,null);assert.equal(f.s.getDocument().experience.pausedReason,'hard_hour_budget');assert.equal(f.paid,0);const weekly=f.host.storage.list('round2-weekly').filter(r=>r.id.startsWith('weekly_'));assert.equal(weekly.length,1);assert.equal(weekly[0].input.period.kind,'bounded_partial');assert.equal(weekly[0].input.period.finalPartial,true);assert.equal(weekly[0].status,'queued');assert.equal(f.s.getState().balance,'300000');
});
