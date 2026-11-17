import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStructuredReport } from '../packages/reports/report-content.js';
const chart = extra => ({ type:'chart',kind:'bar',title:'数量比较',rows:[{label:'A',value:0},{label:'B',value:4}],options:{x:'label',y:'value',unit:'个'},...extra });
const render=(blocks,extra={})=>renderStructuredReport({}, {title:'数量比较',lead:'合成数据展示了已提供的比较结果。',summary:'',locale:'zh-CN',provenance_kind:'demo',data:[],content:{kind:'document',sections:[{title:'数量比较',blocks}]},...extra});
const markup=html=>(html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]??html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
const count=(html,text)=>markup(html).split(text).length-1;
test('adjacent report, section and chart titles appear once while the plot keeps its name',async()=>{
  const html=await render([chart()]);assert.equal(count(html,'数量比较'),1);
  const config=JSON.parse(html.match(/id="sesame-module-charts"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(config[0].title,'数量比较');assert.deepEqual(config[0].rows,chart().rows);
});
test('prose has one explicit location and charts cannot add extra explanatory slots',async()=>{
  const html=await render([{type:'paragraph',text:'B 比 A 多四个'},chart()]);
  assert.equal(count(html,'B 比 A 多四个'),1);assert.doesNotMatch(markup(html),/kit-chart-caption/);
  for(const extra of [{takeaway:'重复说明'},{source_note:'重复来源'}])await assert.rejects(render([chart(extra)]),/Unsupported/);
});
test('distinct explanations and zero values stay in their explicit blocks',async()=>{
  const html=await render([{type:'paragraph',text:'保留样本 A'},{type:'judgment',text:'数量为 0，不能当作缺失'},{type:'metrics',items:[{label:'数量',value:0}]},{type:'paragraph',text:'USD'},chart()]);
  for(const text of ['保留样本 A','数量为 0，不能当作缺失','USD'])assert.equal(count(html,text),1);
  assert.match(markup(html),/<dd>0<\/dd>/);
  for(const block of [{type:'metrics',items:[{label:'数量',value:0,note:'说明'}]},{type:'range',label:'区间',min:0,max:10,value:4,note:'说明'},{type:'formula',latex:'a/b',caption:'说明'}])await assert.rejects(render([block]),/Unsupported/);
});
test('index summary is not inserted as visible report prose',async()=>{
  const html=await render([chart()],{summary:'仅供列表检索的摘要'});
  assert.doesNotMatch(markup(html),/仅供列表检索的摘要/);assert.equal(count(html,'数量比较'),1);
});
test('answer components retain their own title without report chrome',async()=>{
  const html=await render([chart()],{target:'answer',content:{kind:'document',sections:[{title:'',blocks:[chart()]}]}});
  assert.match(markup(html),/<strong[^>]*>数量比较<\/strong>/);
});
test('named sections and details reset adjacent title scope without creating an appendix',async()=>{
  const siblings=[chart({title:'营业收入'}),{type:'table',caption:'营业收入',columns:['地区','金额'],rows:[['华东',42]]},{type:'logic',title:'营业收入',nodes:[{id:'sales',label:'已记录销售'}],edges:[]}];
  const html=markup(await render([],{title:'营业收入',content:{kind:'document',sections:[{title:'子公司 A',blocks:[...siblings,{type:'details',title:'分地区记录',blocks:siblings}]},{title:'',blocks:[chart({title:'营业收入'})]}]}}));
  assert.equal((html.match(/<strong>营业收入<\/strong>/g)??[]).length,2);
  assert.equal((html.match(/<caption[^>]*>营业收入<\/caption>/g)??[]).length,2);
  assert.equal((html.match(/<h3>营业收入<\/h3>/g)??[]).length,2);
  assert.match(html,/<summary>分地区记录<\/summary>/);
});
