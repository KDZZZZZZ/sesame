// Contract-shaped regressions only: NOT native SDK/client or real trades.
import test from 'node:test'; import assert from 'node:assert/strict';
import {fixture} from './round2-presentation-fixtures.test.mjs';
import {createMarkerIndicator} from '../markers.js';
import {onReplayCommitted, readConsumedView, consumedBars} from '../replay-presentation.js';
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
test('main refresh validates fixed input contract, mounts once, repeats idempotently; no role or report calls',async()=>{
 const f=fixture(),before=structuredClone(f.engine),publish=f.host.artifacts.publish;
 f.host.artifacts.publish=async request=>{if(request.manifest.kind==='indicator')fixedContract(request.manifest.content);return publish(request);};
 const batch=f.batch(),context={runId:f.engine.id,engine:f.engine,previousEngine:f.engine,replayCutoffMs:batch.cutoffMs,consumedTicks:batch,chartId:'audience'};
 const a=await onReplayCommitted(f.host,f.service,context);assert.equal(a.refresh.status,'mounted');const count=f.calls.script.length;
 const b=await onReplayCommitted(f.host,f.service,context);assert.equal(b.refresh.instanceId,a.refresh.instanceId);assert.equal(f.calls.script.length,count);assert.equal(f.layout.scripts.length,1);
 const memo=f.host.storage.get('round2-presentation','chart_'+f.engine.id+'_audience');assert.match(memo.bundleDigest,/^sha256:[a-f0-9]{64}$/);assert.deepEqual(f.engine,before);assert.equal(f.calls.agent.length+f.calls.inference.length,0);
});
test('fixed data correction preserves actual consumed forming revision and computed SMA20; no future completion is fabricated',async()=>{
 const f=fixture(),b=createMarkerIndicator(f.service,{includeEvents:true,overlayRef:overlay});fixedContract(b.definition);
 const compute=(await import(new URL('data:text/javascript;base64,'+Buffer.from(b.files['markers.js']).toString('base64')))).compute;
 const rows=Array.from({length:20},(_,i)=>({id:'synthetic-'+i,openTime:{basis:'utc',unixMs:1000000000000+i*3600000},endTime:{basis:'utc',unixMs:1000000000000+(i+1)*3600000},isClosed:i<19,close:String(i+1),native:{revealedThrough:{basis:'utc',unixMs:1000000000000+i*3600000+1000}}}));
 const out=compute({inputs:{price:{rows},overlay:{rows:[]}}});assert.equal(out.series.find(x=>x.seriesId==='consumed-sma20').points.at(-1).value.value,'10.5');
 rows[19].close='40';const next=compute({inputs:{price:{rows},overlay:{rows:[]}}});assert.equal(next.series.find(x=>x.seriesId==='consumed-sma20').points.at(-1).value.value,'11.5');assert.equal(rows[19].isClosed,false);
});
