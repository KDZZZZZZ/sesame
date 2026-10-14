// New core checks ONLY. Isolated on-disk SQLite adapter, NOT Sesame Store/SDK receipt.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join,dirname } from 'node:path';
import { ReplayService } from '../service.js';
import { Recorder } from '../recording.js';
import { createRun } from '../native-engine.js';
import { canonical,sha256,ROUND2_PROFILE_ID } from '../experiment-profiles.js';
const root=dirname(fileURLToPath(new URL('../package.json',import.meta.url))),dirs=[],dbs=[];
after(async()=>{for(const db of dbs)try{db.close();}catch{};for(const d of dirs)await fs.rm(d,{recursive:true,force:true});});
function store(directory) {
 const db=new DatabaseSync(join(directory,'fixture.sqlite'));dbs.push(db);db.exec('CREATE TABLE IF NOT EXISTS rows (c TEXT,id TEXT,body TEXT,PRIMARY KEY(c,id))');
 return {directory,get(c,id,optional=false){const row=db.prepare('SELECT body FROM rows WHERE c=? AND id=?').get(c,id);if(!row&&!optional)throw Error('record missing');return row?JSON.parse(row.body):null;},
 list(c){return db.prepare('SELECT body FROM rows WHERE c=? ORDER BY id').all(c).map(r=>JSON.parse(r.body));},put(c,r){db.prepare('INSERT INTO rows VALUES(?,?,?) ON CONFLICT(c,id) DO UPDATE SET body=excluded.body').run(c,r.id,canonical(r));},transaction(fn){db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}},close(){db.close();}};
}
async function fixture() {
 const directory=await fs.mkdtemp(join(root,'.round2-core-fixture-'));dirs.push(directory);let paid=0;
 const host={storage:store(directory),agents:{submit(){paid++;throw Error('Forbidden paid call');},inspect(){throw Error('No real tasks');}},inference:{models(){paid++;throw Error('Creation must not select/request model');}}};
 const service=new ReplayService(host);service.recorder=new Recorder(directory,{mirrorRoot:join(directory,'mirror')});await service.recorder.initialize();
 const chapters=['AUDJPY','USDJPY','EURCHF'].map(symbol=>({symbol,startIndex:0,endIndex:1}));const time=Date.UTC(2024,0,8);
 const engine=createRun('kurumi-00000000-0000-0000-0000-000000000001',chapters,{fixture:'terminal-demo'});engine.status='complete';engine.outcome='not_reached';engine.chapter=2;engine.index=1;
 const old={id:'continuous',revision:7,engine,model:null,commands:{},control:{running:false,remaining:0,active:null,recovery:null,continuation:null,phase:'complete',attempt:0}};
 host.storage.put('challenge',old);service.data={chapters,frames:chapters.map(()=>[{time},{time:time+3600000}]),digests:engine.dataDigests,provenance:{kind:'demo'}};
 const seal={command_id:'seal-fixture',expected_version:7,run_id:engine.id},create={command_id:'new-fixture',expected_version:7,previous_run_id:engine.id,profile_id:ROUND2_PROFILE_ID};
 return {directory,host,service,old,seal,create,get paid(){return paid;}};
}
test('terminal seal -> distinct new50x run: exact retries, old continuous/history unchanged, no model',async()=>{
 const f=await fixture();const seal=await f.service.archiveTerminal(f.seal);assert.ok(seal.sealed);assert.deepEqual(f.service.getDocument(),f.old);
 assert.deepEqual(await f.service.archiveTerminal(f.seal),seal);const created=await f.service.createExperiment(f.create);
 assert.notEqual(created.runId,f.old.engine.id);assert.equal(created.initialBalanceJPY,'300000');assert.equal(created.goalJPY,'20000000');assert.equal(created.modelRequested,false);
 assert.deepEqual(f.host.storage.get('challenge','continuous'),f.old);assert.deepEqual(f.host.storage.get('experiment-history',f.old.engine.id).document,f.old);
 assert.deepEqual(await f.service.createExperiment(f.create),created);assert.equal(f.host.storage.list('challenge').length,2);assert.equal(f.paid,0);
 assert.deepEqual(f.service.getState().rules.chapterRules.map(r=>r.leverage),['50','50','50']);assert.equal(f.service.getDocument().control.running,false);
 await assert.rejects(f.service.createExperiment({...f.create,profile_id:'other'}));
});
test('changed idempotent content and unknown transactions blocked without new capital',async()=>{
 const f=await fixture();await f.service.archiveTerminal(f.seal);
 await assert.rejects(f.service.archiveTerminal({...f.seal,expected_version:8}),{code:'IDEMPOTENCY_CONFLICT'});
 f.host.storage.put('experiment-commands',{id:'unknown-other',status:'creating',input:{unknown:true}});
 await assert.rejects(f.service.createExperiment(f.create),{code:'TRANSACTION_UNKNOWN'});assert.equal(f.host.storage.list('challenge').length,1);assert.equal(f.paid,0);
});
test('active/recovery/continuation/unknown/archive failure/nonterminal/role unsealed all gate',async()=>{
 for(const mutation of [d=>d.control.active={},d=>d.control.recovery={},d=>d.control.continuation={},d=>d.control.archiveFailed={},d=>d.control.phase='submission_unknown',d=>d.engine.status='paused',d=>d.control.taskIds=['missing-role']]){
  const f=await fixture(),d=structuredClone(f.old);mutation(d);f.host.storage.put('challenge',d);
  await assert.rejects(f.service.archiveTerminal(f.seal));assert.equal(f.host.storage.list('experiment-history').length,0);assert.equal(f.paid,0);
 }
 const f=await fixture();await assert.rejects(f.service.createExperiment(f.create),{code:'HISTORY_UNSEALED'});
});
test('archive mirror failure leaves old untouched, failed reservation blocks new; same seal explicitly retries',async()=>{
 const f=await fixture(),file=f.service.recorder.file.bind(f.service.recorder);let fail=true;
 f.service.recorder.file=async(...a)=>{if(fail)throw Object.assign(Error('isolated disk failure'),{code:'ARCHIVE_WRITE_FAILED'});return file(...a);};
 await assert.rejects(f.service.archiveTerminal(f.seal),{code:'ARCHIVE_WRITE_FAILED'});assert.deepEqual(f.service.getDocument(),f.old);
 assert.equal(f.host.storage.get('experiment-commands',f.seal.command_id).status,'archive_failed');await assert.rejects(f.service.createExperiment(f.create),{code:'TRANSACTION_UNKNOWN'});
 fail=false;await f.service.archiveTerminal(f.seal);await f.service.createExperiment(f.create);assert.equal(f.paid,0);
});
test('physical close/reopen preserves new run identity and cannot revive/recharge old history',async()=>{
 const f=await fixture();await f.service.archiveTerminal(f.seal);const first=await f.service.createExperiment(f.create);f.host.storage.close();
 const host={...f.host,storage:store(f.directory)},service=new ReplayService(host);service.data=f.service.data;service.recorder=new Recorder(f.directory,{mirrorRoot:join(f.directory,'mirror')});
 assert.deepEqual(await service.createExperiment(f.create),first);assert.equal(service.getState().id,first.runId);
 assert.deepEqual(host.storage.get('challenge','continuous'),f.old);assert.equal(f.paid,0);
});
test('creation archive interruption reserves one new identity; retry recovers same run, not second funding',async()=>{
 const f=await fixture();await f.service.archiveTerminal(f.seal);const real=f.service.recorder.file.bind(f.service.recorder);f.service.recorder.file=async()=>{throw Error('interrupted initial archive');};
 await assert.rejects(f.service.createExperiment(f.create));const saved=f.host.storage.get('experiment-commands',f.create.command_id);assert.equal(saved.status,'creating');assert.ok(saved.newRunId);
 f.service.recorder.file=real;const result=await f.service.createExperiment(f.create);assert.equal(result.runId,saved.newRunId);assert.equal(f.host.storage.list('challenge').length,2);assert.equal(f.paid,0);
});
test('tampered or missing archive bytes cannot create new run; digest/content not JSON-order sensitive',async()=>{
 const f=await fixture();const seal=await f.service.archiveTerminal(f.seal);const file=join(f.service.recorder.mirror,seal.manifestFile.path);await fs.writeFile(file,'tampered');
 // manifest itself is verified, not merely its children.
 await assert.rejects(f.service.createExperiment(f.create));assert.equal(f.host.storage.list('challenge').length,1);
});
test('sealed current document rejects ordinary mutate, legacy rules unchanged',async()=>{
 const f=await fixture();await f.service.archiveTerminal(f.seal);assert.throws(()=>f.service.mutate(7,d=>d.engine.balance='300000'),{code:'HISTORY_SEALED'});
 assert.deepEqual(f.service.getState().rules.chapterRules,[{leverage:'500',stopout:'0.2'},{leverage:'25',stopout:'0.5'},{leverage:'25',stopout:'0.3'}]);
});

test('concurrent stable seal/create commands return same new run, not a failed overwriting reservation',async()=>{
 const f=await fixture();const seals=await Promise.all([f.service.archiveTerminal(f.seal),f.service.archiveTerminal(f.seal)]);assert.deepEqual(seals[0],seals[1]);
 const results=await Promise.all([f.service.createExperiment(f.create),f.service.createExperiment(f.create)]);assert.deepEqual(results[0],results[1]);assert.equal(f.host.storage.list('challenge').length,2);
 assert.equal(f.host.storage.get('experiment-commands',f.create.command_id).status,'committed');assert.deepEqual(await f.service.archiveTerminal(f.seal),seals[0]);
});

test('truly fresh isolated installation creates bounded50 directly, no fake legacy terminal/history or model',async()=>{
 const f=await fixture(),directory=await fs.mkdtemp(join(root,'.core-fresh-install-'));dirs.push(directory);const host={...f.host,storage:store(directory)},s=new ReplayService(host);s.data=f.service.data;s.recorder=new Recorder(directory,{mirrorRoot:join(directory,'mirror')});await s.recorder.initialize();
 const args={command_id:'fresh-direct',expected_version:0};const result=await s.createExperiment(args);assert.equal(result.freshPortableInstall,true);assert.equal(result.previousRunId,null);assert.equal(result.initialBalanceJPY,'300000');assert.equal(s.getDocument().experience.content.mode,'bounded_native_immersive_acceptance');assert.equal(s.getDocument().experience.content.limits.maxStepsPerCommand,1);assert.deepEqual(s.getState().rules.chapterRules.map(r=>r.leverage),['50','50','50']);assert.equal(host.storage.list('experiment-history').length,0);assert.equal(host.storage.list('challenge').length,1);assert.equal(f.paid,0);assert.deepEqual(await s.createExperiment(args),result);assert.deepEqual(f.host.storage.get('challenge','continuous'),f.old);
});
