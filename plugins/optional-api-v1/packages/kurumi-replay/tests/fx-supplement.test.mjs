import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseHistDataCSV,prepareFxSupplement,publishFxSupplement,loadFxSupplement} from '../fx-supplement.js';
import {joinAsOfQuotes} from '../native-engine.js';
import {hash,storage} from '../scripts/data-core.mjs';
import {ReplayService} from '../service.js';
import {Recorder} from '../recording.js';

const from=Date.parse('2015-01-15T22:00:00Z'), runId='kurumi-11111111-1111-4111-8111-111111111111';
const binding={runId,from,toExclusive:from+3600000,snapshotDigest:hash('fixture snapshot'),configDigest:hash('fixture config')};
const csv=Buffer.from('20150115 165959000,137.100000,137.200000,0\n20150115 170405100,137.300000,137.400000,0\n');
const q=(time,bid='137.100')=>({time,bid,ask:'137.900',source:'test-only'});
async function bundle(t){
 const root=await fs.mkdtemp(join(tmpdir(),'kurumi-fx-supplement-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dir=join(root,'bundle');await fs.mkdir(dir);await fs.writeFile(join(dir,'quotes.csv'),csv);
 const zip=Buffer.from('TEST ONLY zip provenance fixture, not market evidence');await fs.writeFile(join(dir,'download.zip'),zip);
 const m={schemaVersion:1,provider:'HistData.com',symbol:'CHFJPY',format:'generic_ascii_ticks',timezone:'EST_UTC_MINUS_05_NO_DST',...binding,
  raw:{path:'quotes.csv',bytes:csv.length,digest:hash(csv)},zip:{path:'download.zip',bytes:zip.length,digest:hash(zip)},download:{url:'https://www.histdata.com/get.php',httpStatus:200,tlsAuthenticated:true,observedAt:'2026-10-12T00:00:00Z'}};
 await fs.writeFile(join(dir,'source.json'),JSON.stringify(m));return {root,dir,m};
}
test('fixed EST parsing preserves milliseconds, line evidence and lossless prices',()=>{
 const rows=parseHistDataCSV(csv,{...binding,source:'fixture'});assert.equal(rows[1].time,from+245100);assert.equal(rows[1].bid,'137.300');assert.equal(rows[1].sourceLine,2);
 assert.throws(()=>parseHistDataCSV(Buffer.from('20150115 170405100,137.300010,137.400000,0\n'),{...binding,source:'fixture'}),/precision/);
 assert.throws(()=>parseHistDataCSV(Buffer.from('20150115 170405100,137.500000,137.400000,0\n'),{...binding,source:'fixture'}),/bid\/ask/);
});
test('supplement never overrides a fresh original and cannot look ahead or extend 60 seconds',()=>{
 const main=[q(from+245000)],original=[q(from+244000,'137.200')],extra=[q(from+244500,'137.300')];
 assert.equal(joinAsOfQuotes(main,original,{supplementalRows:extra})[0].fx.bid,'137.200');
 const old=[q(from)];const filled=joinAsOfQuotes(main,old,{supplementalRows:extra})[0];assert.equal(filled.fx.bid,'137.300');assert.equal(filled.fxAgeMs,500);assert.ok(filled.fxSupplement);
 assert.throws(()=>joinAsOfQuotes(main,old,{supplementalRows:[q(from+245001)]}),/60000/);
 assert.throws(()=>joinAsOfQuotes(main,old,{supplementalRows:[q(from+184999)]}),/60000/);
 assert.throws(()=>joinAsOfQuotes(main,old,{fxMaxAgeMs:60001}),/maximum age/);
});
test('immutable import pins run, snapshot and uncommitted window; tampering fails closed',async t=>{
 const {root,dir}=await bundle(t),dest=join(root,'storage');await storage(dest,true);
 const prepared=await prepareFxSupplement(dir,binding);await publishFxSupplement(dest,prepared);
 assert.equal((await publishFxSupplement(dest,prepared)).reused,true);
 const options={...binding,to:binding.toExclusive-1};assert.equal((await loadFxSupplement(dest,options)).rows.length,2);
 await assert.rejects(prepareFxSupplement(dir,{...binding,from:from+3600000}),/uncommitted/);
 await assert.rejects(prepareFxSupplement(dir,{...binding,runId:'different'}),/another run/);
 await assert.rejects(loadFxSupplement(dest,{...options,snapshotDigest:hash('changed')}),/binding/);
 assert.deepEqual((await loadFxSupplement(dest,{...options,from:from-3600000})).rows,[]);
 await fs.appendFile(join(dest,'kurumi-data-v1',prepared.index.raw.path),'tamper');
 await assert.rejects(loadFxSupplement(dest,options),/hash changed/);
});
test('service import archives both copies before activation, changes no engine or continuation and is idempotent',async t=>{
 const {root,dir}=await bundle(t),directory=join(root,'storage');await storage(directory,true);
 let doc={id:'continuous',revision:1,commands:{},engine:{id:runId,version:471,status:'missing_data',chapter:0,index:0,balance:'315939.74925',fills:[{id:'untouched'}]},control:{running:false,active:null,recovery:null,continuation:{decisionId:'saved',remainingBars:3}}};
 const host={storage:{directory,get:()=>structuredClone(doc),put:(_c,d)=>{doc=structuredClone(d);},transaction:fn=>fn()}};
 const service=new ReplayService(host);service.data={frames:[[{time:from-3600000},{time:from}]],digests:{download:binding.snapshotDigest,config:binding.configDigest}};
 service.recorder=new Recorder(directory,{mirrorRoot:join(root,'mirror')});
 service.status=()=>({revision:doc.revision});
 const before=structuredClone(doc),args={command_id:'test_fixture_import',expected_version:1,bundle_directory:dir};
 const result=await service.importFxSupplement(args);assert.equal(result.installed,true);assert.deepEqual(doc.engine,before.engine);assert.deepEqual(doc.control,before.control);
 assert.equal((await service.importFxSupplement(args)).revision,2);assert.equal(doc.fxSupplements.length,1);
 const raw=result.index.raw;const archived=join('data-supplements',raw.path);
 assert.deepEqual(await fs.readFile(join(directory,'recording',archived)),csv);assert.deepEqual(await fs.readFile(join(root,'mirror',archived)),csv);
 doc.control.active={id:'busy'};await assert.rejects(service.importFxSupplement({...args,command_id:'blocked',expected_version:2}),{code:'DECISION_PENDING'});
});
