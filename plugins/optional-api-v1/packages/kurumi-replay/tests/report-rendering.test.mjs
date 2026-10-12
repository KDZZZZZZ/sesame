import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {reportHTML,publishReport} from '../report.js';
import {fixture,sha} from './round2-presentation-fixtures.test.mjs';

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
    f.host.artifacts.blob=text=>{const ref={digest:sha(text),size:Buffer.byteLength(text)};f.blobs.set(ref.digest,text);return ref;};
    const publish=f.host.artifacts.publish;
    f.host.artifacts.publish=async request=>{
      const ref=await publish(request);
      if(request.operationId==='main-report:source')f.data.provenance={kind:kind==='demo'?'derived':'demo'};
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
    assert.equal(f.calls.inference.length,0);assert.equal(f.engine.fills.length,0);
  });
}
