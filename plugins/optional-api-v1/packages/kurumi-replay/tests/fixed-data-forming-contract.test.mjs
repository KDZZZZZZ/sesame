// Real host resource/canvas contracts with synthetic market state; no native SDK/client or real trades.
import test from 'node:test'; import assert from 'node:assert/strict';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fixture} from './round2-presentation-fixtures.test.mjs';
import {createMarkerIndicator} from '../markers.js';
import {onReplayCommitted} from '../replay-presentation.js';
import {records,closeRecords} from '../records.js';
const hostRoot=pathToFileURL((process.env.SESAME_HOST_ROOT??fileURLToPath(new URL('../../../../../../mt5agent/',import.meta.url)))+'/');
const {Store}=await import(new URL('modules/agent/store.js',hostRoot));
const {Runtime}=await import(new URL('modules/agent/runtime.js',hostRoot));
const {createHostContextV2}=await import(new URL('modules/plugins/host-v2/context.js',hostRoot));
const overlay={id:'fixture-fixed-data',revision:'fixture-revision',digest:'sha256:'+'1'.repeat(64),kind:'data',schemaVersion:'1.0.0'};
function fixedContract(content){for(const input of content.inputs??[])if(input.binding==='fixed')assert.equal(input.forming,'closed_only','Fixed data has no forming bars');}
test('fixed annotation input is closed_only while dynamic price input still includes consumed forming bars',()=>{
 const f=fixture(),b=createMarkerIndicator(f.service,{includeEvents:true,overlayRef:overlay});
 fixedContract(b.definition);assert.equal(b.definition.inputs.find(x=>x.id==='price').forming,'include');
 assert.deepEqual(b.definition.inputs.find(x=>x.id==='overlay').data,overlay);assert.ok(b.definition.series.some(x=>x.id==='consumed-sma20'));
});
test('legacy static marker price remains closed_only and no unrequested fixed input is introduced',()=>{
 const f=fixture(),b=createMarkerIndicator(f.service,{includeEvents:false});assert.equal(b.definition.inputs[0].forming,'closed_only');assert.equal(b.definition.inputs.length,1);
});
test('main refresh validates fixed input contract, mounts once, repeats idempotently; no role or report calls',async t=>{
 const f=fixture(),root=await mkdtemp(join(tmpdir(),'kurumi-forming-v2-')),store=new Store(join(root,'state'));
 const runtime=new Runtime(store,{piDir:join(root,'pi'),officialPluginsDirectory:join(root,'empty')});let host;
 t.after(async()=>{if(host)closeRecords(host);await runtime.close();store.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});});
 await runtime.init();
 const path=join(runtime.workspaces.root('conv_main'),'kurumi');
 await cp(new URL('../',import.meta.url),path,{recursive:true,filter:path=>!path.includes('.core-sqlite-roundtrip')});
 const checked=await runtime.plugins.manager.test('conv_main',{path});assert.equal(checked.passed,true,JSON.stringify(checked));
 await runtime.plugins.manager.install('conv_main',{path,digest:checked.digest});runtime.plugins.activate('conv_main','sesame/kurumi-replay');
 const entry=runtime.plugins.entry('sesame/kurumi-replay'),nativeHost=createHostContextV2(runtime,entry,'conv_main');
 const {getService}=await import(pathToFileURL(join(entry.root,'service.js')).href),installedService=getService(nativeHost);
 installedService.data=f.data;f.engine=installedService.newState(f.engine.id,f.data.chapters,f.data.digests);
 records(nativeHost).put('challenge',{id:'continuous',revision:1,engine:f.engine,model:null,settings:{decisionIntervalHours:4},commands:{},control:{running:false,active:null,recovery:null,phase:'paused'}});
 const published=[];
 host={...nativeHost,resources:{...nativeHost.resources,publish:async(ref,manifest,options)=>{if(manifest.kind==='indicator')fixedContract(manifest.content);published.push(manifest.kind);return nativeHost.resources.publish(ref,manifest,options);}},
  views:{...nativeHost.views,apply:async input=>{if(input.surface==='indicator')f.calls.script.push(input);return nativeHost.views.apply(input);}}};
 const source=(await host.data.sources({providerId:'sesame/kurumi-replay#market'})).items[0].ref,scene=await host.views.inspect({surface:'canvas'});
 await host.views.apply({surface:'canvas',commandId:'forming_fixture_chart',expectedVersion:scene.version,operations:[{op:'add',id:'audience',chart:{binding:{source,instrument:{sourceId:'kurumi:'+f.engine.id,instrumentId:'AUDJPY'},spec:{timeframe:'1h',priceBasis:'bid',adjustment:'none',session:'all',calendarRevision:{status:'unknown'}}},symbol:'Synthetic AUDJPY',style:'candles',width:800,height:480}}]});
 const before=structuredClone(f.engine);
 const batch=f.batch(),context={runId:f.engine.id,engine:f.engine,previousEngine:f.engine,replayCutoffMs:batch.cutoffMs,consumedTicks:batch,chartId:'audience'};
 const a=await onReplayCommitted(host,f.service,context);assert.equal(a.refresh.status,'mounted');const count=f.calls.script.length;
 const b=await onReplayCommitted(host,f.service,context);assert.equal(b.refresh.instanceId,a.refresh.instanceId);assert.equal(f.calls.script.length,count);assert.equal((await host.views.inspect({surface:'canvas'})).scripts.length,1);
 const memo=records(host).get('round2-presentation','chart_'+f.engine.id+'_audience');assert.match(memo.bundleDigest,/^sha256:[a-f0-9]{64}$/);assert.deepEqual(f.engine,before);
 assert.ok(published.includes('indicator'));assert.equal(published.includes('report'),false);assert.equal(runtime.runs.list().filter(run=>['agent','model'].includes(run.kind)).length,0);
});
test('fixed data correction preserves actual consumed forming revision and computed SMA20; no future completion is fabricated',async()=>{
 const f=fixture(),b=createMarkerIndicator(f.service,{includeEvents:true,overlayRef:overlay});fixedContract(b.definition);
 const compute=(await import(new URL('data:text/javascript;base64,'+Buffer.from(b.files['markers.js']).toString('base64')))).compute;
 const rows=Array.from({length:20},(_,i)=>({id:'synthetic-'+i,openTime:{basis:'utc',unixMs:1000000000000+i*3600000},endTime:{basis:'utc',unixMs:1000000000000+(i+1)*3600000},isClosed:i<19,close:String(i+1),native:{revealedThrough:{basis:'utc',unixMs:1000000000000+i*3600000+1000}}}));
 const out=compute({inputs:{price:{rows},overlay:{rows:[]}}});assert.equal(out.series.find(x=>x.seriesId==='consumed-sma20').points.at(-1).value.value,'10.5');
 rows[19].close='40';const next=compute({inputs:{price:{rows},overlay:{rows:[]}}});assert.equal(next.series.find(x=>x.seriesId==='consumed-sma20').points.at(-1).value.value,'11.5');assert.equal(rows[19].isClosed,false);
});
