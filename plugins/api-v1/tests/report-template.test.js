import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilities as reportTools } from '../packages/reports/index.js';

test('report preview escapes authored text and retains fixed chart identity in the unified renderer', async () => {
  const writes=[];
  const tools=reportTools({capabilities:{invoke:async(id,input)=>{assert.equal(id,'sesame/workspace#write');writes.push(input);return {type:'result',value:{path:input.path}};}}});
  const template=tools.find(tool=>tool.name==='report_template');
  const dataId='</script><script>invalid()</script>';
  const result=await template.execute({output_path:'report.html',title:'</title><script>invalid()</script>',summary:'<strong>Untrusted text</strong>',data_id:dataId,chart_title:'Demo',takeaway:'Fictional sample',source_note:'Demo only',kind:'line',x:'month',y:'value',unit:'%',columns:['month','value'],demo:true});
  const html=writes[0].content;
  assert.match(html,/&lt;script&gt;invalid\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>invalid\(\)/);assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+href=/i);
  const config=JSON.parse(html.match(/<script id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(config[0].dataId,dataId);assert.equal(config[0].kind,'line');assert.deepEqual(config[0].columns,['month','value']);
  assert.match(html,/data-report-layout="unified"/);assert.match(html,/演示样本/);
  assert.equal(result.editable,false);assert.deepEqual(result.publish.style,{});
  assert.deepEqual(result.publish.content.sections[0].blocks[0].data_id,dataId);
  await assert.rejects(template.execute({kind:'matrix'}),/value column/);
});
