import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {reportHTML,publishReport} from '../report.js';
import {fixture,sha,T,H} from './round2-presentation-fixtures.test.mjs';

for(const model of [null,{provider:'fixture',id:'configured-model'}]){
  test(`report initialization with ${model?'a selected model':'no selected model'}`,async()=>{
    const script=[...reportHTML().matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    const element={textContent:''},rendered=[];let initialized;
    runInNewContext(script,{
      reportKit:{rows:async()=>[{type:'summary',model,status:'created_paused',balance:'300000',markedEquity:'300000'},
        {type:'source',provenance:{kind:'demo'},digests:{}}],render:(selector,report)=>rendered.push({selector,report})},
      window:{report:{track:promise=>(initialized=promise)}},document:{getElementById:()=>element},
    });
    await initialized;
    assert.equal(element.textContent,'');assert.equal(rendered.length,1);
    assert.equal(rendered[0].report.meta.find(row=>row.label==='模型').value,model?'fixture/configured-model':'尚未选择模型');
    assert.equal(rendered[0].report.metrics.find(row=>row.label==='已结算余额').value,'300000');
  });
}

for(const kind of ['demo','derived']){
  test(`main report preserves frozen ${kind} provenance at both manifest levels`,async()=>{
    const f=fixture();f.data.provenance={kind};
    f.service.getDocument=()=>({model:null,control:{phase:'created_paused'}});
    f.service.getReplayPresentation=()=>({bars:[]});
    f.service.nativeEnvironment={status:'synthetic-no-native-engine'};
    f.host.artifacts.blob=text=>{const ref={digest:sha(text),size:Buffer.byteLength(text)};f.blobs.set(ref.digest,text);return ref;};
    const publish=f.host.artifacts.publish;
    f.host.artifacts.publish=async request=>{
      const ref=await publish(request);
      if(request.operationId==='main-report:source'){
        f.data.provenance={kind:kind==='demo'?'derived':'demo'};f.data.digests={later:'UNREVEALED_DIGEST'};
        Object.assign(f.engine,{version:2,status:'complete',outcome:'victory'});
        f.service.observe=()=>({asOf:T+H,account:{equity:'20000000'}});
      }
      return ref;
    };
    const result=await publishReport(f.host,f.service,'main-report');
    assert.equal(result.provenanceKind,kind);assert.equal(f.artifacts.size,3);
    for(const {request:{manifest}} of f.artifacts.values()){
      assert.equal(manifest.provenance.kind,kind);
      assert.deepEqual(manifest.content.provenance,manifest.provenance);
      assert.deepEqual(manifest.dependencies,manifest.provenance.references);
    }
    assert.deepEqual(f.artifacts.get('main-report').request.manifest.dependencies,[result.data,result.source]);
    const sourceBlob=f.artifacts.get('main-report:source').request.manifest.blobs[0];
    const rowsBlob=f.artifacts.get('main-report:data').request.manifest.blobs[0];
    const archivedSource=f.calls.archives.find(row=>row.path.endsWith('-checkpoint.json')).text;
    const archivedRows=f.calls.archives.find(row=>row.path.endsWith('-rows.json')).text;
    assert.equal(archivedSource,f.blobs.get(sourceBlob.digest));assert.equal(archivedRows,f.blobs.get(rowsBlob.digest));
    assert.equal(JSON.parse(archivedSource).checkpoint.engine.version,1);assert.equal(archivedSource.includes('UNREVEALED_DIGEST'),false);
    assert.equal(result.engineVersion,1);assert.equal(result.asOf,T);assert.equal(result.status,'paused');assert.equal(result.outcome,null);
    assert.equal(JSON.parse(archivedRows)[0].version,result.engineVersion);
    assert.deepEqual(JSON.parse(archivedRows).find(row=>row.type==='source').nativeEnvironment,f.service.nativeEnvironment);
    assert.equal(f.artifacts.get('main-report').request.manifest.content.summary,'真实角色模拟挑战进行中；当前尚不能判定胜利。');
    assert.equal(f.calls.inference.length,0);assert.equal(f.engine.fills.length,0);
  });
}
