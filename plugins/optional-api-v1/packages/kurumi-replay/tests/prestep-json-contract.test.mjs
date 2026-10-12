import test from 'node:test';
import assert from 'node:assert/strict';
import {beforeStepContexts,freezeBeforeNative} from '../utc-before-step.js';
import {canonical,sha256,getExperimentProfile} from '../experiment-profiles.js';

function fixture(){
 const t=Date.UTC(2014,4,14),engine={id:'isolated-no-quotes',version:1,chapter:0,index:0,balance:'300000',position:null,lastQuote:null,rules:{experimentProfile:getExperimentProfile('informed-replay-50x-v1')},chapters:[{startIndex:0,weekendGaps:[]}],fills:[],ledger:[],orders:[],equity:[]};
 const data={frames:[[{time:t},{time:t+3600000}]]},market={id:engine.id,runId:engine.id,commitVersion:1,cutoffMs:t+3600000,sources:[],bars:[]};
 const decision={id:'original-model-decision',runId:engine.id,stepId:engine.id+':0:0',expectedVersion:1,target:'35000',stop:'95.630',reason:'original',utterance:'original'};
 const rows=new Map(),archives=new Map(),writes=[];
 const host={storage:{get(c,id,optional=false){assert.equal(typeof optional,'boolean');const row=rows.get(c+':'+id);if(!row&&!optional)throw Error('missing');return row??null;},put(c,row){const parsed=JSON.parse(canonical(row));rows.set(c+':'+row.id,structuredClone(parsed));},transaction(f){return f();}}};
 const service={host,getData:()=>data,getState:()=>engine,getReplayPresentation:()=>market,async archiveFileSafe(path,bytes){if(archives.has(path)&&archives.get(path)!==bytes)throw Error('ARCHIVE_CONFLICT');archives.set(path,bytes);writes.push(path);}};
 return {engine,data,market,decision,rows,archives,writes,service};
}
test('absent actual quote time is null, not the disclosure/cutoff time',()=>{const f=fixture(),r=beforeStepContexts(f.engine,f.data,f.market);assert.equal(r.opening.account.quoteTimeMs,null);assert.equal(r.opening.account.asOfMs,f.market.cutoffMs);assert.equal(r.opening.account.balance,'300000');assert.equal(r.opening.account.valuationStatus,'committed flat cash requires no market conversion');assert.equal(f.engine.lastQuote,null);});
test('canonical opening is valid JSON and strict nested Store roundtrips',async()=>{const f=fixture(),r=await freezeBeforeNative(f.service,f.engine,f.decision);assert.deepEqual(JSON.parse(canonical(r)),r);assert.deepEqual(f.rows.get('pre-step-boundaries:'+r.id),r);assert.equal(r.status,'captured_before_advance');assert.equal(r.digest,sha256(canonical(r.input)));for(const b of f.archives.values())assert.deepEqual(JSON.parse(b),r);});
test('invalid legacy raw evidence is retained; fixed capture uses a new filename',async()=>{const f=fixture(),legacy=`utc-boundaries/${f.engine.id}/2/before-native.json`,bad='{"quoteTimeMs":undefined}';f.archives.set(legacy,bad);await freezeBeforeNative(f.service,f.engine,f.decision);assert.equal(f.archives.get(legacy),bad);assert.deepEqual(f.writes,[`utc-boundaries/${f.engine.id}/2/before-native-v2.json`]);assert.equal(f.archives.size,2);});
test('retry same original intent is idempotent without another capture',async()=>{const f=fixture(),a=await freezeBeforeNative(f.service,f.engine,f.decision),b=await freezeBeforeNative(f.service,f.engine,structuredClone(f.decision));assert.deepEqual(a,b);assert.equal(f.writes.length,1);assert.equal(f.rows.size,1);});
test('changed original intent remains rejected after valid capture',async()=>{const f=fixture();await freezeBeforeNative(f.service,f.engine,f.decision);await assert.rejects(()=>freezeBeforeNative(f.service,f.engine,{...f.decision,target:'36000'}),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.equal(f.writes.length,1);});
test('non-opening ordinary step does not fabricate a quote or archive',async()=>{const f=fixture();f.engine.chapters[0].startIndex=99;const r=await freezeBeforeNative(f.service,f.engine,f.decision);assert.equal(r,null);assert.equal(f.writes.length,0);});
