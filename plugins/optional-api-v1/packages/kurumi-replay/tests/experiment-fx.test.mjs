// New explicit full-window binding fixtures; no network/download authenticity claim.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../experiment-profiles.js';
import { prepareExperimentFx,publishExperimentFx,loadExperimentFx } from '../experiment-fx.js';
import { ReplayService } from '../service.js';
import { Recorder } from '../recording.js';
import { ROUND2_PROFILE_ID } from '../experiment-profiles.js';
import { createRun } from '../native-engine.js';
import { joinAsOfQuotes } from '../native-engine.js';
const root=dirname(fileURLToPath(new URL('../package.json',import.meta.url))),dirs=[];after(async()=>{for(const d of dirs)await fs.rm(d,{recursive:true,force:true});});
async function fixture(){const directory=await fs.mkdtemp(join(root,'.round2-core-fx-'));dirs.push(directory);const bundle=join(directory,'bundle');await fs.mkdir(bundle);await fs.mkdir(join(directory,'kurumi-data-v1'));
 const from=Date.UTC(2024,0,8,5),toExclusive=from+48*3600000,runId='kurumi-00000000-0000-0000-0000-000000000005';
 const raw=Buffer.from('20240108 000000000,160.000000,160.200000,0\n20240109 000000000,161.000000,161.200000,0\n'),zip=Buffer.from('fixture bytes, not genuine zip/download');
 const m={schemaVersion:2,provider:'HistData.com',symbol:'CHFJPY',format:'generic_ascii_ticks',timezone:'EST_UTC_MINUS_05_NO_DST',runId,from,toExclusive,snapshotDigest:'sha256:'+'1'.repeat(64),configDigest:'sha256:'+'2'.repeat(64),download:{url:'https://www.histdata.com/get.php',httpStatus:200,tlsAuthenticated:true,observedAt:'2024-01-10T00:00:00Z',classification:'fixture_not_observed_download'},raw:{path:'quotes.csv',bytes:raw.length,digest:sha256(raw)},zip:{path:'download.zip',bytes:zip.length,digest:sha256(zip)}};
 await fs.writeFile(join(bundle,'source.json'),JSON.stringify(m));await fs.writeFile(join(bundle,'quotes.csv'),raw);await fs.writeFile(join(bundle,'download.zip'),zip);
 return {directory,bundle,m,expected:{runId,from,toExclusive,snapshotDigest:m.snapshotDigest,configDigest:m.configDigest}};}
test('schema2 full-window newrun binding + bounded load, never copies old pointer',async()=>{
 const f=await fixture(),old='kurumi-00000000-0000-0000-0000-000000000001',oldDir=join(f.directory,'kurumi-data-v1','fx-supplements',old);await fs.mkdir(oldDir,{recursive:true});await fs.writeFile(join(oldDir,'active.json'),'old-pointer-fixture');
 const p=await prepareExperimentFx(f.bundle,f.expected);assert.equal(p.rowCount,2);assert.equal(p.index.schemaVersion,2);assert.equal(p.index.runId,f.expected.runId);assert.equal(p.index.coverage.completeForArbitraryExposure,false);
 assert.equal((await publishExperimentFx(f.directory,p)).reused,false);assert.equal((await publishExperimentFx(f.directory,p)).reused,true);const loaded=await loadExperimentFx(f.directory,{...f.expected,to:f.expected.from+3599999});assert.equal(loaded.rows.length,1);assert.equal(loaded.rows[0].time,f.expected.from);
 assert.equal(await fs.readFile(join(oldDir,'active.json'),'utf8'),'old-pointer-fixture');assert.ok(p.files.every(([r])=>r.path.startsWith(`fx-supplements/${f.expected.runId}/`)));
 const absent=await loadExperimentFx(f.directory,{...f.expected,runId:'kurumi-00000000-0000-0000-0000-000000000009',to:f.expected.from+1000});assert.deepEqual(absent,{rows:[],sources:[]});
});
test('oldrun/schema1/partial24H or changed snapshot cannot be silently rebound',async()=>{
 const f=await fixture();for(const patch of [{runId:'kurumi-00000000-0000-0000-0000-000000000001'},{schemaVersion:1},{toExclusive:f.expected.from+24*3600000},{snapshotDigest:'sha256:'+'3'.repeat(64)}]){await fs.writeFile(join(f.bundle,'source.json'),JSON.stringify({...f.m,...patch}));await assert.rejects(prepareExperimentFx(f.bundle,f.expected),{code:'INVALID_FX_SUPPLEMENT'});}
});
test('source bytes mutation rejected; real/tick/FX freshness not faked by full-window bounds',async()=>{
 const f=await fixture(),p=await prepareExperimentFx(f.bundle,f.expected);await publishExperimentFx(f.directory,p);const loaded=await loadExperimentFx(f.directory,{...f.expected,to:f.expected.from+1000});
 assert.throws(()=>joinAsOfQuotes([{time:f.expected.from+60001,bid:'1',ask:'1.0002'}],[],{supplementalRows:loaded.rows}),{code:'INVALID_DATA'});
 await fs.writeFile(join(f.bundle,'quotes.csv'),'tampered');await assert.rejects(prepareExperimentFx(f.bundle,f.expected),{code:'INVALID_FX_SUPPLEMENT'});
});

test('CORE explicit FX reservation survives binary archive failure and same-command repair, blocks model start',async()=>{
 const f=await fixture(),rows=new Map(),copy=x=>JSON.parse(JSON.stringify(x));let paid=0;
 const host={storage:{directory:f.directory,get(c,id,optional=false){const r=rows.get(c+':'+id);if(!r&&!optional)throw Error('Missing record');return r?copy(r):null;},list(c){return [...rows].filter(([k])=>k.startsWith(c+':')).map(([,r])=>copy(r));},put(c,r){rows.set(c+':'+r.id,copy(r));},transaction:fn=>fn()},inference:{models(){paid++;throw Error('Forbidden model selection');}}};
 const service=new ReplayService(host),chapters=['AUDJPY','USDJPY','EURCHF'].map(symbol=>({symbol,startIndex:0,endIndex:48})),engine=createRun(f.expected.runId,chapters,{download:f.m.snapshotDigest,config:f.m.configDigest},{profileId:ROUND2_PROFILE_ID});
 host.storage.put('challenge',{id:'continuous',revision:1,engine,commands:{},settings:{decisionIntervalHours:4},control:{phase:'created_paused',running:false,active:null,recovery:null,continuation:null,remaining:0}});
 service.data={chapters,digests:engine.dataDigests,frames:chapters.map(()=>Array.from({length:49},(_,i)=>({time:f.expected.from+(i-1)*3600000})))};
 service.recorder=new Recorder(f.directory,{mirrorRoot:join(f.directory,'mirror')});await service.recorder.initialize();const file=service.recorder.file.bind(service.recorder);let once=true;
 service.recorder.file=async(...a)=>{if(once&&a[0].endsWith('quotes.csv')){once=false;throw Object.assign(Error('fixture binary mirror failure'),{code:'ARCHIVE_WRITE_FAILED'});}return file(...a);};
 const args={command_id:'full-window-fx',expected_version:1,run_id:engine.id,bundle_directory:f.bundle};
 await assert.rejects(service.bindExperimentFx(args),{code:'ARCHIVE_WRITE_FAILED'});assert.equal(host.storage.get('experiment-commands',args.command_id).status,'binding_fx');
 await assert.rejects(service.start({command_id:'blocked-start',expected_version:service.getDocument().revision}),{code:'TRANSACTION_UNKNOWN'});assert.equal(paid,0);
 const result=await service.bindExperimentFx(args);assert.equal(result.bound,true);assert.equal(service.getState().version,1);assert.equal(service.getState().balance,'300000');assert.equal(paid,0);
 assert.deepEqual(await service.bindExperimentFx(args),result);assert.equal(service.getDocument().fxSupplements.length,1);
 const archived=await fs.readFile(join(service.recorder.mirror,'data-supplements',result.index.raw.path)),original=await fs.readFile(join(f.bundle,'quotes.csv'));assert.deepEqual(archived,original);
});
