import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderLogicDiagram, factorLogic } from '../packages/reports/report-logic.js';
import { renderStructuredReport } from '../packages/reports/report-content.js';
const host = process.env.SESAME_HOST_ROOT;
const expression = { op:'sub', args:[{op:'field',name:'close'},{op:'mean',window:20,args:[{op:'field',name:'close'}]}] };
const flow = { title:'已有规则怎样处理信号',nodes:[
  {id:'a',label:'得到信号'}, {id:'b',label:'条件是否满足？'},
  {id:'c',label:'按既定规则执行'}, {id:'d',label:'暂停使用'},
],edges:[{from:'a',to:'b'},{from:'b',to:'c',label:'满足'},{from:'b',to:'d',label:'不满足'}] };
const args = content => ({title:'逻辑图软件测试',locale:'zh-CN',provenance_kind:'demo',data:[],content});

test('factor diagrams preserve operand order and recorded windows without creating trade rules', () => {
  const before=structuredClone(expression), graph=factorLogic(expression);
  assert.deepEqual(expression,before);
  const subtraction=graph.nodes.find(n=>n.label==='①减去②');
  const incoming=graph.edges.filter(e=>e.to===subtraction.id);
  assert.equal(graph.nodes.find(n=>n.id===incoming.find(e=>e.label==='输入1').from).label,'收盘价');
  assert.deepEqual(graph.nodes.find(n=>n.id===incoming.find(e=>e.label==='输入2').from),{id:'step-2',label:'求平均值',detail:'20 个周期'});
  assert.doesNotMatch(JSON.stringify(graph),/买入|止损|仓位|上涨概率/);
  assert.equal(factorLogic('a custom expression'),null);
});

test('logic content preserves shared dependencies and escapes labels, rejecting broken graph identities', async () => {
  const data={...flow,nodes:flow.nodes.map(n=>({...n})),edges:[...flow.edges,{from:'a',to:'d'}]};
  data.nodes[0].label='<img src=x onerror=alert(1)>';
  const before=structuredClone(data), html=renderLogicDiagram(data);
  assert.deepEqual(data,before); assert.match(html,/\\u003cimg/); assert.doesNotMatch(html,/<img/);
  const payload=JSON.parse(html.match(/<script type="application\/json">(.*?)<\/script>/s)[1]);
  assert.deepEqual(payload.graph.edges,data.edges);
  assert.equal(payload.graph.nodes[0].label,data.nodes[0].label);
  assert.throws(()=>renderLogicDiagram({...flow,edges:[{from:'missing',to:'a'}]}),/existing nodes/);
  assert.throws(()=>renderLogicDiagram({...flow,edges:[...flow.edges,{from:'c',to:'a'}]}),/circular dependencies/);
  const document=await renderStructuredReport({},args({kind:'document',sections:[{title:'已有规则',blocks:[{type:'logic',...flow}]}]}));
  assert.match(document,/data-report-svl/); assert.match(document,/SesameSvlGraph.mount/); assert.doesNotMatch(document,/report-logic-viewport/);
});

test('all public report inputs accept the same logic content through their declared schema', {skip:!host}, async () => {
  const {validateSchemas}=await import(join(host,'modules/shared/schema-service.js'));
  const contract=JSON.parse(await readFile(new URL('../packages/reports/capabilities.json',import.meta.url),'utf8'));
  const content={kind:'document',sections:[{title:'规则',blocks:[{type:'logic',...flow}]}]};
  const values={
    report_document_template:{output_path:'fixture.html',title:'演示',content},
    report_publish:{operation_id:'fixture-logic-publication',title:'演示',summary:'软件测试',provenance_kind:'demo',data:[],content},
    report_render:{metadata:{title:'演示',summary:'软件测试',locale:'zh-CN',provenanceKind:'demo',features:[]},data:[],related:[],references:[],input:{content}},
  };
  for(const [id,value] of Object.entries(values))await validateSchemas([{schema:contract.capabilities.find(c=>c.id===id).inputSchema,value}]);
});

test('factor selection switches its actual logic diagram and keeps narrow pages and print complete', {skip:!host,timeout:30000}, async t => {
  const {chromium}=createRequire(join(host,'package.json'))('playwright');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const run={id:'synthetic',config:{rounds:1},trials:[
    {id:'one',name:'差值示例',candidate:expression},
    {id:'two',name:'成交量示例',candidate:{op:'field',name:'volume'}},
  ],selection:{trialIds:['one']}};
  const before=structuredClone(run), html=await renderStructuredReport({},args({kind:'signal-study',run}));
  const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
  assert.match(await page.locator('[data-factor-condition="0"] [data-report-svl]').innerText(),/这个因子怎么算出来/);
  assert.equal(await page.locator('[data-factor-condition="0"] [data-report-svl] .svl-node').count(),5);
  const first=page.locator('[data-factor-condition="0"] [data-report-svl]');
  assert.ok(await first.locator('.svl-port').count()>0);
  assert.equal(await first.locator('.svl-node__header').count(),5);
  await first.getByRole('button',{name:'实际大小',exact:true}).click();
  assert.equal(Number(await first.locator('.svl-graph').getAttribute('data-zoom')),1);
  await first.getByRole('button',{name:'缩小图',exact:true}).click();
  assert.ok(Number(await first.locator('.svl-graph').getAttribute('data-zoom'))<1);
  await first.getByRole('button',{name:'放大图',exact:true}).click();
  await first.locator('[data-node-id="step-1"]').click();
  assert.equal(await first.locator('[data-node-id="step-1"]').getAttribute('aria-pressed'),'true');
  assert.ok(await first.locator('.svl-connection[data-connected]').count()>0);
  await page.locator('#factor-focus').selectOption('1');
  assert.equal(await page.locator('[data-factor-condition="0"]').isVisible(),false);
  assert.match(await page.locator('[data-factor-condition="1"] [data-report-svl] .svl-graph svg').textContent(),/成交量/);
  assert.deepEqual(await page.locator('#run-snapshot').evaluate(n=>JSON.parse(n.textContent)),before);
  for(const width of [1000,390]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok(await page.locator('[data-report-svl]:visible .svl-node').evaluateAll(nodes=>nodes.every(n=>n.querySelector('.svl-node__id').getComputedTextLength() <= Number(n.querySelector('rect').getAttribute('width'))-40)));
  }
  await page.locator('[data-report-svl]:visible .svl-node[data-node-id="step-0"]').click();
  assert.equal(await page.locator('[data-report-evidence-appendix] details[open]').filter({hasText:'成交量'}).count(),1);
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('[data-report-svl]:visible .svl-graph').evaluate(n=>getComputedStyle(n).overflowX),'visible');
  assert.deepEqual(run,before);assert.deepEqual(errors,[]);
});
