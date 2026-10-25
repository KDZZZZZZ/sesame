import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCapabilities } from '../packages/auto-factor-mining/index.js';
import { fixture as createFixture, input, finished, poll, models, iso, rows } from '../packages/auto-factor-mining/tests/host-fixture.js';
import { evaluate } from '../packages/factor-evaluator/evaluator.js';
const fixture = options => createFixture({ evaluator: evaluate, ...options });
const own = (t,f) => { t.after(()=>f.runtime.dispose());return f; };
const resume = async (f, id) => {
 const read = await f.runtime.observed(f.main,id);
 return f.runtime.control(f.main,id,'resume',{interrupt_ids:read.interrupts.map(item=>item.id)});
};

test('v2 workflow uses real evaluator scores, declared Agent calls and native finalization/publication', async t=>{
 const f=own(t,await fixture()),run=await f.runtime.create(f.main,input()),done=await finished(f,run.id);
 assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.trials[0].metrics.validation.rankIC,1);assert.equal(Object.keys(done.holdout).length,1);
 assert.equal(f.requests.length,6);assert.ok(f.requests.every(request=>!['finalize','report'].includes(request.input.mode)));
 assert.equal(f.requests.find(request=>request.input.role==='reviewer').model.id,'review');
 assert.ok(f.requests.every(request=>request.allowedCalls.every(call=>['auto_factor_context','auto_factor_submit'].includes(call.capabilityId))));
 assert.equal(done.reportPending,false,JSON.stringify(done.reportError));assert.equal(done.report.ref.kind,'report');
 const html=await f.main.resources.read(done.report.ref,{part:'content',entry:done.report.entry});
 assert.match(Buffer.from(html.content,'base64').toString(),/SIMULATED/);
 assert.equal((await f.runtime.create(f.main,input())).id,run.id);
 await assert.rejects(f.runtime.create(f.main,{...input(),goal:'changed'}),/different frozen inputs/);
});

test('custom factor assignments omit advisory stages while retaining real evaluation, selection and holdout', async t => {
 const f=own(t,await fixture()),args=input();
 args.config.workflow={plan:null,hypothesis:{id:'quant',instructions:'Use only the frozen development evidence.'},code:{id:'quant'},review:null,reflection:null,selection:{id:'lead'}};
 const run=await f.runtime.create(f.main,args),done=await finished(f,run.id);
 assert.equal(done.status,'completed',JSON.stringify(done.error));
 assert.deepEqual(f.requests.map(request=>[request.input.role,request.input.mode]),[['quant','hypothesis'],['quant','code'],['lead','selection']]);
 assert.match(f.requests[0].instructions,/Use only the frozen development evidence/);
 assert.equal(done.trials[0].metrics.validation.rankIC,1);assert.equal(done.trials[0].review.source,'evaluator');
 assert.equal(done.trials[0].status,'accepted');assert.ok(done.selection.digest);assert.equal(Object.keys(done.holdout).length,1);
 const workflow=[...f.jobs.values()].find(job=>job.capability.endsWith('#auto_factor_workflow'));
 assert.deepEqual(workflow.options.task.collaboration.agents.map(member=>member.id),['quant','lead']);
 assert.equal(done.reflections.length,0);assert.deepEqual(done.completedRounds,[0]);
 assert.equal((await f.runtime.create(f.main,args)).id,run.id);assert.equal(f.requests.length,3);
 f.runtime.update(run.id,{config:{...done.config,workflow:{...done.config.workflow,reflection:{id:'added',title:'added',instructions:''}}}});
 assert.equal(f.runtime.dependencies(f.main,run.id).details.cause.code,'FROZEN_WORKFLOW_CHANGED');
});

test('omitting a factor reviewer never promotes a candidate rejected by the actual evaluator', async t => {
 const f=own(t,await fixture({onTask:async ({request,child,execution,runtime,job})=>{
  if(request.input.mode!=='code')return;
  await runtime.submit(child,request.input.runId,{candidate:{op:'constant',value:1},explanation:'A constant cannot pass real IC eligibility.'},new AbortController().signal,execution);
  job.finish({status:'completed',output:{text:'Constant candidate submitted.',model:request.model}});return 'hold';
 }})),args=input();args.config.workflow={review:null,reflection:null};
 const run=await f.runtime.create(f.main,args),done=await finished(f,run.id);
 assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.trials[0].eligible,false);
 assert.equal(done.trials[0].status,'rejected');assert.deepEqual(done.selection.trialIds,[]);
});

test('merged factor members retain distinct step identities and frozen assignments across Store reopen', async t => {
 let held=false;
 const f=own(t,await fixture({onTask:({request})=>{if(request.input.mode==='code'){held=true;return 'hold';}}})),args=input();
 args.config.workflow={plan:null,hypothesis:{id:'quant'},code:{id:'quant'},review:{id:'quant'},reflection:null,selection:{id:'lead'}};
 const run=await f.runtime.create(f.main,args);await poll(()=>held);await f.runtime.control(f.main,run.id,'pause');
 const original=f.runtime.get(run.id),coder=original.tasks.find(task=>task.mode==='code');
 const g=own(t,await fixture({storage:f.saved}));assert.equal(g.requests.length,0);
 await resume(g,run.id);const done=await finished(g,run.id);
 assert.equal(done.status,'completed',JSON.stringify(done.error));
 assert.deepEqual(done.config.workflow,original.config.workflow);assert.equal(done.workflow.id,original.workflow.id);
 assert.equal(done.tasks.find(task=>task.mode==='code').runRef.id,coder.runRef.id);
 assert.deepEqual(done.tasks.map(task=>[task.role,task.mode]),[['quant','hypothesis'],['quant','code'],['quant','review'],['lead','selection']]);
 assert.equal(new Set(done.tasks.map(task=>task.id)).size,4);assert.equal(new Set(done.tasks.map(task=>task.runRef.id)).size,4);
 assert.equal(g.requests.some(request=>request.input.mode==='hypothesis'),false);assert.ok(done.selection.digest);assert.equal(Object.keys(done.holdout).length,1);
 const graph=g.jobs.get(done.workflow.id).options.task.collaboration,pairs=graph.relationships.map(edge=>`${edge.from}:${edge.to}`);
 assert.equal(new Set(pairs).size,pairs.length);
});
test('PIT-invalid rows are rejected before any Agent dispatch',async t=>{
 const f=own(t,await fixture());f.datasets.get('data').rows[0].availableAt=iso(2);
 await assert.rejects(f.runtime.create(f.main,input()),/Point-in-time/);assert.equal(f.requests.length,0);
});
test('pause in a coder and explicit resume retain durable prior role outputs',async t=>{
 let held=false;const f=own(t,await fixture({onTask:({request})=>{if(request.input.mode==='code'){held=true;return 'hold';}}}));
 const run=await f.runtime.create(f.main,input());await poll(()=>held);await f.runtime.control(f.main,run.id,'pause');
 const original=f.runtime.get(run.id),coder=original.tasks.find(task=>task.mode==='code');
 assert.equal(original.report,undefined);assert.equal(original.status,'interrupted');
 const g=own(t,await fixture({storage:f.saved}));assert.equal(g.runtime.get(run.id).status,'interrupted');assert.equal(g.requests.length,0);
 await resume(g,run.id);const done=await finished(g,run.id);assert.equal(done.status,'completed',JSON.stringify(done.error));
 assert.ok(!g.requests.some(request=>['plan','hypothesis'].includes(request.input.mode)));assert.equal(done.generation,0);
 assert.equal(done.workflow.id,original.workflow.id);assert.equal(done.tasks.find(task=>task.mode==='code').runRef.id,coder.runRef.id);
 assert.equal(done.tasks.length,6,'Resuming an accepted role does not create another assignment');
 assert.ok(g.saved.emitted.some(event=>event.runId===done.workflow.id&&event.type==='progress'&&event.data.metrics?.reusedOutputs===2));
 for(const event of g.saved.emitted.filter(value=>value.runId===done.workflow.id&&value.type==='handoff')){
  assert.equal(g.jobs.get(event.data.fromRunId)?.parentRunId,done.workflow.id,'Prior-generation evidence is retained as a checkpoint, not a new workflow node');
  assert.equal(g.jobs.get(event.data.toRunId)?.parentRunId,done.workflow.id);
 }
});
test('shutdown preserves interrupted work and restart does not start models',async t=>{
 const f=own(t,await fixture({onTask:()=> 'hold'})),run=await f.runtime.create(f.main,input());await poll(()=>f.requests.length);await f.runtime.dispose();
 const g=own(t,await fixture({storage:f.saved}));assert.equal(g.runtime.get(run.id).status,'interrupted');assert.equal(g.requests.length,0);
 await resume(g,run.id);assert.equal((await finished(g,run.id)).status,'completed');
});
test('caller input cannot replace trusted Agent provenance and completed outputs cannot be rewritten',async t=>{
 let checked=false;const f=own(t,await fixture({onTask:async({request,child,execution,runtime})=>{
  if(request.input.mode!=='plan')return;const id=request.input.runId;
  assert.ok(runtime.context(child,id,'data',0,200,execution).rows.items.every(row=>row.time<=iso(9)));
  assert.throws(()=>runtime.context(child,id,'team',0,20,{provenance:{agent:{...execution.provenance.agent,input:{...request.input,role:'reviewer'}}}}),/registered running Agent/);
  await assert.rejects(runtime.submit(child,id,{runId:id,role:'supervisor'}),/registered running Agent/);
  const output={directions:['momentum'],stop:false,reason:'Fixed fixture direction'};await runtime.submit(child,id,output,undefined,execution);
  await assert.rejects(runtime.submit(child,id,{...output,reason:'rewrite'},undefined,execution),/different output/);checked=true;
 }}));const run=await f.runtime.create(f.main,input());assert.equal((await finished(f,run.id)).status,'completed');assert.ok(checked);
});
test('research completes its selected rounds and native report without an Agent call quota',async t=>{
 const f=own(t,await fixture()),args=input();args.config.rounds=3;
 const run=await f.runtime.create(f.main,args),done=await finished(f,run.id);
 assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.reflections.length,3);assert.ok(f.requests.length>12);
 assert.ok(f.requests.every(request=>!Object.hasOwn(request,'budget')));assert.equal(done.reportPending,false);assert.ok(done.selection);
});
test('model drift and frozen input corruption keep the same Run interrupted before model dispatch',async t=>{
 const f=own(t,await fixture({onTask:()=> 'hold'})),run=await f.runtime.create(f.main,input());await poll(()=>f.requests.length);await f.runtime.control(f.main,run.id,'pause');
 const changed={...f.main,context:{...f.main.context,models:models.map(model=>({...model,configurationDigest:'changed'}))}};
 const before=f.requests.length,workflow=f.runtime.get(run.id).workflow.id;
 assert.equal(f.runtime.dependencies(changed,run.id).available,false);
 const originalModels=f.main.context.models;f.main.context.models=changed.context.models;
 await resume(f,run.id);assert.equal(f.runtime.get(run.id).status,'interrupted');f.main.context.models=originalModels;
 const data=f.runtime.checkpoints.dataset(run.id);data.dataset.rows[0].fields.close=999;await f.runtime.checkpoints.setDataset(run.id,data);
 await resume(f,run.id);assert.equal(f.runtime.get(run.id).status,'interrupted');
 assert.equal(f.requests.length,before);assert.equal(f.runtime.get(run.id).workflow.id,workflow);
});
test('cancelled work retains only development checkpoints and does not fabricate a final report',async t=>{
 const f=own(t,await fixture({onTask:()=> 'hold'})),run=await f.runtime.create(f.main,input());await poll(()=>f.requests.length);await f.runtime.control(f.main,run.id,'pause');
 await assert.rejects(f.runtime.report(f.main,run.id),{code:'REPORT_UNAVAILABLE'});
 const done=await f.runtime.control(f.main,run.id,'cancel');assert.equal(done.status,'cancelled');assert.equal(done.report,undefined);
 assert.equal(done.holdout,undefined);assert.equal(done.data.holdoutMetrics,undefined);
});
test('report reads return the same artifact without republishing or recreating host-bound files',async t=>{
 const f=own(t,await fixture()),run=await f.runtime.create(f.main,input()),done=await finished(f,run.id),size=f.saved.resources.size,artifacts=f.saved.artifacts.size;
 for(let i=0;i<3;i++)assert.deepEqual(await f.runtime.report(f.main,run.id),done.report);
 assert.equal(f.saved.resources.size,size);assert.equal(f.saved.artifacts.size,artifacts);
});
test('unsettled research cannot publish and completed assignments cannot submit after same-Run resume',async t=>{
 let old;const f=own(t,await fixture({onTask:value=>{if(!old){old=value;return 'hold';}}})),run=await f.runtime.create(f.main,input());await poll(()=>old);
 f.runtime.update(run.id,{status:'completed'});await assert.rejects(f.runtime.report(f.main,run.id),{code:'REPORT_UNAVAILABLE'});f.runtime.update(run.id,{status:'running'});
 await f.runtime.control(f.main,run.id,'pause');await resume(f,run.id);
 const done=await finished(f,run.id);assert.equal(done.status,'completed');
 assert.throws(()=>f.runtime.context(old.child,run.id,'team',0,20,old.execution),/registered running Agent/);
});
test('an explicit evaluator rejection permits candidate correction without accepting model metrics',async t=>{
 let corrected=false;const f=own(t,await fixture({onTask:async({request,child,execution,runtime})=>{if(request.input.mode!=='code')return;await assert.rejects(runtime.submit(child,request.input.runId,{candidate:{op:'invalid'},explanation:'Rejected'},undefined,execution),error=>error.code==='EVALUATION_REJECTED');corrected=true;}}));
 const run=await f.runtime.create(f.main,input()),done=await finished(f,run.id);assert.ok(corrected);assert.equal(done.status,'completed');assert.equal(done.trials[0].metrics.validation.rankIC,1);
});
test('selected qualified research capability IDs are frozen and disable holdout claims',async t=>{
 const f=own(t,await fixture());f.manifests.set('third-party/research',{id:'third-party/research',version:'1',revision:'fixed',capabilities:[{id:'search',consumers:['agent','host']},{id:'configure',consumers:['host']}]});
 f.datasets.get('data').rows=rows.filter(row=>row.time<=iso(9));const args=input();args.config.research={plugins:['third-party/research'],tools:['third-party/research#search']};
 const run=await f.runtime.create(f.main,args),done=await finished(f,run.id);assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.data.holdoutMode,'none');assert.deepEqual(done.holdout,{});
 assert.ok(f.requests.every(request=>request.allowedCalls.some(call=>call.pluginId==='third-party/research'&&call.capabilityId==='search')));
});

test('selected knowledge-only methods reach all roles without granting a callable evaluator or extra tools',async t=>{
 const f=own(t,await fixture());
 f.manifests.set('third-party/factor-method',{id:'third-party/factor-method',version:'1',revision:'method-v1',capabilities:[],knowledge:[{id:'method',kind:'prompt',path:'prompt.md'}]});
 const args=input();args.config.research={plugins:['third-party/factor-method'],tools:[]};
 const run=await f.runtime.create(f.main,args),done=await finished(f,run.id);
 assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.data.holdoutMode,'workflow-isolated');
 assert.equal(done.finalEvaluation.holdoutStatus,'evaluated');assert.equal(Object.keys(done.holdout).length,1);
 assert.equal(f.requests.length,6);
 for(const request of f.requests){
  assert.deepEqual(request.plugins,['third-party/factor-method','sesame/plugin-manager']);
  assert.deepEqual(request.allowedCalls.map(call=>call.capabilityId),['auto_factor_context','auto_factor_submit','plugin_read']);
 }
});

test('an explicitly selected public knowledge reader does not expose holdout observations',async t=>{
 const f=own(t,await fixture()),args=input();
 args.config.research={plugins:['sesame/plugin-manager'],tools:['sesame/plugin-manager#plugin_read']};
 const run=await f.runtime.create(f.main,args),done=await finished(f,run.id);
 assert.equal(done.status,'completed',JSON.stringify(done.error));assert.equal(done.data.holdoutMode,'workflow-isolated');
 assert.equal(done.finalEvaluation.holdoutStatus,'evaluated');
 assert.ok(f.requests.every(request=>request.allowedCalls.filter(call=>call.capabilityId==='plugin_read').length===1));
});

test('missing knowledge reader interrupts before member dispatch and its repair resumes retained evaluator work',async t=>{
 let prepares=0;const f=own(t,await fixture({onEvaluate:args=>{if(args.action==='prepare')prepares++;}}));
 const reader=f.manifests.get('sesame/plugin-manager');f.manifests.delete('sesame/plugin-manager');
 f.manifests.set('third-party/method',{id:'third-party/method',version:'1',revision:'method-v1',capabilities:[]});
 const args=input();args.config.research={plugins:['third-party/method'],tools:[]};
 const run=await f.runtime.create(f.main,args),paused=await finished(f,run.id);
 assert.equal(paused.status,'interrupted');assert.equal(f.requests.length,0);assert.equal(paused.report,undefined);
 assert.match(f.runtime.dependencies(f.main,run.id).reason,/sesame\/plugin-manager/);
 f.manifests.set('sesame/plugin-manager',reader);await resume(f,run.id);
 const done=await finished(f,run.id);assert.equal(done.status,'completed');assert.equal(prepares,1);
 assert.equal(done.workflow.id,paused.workflow.id);assert.equal(done.data.holdoutMode,'workflow-isolated');
});
test('factory is pure and its bindings exactly match the sole manifest',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../packages/auto-factor-mining/capabilities.json',import.meta.url)));
 const host=new Proxy({}, {get(){throw Error('Factory accessed host');}});
 assert.deepEqual(createCapabilities(host).map(value=>value.name).sort(),manifest.capabilities.map(value=>value.binding.name).sort());
 assert.equal(manifest.capabilities.filter(value=>value.transport==='subscription').length,0);assert.equal(manifest.stateCollections[0].name,'runs');
});

test('preflight blocks a changed evaluator before any role and resumes the original Run without preparing another session',async t=>{
 let f,prepares=0;
 f=own(t,await fixture({onEvaluate:args=>{if(args.action==='prepare'){prepares++;f.manifests.get('sesame/factor-evaluator').revision='changed-after-freeze';}}}));
 const created=await f.runtime.create(f.main,input()),blocked=await finished(f,created.id);
 assert.equal(blocked.status,'interrupted');assert.equal(f.requests.length,0);assert.equal(blocked.report,undefined);
 assert.equal(f.runtime.dependencies(f.main,created.id).available,false);
 f.manifests.get('sesame/factor-evaluator').revision='fixture-evaluator';
 await resume(f,created.id);const done=await finished(f,created.id);
 assert.equal(done.status,'completed');assert.equal(done.workflow.id,blocked.workflow.id);assert.equal(prepares,1);assert.equal(f.requests.length,6);
});

test('a candidate dependency interruption retains its trial and accepted coder Run without becoming a failed trial',async t=>{
 let candidateCalls=0;
 const f=own(t,await fixture({onEvaluate:args=>{if(args.action==='candidate'&&++candidateCalls===1)throw Object.assign(new Error('Selected evaluator temporarily unavailable'),{code:'DEPENDENCY_UNAVAILABLE'});}}));
 const created=await f.runtime.create(f.main,input()),blocked=await finished(f,created.id),coder=blocked.tasks.find(task=>task.mode==='code');
 assert.equal(blocked.status,'interrupted');assert.notEqual(blocked.trials[0].status,'failed');assert.equal(blocked.report,undefined);
 assert.ok(coder.pendingOutput);assert.equal(coder.finishedAt,undefined);
 await resume(f,created.id);const done=await finished(f,created.id);
 assert.equal(done.status,'completed');assert.equal(done.tasks.length,6);assert.equal(done.workflow.id,blocked.workflow.id);
 assert.equal(done.tasks.find(task=>task.mode==='code').runRef.id,coder.runRef.id);assert.equal(candidateCalls,2);
 assert.equal(f.requests.filter(request=>request.input.mode==='plan').length,1);assert.equal(f.requests.filter(request=>request.input.mode==='hypothesis').length,1);
});

test('final evaluation dependency recovery reuses frozen selection and every completed role',async t=>{
 let finalCalls=0;const selections=[];
 const f=own(t,await fixture({onEvaluate:args=>{if(args.action==='finalize'){selections.push(args.selection_digest);if(++finalCalls===1)throw Object.assign(new Error('Final evaluator unavailable'),{code:'DEPENDENCY_UNAVAILABLE'});}}}));
 const created=await f.runtime.create(f.main,input()),blocked=await finished(f,created.id);
 assert.equal(blocked.status,'interrupted');assert.ok(blocked.selection);assert.equal(blocked.report,undefined);assert.equal(f.requests.length,6);
 await resume(f,created.id);const done=await finished(f,created.id);
 assert.equal(done.status,'completed');assert.equal(f.requests.length,6);assert.equal(done.workflow.id,blocked.workflow.id);
 assert.deepEqual(selections,[blocked.selection.digest,blocked.selection.digest]);assert.equal(done.selection.digest,blocked.selection.digest);
});

test('read exposes pending interrupts and resume resolves only the explicitly selected IDs',async t=>{
 let held=false;
 const f=own(t,await fixture({onTask:()=>{if(!held){held=true;return 'hold';}}}));
 const created=await f.runtime.create(f.main,input());await poll(()=>held);await f.runtime.control(f.main,created.id,'pause');
 const workflow=f.jobs.get(f.runtime.get(created.id).workflow.id);
 workflow.value.interrupts.push({id:'independent-dependency',reason:'A separate dependency still requires attention',requirements:[],resolvedAt:null});
 const before=await f.runtime.observed(f.main,created.id),calls=f.requests.length;
 assert.equal(before.interrupts.length,2);assert.ok(before.interrupts.every(item=>item.id&&item.reason));
 await assert.rejects(f.runtime.control(f.main,created.id,'resume'),{code:'INVALID_ARGUMENT'});
 await f.runtime.control(f.main,created.id,'resume',{interrupt_ids:[before.interrupts[0].id]});
 const partial=await f.runtime.observed(f.main,created.id);
 assert.equal(partial.status,'interrupted');assert.deepEqual(partial.interrupts.map(item=>item.id),['independent-dependency']);assert.equal(f.requests.length,calls);
 await assert.rejects(f.runtime.control(f.main,created.id,'resume',{interrupt_ids:[before.interrupts[0].id]}),{code:'run_interrupt_conflict'});
 await f.runtime.control(f.main,created.id,'resume',{interrupt_ids:['independent-dependency'],response:{resolution:'Observed recovery'}});
 assert.equal((await finished(f,created.id)).status,'completed');
});

test('publication interruption keeps final measurements resumable without repeating roles or evaluation',async t=>{
 let stop=true,finals=0;
 const f=own(t,await fixture({onEvaluate:args=>{if(args.action==='finalize')finals++;},beforeResource:spec=>{
  if(stop&&spec.kind==='directory'){stop=false;throw Object.assign(new Error('Publication safely interrupted'),{code:'RUN_INTERRUPTED'});}
 }}));
 const created=await f.runtime.create(f.main,input()),paused=await finished(f,created.id);
 assert.equal(paused.status,'interrupted');assert.equal(paused.report,undefined);assert.ok(paused.finalEvaluation);
 assert.equal(paused.events.some(event=>event.type==='run.finished'),false);
 const calls=f.requests.length;await resume(f,created.id);const done=await finished(f,created.id);
 assert.equal(done.status,'completed');assert.ok(done.report);assert.equal(f.requests.length,calls);assert.equal(finals,1);
});

test('an ordinary report write error retains final evaluation and resumes the same workflow without re-running Agents',async t=>{
 let stop=true,finals=0;
 const f=own(t,await fixture({onEvaluate:args=>{if(args.action==='finalize')finals++;},beforeResource:spec=>{
  if(stop&&spec.kind==='directory'){stop=false;throw Object.assign(new Error('Report storage temporarily unavailable'),{code:'EIO'});}
 }}));
 const created=await f.runtime.create(f.main,input()),paused=await finished(f,created.id);
 assert.equal(paused.status,'interrupted');assert.equal(paused.reportError.code,'EIO');assert.ok(paused.finalEvaluation);assert.equal(paused.report,undefined);
 assert.equal(paused.events.some(event=>event.type==='run.finished'),false);
 const calls=f.requests.length;await resume(f,created.id);const done=await finished(f,created.id);
 assert.equal(done.status,'completed');assert.ok(done.report);assert.equal(done.workflow.id,paused.workflow.id);assert.equal(f.requests.length,calls);assert.equal(finals,1);
});

test('an ordinary model error interrupts its original role and resumes it without abandoning the trial',async t=>{
 let interrupted=false;
 const f=own(t,await fixture({onTask:({request})=>{
  if(request.input.mode==='code'&&!interrupted){interrupted=true;throw Object.assign(new Error('Model connection reset'),{code:'ECONNRESET'});}
 }}));
 const created=await f.runtime.create(f.main,input()),paused=await finished(f,created.id),coder=paused.tasks.find(task=>task.mode==='code');
 assert.equal(paused.status,'interrupted');assert.equal(paused.report,undefined);assert.equal(coder.finishedAt,undefined);
 assert.equal(f.jobs.get(coder.runRef.id).value.error.code,'ECONNRESET');
 const trial=structuredClone(paused.trials[0]);await resume(f,created.id);const done=await finished(f,created.id);
 assert.equal(done.status,'completed');assert.equal(done.workflow.id,paused.workflow.id);assert.equal(done.trials[0].id,trial.id);
 assert.equal(done.tasks.find(task=>task.mode==='code').runRef.id,coder.runRef.id);
 assert.equal(f.requests.filter(request=>request.input.mode==='plan').length,1);assert.equal(f.requests.filter(request=>request.input.mode==='hypothesis').length,1);
 assert.equal(f.requests.filter(request=>request.input.mode==='code').length,2);
});

test('a completed role missing structured output remains a specific preflight blocker without repeating other work',async t=>{
 const f=own(t,await fixture({onTask:({request,job})=>{
  if(request.input.mode==='code'){job.finish({status:'completed',output:{text:'Retained explanation without a submitted candidate'}});return 'hold';}
 }}));
 const created=await f.runtime.create(f.main,input()),paused=await finished(f,created.id),coder=paused.tasks.find(task=>task.mode==='code');
 assert.equal(paused.status,'interrupted');assert.equal(paused.error.code,'MISSING_OUTPUT');assert.match(coder.text,/Retained explanation/);
 const readiness=f.runtime.dependencies(f.main,created.id);assert.equal(readiness.available,false);assert.equal(readiness.details.cause.code,'MISSING_OUTPUT');
 assert.match(readiness.reason,/auto_factor_submit/);assert.match(readiness.reason,/main Agent cannot submit/);
 const calls=f.requests.length;await resume(f,created.id);
 assert.equal(f.runtime.get(created.id).status,'interrupted');assert.equal(f.requests.length,calls);assert.equal(f.runtime.get(created.id).workflow.id,paused.workflow.id);
});

test('factor inspector retry retains exact publication and evaluator selection without new Agents', async t => {
 const f=own(t,await fixture()); f.saved.reportState.inspectionStatus='failed';
 const created=await f.runtime.create(f.main,input()),paused=await finished(f,created.id),requests=f.requests.length;
 assert.equal(paused.status,'interrupted');assert.equal(paused.report,undefined);assert.ok(paused.reportPublication.ref);assert.ok(paused.finalEvaluation);
 const ref=structuredClone(paused.reportPublication.ref),selection=structuredClone(paused.selection),final=structuredClone(paused.finalEvaluation);
 f.saved.reportState.inspectionStatus='rendered';await resume(f,created.id);const done=await finished(f,created.id);
 assert.equal(done.status,'completed');assert.deepEqual(done.report.ref,ref);assert.equal(done.report.renderStatus,'rendered');
 assert.equal(f.requests.length,requests);assert.deepEqual(done.selection,selection);assert.deepEqual(done.finalEvaluation,final);
 assert.equal(f.saved.reportState.calls.filter(call=>call.id.endsWith('#report_publish')).length,1);
});

test('factor requires probe reads frozen local evidence without invoking or preparing the evaluator', async t => {
 let evaluatorCalls=0;
 const f=own(t,await fixture({onEvaluate:()=>{evaluatorCalls++;},onTask:({request})=>request.input.mode==='plan'?'hold':undefined}));
 const created=await f.runtime.create(f.main,input());await poll(()=>f.requests.some(request=>request.input.mode==='plan'));
 const before=structuredClone(f.runtime.get(created.id)),calls=evaluatorCalls,agents=f.requests.length;
 const probeHost={...f.main,capabilities:{invoke:()=>assert.fail('Readiness must not invoke an evaluator or Agent')},plugins:{...f.main.plugins,setEnabled:()=>assert.fail('Readiness must not load/configure an evaluator')},data:{query:()=>assert.fail('Readiness must not acquire live evaluation input')}};
 const result=f.runtime.dependencies(probeHost,created.id);
 assert.equal(result.available,true);assert.equal(result.details.frozenDataVerified,true);assert.match(result.details.evaluatorSessionProbe,/next requested operation/);
 assert.equal(evaluatorCalls,calls);assert.equal(f.requests.length,agents);assert.deepEqual(f.runtime.get(created.id),before);
});
