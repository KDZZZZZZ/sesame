import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderLogicDiagram } from '../packages/reports/report-logic.js';
import { renderStructuredReport } from '../packages/reports/report-content.js';
const host=process.env.SESAME_HOST_ROOT;
const flow={title:'已有处理过程',nodes:[{id:'a',label:'已有输入',detail:'保留原始记录'},{id:'b',label:'条件判断'},{id:'c',label:'结果甲'},{id:'d',label:'结果乙'}],edges:[{from:'a',to:'b'},{from:'b',to:'c',label:'甲'},{from:'b',to:'d',label:'乙'}]};
const content={kind:'document',sections:[{title:'',blocks:[{type:'logic',...flow}]}]};
const args={title:'通用逻辑图',locale:'zh-CN',provenance_kind:'demo',data:[],content};
test('generic dependencies preserve shared inputs and labels while rejecting broken identities',async()=>{
  const data={...flow,nodes:flow.nodes.map(n=>({...n})),edges:[...flow.edges,{from:'a',to:'d'}]};
  data.nodes[0].label='<img src=x onerror=alert(1)>';const before=structuredClone(data),html=renderLogicDiagram(data);
  assert.deepEqual(data,before);assert.match(html,/\\u003cimg/);assert.doesNotMatch(html,/<img/);
  const payload=JSON.parse(html.match(/<script type="application\/json">(.*?)<\/script>/s)[1]);
  assert.deepEqual(payload.graph.edges,data.edges);assert.equal(payload.graph.nodes[0].label,data.nodes[0].label);
  assert.throws(()=>renderLogicDiagram({...flow,edges:[{from:'missing',to:'a'}]}),/existing nodes/);
  assert.throws(()=>renderLogicDiagram({...flow,edges:[...flow.edges,{from:'c',to:'a'}]}),/circular dependencies/);
});
test('components and provider accept the same generic diagram schema', {skip:!host},async()=>{
  const {validateSchemas}=await import(pathToFileURL(join(host,'modules/shared/schema-service.js')).href);
  const contract=JSON.parse(await readFile(new URL('../packages/reports/capabilities.json',import.meta.url),'utf8'));
  const values={components_show:{operation_id:'diagram-fixture',title:'演示',provenance_kind:'demo',content},report_render:{metadata:{title:'演示',summary:'软件测试',locale:'zh-CN',provenanceKind:'demo',features:[]},data:[],related:[],references:[],input:{content}}};
  for(const[id,value]of Object.entries(values))await validateSchemas([{schema:contract.capabilities.find(c=>c.id===id).inputSchema,value}]);
});
test('shared canvas retains ports, selection, zoom, narrow layout and exact supplied node detail', {skip:!host,timeout:30000},async t=>{
  const {chromium}=createRequire(join(host,'package.json'))('playwright');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const before=structuredClone(content);await page.setContent(await renderStructuredReport({},args));
  const graph=page.locator('[data-report-svl]');await graph.locator('.svl-node').first().waitFor();
  assert.equal(await graph.locator('.svl-node').count(),4);assert.ok(await graph.locator('.svl-port').count()>0);
  assert.doesNotMatch(await graph.innerText(),/保留原始记录/);
  assert.equal(await graph.locator('.report-node-detail').isVisible(),false);
  await graph.getByRole('button',{name:'实际大小',exact:true}).click();assert.equal(Number(await graph.locator('.svl-graph').getAttribute('data-zoom')),1);
  await graph.getByRole('button',{name:'缩小图',exact:true}).click();assert.ok(Number(await graph.locator('.svl-graph').getAttribute('data-zoom'))<1);
  await graph.locator('[data-node-id="a"]').click();assert.equal(await graph.locator('[data-node-id="a"]').getAttribute('aria-pressed'),'true');
  assert.match(await graph.locator('.report-node-detail').innerText(),/保留原始记录/);
  assert.equal((await graph.innerText()).split('保留原始记录').length-1,1,'Node detail appears only in the selected detail view');
  assert.ok(await graph.locator('.svl-connection[data-connected]').count()>0);
  for(const width of [1000,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.emulateMedia({media:'print'});assert.ok((await page.pdf()).length>1000);
  assert.deepEqual(content,before);assert.deepEqual(errors,[]);
});
