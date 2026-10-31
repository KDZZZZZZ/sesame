import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { resolveStructure, bindResults } from '../packages/reports/report-structure.js';
import { renderComposedReport } from '../packages/reports/report-compose.js';

function render(field, value, locale = 'zh-CN') {
  const structure = resolveStructure({ locale, sections:[{id:'custom',title:'User research',fields:[{key:'result',label:'Result',type:'object',meaning:'Actual supplied result',...field}]}] });
  const bound = bindResults(structure,[{section_id:'custom',field:'result',value}]);
  return renderComposedReport({title:'Projection',structure,bound,data:[],references:[],demo:true});
}

test('score bars preserve independently supplied values and an explicit domain without a synthetic total', () => {
  const html=render({type:'array',presentation:{kind:'scores',label:'name',value:'score',min:0,max:100}},[{name:'Value',score:84},{name:'Quality',score:61}]);
  assert.match(html,/aria-valuenow="84"/);assert.match(html,/aria-valuenow="61"/);
  assert.match(html,/width:84\.0000%/);assert.doesNotMatch(html,/aria-valuenow="72\.5"/);
  assert.match(html,/数据与口径/);
});

test('price ranges map a supplied reference to its real position and preserve unrounded original values', () => {
  const html=render({presentation:{kind:'range',lower:'low',upper:'high',reference:'spot',unit:'USD'}},{low:93.4061,high:106.5939,spot:100});
  assert.match(html,/left:50\.0000%/);assert.match(html,/>93\.4061</);assert.match(html,/>106\.5939</);
  assert.match(html,/93\.41/);assert.match(html,/USD/);
});

test('incompatible or missing mappings use complete facts instead of clipping or inventing values', () => {
  for (const value of [{low:20,high:26,spot:30},{low:20,high:20,spot:20},{low:'20%',high:'26%',spot:'23%'}]) {
    const html=render({presentation:{kind:'range',lower:'low',upper:'high',reference:'spot'}},value);
    assert.doesNotMatch(html,/class="module-range-marker"/);assert.match(html,/class="module-facts"/);
  }
  const html=render({presentation:{kind:'metric',value:'missing'}},{actual:0,confirmed:false});
  assert.doesNotMatch(html,/class="module-metric-value"/);assert.match(html,/>0</);assert.match(html,/>否</);
});

test('user redefinitions do not inherit incompatible presentations; null disables a suggested view', () => {
  const custom=resolveStructure({sections:[{module_id:'M09',fields:[{key:'iv_rank',type:'text',meaning:'User-defined description'}]}]});
  assert.equal(custom.sections[0].fields[0].presentation,undefined);
  assert.equal(resolveStructure({sections:[{module_id:'M09',fields:[{key:'iv_rank',presentation:null}]}]}).sections[0].fields[0].presentation,null);
  for (const presentation of [{kind:'scores',label:'n',value:'v',min:0,max:0},{kind:'metric',value:'v',min:10,max:0},{kind:'metric',value:'v',html:'<script>'}]) {
    assert.throws(()=>render({presentation},{v:0}));
  }
});

test('numeric zero stays a real result and labels/captions cannot inject markup', () => {
  const html=render({presentation:{kind:'metric',value:'v',caption:'caption',min:0,max:100}},{v:0,caption:'<img src=x onerror=alert(1)>'});
  assert.match(html,/aria-valuenow="0"/);assert.match(html,/&lt;img src=x/);assert.doesNotMatch(html,/<img src=x/);
});

test('a different method scale or currency falls back without relabeling the supplied result', () => {
  const score=render({presentation:{kind:'metric',value:'v',min:0,max:100,scale:'scale',scale_label:'0–100'}},{v:4,scale:'0–5'});
  assert.doesNotMatch(score,/aria-valuenow="4"/);assert.match(score,/>0–5</);
  const price=render({presentation:{kind:'range',lower:'low',upper:'high',reference:'spot',unit:'USD',unit_field:'currency'}},{low:90,high:110,spot:100,currency:'EUR'});
  assert.doesNotMatch(price,/class="module-range-marker"/);assert.match(price,/>EUR</);
});

test('opt-in scalar metrics format supplied numbers and retain their exact source values', () => {
  for (const [value,unit,display] of [[1.2408098449819225,'%','1.24'],[0.8425153843437879,'倍','0.84'],[-0.8425153843437879,'倍','-0.84'],[0,'%','0']]) {
    const html=render({type:'number',unit,presentation:{kind:'metric',digits:2}},value);
    assert.ok(html.includes(`<p class="module-metric-value">${display}<span class="module-number-unit">${unit}</span></p>`));
    assert.ok(html.includes(`</p>${value}</details>`),'The original precision stays in the evidence details');
  }
  assert.match(render({type:'number',unit:'%',presentation:{kind:'metric',digits:2}},1.2408098449819225,'de-DE'),/module-metric-value">1,24/);
  assert.match(render({type:'number',presentation:{kind:'metric',digits:6}},0.000012),/module-metric-value">0\.000012</);
  const integer=render({type:'integer',presentation:{kind:'metric'}},Number.MAX_SAFE_INTEGER);
  assert.match(integer,/module-metric-value">9,007,199,254,740,991</);assert.ok(integer.includes('</p>9007199254740991</details>'));
  assert.match(render({type:'number',unit:'%',presentation:{kind:'metric',unit:'',digits:2}},1.24),/module-metric-value">1\.24<\/p>/);
  assert.doesNotMatch(render({type:'number',unit:'%'},1.2408098449819225),/class="module-metric-value"/,'Plain numbers do not opt in automatically');
  assert.match(render({type:'text'},'001234567890.0000'),/001234567890\.0000/,'Text identifiers are never parsed as numbers');
});

test('scalar metrics reject object mappings and unsupported presentations without inventing a result', () => {
  for (const presentation of [{kind:'metric',value:'v'},{kind:'metric',caption:'note'},{kind:'metric',meta:['source']},{kind:'metric',unit_field:'currency'},{kind:'metric',scale:'scale',scale_label:'0–100'},{kind:'range',lower:'low',upper:'high'},{kind:'scores',label:'name',value:'score',min:0,max:100}]) {
    assert.throws(()=>render({type:'number',presentation},1));
  }
  for (const digits of [-1,7,1.5]) assert.throws(()=>render({type:'number',presentation:{kind:'metric',digits}},1));
  for (const type of ['text','boolean','probability']) assert.throws(()=>render({type,presentation:{kind:'metric'}},type==='text'?'1':type==='boolean'?true:0.5));
});

const judgmentExample = JSON.parse(readFileSync(new URL('../packages/reports/examples/judgment-presentation.json', import.meta.url)));
const judgmentField = { ...judgmentExample.field, key: 'result' };
const judgmentBody = html => html.match(/<div class="module-judgments" role="list">([\s\S]*?)<details class="module-value-details">/)?.[1];

test('judgments map supplied prose without inferring scores, colors, probabilities or missing optional content', () => {
  const before = JSON.stringify(judgmentExample.value);
  const html = render(judgmentField, judgmentExample.value);
  const body = judgmentBody(html);
  assert.ok(body);
  assert.equal((body.match(/class="module-judgment" role="listitem"/g) ?? []).length, 2);
  assert.deepEqual([...body.matchAll(/class="module-judgment-value"><strong>(.*?)<\/strong>/g)].map(match => match[1]), judgmentExample.value.map(row => row.判断));
  for (const text of ['虚构候选甲与乙', '本次研究范围', '乙补齐材料后重新比较。', '不适用：此项是材料完备性判断，不是价格预测。', '示例快照']) assert.ok(body.includes(text));
  assert.doesNotMatch(body, /role="meter"|aria-valuenow|module-meter|style=|50%|0\.5|undefined/);
  assert.equal(JSON.stringify(judgmentExample.value), before, 'Rendering leaves every supplied record unchanged');
});

test('judgment mappings read direct user-named properties and preserve every unmapped value in details', () => {
  const value = [{
    question: 'Which item comes first?', 'finding.text': 'Review the schedule first.',
    finding: { text: 'Nested data is not the mapped judgment.' },
    asset: 'Example A', term: 'Authored scope', why: 'A time is missing.', change: 'When the time is confirmed.', past: 'Not applicable to a scheduling fact.',
    note: 'No price prediction is supplied.', checked: false, count: 0,
    unknown: { decimal: '9007199254740993.0000000001', missing: null, source: '<original>' },
  }];
  const field = { type: 'array', presentation: { kind: 'judgments', label: 'question', value: 'finding.text', subject: 'asset', horizon: 'term', basis: 'why', condition: 'change', history: 'past', caption: 'note', meta: ['checked', 'count'] } };
  const html = render(field, value, 'en-US'), body = judgmentBody(html);
  assert.match(body, /<strong>Review the schedule first\.<\/strong>/);
  assert.doesNotMatch(body, /Nested data|9007199254740993/);
  assert.match(body, /Historical reference/); assert.match(body, /checked<\/span> false/); assert.match(body, /count<\/span> 0/);
  const details = html.match(/<details class="module-value-details">([\s\S]*?)<\/details>/)[1];
  for (const text of ['Nested data is not the mapped judgment.', '9007199254740993.0000000001', '&lt;original&gt;', '>—<']) assert.ok(details.includes(text));
  const unmapped = render({ type: 'array', presentation: { kind: 'judgments', label: '问题', value: '判断' } }, [{ 问题: '问题一', 判断: '保留当前结论。', 对象: '未映射对象' }]);
  assert.doesNotMatch(judgmentBody(unmapped), /未映射对象/, 'Conventional property names are not guessed');
  assert.match(unmapped, /未映射对象/);
});

test('one incompatible judgment row makes the complete field fall back without dropping records', () => {
  const good = { 问题: '完整问题', 判断: '完整判断', 未映射: '保留原值' };
  for (const bad of [
    { 问题: '缺判断', 原值: 0 }, { 问题: '空判断', 判断: '  ' }, { 问题: '', 判断: '原判断' },
    { 问题: '数值不能冒充文字', 判断: 0 }, { 问题: '布尔不能冒充文字', 判断: false },
    { 问题: '嵌套依据', 判断: '原判断', 依据: { 原始材料: '必须保留' } },
    { 问题: '空依据', 判断: '原判断', 依据: '' },
    { 问题: '嵌套元数据', 判断: '原判断', 数据截点: { 原文: '必须保留' } },
    null,
  ]) {
    const html = render(judgmentField, [good, bad]);
    assert.equal(judgmentBody(html), undefined);
    assert.match(html, /完整问题/); assert.match(html, /完整判断/); assert.match(html, /保留原值/);
    if (bad?.原值 === 0 || bad?.判断 === 0) assert.match(html, />0</);
    if (bad?.判断 === false) assert.match(html, />否</);
    if (bad?.依据?.原始材料 || bad?.数据截点?.原文) assert.match(html, /必须保留/);
  }
  assert.equal(judgmentBody(render(judgmentField, [])), undefined);
});

test('judgment arrays beyond the presentation limit fall back with all original rows', () => {
  const values = Array.from({ length: 25 }, (_, index) => ({ 问题: `原问题-${index}`, 判断: `原判断-${index}` }));
  const html = render(judgmentField, values);
  assert.equal(judgmentBody(html), undefined);
  for (const row of values) { assert.ok(html.includes(row.问题)); assert.ok(html.includes(row.判断)); }
  assert.equal((judgmentBody(render(judgmentField, values.slice(0, 24))).match(/role="listitem"/g) ?? []).length, 24);
});

test('all judgment prose and metadata stay escaped, including unmapped nested input', () => {
  const attack = '<img src=x onerror="alert(1)"> & </script>';
  const row = Object.fromEntries(['问题', '判断', '对象', '期限', '依据', '改判条件', '历史参照', '说明', '数据截点'].map(key => [key, attack]));
  row.原始材料 = { text: attack };
  const html = render(judgmentField, [row]), body = judgmentBody(html);
  assert.match(body, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img src=x|onerror="alert\(1\)"/);
  assert.match(html, /原始材料/);
});

test('judgments require explicit text mappings on array fields and reject numeric presentation settings', () => {
  for (const presentation of [
    { kind: 'judgments', value: '判断' }, { kind: 'judgments', label: '问题' },
    { kind: 'judgments', label: '问题', value: '判断', subject: '' },
    { kind: 'judgments', label: '问题', value: '判断', history: ['历史'] },
    { kind: 'judgments', label: '问题', value: '判断', min: 0, max: 100 },
    { kind: 'judgments', label: '问题', value: '判断', digits: 2 },
    { kind: 'judgments', label: '问题', value: '判断', score: '分数' },
  ]) assert.throws(() => render({ type: 'array', presentation }, judgmentExample.value));
  for (const type of ['object', 'text', 'number', 'boolean']) assert.throws(() => render({ type, presentation: judgmentField.presentation }, []));
  assert.throws(() => render({ presentation: { kind: 'metric', value: 'v', basis: 'why' } }, { v: 1, why: 'Ignored mapping' }));
});

test('judgment layout adapts to wide and narrow screens and keeps complete data in the appendix', { skip: !process.env.SESAME_HOST_ROOT, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(process.env.SESAME_HOST_ROOT, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const values = structuredClone(judgmentExample.value);
  values[0].判断 = '偏强：这是提供方的文字判断。';
  values[1].判断 = '偏弱：这是提供方的另一条文字判断。';
  values[1].对象 = 'A_long_unbroken_source_identifier_'.repeat(8);
  await page.setContent(render(judgmentField, values));
  await page.locator('[data-report-evidence-appendix] .module-value-details').waitFor({ state: 'attached' });
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator('.module-judgments').evaluate(element => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      items: [...element.querySelectorAll('.module-judgment')].map(item => {
        const box = item.getBoundingClientRect(), style = getComputedStyle(item), strong = getComputedStyle(item.querySelector('strong'));
        return { left: box.left, right: box.right, color: strong.color, weight: Number(strong.fontWeight), border: style.borderTopWidth, background: style.backgroundColor, shadow: style.boxShadow };
      }),
    }));
    assert.equal(layout.columns, width > 560 ? 2 : 1);
    assert.equal(layout.overflow, false);
    assert.equal(layout.items.length, 2);
    assert.equal(layout.items[0].color, layout.items[1].color, 'The renderer does not color judgments by their words');
    for (const item of layout.items) {
      assert.ok(item.left >= 0 && item.right <= width + 1);
      assert.ok(item.weight >= 600);
      assert.equal(item.border, '0px'); assert.equal(item.background, 'rgba(0, 0, 0, 0)'); assert.equal(item.shadow, 'none');
    }
  }
  assert.equal(await page.locator('#section-custom .module-value-details').count(), 0);
  const link = page.locator('.module-presentation-judgments .report-evidence-links a').first();
  await link.click();
  const details = page.locator('[data-report-evidence-appendix] .module-value-details');
  assert.equal(await details.getAttribute('open'), '');
  assert.match(await details.innerText(), /未映射的原始记录/);
  assert.match(await details.innerText(), /材料齐全/);
  assert.match(await details.innerText(), /材料待补/);
  assert.deepEqual(errors, []);
});
