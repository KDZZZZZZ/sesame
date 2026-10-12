import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {reportHTML} from '../report.js';

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
