import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplayService} from '../service.js';
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
