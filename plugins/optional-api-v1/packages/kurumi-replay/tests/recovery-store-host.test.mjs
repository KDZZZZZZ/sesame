// TEST ONLY: genuine Store CLOSED / REOPENED, isolated demo financial engine.
// No private production database, network, environment install or model request.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {ReplayService} from '../service.js';
import {createReferenceRun,decideReferenceAndAdvance,snapshotReference} from '../engine.js';
import {auditLedger} from '../ledger.js';
const app=process.env.KURUMI_DISPLAY_HOST_APP;
const time=Date.UTC(2014,4,14),bar=time=>({time,bid:{open:'95',high:'95.1',low:'94.9',close:'95'},ask:{open:'95.01',high:'95.11',low:'94.91',close:'95.01'}});
const data={chapters:['AUDJPY','USDJPY','EURCHF'].map(symbol=>({symbol,startIndex:0,endIndex:2})),frames:[0,1,2].map(()=>[bar(time),bar(time+3600000),bar(time+7200000)]),digests:{fixture:'DEMO-only'},provenance:{kind:'demo'}};
const model={provider:'openai',id:'gpt-6.1-sol',configurationDigest:'sha256:'+'1'.repeat(64)};
async function setup(t){
 const imp=p=>import(pathToFileURL(join(app,p)).href);await imp('modules/plugins/sdk-loader.js');
 const {Store}=await imp('modules/agent/store.js'),{Runtime}=await imp('modules/agent/runtime.js'),{createHostContext}=await imp('modules/plugins/context.js');
 const root=await mkdtemp(join(tmpdir(),'kurumi-recovery-reopen-'));let store,runtime,service,host,advances=0;
 const decision={id:'saved-task:decision',runId:'demo-recovery',stepId:'demo-recovery:0:0',expectedVersion:1,target:'1000',stop:null,reason:'DEMO lifecycle test only',utterance:'DEMO'};
 const task={id:'saved-task',requestId:'saved-task',status:'completed',model,toolCalls:[{name:'kurumi_decide',status:'failed'}]};
 async function open(){
  store=new Store(join(root,'state'));runtime=new Runtime(store,{piDir:join(root,'pi'),officialPluginsDirectory:join(root,'empty')});await runtime.init();
  host=createHostContext(runtime,{id:'sesame/kurumi-replay',version:'0.1.1-dev.3',digest:'sha256:'+'0'.repeat(64)},'conv_main');
  service=new ReplayService({...host,agents:{inspect:()=>task,submit:()=>{throw Error('NO PAID TASK ALLOWED');}}});service.data=data;service.accountSnapshot=snapshotReference;service.verifyBackend=async()=>({ready:true});service.chooseModel=()=>model;
  service.advance=async(dir,state,decision)=>{advances++;return decideReferenceAndAdvance(state,decision,data.frames[state.chapter]);};
 }
 async function close(){await service.dispose();await runtime.close();store.close();}
 await open();host.storage.put('challenge',{id:'continuous',revision:1,engine:createReferenceRun('demo-recovery',data.chapters,data.digests),commands:{},control:{phase:'paused',running:false,remaining:0,active:null,attempt:0},model,roleEvidence:[{taskId:task.id,requestId:task.requestId,model,decision,status:'failed_not_committed',error:{code:'OLD_NATIVE_ERROR',message:'original failure preserved'}}]});
 t.after(async()=>{await close();await rm(root,{recursive:true,force:true});});
 return {get service(){return service;},get host(){return host;},get advances(){return advances;},decision,close,open,
  recover:id=>service.recover({command_id:id,expected_version:service.status().revision,decision_id:decision.id}),
  reconcile:id=>({command_id:id,expected_version:service.status().revision})};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('real Store reopen: interrupted recovery only reconciles, explicit new recovery commits once; duplicate commands never book twice',{skip:!app},async t=>{
 const f=await setup(t);let finish;const original=f.service;
 original.advance=async(dir,state,decision)=>new Promise(resolve=>{finish=()=>resolve(decideReferenceAndAdvance(state,decision,data.frames[state.chapter]));});
 const pending=f.recover('interrupted-recover');const rejected=assert.rejects(pending,{code:'INTERRUPTED'});await flush();
 const guard=f.service.getDocument().control.recovery;assert.equal(guard.originalEngineVersion,1);assert.equal(guard.decisionId,f.decision.id);
 await assert.rejects(f.service.prepare(),/活跃回合/);assert.throws(()=>f.service.reconcile(f.reconcile('live-reconcile')),{code:'DECISION_PENDING'});
 await f.close();finish();await rejected;await f.open();await f.service.initialize();
 assert.equal(f.service.status().control.phase,'recovery_requires_reconcile');assert.equal(f.service.status().recovery.requiresReconcile,true);assert.equal(f.advances,0);
 assert.throws(()=>f.service.start({command_id:'blocked-start',expected_version:f.service.status().revision}),{code:'DECISION_PENDING'});
 await assert.rejects(f.recover('blocked-recover'),{code:'DECISION_PENDING'});await assert.rejects(f.service.prepare(),/活跃回合/);
 const before=f.service.getState(),args=f.reconcile('reconcile-uncommitted');const result=f.service.reconcile(args);
 assert.equal(result.reconciliation.status,'not_committed');assert.deepEqual(f.service.getState(),before);assert.equal(f.service.getDocument().recoveries[0].status,'interrupted_not_committed');assert.ok(f.service.getDocument().recoveries[0].interruptedAt);assert.equal(f.service.getDocument().roleEvidence[0].error.code,'OLD_NATIVE_ERROR');
 const revision=f.service.status().revision;f.service.reconcile(args);assert.equal(f.service.status().revision,revision);
 // Original interrupted operation is consumed; retry needs a new explicit ID.
 await original.dispose();await f.service.recover({command_id:'interrupted-recover',expected_version:1,decision_id:f.decision.id});assert.equal(f.advances,0);
 const retry={command_id:'explicit-recover-after-reconcile',expected_version:f.service.status().revision,decision_id:f.decision.id};await f.service.recover(retry);await f.service.recover(retry);
 assert.equal(f.advances,1);assert.equal(f.service.getState().decisions.length,1);assert.equal(f.service.getState().fills.length,1);auditLedger(f.service.getState());
 f.service.reconcile(f.reconcile('reconcile-after-commit'));assert.equal(f.advances,1);assert.equal(f.service.getState().decisions.length,1);
 await f.close();await f.open();await f.service.initialize();await f.service.recover(retry);assert.equal(f.advances,1);
 console.log(JSON.stringify({layer:'real-Store-close-reopen-demo-lifecycle',noNetwork:true,paidTasks:0,advances:f.advances,decisions:1,fills:1}));
});
test('real Store reopen: committed financial candidate with legacy retained recovery guard is reported, never replayed',{skip:!app},async t=>{
 const f=await setup(t),before=f.service.getState();
 // Isolated fault fixture: actual calculated DEMO ledger commit with retained
 // legacy reservation. No manufactured fills/cash and no production DB access.
 const after=decideReferenceAndAdvance(before,f.decision,data.frames[0]);auditLedger(after);
 f.service.mutate(undefined,d=>{d.engine=after;d.control.recovery={commandId:'legacy',decisionId:f.decision.id};d.recoveries=[{commandId:'legacy',decisionId:f.decision.id,status:'matching'}];});
 await f.close();await f.open();await f.service.initialize();const committed=f.service.getState();
 const args=f.reconcile('already-committed-reconcile');const result=f.service.reconcile(args);assert.equal(result.reconciliation.status,'committed');assert.deepEqual(f.service.getState(),committed);assert.equal(f.service.status().recovery,null);assert.equal(f.service.getDocument().roleEvidence[0].status,'recovered_committed');
 f.service.reconcile(args);f.service.reconcile(f.reconcile('already-committed-again'));assert.deepEqual(f.service.getState(),committed);
 await assert.rejects(f.recover('do-not-replay'),{code:'RECOVERY_NOT_ALLOWED'});assert.equal(f.advances,0);
 await f.close();await f.open();await f.service.initialize();assert.deepEqual(f.service.getState(),committed);
});
test('real Store reopen: ambiguous engine version keeps guard, actionable diagnostics, prepare/recover/start remain blocked',{skip:!app},async t=>{
 const f=await setup(t);f.service.mutate(undefined,d=>{d.engine.version++;d.control.recovery={commandId:'ambiguous',decisionId:f.decision.id,originalEngineVersion:1};d.recoveries=[{commandId:'ambiguous',status:'matching'}];});
 await f.close();await f.open();await f.service.initialize();const before=f.service.getState(),args=f.reconcile('unknown-reconcile');
 const result=f.service.reconcile(args);assert.equal(result.reconciliation.status,'unknown');assert.match(result.error,/kurumi_export/);assert.ok(result.recovery);assert.deepEqual(f.service.getState(),before);
 f.service.reconcile(args);f.service.reconcile(f.reconcile('unknown-new-observation'));assert.ok(f.service.status().recovery);
 await assert.rejects(f.service.prepare(),/活跃回合/);await assert.rejects(f.recover('unknown-recover'),{code:'DECISION_PENDING'});assert.throws(()=>f.service.start({command_id:'unknown-start',expected_version:f.service.status().revision}),{code:'DECISION_PENDING'});assert.equal(f.advances,0);
});

test('real Store reopen: missing original evidence remains diagnosable without fabricated origin version',{skip:!app},async t=>{
 const f=await setup(t);f.service.mutate(undefined,d=>{d.roleEvidence=[];d.control.recovery={commandId:'missing-origin',decisionId:'missing-decision'};});
 await f.close();await f.open();await f.service.initialize();const result=f.service.reconcile(f.reconcile('missing-origin-reconcile'));
 assert.equal(result.reconciliation.status,'unknown');assert.equal(result.recovery.originalEngineVersion,null);assert.ok(result.recovery.requiresReconcile);assert.equal(f.service.getState().balance,'300000');assert.equal(f.advances,0);
});
test('real Store reopen: a matching decision with non-reconciling money is unknown, never declared committed',{skip:!app},async t=>{
 const f=await setup(t),after=decideReferenceAndAdvance(f.service.getState(),f.decision,data.frames[0]);
 // Intentionally damaged isolated DEMO fault fixture; never used as success.
 f.service.mutate(undefined,d=>{d.engine=after;d.engine.balance='300001';d.control.recovery={commandId:'damaged-ledger',decisionId:f.decision.id};});
 await f.close();await f.open();await f.service.initialize();const before=f.service.getState(),result=f.service.reconcile(f.reconcile('damaged-ledger-reconcile'));
 assert.equal(result.reconciliation.status,'unknown');assert.match(result.error,/对账/);assert.ok(result.recovery);assert.deepEqual(f.service.getState(),before);assert.equal(f.advances,0);
});
