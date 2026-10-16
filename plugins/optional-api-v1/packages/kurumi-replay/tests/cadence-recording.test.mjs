// Pure controller race/partial-progress tests. No model, broker or real run.
import {pathToFileURL} from 'node:url';
const {ReplayService}=await import(pathToFileURL(process.argv[2]??new URL('../service.js',import.meta.url).pathname));
const outcomes=[];
const assert=(ok,m)=>{if(!ok)throw new Error(m);};
async function test(name,fn){try{await fn();outcomes.push({name,passed:true});}catch(e){outcomes.push({name,passed:false,error:e.message});}}
const frame=i=>({time:100000000+i*3600000,bid:{open:'100',high:'101',low:'99',close:'100'},ask:{open:'100.1',high:'101.1',low:'99.1',close:'100.1'}});
function setup(){
 let doc={id:'continuous',revision:1,engine:{id:'audit_run',version:1,chapter:0,index:0,balance:'300000',status:'paused',position:{quantity:'1000',stop:'99'},nativeJournal:[],decisions:[],fills:[],ledger:[],history:[],equity:[],dataDigests:{audit:true}},settings:{decisionIntervalHours:4},commands:{},model:{provider:'openai',id:'gpt-6.1-sol'},control:{running:true,remaining:2,phase:'ready',attempt:0,active:null,continuation:{decisionId:'audit_decision',remainingBars:3,committedCount:0}}};
 let submissions=0;
 const host={storage:{directory:'/not-real-audit-storage',get:()=>structuredClone(doc),put:(_kind,value)=>{doc=structuredClone(value);},transaction:fn=>fn()},agents:{submit:()=>{submissions++;return{id:'audit_task'};},wait:()=>new Promise(()=>{}),inspect:()=>({id:'audit_task',status:'running'}),cancel:()=>{}},inference:{models:()=>[doc.model]}};
 const s=new ReplayService(host);s.recorder={append:async()=>({digest:'audit'}),file:async()=>({})};
 s.data={chapters:[{symbol:'AUDJPY'},{symbol:'USDJPY'}],frames:[Array.from({length:8},(_,i)=>frame(i)),Array.from({length:8},(_,i)=>frame(i))]};
 s.observe=()=>({runId:doc.engine.id,stepId:'audit_step',chapter:1,asOf:100000000,expectedVersion:doc.engine.version});
 return {s,doc:()=>structuredClone(doc),submissions:()=>submissions};
}
await test('missing-data does not consume a pending H1 or invent a commit',async()=>{
 const f=setup();f.s.advance=async(_dir,state)=>({...state,status:'missing_data'});
 const count=await f.s.runContinuations(f.doc().control.continuation);
 assert(count===0,'missing H1 counted as committed');
 assert(f.doc().control.continuation.remainingBars===3,'missing H1 consumed continuation budget');
});
await test('chapter boundary terminates old decision block before next chapter',async()=>{
 const f=setup();f.s.advance=async(_dir,state)=>({...state,chapter:1,index:0,version:state.version+1,position:null});
 await f.s.runContinuations(f.doc().control.continuation);
 assert(!f.doc().control.continuation,'old decision retained automatic bars into next chapter');
});
await test('stop-loss flat position stays flat for remaining automatic bars',async()=>{
 const f=setup();const targets=[];f.s.advance=async(_dir,state,decision)=>{targets.push(decision.target);return{...state,index:state.index+1,version:state.version+1,position:null};};
 await f.s.runContinuations(f.doc().control.continuation);
 assert(targets.join(',')==='1000,0,0','automatically reopened after stop-loss');
});
await test('pause while automatic matching is in flight prevents its later commit',async()=>{
 const f=setup();let finish,started;const ready=new Promise(r=>started=r);
 f.s.advance=async(_dir,state)=>new Promise(r=>{finish=()=>r({...state,index:state.index+1,version:state.version+1});started();});
 const running=f.s.runContinuations(f.doc().control.continuation);await ready;
 await f.s.pause({command_id:'audit_pause',expected_version:f.doc().revision});
 finish();await Promise.race([running.catch(()=>{}),new Promise(r=>setTimeout(r,50))]);
 assert(f.doc().engine.index===0,'matching committed after explicit pause');
});
await test('pause during pre-submit archival prevents a new paid role task',async()=>{
 const f=setup();f.s.mutate(undefined,d=>{d.control.continuation=null;});let finish,started;const ready=new Promise(r=>started=r);
 f.s.recorder.append=async(kind)=>kind==='role_request'?new Promise(r=>{finish=()=>r({digest:'audit'});started();}):{digest:'audit'};
 const pending=f.s.launchReady();await ready;
 await f.s.pause({command_id:'audit_pause_submit',expected_version:f.doc().revision});finish();await pending.catch(()=>{});
 assert(f.submissions()===0,'paid role submitted after pause');
});
await test('the full four-H1 decision returns a current and idempotent final account receipt',async()=>{
 const f=setup();
 f.s.mutate(undefined,d=>{d.control.continuation=null;d.control.active={requestId:'audit-full-role',taskId:'audit-full-task',stepId:'audit-step',request:{input:{snapshot:{}}}};});
 f.s.authorize=()=>({active:f.doc().control.active});
 f.s.advance=async(_dir,state,decision)=>({...state,index:state.index+1,version:state.version+1,decisions:[...state.decisions,{decision}]});
 const actor={scope:{runId:'audit-actor',conversationId:'audit-conversation'}},args={run_id:'audit_run',step_id:'audit-step',expected_version:1,target:'0',stop:null,reason:'fixture',utterance:'fixture'};
 const receipt=await f.s.playerDecide(actor,args);
 assert(receipt.accepted&&receipt.engineVersion===5,'final receipt does not describe four committed H1 intervals');
 assert(receipt.balance===f.doc().engine.balance,'final receipt balance is stale');
 assert(JSON.stringify(receipt)===JSON.stringify(await f.s.playerDecide(actor,args)),'duplicate decision returned a different/stale receipt');
});
await test('an interrupted four-hour block returns the actual committed account and remaining hours',async()=>{
 const f=setup();
 f.s.mutate(undefined,d=>{d.control.continuation=null;d.control.active={requestId:'audit-partial-role',taskId:'audit-partial-task',stepId:'audit-step',request:{input:{snapshot:{}}}};});
 f.s.authorize=()=>({active:f.doc().control.active});let calls=0;
 f.s.advance=async(_dir,state,decision)=>{if(++calls===3)throw new Error('deterministic interrupted matching');return{...state,index:state.index+1,version:state.version+1,decisions:[...state.decisions,{decision}]};};
 const actor={scope:{runId:'audit-actor',conversationId:'audit-conversation'}},args={run_id:'audit_run',step_id:'audit-step',expected_version:1,target:'0',stop:null,reason:'fixture',utterance:'fixture'};
 const receipt=await f.s.playerDecide(actor,args);
 assert(receipt.engineVersion===3&&receipt.finalBlock.committedHours===2&&receipt.finalBlock.pendingHours===2,'interrupted receipt hid the already-committed second H1');
 assert(JSON.stringify(receipt)===JSON.stringify(await f.s.playerDecide(actor,args)),'interrupted receipt was not durable/idempotent');
});
await test('archive failure remains visible after its detailed status becomes an object',async()=>{
 const f=setup();f.s.markArchiveFailed(new Error('fixture disk failure'));
 assert(f.s.status().archive.failed===true,'archive failure was incorrectly reported as healthy');
});
await test('a later cleanup error cannot erase an unarchived committed account snapshot',async()=>{
 const f=setup();let diskFailed=true;const persisted=[];
 f.s.recorder.append=async(kind,payload)=>{if(diskFailed)throw Object.assign(new Error('fixture disk full'),{code:'ENOSPC'});persisted.push({kind,payload});return{digest:'audit'};};
 const payload={engine:f.doc().engine};
 await f.s.archiveSafe('h1_committed',payload).catch(()=>{});
 f.s.markArchiveFailed(new Error('later cleanup archive failure'));
 diskFailed=false;await f.s.assertArchiveHealthy();
 assert(persisted.some(r=>r.kind==='h1_committed'&&r.payload.engine.id===payload.engine.id),'pending account snapshot was erased by later cleanup error');
});
await test('missing data on the first H1 is not archived as a committed transaction',async()=>{
 const f=setup();const kinds=[];
 f.s.mutate(undefined,d=>{d.control.continuation=null;d.control.active={requestId:'audit-role',taskId:'audit-role-task',stepId:'audit-step',request:{input:{snapshot:{}}}};});
 f.s.authorize=()=>({active:f.doc().control.active});f.s.recorder.append=async(kind)=>{kinds.push(kind);return{digest:'audit'};};
 f.s.advance=async(_dir,state)=>({...state,status:'missing_data'});
 const result=await f.s.playerDecide({scope:{runId:'audit-actor',conversationId:'audit-conversation'}},{run_id:'audit_run',step_id:'audit-step',expected_version:1,target:'0',stop:null,reason:'fixture',utterance:'fixture'});
 assert(result.accepted===false,'missing data was accepted');
 assert(!kinds.includes('h1_committed')&&kinds.includes('h1_missing_data'),'missing data was labelled as a committed account update');
});
console.log(JSON.stringify({source:process.argv[2]??'plugin-draft/service.js',passed:outcomes.filter(x=>x.passed).length,total:outcomes.length,outcomes},null,2));
process.exitCode=outcomes.every(x=>x.passed)?0:1;
