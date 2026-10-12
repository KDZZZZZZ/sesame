import test from 'node:test';
import assert from 'node:assert/strict';
import {reduceConsumedTicks,consumedBars,onReplayCommitted,readConsumedView,batchFromCommittedJournal,presentationGate,digest} from '../replay-presentation.js';
import {buildMarkerSnapshot,createMarkerIndicator,compute} from '../markers.js';
import {ReplayMarketProvider} from '../providers.js';
import {createAnalysisPlan,generalMethodBrief,verifyMethodUse} from '../analysis-plan.js';
import {fixture,H,T,utc,sha} from './round2-presentation-fixtures.test.mjs';
const err=code=>e=>e.code===code;
function ctx(f,batch,extras={}){return {engine:structuredClone(f.engine),previousEngine:structuredClone(f.engine),runId:f.engine.id,replayCutoffMs:batch.cutoffMs,consumedTicks:batch,chartId:'audience',...extras};}

test('consumed-only forming excludes future extreme/complete OHLC, exact decimal, partial bar same identity',()=>{
 const f=fixture(),a=f.batch(),v=reduceConsumedTicks(null,a),bars=consumedBars(v,'AUDJPY','bid','series');assert.equal(bars.length,1);assert.equal(bars[0].high,a.rows[0].bid);assert.equal(bars[0].low,'99');assert.equal(bars[0].isClosed,false);assert.equal(bars[0].native.revealedThrough.unixMs,a.cutoffMs);assert.equal(consumedBars(v,'AUDJPY','bid','series',false).length,0);
 const b=f.batch({batchId:'delta2',rows:[{time:T+2500,bid:'102',ask:'102.1'}],sequenceStart:2,cutoffMs:T+3000});const next=reduceConsumedTicks(v,b),nextBars=consumedBars(next,'AUDJPY','bid','series');assert.equal(nextBars[0].id,bars[0].id);assert.notEqual(nextBars[0].revision,bars[0].revision);assert.equal(nextBars[0].open,a.rows[0].bid);assert.equal(nextBars[0].close,'102');
 assert.throws(()=>reduceConsumedTicks(null,f.batch({rows:[...a.rows,{time:T+3000,bid:'9999',ask:'10000'}]})),err('FUTURE_DATA_FORBIDDEN'));
 assert.throws(()=>reduceConsumedTicks(v,{...b,sequenceStart:4}),err('SNAPSHOT_REQUIRED'));
 assert.deepEqual(reduceConsumedTicks(v,a),v);assert.throws(()=>reduceConsumedTicks(v,{...a,cutoffMs:T+2500}),err('IDEMPOTENCY_CONFLICT'));
 const closed=reduceConsumedTicks(next,{...b,batchId:'final3',sequenceStart:3,rows:[{time:T+H-1,bid:'98',ask:'98.1'}],intervalComplete:true,cutoffMs:T+H});assert.equal(closed.bars[0].isClosed,true);assert.throws(()=>reduceConsumedTicks(closed,{...b,batchId:'rewrite',sequenceStart:4,cutoffMs:T+H}),err('VERSION_CONFLICT'));
});

test('committed nativeJournal consumed-tick bridge verifies bytes/count and terminal prefix; no lastQuote path fabrication',()=>{
 const f=fixture(),rows=f.batch().rows,raw=JSON.stringify(rows),step={from:T,to:T+H,ticksRef:{bytes:Buffer.byteLength(raw),rowCount:rows.length,digest:sha(raw)},coverage:{sources:[{fixture:true}]}};
 const prev={...f.engine,version:1,nativeJournal:[]},next={...f.engine,version:2,nativeJournal:[step],bankrupt:true,lastQuote:rows.at(-1)};
 const b=batchFromCommittedJournal(next,prev,step,raw);assert.equal(b.cutoffMs,rows.at(-1).time);assert.equal(b.intervalComplete,false);assert.deepEqual(b.rows,rows);assert.equal(reduceConsumedTicks(null,b).bars[0].bid.high,rows[0].bid);
 assert.throws(()=>batchFromCommittedJournal(next,prev,step,raw+' '),err('HASH_MISMATCH'));assert.throws(()=>batchFromCommittedJournal(next,prev,step),err('CONSUMED_TICKS_REQUIRED'));
 assert.throws(()=>batchFromCommittedJournal({...next,nativeJournal:[{from:T,to:T+H}]},prev,{from:T,to:T+H}),err('CONSUMED_TICKS_REQUIRED'));
 assert.throws(()=>batchFromCommittedJournal({...next,version:3},prev,step,raw),err('VERSION_CONFLICT'));
});

test('provider uses actual consumed snapshot + subscription upsert and reconnect, never source future OHLC',async()=>{
 const f=fixture(),a=f.batch();await onReplayCommitted(f.host,f.service,ctx(f,a,{chartId:undefined}));f.service.getReplayPresentation=()=>readConsumedView(f.host,f.engine.id);
 // Unreadable full OHLC does not matter: provider uses only consumed view.
 Object.defineProperty(f.data.frames[0][0],'bid',{get(){throw Error('UNCONSUMED OHLC accessed');}});
 const p=new ReplayMarketProvider(f.host,f.service),context={bindingId:'fixture-bind'},instrument={sourceId:'kurumi:'+f.engine.id,instrumentId:'AUDJPY'},spec={timeframe:'1h',priceBasis:'bid',adjustment:'none',session:'all',calendarRevision:{status:'unknown'}};p.bind({},context);
 const stream=await p.subscribeBars({instrument,spec,tailLimit:10,includeForming:true},context),events=[];stream.ready(e=>events.push(e));assert.equal(stream.snapshot.bars[0].isClosed,false);
 const b=f.batch({batchId:'provider-delta',sequenceStart:2,rows:[{time:T+2500,bid:'105',ask:'105.1'}],cutoffMs:T+3000});await onReplayCommitted(f.host,f.service,ctx(f,b,{chartId:undefined}));f.emit();assert.equal(events.length,1);assert.equal(events[0].type,'bars.upsert');assert.equal(events[0].payload.bars[0].close,'105');assert.equal(events[0].seq,'1');
 await stream.close();const again=await p.subscribeBars({instrument,spec,tailLimit:10,includeForming:true},context);assert.equal(again.snapshot.bars[0].close,'105');await again.close();
 const read=await p.queryBars({instrument,spec,range:{from:utc(T),to:utc(T+3000)},includeForming:true,page:{limit:10}},context);assert.equal(read.data.page.items.length,1);assert.equal(read.data.coverage.complete,false);assert.equal(read.data.page.items[0].volume.real.status,'unknown');
 p.dispose();
});

test('repeat refresh unchanged instance; next commit replaces host ID not growth; lock, delete, binding reconnect',async()=>{
 const f=fixture(),a=f.batch(),before=structuredClone(f.engine),context=ctx(f,a);const first=await onReplayCommitted(f.host,f.service,context);assert.equal(first.refresh.gate.status,'pending');assert.equal(f.calls.script.length,1);assert.equal(f.calls.script[0].script_id,undefined);assert.equal(f.layout.scripts.length,1);
 const twice=await onReplayCommitted(f.host,f.service,context);assert.equal(twice.refresh.instanceId,first.refresh.instanceId);assert.equal(f.calls.script.length,1);
 f.engine={...f.engine,version:2};const b=f.batch({batchId:'h1-next',from:T+H,toExclusive:T+2*H,cutoffMs:T+H+1000,rows:[{time:T+H+100,bid:'101',ask:'101.1'}]});const changed=await onReplayCommitted(f.host,f.service,ctx(f,b));assert.equal(f.calls.script[1].script_id,first.refresh.instanceId);assert.notEqual(changed.refresh.instanceId,first.refresh.instanceId);assert.equal(f.layout.scripts.length,1);
 f.layout.charts[0].locked=true;const locked=await onReplayCommitted(f.host,f.service,ctx(f,b));assert.equal(locked.refresh.reason,'User chart lock retained');assert.equal(f.calls.script.length,2);
 f.layout.charts=[];f.layout.scripts=[];const deleted=await onReplayCommitted(f.host,f.service,ctx(f,b));assert.match(deleted.refresh.reason,/deleted/);assert.equal(f.calls.script.length,2);
 f.layout.charts=[{id:'audience',script_ids:[],binding:{instrument:{sourceId:'kurumi:other',instrumentId:'AUDJPY'}}}];const wrong=await onReplayCommitted(f.host,f.service,ctx(f,b));assert.match(wrong.refresh.reason,/Binding/);
 f.layout.charts[0].binding.instrument.sourceId='kurumi:'+f.engine.id;const restored=await onReplayCommitted(f.host,f.service,ctx(f,b));assert.equal(restored.refresh.status,'mounted');assert.equal(f.layout.scripts.length,1);assert.deepEqual(before,{...f.engine,version:1});
});

test('service scope commits durable main-refresh todo without touching session layout',async()=>{
 const f=fixture();f.host.scope.kind='service';f.host.layout.script=()=>{throw Error('service layout forbidden');};const r=await onReplayCommitted(f.host,f.service,ctx(f,f.batch()));assert.equal(r.status,'committed');assert.equal(r.refresh.status,'pending');assert.equal(f.host.storage.get('round2-presentation','todo_'+f.engine.id).needsMainRefresh,true);
});

test('lost mount response reconciles exact host instance on retry, no duplicate indicator',async()=>{
 const f=fixture(),context=ctx(f,f.batch()),original=f.host.layout.script;let once=true;f.host.layout.script=async a=>{const r=await original(a);if(a.action==='put'&&once){once=false;throw Error('LOST_REPLY fixture');}return r;};
 await assert.rejects(onReplayCommitted(f.host,f.service,context),/LOST_REPLY/);assert.equal(f.layout.scripts.length,1);const r=await onReplayCommitted(f.host,f.service,context);assert.equal(r.refresh.status,'unchanged');assert.equal(f.calls.script.length,1);assert.equal(f.layout.scripts.length,1);
});

test('exact real ledger events carry Sesame actor/evidence; original interval remains spectator-only, no future values',()=>{
 const f=fixture();f.engine.index=1;f.engine.version=2;f.engine.fills=[{id:'stop-fill',instrument:'AUDJPY',chapter:0,index:1,time:T+H+100,signedQuantity:'-1000',price:'99',reason:'stop',orderId:'stop-1'}];f.engine.orders=[{id:'decision-1',chapter:0,time:T+H+1,target:'1000',stop:'99',status:'filled'}];f.engine.decisions=[{decision:{id:'decision-1',target:'1000',reason:'fixture'},executedChapter:0,executionTime:T+H+1}];f.engine.equity=[{chapter:0,index:1,time:T+H+100,quantity:'0',equity:'299000'}];
 const original={id:'uncertain',symbol:'AUDJPY',kind:'interval',from:T,to:T+2*H,release:'window_end',evidence:'fitted',text:'fixture-original-fitted'};
 const snapshot=buildMarkerSnapshot(f.service,{includeEvents:true,originals:[original]});assert.equal(snapshot.rows.filter(r=>r.kind==='original-interval').length,1);assert.ok(snapshot.rows.filter(r=>r.actor==='Sesame').every(r=>r.evidence));assert.equal(snapshot.rows.filter(r=>r.eventType==='risk-exit').length,1);
 const bars=[0,1].map(i=>({id:'bar'+i,openTime:utc(T+i*H),endTime:utc(T+(i+1)*H),isClosed:true,close:'100'}));const result=compute({parameters:{label_mode:'events'},inputs:{price:{rows:bars},overlay:{rows:snapshot.rows}}});const interval=result.series.find(s=>s.seriesId==='original-intervals').markers;assert.equal(interval.length,2);assert.ok(interval.every(m=>!('price'in m)&&/非成交/.test(m.text)));
 assert.ok(!JSON.stringify(f.engine).includes('fixture-original-fitted'));assert.equal(buildMarkerSnapshot(f.service,{includeEvents:true,originals:[{...original,to:T+3*H,text:'HIDDEN_FUTURE'}]}).rows.some(r=>r.text.includes('HIDDEN_FUTURE')),false);
});

test('typed live close/SMA20 actually computed with warmup, no zero-fill or future bars',async()=>{
 const f=fixture(),bundle=createMarkerIndicator(f.service,{includeEvents:true,originals:[]}),run=(await import(new URL('data:text/javascript;base64,'+Buffer.from(bundle.files['markers.js']).toString('base64')))).compute;
 const bars=Array.from({length:20},(_,i)=>({id:'b'+i,openTime:utc(T+i*H),endTime:utc(T+(i+1)*H),isClosed:i!==19,close:String(i+1),native:{revealedThrough:utc(T+i*H+1000)}}));
 const warm=run({inputs:{price:{rows:bars.slice(0,19)}}});assert.deepEqual(warm.series.find(s=>s.seriesId==='consumed-sma20').points,[]);
 const result=run({inputs:{price:{rows:bars}}});assert.equal(result.series.find(s=>s.seriesId==='consumed-sma20').points[0].value.value,'10.5');assert.equal(result.series.find(s=>s.seriesId==='consumed-close').points.at(-1).value.value,'20');assert.ok(bundle.definition.series.some(s=>s.type==='line'));assert.equal(bundle.definition.inputs[0].forming,'include');
});

test('client receipt gate fails closed without matching public verifier or mounted generation',async()=>{
 const f=fixture(),r=await onReplayCommitted(f.host,f.service,ctx(f,f.batch()));const {instanceId,artifact}=r.refresh;const gate=await presentationGate(f.host,'audience',instanceId,artifact);assert.equal(gate.status,'pending');assert.equal(gate.raw.script.receipts.length,0);
 await assert.rejects(presentationGate(f.host,'audience',instanceId,artifact,undefined,async()=>({status:'rendered'})),err('SOURCE_DATA_INVALID'));
});

test('method plan records pinned catalog proposals only, failed technical method not adopted; no role historical outcomes',async()=>{
 const plan=createAnalysisPlan();assert.ok(plan.methods.length>=7);assert.ok(plan.methods.every(m=>m.status==='proposed_not_adopted'&&!m.adopted&&m.version&&m.digest));assert.equal(plan.unusable[0].runtime_status,'failed');assert.deepEqual(generalMethodBrief(plan).forwardValidatedRules,[]);assert.equal(generalMethodBrief(plan).outOfSample,false);
 await assert.rejects(verifyMethodUse(fixture().host,{pluginId:'technical-analysis-theory'}),err('METHOD_UNAVAILABLE'));await assert.rejects(verifyMethodUse(fixture().host,{pluginId:'sesame/ict',version:'1.0.0',method:'not invoked'}),err('METHOD_EVIDENCE_REQUIRED'));
});

test('lost UI memo recovers exact published instance; foreign scripts never trigger automatic duplicate growth',async()=>{
 const f=fixture(),context=ctx(f,f.batch());const first=await onReplayCommitted(f.host,f.service,context);f.storage.map.delete('round2-presentation:chart_'+f.engine.id+'_audience');
 const same=await onReplayCommitted(f.host,f.service,context);assert.equal(same.refresh.instanceId,first.refresh.instanceId);assert.equal(f.calls.script.length,1);
 const g=fixture();g.layout.charts[0].script_ids=['foreign'];g.layout.scripts=[{id:'foreign',artifact:{id:'user-owned',revision:'1',digest:sha('foreign'),kind:'indicator',schemaVersion:'1.0.0'}}];const r=await onReplayCommitted(g.host,g.service,ctx(g,g.batch()));assert.equal(r.refresh.status,'pending');assert.equal(g.calls.script.length,0);assert.equal(g.layout.scripts.length,1);
});

test('new typed presentation indicator satisfies actual public indicator_publish schema (read-only resource)',async()=>{
 const {readFile}=await import('node:fs/promises');
 const tools=JSON.parse(await readFile('/Applications/Sesame.app/Contents/Resources/official-plugins/canvas-control/tools.json','utf8'));
 const schema=tools.find(t=>t.name==='indicator_publish').parameters;
 function validate(v,s){
  if(s.anyOf){assert.ok(s.anyOf.some(b=>{try{validate(v,b);return true;}catch{return false;}}));return;}
  if(s.const!==undefined)assert.deepEqual(v,s.const);
  if(s.type==='object'){assert.ok(v&&typeof v==='object'&&!Array.isArray(v));for(const k of s.required??[])assert.ok(Object.hasOwn(v,k),k);for(const [k,val]of Object.entries(v)){if(s.properties?.[k])validate(val,s.properties[k]);else if(s.patternProperties){const entry=Object.entries(s.patternProperties).find(([p])=>new RegExp(p).test(k));if(entry)validate(val,entry[1]);}else assert.notEqual(s.additionalProperties,false,`Undeclared ${k}`);}if(s.maxProperties!==undefined)assert.ok(Object.keys(v).length<=s.maxProperties);}
  if(s.type==='array'){assert.ok(Array.isArray(v));if(s.maxItems!==undefined)assert.ok(v.length<=s.maxItems);for(const x of v)validate(x,s.items);}
  if(s.type==='string'){assert.equal(typeof v,'string');if(s.pattern)assert.match(v,new RegExp(s.pattern));if(s.minLength)assert.ok(v.length>=s.minLength);if(s.maxLength)assert.ok(v.length<=s.maxLength);}
  if(s.type==='boolean')assert.equal(typeof v,'boolean');if(s.type==='integer'||s.type==='number'){assert.equal(typeof v,'number');assert.ok(Number.isFinite(v));if(s.type==='integer')assert.ok(Number.isInteger(v));if(s.minimum!==undefined)assert.ok(v>=s.minimum);if(s.maximum!==undefined)assert.ok(v<=s.maximum);}
 }
 const f=fixture(),bundle=createMarkerIndicator(f.service,{includeEvents:true,originals:[]});validate({operation_id:'round2_public_typed_contract_0001',definition:bundle.definition,files:bundle.files},schema);
 const run=(await import(new URL('data:text/javascript;base64,'+Buffer.from(bundle.files['markers.js']).toString('base64')))).compute;
 const output=run({inputs:{price:{rows:consumedBars(reduceConsumedTicks(null,f.batch()),'AUDJPY','bid','s')}}});assert.ok(output.series.every(s=>bundle.definition.series.some(d=>d.id===s.seriesId)));console.log('Public typed schema checked; NOT host SDK activation or frontend receipt');
});

test('automatic overlay uses fixed DataRef instead of growing embedded static code; full event evidence not silently dropped',async()=>{
 const f=fixture();f.engine.fills=Array.from({length:250},(_,i)=>({id:'f'+i,instrument:'AUDJPY',chapter:0,index:0,time:T+1000,signedQuantity:i%2?'1000':'-1000',price:'100',reason:'fixture action '.repeat(30),orderId:'o'+i}));
 assert.throws(()=>createMarkerIndicator(f.service,{includeEvents:true,originals:[]}),err('RESOURCE_EXHAUSTED'));
 const r=await onReplayCommitted(f.host,f.service,ctx(f,f.batch()));assert.equal(r.refresh.status,'mounted');assert.equal(f.layout.scripts.length,1);
 const indicator=[...f.artifacts.values()].find(a=>a.ref.kind==='indicator'),overlay=indicator.request.manifest.content.inputs.find(i=>i.id==='overlay');assert.equal(overlay.kind,'data');assert.equal(overlay.binding,'fixed');assert.equal(overlay.data.kind,'data');assert.ok(indicator.request.manifest.dependencies.some(d=>d.id===overlay.data.id));
 const data=[...f.artifacts.values()].find(a=>a.ref.id===overlay.data.id),rows=JSON.parse(f.blobs.get(data.request.manifest.blobs[0].digest));assert.equal(rows.filter(x=>x.eventType==='fill').length,250);
 const source=f.blobs.get(indicator.request.manifest.blobs.find(b=>b.path==='markers.js').digest);assert.ok(Buffer.byteLength(source)<32768);const compiled=(await import(new URL('data:text/javascript;base64,'+Buffer.from(source).toString('base64')))).compute;
 const output=compiled({parameters:{label_mode:'events'},inputs:{price:{rows:consumedBars(readConsumedView(f.host,f.engine.id),'AUDJPY','bid','s')},overlay:{rows}}});assert.equal(output.series.filter(s=>s.seriesId==='actual-buy'||s.seriesId==='actual-sell').flatMap(s=>s.markers).length,250);assert.ok(rows.every(x=>x.actor==='Sesame'));
});

test('public main audience consumer drains durable service todo, stores pending real-client gate without model or extra instance',async()=>{
 const {refreshReplayAudience}=await import('../replay-presentation.js');const f=fixture();f.host.scope.kind='service';await onReplayCommitted(f.host,f.service,ctx(f,f.batch()));assert.equal(f.host.storage.get('round2-presentation','todo_'+f.engine.id).needsMainRefresh,true);
 f.host.scope.kind='main';const r=await refreshReplayAudience(f.host,f.service,{chartId:'audience'});assert.equal(r.refresh.status,'mounted');assert.equal(f.host.storage.get('round2-presentation','todo_'+f.engine.id).needsMainRefresh,false);assert.equal(f.host.storage.get('round2-presentation','todo_'+f.engine.id).clientGate.status,'pending');await refreshReplayAudience(f.host,f.service,{chartId:'audience'});assert.equal(f.calls.script.length,1);assert.equal(f.calls.inference.length,0);assert.equal(f.calls.agent.length,0);
});

test('consumed-prefix callback uses same-asof actual account checkpoint, never later final-hour account; full commit verifies prefix and finalizes once',async()=>{
 const {onConsumedPrefix,readSpectatorCheckpoint,ticksPrefixDigest}=await import('../replay-presentation.js');const {ReplayAccountProvider}=await import('../providers.js');const f=fixture(),partial=structuredClone(f.engine),batch=f.batch(),account={engineVersion:1,asOfMs:batch.cutoffMs,quoteTimeMs:batch.rows.at(-1).time,balance:'300000',equity:'300000',unrealizedJpy:'0',margin:'0',freeMargin:'300000'};
 const prefix={engine:partial,runId:partial.id,replayCutoffMs:batch.cutoffMs,consumedTicks:batch,account,nativeConsumedProof:{kind:'native-consumed-checkpoint',engineDigest:digest(partial),accountDigest:digest(account),batchDigest:digest(batch)}};
 const result=await onConsumedPrefix(f.host,f.service,prefix);assert.equal(result.accountAsOfMs,batch.cutoffMs);assert.ok(readSpectatorCheckpoint(f.host,partial.id));f.engine.balance='9999999';
 const provider=new ReplayAccountProvider(f.host,f.service),context={bindingId:'prefix-view'},ref={connectionId:'kurumi-simulation',accountId:partial.id};provider.bind({},context);const snap=await provider.snapshot({account:ref},context);assert.equal(snap.data.balance.value.value,'300000');assert.equal(snap.data.asOf.unixMs,batch.cutoffMs);
 const full={...batch,batchId:'native_full_commit',commitVersion:2,rows:[...batch.rows,{time:T+3000,bid:'102',ask:'102.1'}],intervalComplete:true,cutoffMs:T+H};f.engine={...partial,version:2};const committed=ctx(f,full,{chartId:undefined});await onReplayCommitted(f.host,f.service,committed);assert.equal(readSpectatorCheckpoint(f.host,partial.id),null);const view=readConsumedView(f.host,partial.id);assert.equal(view.bars[0].consumedCount,3);assert.equal(view.bars[0].isClosed,true);assert.equal(view.bars[0].prefixDigest,ticksPrefixDigest(full.rows));await onReplayCommitted(f.host,f.service,committed);assert.equal(readConsumedView(f.host,partial.id).bars[0].consumedCount,3);provider.dispose();
 const g=fixture();await assert.rejects(onConsumedPrefix(g.host,g.service,{...prefix,nativeConsumedProof:null}),{code:'CONSUMED_CHECKPOINT_REQUIRED'});assert.equal(f.calls.inference.length,0);
});

test('package main coordinator really consumes service needsMainRefresh without growth or paid calls; client proof remains separate',async()=>{
 const {consumeMainAudience}=await import('../replay-presentation.js');const f=fixture();f.host.scope.kind='service';await onReplayCommitted(f.host,f.service,ctx(f,f.batch(),{chartId:'audience'}));assert.equal(f.host.storage.get('round2-presentation','todo_'+f.engine.id).needsMainRefresh,true);f.host.scope.kind='main';await consumeMainAudience(f.host,f.service);assert.equal(f.host.storage.get('round2-presentation','todo_'+f.engine.id).needsMainRefresh,false);assert.equal(f.calls.script.length,1);await consumeMainAudience(f.host,f.service);assert.equal(f.calls.script.length,1);assert.equal(f.calls.agent.length+f.calls.inference.length,0);
});

test('representative non-legend original candidate interval and actual stop coexist before chapter completion, no future outcome or role state mutation',async()=>{
 const {buildMarkerSnapshot,compute}=await import('../markers.js');const f=fixture(),m=Date.UTC(2014,4,14);f.data.frames[0][0].time=m;const before=JSON.stringify(f.engine);const fill={id:'demo-stop',chapter:0,time:m+100,orderId:'demo-decision',instrument:'AUDJPY',signedQuantity:'-1000',price:'100',reason:'stop',openedQuantity:'0',closedQuantity:'1000'};f.engine.fills=[fill];f.service.getReplayPresentation=()=>({runId:f.engine.id,commitVersion:1,cutoffMs:m+H,bars:[]});const snapshot=buildMarkerSnapshot(f.service,{includeEvents:true,includeAudienceContext:true,to:m+H});const original=snapshot.rows.find(r=>r.releasePolicy==='audience_context');assert.ok(original);assert.equal(original.occurrence.status,'unknown');assert.equal(snapshot.rows.some(r=>r.key==='actual:'+f.engine.id+':demo-stop'),true);assert.ok(snapshot.rows.some(r=>r.eventType==='risk-exit'));const result=compute({inputs:{price:{rows:[{id:'bar',openTime:{basis:'utc',unixMs:m},endTime:{basis:'utc',unixMs:m+H},isClosed:true,close:'100'}]},overlay:{rows:snapshot.rows}}});assert.ok(result.series.find(r=>r.seriesId==='original-intervals').markers.length);assert.ok(result.series.find(r=>r.seriesId==='actual-sell').markers.length);assert.equal(f.engine.fills[0].id,'demo-stop');console.log('Nonempty coexistence computed from SYNTHETIC fixture only; actual native visible proof still pending');
});

test('normal NON-bankrupt playback path streams forming revisions after real warmup receiver, calculates SMA, then closes once; not actual client acceptance',async()=>{
 const {initializeReplayAudience}=await import('../replay-presentation.js');const f=fixture(),before=JSON.stringify(f.engine),warmup=[];for(let i=20;i>0;i--){const from=T-i*H,rows=[{time:from+100,bid:'100',ask:'100.1'},{time:from+1000,bid:'100',ask:'100.1'}];warmup.push(f.batch({batchId:'warm_'+i,from,toExclusive:from+H,cutoffMs:from+H,intervalComplete:true,rows,sourceDigest:sha(rows)}));}await initializeReplayAudience(f.host,f.service,{engine:f.engine,warmupBatches:warmup,cutoffMs:T});assert.equal(JSON.stringify(f.engine),before);f.service.presentationEnabled=true;f.service.getReplayPresentation=()=>readConsumedView(f.host,f.engine.id);const p=new ReplayMarketProvider(f.host,f.service),context={bindingId:'normal-bridge'},instrument={sourceId:'kurumi:'+f.engine.id,instrumentId:'AUDJPY'},spec={timeframe:'1h',priceBasis:'bid',adjustment:'none',session:'all',calendarRevision:{status:'unknown'}};p.bind({},context);const stream=await p.subscribeBars({instrument,spec,tailLimit:25,includeForming:true},context),events=[];stream.ready(e=>events.push(e));f.host.scope.kind='service';
 const a=f.batch();await onReplayCommitted(f.host,f.service,ctx(f,a));f.emit();assert.equal(events.at(-1).payload.bars.at(-1).isClosed,false);const b=f.batch({batchId:'normal_delta',sequenceStart:2,cutoffMs:T+3000,rows:[{time:T+2500,bid:'102',ask:'102.1'}]});await onReplayCommitted(f.host,f.service,ctx(f,b));f.emit();assert.equal(events.at(-1).payload.bars.at(-1).close,'102');assert.equal(events.at(-1).payload.bars.at(-1).isClosed,false);const live=consumedBars(readConsumedView(f.host,f.engine.id),'AUDJPY','bid','live'),computed=compute({presentationAnalysis:true,inputs:{price:{rows:live},overlay:{rows:[]}}});assert.ok(computed.series.find(s=>s.seriesId==='consumed-sma20').points.length);
 f.engine.version=2;const full=f.batch({batchId:'normal_final',intervalComplete:true,cutoffMs:T+H,sequenceStart:0,rows:[...a.rows,...b.rows]});await onReplayCommitted(f.host,f.service,ctx(f,full));f.emit();assert.equal(events.at(-1).payload.bars.at(-1).isClosed,true);assert.equal(f.engine.bankrupt,undefined);assert.equal(f.calls.agent.length+f.calls.inference.length,0);await stream.close();p.dispose();console.log('Normal path subscription/compute fixture successful; native visible forming still pending matched SDK client receipt');
});
