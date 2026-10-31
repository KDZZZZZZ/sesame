import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderReasoning, renderInference } from '../packages/reports/report-reasoning.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const en = { escape, tr: (_, english) => english };
const zh = { escape, tr: chinese => chinese };
const ref = { id:'fictional-history', revision:'fixture-r1', digest:`sha256:${'a'.repeat(64)}`, kind:'data', schemaVersion:'1.0.0' };
const basis = () => ({
  scenario:'Fictional comparable observation', matching_method_ref:'fixture/matching@1', target:'Closed above the supplied reference', horizon:'Five closed bars',
  window:{start:'2026-01-01',end:'2026-06-30',as_of:'2026-07-01'}, sample:{matched:23,resolved:20,pending:1,excluded:2,effective:17.5},
  outcomes:[{label:'Above reference',count:14},{label:'Other outcomes',count:6}],
  baseline:{status:'unavailable',description:'No comparable baseline supplied; 66% in unrelated prose is not a numeric baseline.'},
  dependence:'Supplied overlap handling', uncertainty:'Supplied uncertainty explanation', limitations:['Fictional UI fixture only'], refs:[ref],
  sampling:{policy:'user_override',subject:'FIXTURE',selected_scope:'custom',instruments:['FIXTURE'],override_reason:'A deliberately fictional test sample'},
});
const reasoning = status => ({observations:['The supplied observation is 102.5.','The reference is 100.'],steps:['The observation lies above the reference.','This comparison alone does not establish the next return.'],conclusion:'Keep the stated condition under observation.',history:{status,note:status === 'linked' ? 'Same target and horizon.' : 'Comparable outcomes have not been supplied.'}});
const supplied = () => ({claim:'A concise, inspectable claim',method_ref:'fixture/method@1',confidence:{definition:'Supplied model probability',estimate:0.73123456789,interval:{lower:0.51234567891,upper:0.81234567891,level:0.95,method_ref:'fixture/interval@2'}},historical_basis:basis(),validation:{status:'historical_exploration',note:'Not an out-of-sample claim',history_refs:[ref]},knowledge_basis:{mechanism:'A supplied mechanism',expected_observation:'Compare the registered outcome',assumptions:['Closed observations only'],agreement:'mixed',interpretation:'The supplied comparison remains mixed.',theory_refs:['fixture/theory@3']},reasoning:reasoning('linked')});
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test('reasoning remains optional and renders only supplied public explanation', () => {
  for (const value of [undefined,null,false,'text',{}, {claim:'Existing claim'}, {reasoning:null}]) assert.equal(renderReasoning(value,en),'');
  const value=freeze(supplied()), before=structuredClone(value), html=renderReasoning(value,en);
  for (const prose of [...value.reasoning.observations,...value.reasoning.steps,value.reasoning.conclusion]) assert.ok(html.includes(prose));
  assert.equal((html.match(/class="report-reasoning-step"/g)||[]).length,3);
  assert.ok(html.indexOf('data-step="observations"')<html.indexOf('data-step="explanation"'));
  assert.ok(html.indexOf('data-step="explanation"')<html.indexOf('data-step="history"'));
  assert.ok(html.indexOf('data-step="history"')<html.indexOf('class="report-reasoning-conclusion"'));
  assert.deepEqual(value,before);
  assert.doesNotMatch(html, /<pre|<script|fetch\(|plugin|computed result|inferred type/i);
});

test('historical graphics only divide original outcome counts by resolved cases', () => {
  const value=supplied(), html=renderReasoning(value,en);
  assert.match(html,/Historical proportions/);
  assert.match(html,/14\/20 · 70%/);
  assert.match(html,/6\/20 · 30%/);
  assert.match(html,/style="width:70%"/);
  assert.match(html,/style="width:30%"/);
  assert.match(html,/0\.73123456789/,'The supplied confidence is not replaced with the 70% observed proportion');
  assert.match(html,/0\.51234567891/);
  assert.match(html,/fixture\/interval@2/);
  assert.doesNotMatch(html,/width:66%|width:73\.123/,'No prose baseline or confidence value becomes a historical bar');
});

test('invalid, empty and longer outcome sets do not create invented or partial graphics', () => {
  const cases=[
    {...basis(),sample:{resolved:0},outcomes:[]},
    {...basis(),outcomes:[{label:'Mismatch',count:19}]},
    {...basis(),outcomes:[{label:'Not a count',count:'20'}]},
    {...basis(),outcomes:[{label:'Negative',count:-1},{label:'Other',count:21}]},
    {...basis(),outcomes:Array.from({length:5},(_,i)=>({label:`Group ${i}`,count:4}))},
  ];
  for(const historical_basis of cases){
    const html=renderReasoning({...supplied(),historical_basis},en);
    assert.doesNotMatch(html,/report-reasoning-shares|style="width:/);
    for(const row of historical_basis.outcomes)assert.ok(html.includes(row.label),'All original outcomes remain in the evidence details');
  }
});

test('missing history stays pending or unavailable without default counts or confidence', () => {
  for(const status of ['pending','unavailable']){
    const value={claim:'Unsupported claim',status,reason:'Search has not returned comparable outcomes.',reasoning:reasoning(status)};
    const html=renderReasoning(value,en);
    assert.match(html,new RegExp(`data-history-status="${status}"`));
    assert.ok(html.includes(value.reasoning.history.note));
    assert.doesNotMatch(html,/report-reasoning-sample|report-reasoning-shares|report-reasoning-confidence|50%|0%/);
  }
  const html=renderReasoning({reasoning:reasoning('linked')},{...en,historyHTML:()=>''});
  assert.match(html,/data-history-status="pending"/);
  assert.match(html,/Historical evidence not linked/);
  assert.doesNotMatch(html,/report-reasoning-sample|style="width:/);
});

test('a real outer-context history callback can resolve linked evidence without invented local numbers', () => {
  const calls=[];
  const html=renderReasoning({reasoning:reasoning('linked')},{...en,historyHTML:(...args)=>{calls.push(args);return '<a href="#section-M13">Registered historical evidence</a>';}});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],[undefined,undefined,'summary']);
  assert.match(html,/data-history-status="linked"/);
  assert.match(html,/href="#section-M13"/);
  assert.doesNotMatch(html,/report-reasoning-sample|style="width:/);
});

test('a deterministic observation can explain why historical comparison is not applicable', () => {
  const value={reasoning:{observations:['Low 99; high 105.'],steps:['Both endpoints are observed values.'],conclusion:'The observed range is 99–105.',history:{status:'not_applicable',note:'This range reports the observed extremes and makes no prediction.'}}};
  const html=renderReasoning(value,en);
  assert.match(html,/data-history-status="not_applicable"/);
  assert.ok(html.includes(value.reasoning.history.note));
  assert.doesNotMatch(html,/report-reasoning-sample|report-reasoning-confidence|%|calculated|inferred/i);
});

test('comparison states stay short and factual without becoming data-type badges', () => {
  const expected={supporting:'支持',conflicting:'冲突',mixed:'结果混合',insufficient:'依据不足'};
  for(const [agreement,label] of Object.entries(expected)){
    const value=supplied();value.knowledge_basis.agreement=agreement;
    const html=renderReasoning(value,zh);
    assert.ok(html.includes(`data-agreement="${agreement}"`));assert.ok(html.includes(label));
    assert.doesNotMatch(html,/获取|计算结果|推断类型|插件|路由|badge/);
  }
});

test('legacy inferences preserve precise confidence and full history, knowledge and fixed references', () => {
  const value=supplied();delete value.reasoning;
  const before=structuredClone(value),html=renderInference(freeze(value),en);
  assert.match(html,/report-reasoning-inference/);
  assert.doesNotMatch(html,/report-reasoning-flow|<pre/);
  for(const token of ['0.73123456789','0.51234567891','0.81234567891','17.5','fixture/interval@2','fixture/matching@1','fixture-r1',ref.digest,'A supplied mechanism','fixture/theory@3','Supplied overlap handling','Supplied uncertainty explanation'])assert.ok(html.includes(token),token);
  assert.deepEqual(value,before);
  const missing=renderInference({claim:'No result',status:'pending',reason:'A unique missing-history explanation'},en);
  assert.equal((missing.split('<details')[0].match(/A unique missing-history explanation/g)||[]).length,1);
});

test('host helpers receive exact supplied objects once, without replacing confidence or evidence', () => {
  const value=freeze(supplied()),calls=[];
  const html=renderInference(value,{...en,confidenceHTML:confidence=>{calls.push(['confidence',confidence]);return '<p>Exact host confidence</p>';},historyHTML:(history,validation,display)=>{calls.push(['history',history,validation,display]);return '<p>Exact host history</p>';}});
  assert.equal(calls.length,2);
  assert.equal(calls[0][0],'history');assert.equal(calls[0][1],value.historical_basis);assert.equal(calls[0][2],value.validation);assert.equal(calls[0][3],'full');
  assert.equal(calls[1][0],'confidence');assert.equal(calls[1][1],value.confidence);
  assert.equal((html.match(/Exact host history/g)||[]).length,1);
  assert.equal((html.match(/Exact host confidence/g)||[]).length,1);
});

test('historyDisplay summary omits detailed history and ratios while retaining a real summary and confidence', () => {
  const value=supplied(),calls=[];
  const html=renderReasoning(value,{...en,historyDisplay:'summary',historyHTML:(basis,validation,display)=>{calls.push([basis,validation,display]);return '<a href="#section-M13">20 comparable cases</a>';}});
  assert.equal(calls.length,1);assert.equal(calls[0][0],value.historical_basis);assert.equal(calls[0][2],'summary');
  assert.match(html,/href="#section-M13"/);assert.match(html,/0\.73123456789/);
  assert.doesNotMatch(html,/report-reasoning-shares|Supplied overlap handling|Supplied uncertainty explanation/);
  const fallback=renderReasoning(value,{...en,historyDisplay:'summary'});
  assert.match(fallback,/<strong>20<\/strong> resolved cases/);
  assert.doesNotMatch(fallback,/report-reasoning-shares|Supplied overlap handling/);
});

test('historyDisplay hidden removes the comparison column and history without removing confidence or knowledge', () => {
  const value=supplied();
  const helpers={...en,historyDisplay:'hidden',historyHTML:()=>assert.fail('Hidden history must not invoke the history renderer')};
  for(const html of [renderReasoning(value,helpers),renderInference({...value,reasoning:undefined},helpers)]){
    assert.doesNotMatch(html,/data-step="history"|report-reasoning-sample|report-reasoning-shares|report-reasoning-history-detail|Historical comparison|Supplied overlap handling|Supplied uncertainty explanation|Validation references/);
    assert.match(html,/0\.73123456789/);assert.match(html,/0\.51234567891/);assert.match(html,/A supplied mechanism/);assert.match(html,/fixture\/theory@3/);
  }
  const html=renderReasoning(value,helpers);
  assert.match(html,/report-reasoning-flow-short/);
  assert.equal((html.match(/class="report-reasoning-step"/g)||[]).length,2);
  assert.match(renderInference({claim:'Unavailable result',status:'pending',reason:'A supplied result is still pending'},helpers).split('<details')[0],/A supplied result is still pending/);
});

test('all supplied prose and translated labels are escaped and citation text never becomes an active URL', () => {
  const attack='</p><img src=x onerror="window.__reasoningXss=1"><script>window.__reasoningXss=1</script>"\'&';
  const value=supplied();
  value.claim=attack;value.method_ref=attack;value.reasoning={observations:[attack],steps:[attack],conclusion:attack,history:{status:'linked',note:attack}};
  value.historical_basis.outcomes[0].label=attack;value.historical_basis.refs[0]={...ref,id:attack};value.knowledge_basis.mechanism=attack;value.knowledge_basis.theory_refs=['javascript:alert(1)',attack];
  for(const html of [renderReasoning(value,en),renderInference({...value,reasoning:undefined},en),renderReasoning(supplied(),{escape,tr:()=>attack})]){
    assert.doesNotMatch(html,/<script|<img|href="javascript:|<pre/i);
    assert.match(html,/&lt;script&gt;/);assert.match(html,/&quot;&#39;&amp;/);
  }
});

test('stylesheet scopes the unframed three-column flow and mobile stack to reasoning classes', async () => {
  const css=await readFile(new URL('../packages/reports/assets/report-reasoning.css',import.meta.url),'utf8');
  assert.match(css,/\.report-reasoning-flow\s*\{[^}]*display:\s*grid/);
  assert.match(css,/@media\s*\(max-width:\s*680px\)[\s\S]*\.report-reasoning-flow\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(css,/(?:^|\})\s*(?:html|body|:root|\.backtest|\.module-)/m);
  assert.doesNotMatch(css,/linear-gradient|animation:/);
  for(const shadow of css.matchAll(/box-shadow:([^;]+);/g))assert.equal(shadow[1].trim(),'none');
});

test('desktop and mobile keep the same evidence, keyboard details and unframed layout', {skip:!process.env.SESAME_HOST_ROOT,timeout:30000}, async () => {
  const {chromium}=createRequire(join(process.env.SESAME_HOST_ROOT,'package.json'))('playwright');
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    const css=await readFile(new URL('../packages/reports/assets/report-reasoning.css',import.meta.url),'utf8');
    const value=supplied();value.knowledge_basis.theory_refs.push('long-reference-'.repeat(35));
    await page.setContent(`<html><head><style>:root{--report-ink:#17212b;--report-muted:#596775;--report-line:#d6dce4;--report-data:#334eac}html[data-theme=dark]{--report-ink:#edf1f8;--report-muted:#b8c0cc;--report-line:#38414b;--report-data:#a8b9ff;background:#171b22;color:#edf1f8}body{margin:0;padding:24px;font-family:system-ui;color:var(--report-ink)}main{max-width:1000px;margin:auto}.backtest-unrelated{font-size:13px;color:rgb(100,0,0)}${css}</style></head><body><main>${renderReasoning(value,en)}</main><div class="backtest-unrelated">Unrelated report surface</div></body></html>`);
    const boxes=await page.locator('.report-reasoning-step').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width};}));
    assert.equal(boxes.length,3);assert.ok(boxes[0].x<boxes[1].x&&boxes[1].x<boxes[2].x);assert.ok(Math.abs(boxes[0].y-boxes[2].y)<1);
    assert.equal(await page.locator('.report-reasoning').evaluate(node=>getComputedStyle(node).borderTopWidth),'0px');
    assert.equal(await page.locator('.report-reasoning').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');
    if(process.env.SESAME_REASONING_SCREENSHOTS==='1')await page.screenshot({path:'/tmp/sesame-reasoning-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:900});
    const mobile=await page.locator('.report-reasoning-step').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y};}));
    assert.ok(mobile[0].y<mobile[1].y&&mobile[1].y<mobile[2].y);assert.ok(mobile.every(box=>box.x===mobile[0].x));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.SESAME_REASONING_SCREENSHOTS==='1')await page.screenshot({path:'/tmp/sesame-reasoning-mobile.png',fullPage:true});
    await page.locator('.report-reasoning-details > summary').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('.report-reasoning-details').getAttribute('open'),'');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok((await page.locator('.report-reasoning-details').innerText()).includes(ref.digest));
    assert.equal(await page.locator('.backtest-unrelated').evaluate(node=>getComputedStyle(node).fontSize),'13px');
    await page.locator('.report-reasoning-details > summary').click();
    await page.setViewportSize({width:1100,height:900});
    await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
    assert.equal(await page.locator('.report-reasoning-share-track > span').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(168, 185, 255)');
    if(process.env.SESAME_REASONING_SCREENSHOTS==='1')await page.screenshot({path:'/tmp/sesame-reasoning-dark.png',fullPage:true});
    assert.deepEqual(errors,[]);
  }finally{await page.close();await browser.close();}
});
