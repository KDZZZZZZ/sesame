// Test-only matching real HostContext/Store, no App edits, no network/model.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {ReplayService} from '../service.js';import {createRun,validateDecision} from '../native-engine.js';import {loadData} from '../data.js';
const app=process.env.KURUMI_DISPLAY_HOST_APP,storage=process.env.KURUMI_REAL_STORAGE;
test('real Store round trip: reordered source/rules/command/decision keep identity; genuine source change still refuses before submit',{skip:!app||!storage},async t=>{
 const hostImport=p=>import(pathToFileURL(join(app,p)).href);await hostImport('modules/plugins/sdk-loader.js');
 const {Store}=await hostImport('modules/agent/store.js'),{Runtime}=await hostImport('modules/agent/runtime.js'),{createHostContext}=await hostImport('modules/plugins/context.js');
 const root=await mkdtemp(join(tmpdir(),'kurumi-store-roundtrip-')),store=new Store(join(root,'state')),runtime=new Runtime(store,{piDir:join(root,'pi'),officialPluginsDirectory:join(root,'empty')});
 t.after(async()=>{await runtime.close();store.close();await rm(root,{recursive:true,force:true});});await runtime.init();
 const host=createHostContext(runtime,{id:'sesame/kurumi-replay',version:'0.1.1-dev.3',digest:'sha256:'+'0'.repeat(64)},'conv_main');
 const data=await loadData(storage),engine=createRun('persistent-isolated-test',data.chapters,data.digests);
 host.storage.put('challenge',{id:'continuous',revision:1,engine,commands:{},model:null,control:{phase:'paused',running:false,remaining:0,active:null,attempt:0}});
 const saved=host.storage.get('challenge','continuous');assert.deepEqual(saved.engine.dataDigests,data.digests);assert.notEqual(JSON.stringify(saved.engine.dataDigests),JSON.stringify(data.digests));
 const model={provider:'openai',id:'gpt-6.1-sol',configurationDigest:'sha256:'+'1'.repeat(64)};
 const s=new ReplayService(host);s.data=data;s.chooseModel=()=>model;let launches=0;s.launch=()=>{launches++;};
 s.start({command_id:'persist-source-continue',expected_version:1,max_steps:1});assert.equal(launches,1);assert.equal(s.getState().id,engine.id);assert.equal(s.getState().balance,'300000');
 // Same command round-tripped through canonical Store must be idempotent.
 const version=s.getDocument().revision;s.start({max_steps:1,expected_version:1,command_id:'persist-source-continue'});assert.equal(s.getDocument().revision,version);assert.equal(launches,1);
 assert.throws(()=>s.start({command_id:'persist-source-continue',expected_version:1,max_steps:2}),e=>e.code==='IDEMPOTENCY_CONFLICT');
 const state=s.getState(),decision={id:'roundtrip-decision',runId:state.id,stepId:`${state.id}:${state.chapter}:${state.index}`,expectedVersion:state.version,target:'0',stop:null,reason:'test only',utterance:'test only'};
 validateDecision(state,decision); // Real native rule guard accepts sorted keys.
 const snapshot={...s.observe(),authorization:'test-only-auth'};
 s.mutate(undefined,d=>{d.control.active={requestId:'roundtrip',taskId:'task-fixture',stepId:decision.stepId,decided:true,decision:{...decision,id:'roundtrip:decision'},receipt:{accepted:true},request:{input:{snapshot}}};});
 const actor={scope:{kind:'subagent',runId:'fixture-run'},agents:{current:()=>({id:'task-fixture',input:{snapshot}})}};
 const args={run_id:state.id,step_id:decision.stepId,expected_version:state.version,target:'0',stop:null,reason:'test only',utterance:'test only'};
 assert.deepEqual(await s.playerDecide(actor,args),{accepted:true});
 await assert.rejects(s.playerDecide(actor,{...args,target:'1000'}),e=>e.code==='IDEMPOTENCY_CONFLICT');
 s.mutate(undefined,d=>{d.control.active=null;d.control.running=false;});const before=s.getDocument();
 s.data={...data,digests:{...data.digests,download:'sha256:'+'f'.repeat(64)}};
 assert.throws(()=>s.start({command_id:'persist-source-genuine-change',expected_version:before.revision}),e=>e.code==='SOURCE_CHANGED');
 assert.deepEqual(s.getDocument(),before);assert.equal(launches,1);
 console.log(JSON.stringify({layer:'actual-store-roundtrip',storedKeys:Object.keys(saved.engine.dataDigests),loadedKeys:Object.keys(data.digests),identicalSourceAccepted:true,changedSourceRefused:true,paidRequests:0}));
});
