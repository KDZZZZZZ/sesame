import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReplayService} from '../service.js';
import {Recorder} from '../recording.js';
import {fixture,sha} from './round2-presentation-fixtures.test.mjs';

function setup(){
  const f=fixture(),service=new ReplayService(f.host),writes=[];
  const switches={writeFailure:true,sealFailure:false};
  f.host.workspace={taskRoot:runId=>'/synthetic-role-workspace/'+runId};
  f.host.storage.put('challenge',{id:'continuous',revision:1,engine:structuredClone(f.engine),
    control:{running:true,remaining:1,phase:'running',archiveFailed:null},roleTasks:[{actorRunId:'owned-role'}]});
  service.data=f.data;
  service.recorder={root:'/synthetic-recorder',
    append:async(kind,payload)=>{if(switches.writeFailure)throw Object.assign(Error('synthetic disk failure'),{code:'ARCHIVE_WRITE_FAILED'});writes.push({kind,payload});return {digest:sha(payload)};},
    file:async(path,content)=>{if(switches.writeFailure)throw Object.assign(Error('synthetic file failure'),{code:'ARCHIVE_WRITE_FAILED'});writes.push({path,content});return {digest:sha(content)};},
    protectRun:async runId=>{assert.equal(runId,'owned-role');if(switches.sealFailure)throw Object.assign(Error('synthetic sealing failure'),{code:'ARCHIVE_WRITE_FAILED'});return {digest:sha('synthetic role seal')};},
  };
  return {f,service,switches,writes};
}

test('role protection preserves unwritten committed evidence until explicit successful repair',async()=>{
  const {f,service,switches,writes}=setup(),original=service.getState();
  const payload={runId:original.id,engineVersion:original.version,evidence:'synthetic committed evidence'};
  await assert.rejects(service.archiveSafe('h1_committed',payload),{code:'ARCHIVE_WRITE_FAILED'});
  await assert.rejects(service.archiveFileSafe('exports/pending.json','synthetic full file'),{code:'ARCHIVE_WRITE_FAILED'});
  const failed=service.getDocument().control;
  assert.equal(failed.archiveFailed.pendings.length,2);assert.equal(failed.running,false);
  const protectedRole=await service.protectArtifacts('owned-role');assert.equal(protectedRole.resources.length,1);
  assert.deepEqual(service.getDocument().control,failed);assert.equal(writes.length,0);
  await assert.rejects(service.assertArchiveHealthy(),{code:'ARCHIVE_WRITE_FAILED'});
  assert.deepEqual(service.getDocument().control,failed);
  switches.writeFailure=false;await service.assertArchiveHealthy();
  assert.deepEqual(writes,[{kind:'h1_committed',payload},{path:'exports/pending.json',content:'synthetic full file'}]);
  const recovered=service.getDocument().control;assert.equal(recovered.archiveFailed,null);assert.equal(recovered.phase,'paused');assert.equal(recovered.running,false);
  await service.assertArchiveHealthy();assert.equal(writes.length,2);
  assert.deepEqual(service.getState(),original);assert.equal(f.calls.agent.length,0);assert.equal(f.calls.inference.length,0);
});

test('a failed seal followed by successful task protection still retains the older pending queue',async()=>{
  const {service,switches}=setup();
  await assert.rejects(service.archiveSafe('h1_committed',{version:1}),{code:'ARCHIVE_WRITE_FAILED'});
  const before=service.getDocument().control.archiveFailed.pendings;
  switches.sealFailure=true;await assert.rejects(service.protectArtifacts('owned-role'),{code:'ARCHIVE_WRITE_FAILED'});
  switches.sealFailure=false;await service.protectArtifacts('owned-role');
  const after=service.getDocument().control;assert.deepEqual(after.archiveFailed.pendings,before);assert.equal(after.phase,'archive_failed_paused');assert.equal(after.running,false);
  assert.deepEqual(await service.protectArtifacts('unrelated-role'),{artifacts:[],resources:[]});
  assert.deepEqual(service.getDocument().control,after);
});

for (const kind of ['journal','file','seal']) test(`a new ${kind} failure during awaited repair stays paused without replaying repaired entries`,async()=>{
  const {service,switches,writes}=setup(),original=service.getState();
  await assert.rejects(service.archiveSafe('h1_committed',{version:1}),{code:'ARCHIVE_WRITE_FAILED'});
  const originalFailure=service.getDocument().control.archiveFailed.failureId;
  switches.writeFailure=false;
  const append=service.recorder.append;
  let release;
  const wait=new Promise(resolve=>{release=resolve;});
  service.recorder.append=async(type,payload,opts)=>{
    if(type==='h1_committed'){await wait;return append(type,payload,opts);}
    if(type==='new_failure')throw Object.assign(Error('new concurrent journal failure'),{code:'ARCHIVE_WRITE_FAILED'});
    return append(type,payload,opts);
  };
  const repair=service.assertArchiveHealthy(),sameRepair=service.assertArchiveHealthy();
  assert.equal(repair,sameRepair,'share one pending repair, not two append loops');
  const rejected=assert.rejects(repair,{code:'ARCHIVE_RECOVERY_PENDING'});
  if(kind==='journal')await assert.rejects(service.archiveSafe('new_failure',{version:2}),{code:'ARCHIVE_WRITE_FAILED'});
  if(kind==='file'){
    switches.writeFailure=true;
    await assert.rejects(service.archiveFileSafe('new-file.txt','new bytes'),{code:'ARCHIVE_WRITE_FAILED'});
    switches.writeFailure=false;
  }
  if(kind==='seal'){
    switches.sealFailure=true;
    await assert.rejects(service.protectArtifacts('owned-role'),{code:'ARCHIVE_WRITE_FAILED'});
    switches.sealFailure=false;
  }
  release();await rejected;
  const control=service.getDocument().control;
  assert.notEqual(control.archiveFailed.failureId,originalFailure);
  assert.equal(control.archiveFailed.pendings.length,kind==='seal'?0:1);
  assert.equal(control.phase,'archive_failed_paused');assert.equal(control.running,false);
  assert.deepEqual(writes,[{kind:'h1_committed',payload:{version:1}}]);
  service.recorder.append=append;await service.assertArchiveHealthy();
  assert.equal(writes.filter(r=>r.kind==='h1_committed').length,1);
  assert.equal(service.getDocument().control.archiveFailed,null);
  assert.equal(service.getDocument().control.running,false);assert.deepEqual(service.getState(),original);
});

test('partial queue repair persists progress and retains the original failed simulation clock',async()=>{
  const {service,switches,writes}=setup();
  const payload={value:'frozen'};
  await assert.rejects(service.archiveSafe('first',payload,{simClockMs:123}),{code:'ARCHIVE_WRITE_FAILED'});
  payload.value='later';
  await assert.rejects(service.archiveSafe('second',{value:'second'},{simClockMs:456}),{code:'ARCHIVE_WRITE_FAILED'});
  const append=service.recorder.append,clocks=[];
  service.recorder.append=async(kind,data,opts)=>{
    if(kind==='second')throw Object.assign(Error('second still fails'),{code:'ARCHIVE_WRITE_FAILED'});
    clocks.push(opts.simClockMs);return append(kind,data,opts);
  };
  switches.writeFailure=false;
  await assert.rejects(service.assertArchiveHealthy(),{code:'ARCHIVE_WRITE_FAILED'});
  assert.deepEqual(writes,[{kind:'first',payload:{value:'frozen'}}]);
  assert.deepEqual(service.getDocument().control.archiveFailed.pendings.map(p=>p.pendingKind),['second']);
  service.recorder.append=async(kind,data,opts)=>{clocks.push(opts.simClockMs);return append(kind,data,opts);};
  await service.assertArchiveHealthy();assert.deepEqual(clocks,[123,456]);
  assert.deepEqual(writes.map(r=>r.kind),['first','second']);
  assert.equal(service.getDocument().control.archiveFailed,null);
});

for (const duringRepair of [false,true]) test(`real recorder mirror failure ${duringRepair?'during pending repair':'during original append'} survives restart without duplicating evidence`,async t=>{
  const {service,f}=setup(),original=service.getState();
  const root=await mkdtemp(join(tmpdir(),'kurumi-service-mirror-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const recorder=new Recorder(root),primary=join(recorder.root,'journal.ndjson'),mirror=join(recorder.mirror,'journal.ndjson');
  service.recorder=recorder;await recorder.initialize();
  if(duringRepair){
    await mkdir(primary);
    await assert.rejects(service.archiveSafe('h1_committed',{version:1},{simClockMs:123}),{code:'ARCHIVE_WRITE_FAILED'});
    await rm(primary,{recursive:true});
    // Reinitialize before blocking the mirror so this is a post-primary failure.
    await recorder.initialize();
    await mkdir(mirror);
    await assert.rejects(service.assertArchiveHealthy(),{code:'ARCHIVE_MIRROR_FAILED'});
  }else{
    await mkdir(mirror);
    await assert.rejects(service.archiveSafe('h1_committed',{version:1},{simClockMs:123}),{code:'ARCHIVE_MIRROR_FAILED'});
  }
  assert.equal(service.getDocument().control.archiveFailed.pendings.length,0,'committed primary payload is not unwritten');
  assert.equal(service.getDocument().control.running,false);
  await rm(mirror,{recursive:true});
  const restarted=new ReplayService(f.host);restarted.data=f.data;restarted.recorder=new Recorder(root);
  await restarted.assertArchiveHealthy();
  const bytes=await readFile(primary);assert.deepEqual(await readFile(mirror),bytes);
  const rows=bytes.toString().trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.kind),['h1_committed','archive_recovery_probe']);
  assert.equal(rows[0].simClockMs,123);assert.equal(rows[1].prevDigest,rows[0].digest);
  await new Recorder(root).initialize(); // Actual full-chain validation.
  await restarted.assertArchiveHealthy();assert.deepEqual(await readFile(primary),bytes);
  assert.equal(restarted.getDocument().control.archiveFailed,null);assert.equal(restarted.getDocument().control.running,false);
  assert.deepEqual(restarted.getState(),original);assert.equal(f.calls.agent.length,0);assert.equal(f.calls.inference.length,0);
});

test('first journal directory-sync failure rolls back before service repair appends the evidence',async t=>{
  const {service,f}=setup(),root=await mkdtemp(join(tmpdir(),'kurumi-directory-sync-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const recorder=new Recorder(root),primary=join(recorder.root,'journal.ndjson');
  service.recorder=recorder;await recorder.initialize();
  const open=fs.open;let failures=0;
  const mocked=t.mock.method(fs,'open',async function(path,...args){
    const handle=await open.call(fs,path,...args);
    if(path===recorder.root&&args[0]==='r'&&!failures++)handle.sync=async()=>{throw Object.assign(Error('synthetic directory fsync I/O failure'),{code:'EIO'});};
    return handle;
  });
  await assert.rejects(service.archiveSafe('h1_committed',{version:1},{simClockMs:123}),{code:'ARCHIVE_WRITE_FAILED'});
  assert.equal((await readFile(primary)).length,0,'failed transaction rolled back the already-fsynced line');
  assert.equal(service.getDocument().control.archiveFailed.pendings.length,1);mocked.mock.restore();
  const restarted=new ReplayService(f.host);restarted.data=f.data;restarted.recorder=new Recorder(root);
  await restarted.assertArchiveHealthy();
  const bytes=await readFile(primary);assert.deepEqual(await readFile(join(recorder.mirror,'journal.ndjson')),bytes);
  const rows=bytes.toString().trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.kind),['h1_committed']);assert.equal(rows[0].seq,1);assert.equal(rows[0].simClockMs,123);
  await new Recorder(root).initialize();assert.equal(restarted.getDocument().control.archiveFailed,null);
});
