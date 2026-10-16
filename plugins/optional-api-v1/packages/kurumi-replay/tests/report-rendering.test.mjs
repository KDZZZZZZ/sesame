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
    const resources=new Map();
    f.host.context={kind:'main',sessionId:'fixture'};
    f.host.views={inspect:async()=>({status:'pending',classification:'fixture-not-client'})};
    f.host.resources={
      create:async request=>{
        const ref={id:'resource-'+resources.size,kind:request.kind,version:1};
        resources.set(ref.id,{ref,request:structuredClone(request)});return ref;
      },
      publish:async(root,manifest)=>{
        const operationId=manifest.kind==='resource'?'main-report:source':manifest.kind==='data'?'main-report:data':'main-report';
        const files=manifest.blobs.map(file=>{
          const row=[...resources.values()].find(item=>item.request.parent?.id===root.id&&item.request.name===file.entry);
          assert.ok(row,'Publication must reference a created resource');
          return {...file,content:row.request.source.content};
        });
        const ref={id:'artifact-'+f.artifacts.size,revision:'1',digest:sha(manifest),kind:manifest.kind,schemaVersion:'1.0.0'};
        f.artifacts.set(operationId,{request:{manifest:structuredClone(manifest)},ref,files});
        if(operationId==='main-report:source'){
          f.data.provenance={kind:kind==='demo'?'derived':'demo'};f.data.digests={later:'UNREVEALED_DIGEST'};
          Object.assign(f.engine,{version:2,status:'complete',outcome:'victory'});
          f.service.observe=()=>({asOf:T+H,account:{equity:'20000000'}});
        }
        return {ref};
      },
    };
    const result=await publishReport(f.host,f.service,'main-report');
    assert.equal(result.provenanceKind,kind);assert.equal(f.artifacts.size,3);
    for(const {request:{manifest}} of f.artifacts.values()){
      assert.equal(manifest.provenance.kind,kind);
      assert.deepEqual(manifest.content.provenance,manifest.provenance);
      assert.deepEqual(manifest.dependencies,manifest.provenance.references);
    }
    assert.deepEqual(f.artifacts.get('main-report').request.manifest.dependencies,[result.data,result.source]);
    const sourceBlob=f.artifacts.get('main-report:source').files[0];
    const rowsBlob=f.artifacts.get('main-report:data').files[0];
    const archivedSource=f.calls.archives.find(row=>row.path.endsWith('-checkpoint.json')).text;
    const archivedRows=f.calls.archives.find(row=>row.path.endsWith('-rows.json')).text;
    assert.equal(archivedSource,sourceBlob.content);assert.equal(archivedRows,rowsBlob.content);
    assert.equal(JSON.parse(archivedSource).checkpoint.engine.version,1);assert.equal(archivedSource.includes('UNREVEALED_DIGEST'),false);
    assert.equal(result.engineVersion,1);assert.equal(result.asOf,T);assert.equal(result.status,'paused');assert.equal(result.outcome,null);
    assert.equal(JSON.parse(archivedRows)[0].version,result.engineVersion);
    assert.deepEqual(JSON.parse(archivedRows).find(row=>row.type==='source').nativeEnvironment,f.service.nativeEnvironment);
    assert.equal(f.artifacts.get('main-report').request.manifest.content.summary,(kind==='demo'?'演示数据 · ':'')+'模拟挑战进行中；当前尚不能判定胜利。');
    assert.equal(f.calls.inference.length,0);assert.equal(f.engine.fills.length,0);
  });
}
