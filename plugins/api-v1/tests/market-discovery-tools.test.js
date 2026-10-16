import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilities as data } from '../packages/data-access/index.js';
import { createCapabilities as canvas } from '../packages/canvas-control/index.js';
import { compute } from '../packages/canvas-control/resources/close-line.js';

function fixture() {
 const source={providerId:'fixture/market#prices',revision:'fixed'},connection={id:'configured',revision:'7'},instrument={ref:{sourceId:'opaque-source',instrumentId:'EXACT'},symbol:'EXACT',timeBasis:{kind:'wall',authority:'Fixture/Broker'},calendar:{status:'unknown',reason:'No fixed calendar'},features:{timeframes:['1h','15m'],priceBases:['bid'],adjustments:['none'],sessions:['regular']}},calls=[];
 const f={source,connection,instrument,calls};
 const host={data:{sources:()=>({items:[{ref:source,available:true,contract:'sesame.market/1',configSchema:{properties:{connection:{}}},operations:{searchInstruments:'search',describeInstrument:'describe',queryBars:'history'}}]}),query:async(request,options)=>{options.signal?.throwIfAborted();calls.push(request);if(f.error)throw f.error;return{items:[structuredClone(instrument)],metadata:{connection,...(request.operation==='describeInstrument'?{}:{snapshotId:'exact'})},...(request.operation==='searchInstruments'?{nextCursor:'host-opaque-cursor'}:{})};}},views:{inspect:()=>({version:5,charts:[]})}};
 const tools=new Map([...data(host),...canvas(host)].map(c=>[c.name,c.execute]));f.call=(name,args,signal)=>tools.get(name)(args,signal);return f;
}
test('source discovery has no connection side effect and instrument search preserves host pagination',async()=>{
 const f=fixture();assert.deepEqual((await f.call('data_providers',{contract:'sesame.market/1'})).items[0].ref,f.source);
 assert.deepEqual((await f.call('canvas_inspect',{})).market_sources[0].ref,f.source);assert.equal(f.calls.length,0);
 const result=await f.call('market_instruments',{action:'search',source:f.source,query:'EXACT',limit:10,cursor:'prior'});
 assert.equal(result.nextCursor,'host-opaque-cursor');assert.deepEqual(result.metadata.connection,f.connection);assert.equal(f.calls[0].cursor,'prior');assert.equal(f.calls[0].limit,10);
});
test('description and chart binding preserve exact clock and unknown calendar',async()=>{
 const f=fixture(),args={source:f.source,instrument:f.instrument.ref};
 const result=await f.call('market_instruments',{...args,action:'describe'});assert.deepEqual(result.instrument.timeBasis,f.instrument.timeBasis);
 for(const timeframe of ['1h','15m']){const value=await f.call('canvas_binding',{...args,timeframe});assert.equal(value.binding.spec.timeframe,timeframe);assert.deepEqual(value.binding.spec.calendarRevision,f.instrument.calendar);assert.deepEqual(value.binding.source.binding.connection,f.connection);assert.equal(value.validation.rendered,false);}
 assert.ok(f.calls.every(call=>call.operation==='describeInstrument'));
});
test('ambiguous or stale bindings and source errors never silently choose another source',async()=>{
 const f=fixture(),args={source:f.source,instrument:f.instrument.ref,timeframe:'1h'};
 await assert.rejects(f.call('canvas_binding',{...args,timeframe:'H1'}),{code:'UNSUPPORTED_CAPABILITY'});
 await assert.rejects(f.call('canvas_binding',{...args,source:{...f.source,binding:{connection:{...f.connection,revision:'old'}}}}),{code:'CONNECTION_CHANGED'});
 f.instrument.features.sessions=['regular','extended'];await assert.rejects(f.call('canvas_binding',args),/Choose session/);
 assert.equal((await f.call('canvas_binding',{...args,session:'extended'})).binding.spec.session,'extended');
 f.error=Object.assign(Error('source unavailable'),{code:'SOURCE_UNAVAILABLE'});await assert.rejects(f.call('market_instruments',{...args,action:'describe'}),{code:'SOURCE_UNAVAILABLE'});
});
test('indicator example retains Decimal and SourceTime, including forming data',()=>{
 const time={basis:'wall',authority:'Fixture-Broker',value:'2026-10-09T12:00:00'};
 const output=compute({inputs:{price:{rows:[{id:'stable-bar',openTime:time,close:'1.1234567890123456789',isClosed:false}]}},parameters:{}});
 assert.equal(output.status,'ready');assert.deepEqual(output.series[0].points[0],{key:'stable-bar',time,value:{status:'value',value:'1.1234567890123456789'}});
 assert.equal(compute({inputs:{price:{rows:[]}}}).status,'not_ready');
});
