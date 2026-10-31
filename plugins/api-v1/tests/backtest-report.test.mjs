import { withEvidenceAppendix } from '../packages/reports/report-appendix.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const hostRoot = process.env.SESAME_HOST_ROOT;
const root = new URL('../packages/reports/', import.meta.url);
const script = await readFile(new URL('assets/backtest-explorer.js', root), 'utf8');
const context = { window: {} }; runInNewContext(script, context);
const validate = context.window.SesameBacktest.validate;
const trial = (extra = {}) => ({ trial_id: 'A', symbol: 'BTCUSD', timeframe: 'H1', sample: 'fixed-training-period', status: 'completed', selected: true, parameters: { lookback: '20', net_profit: 'parameter-cannot-replace-profit' }, sharpe: '1.2', max_drawdown_pct: '7.5', net_profit: '9007199254740993.0000000001', ...extra });
const ref = { id: 'source', revision: 'r1', digest: `sha256:${'a'.repeat(64)}`, kind: 'strategy.source', schemaVersion: '1.0.0' };
const graph = { sourceDigest: `sha256:${'b'.repeat(64)}`, nodes: [{ id: 'close', operator: 'series.value' }, { id: 'signal', operator: 'compare.gt' }], edges: [{ from: 'close', to: 'signal', kind: 'data' }], handlers: [{ id: 'closed', event: { type: 'bar.closed' }, steps: [{ id: 'enter', when: 'signal', actions: ['buy'], elseActions: ['wait'] }] }] };
const source = { nodes: [{ id: 'close', op: 'series.value', inputs: { offset: 0 } }, { id: 'signal', op: 'compare.gt', inputs: { left: { node: 'close' }, right: { parameter: 'lookback' } } }] };
const fn = { id: 'power', parameters: { value: { kind: 'decimal' } }, output: { kind: 'decimal' }, result: { node: 'square' }, nodes: [{ id: 'square', op: 'math.pow', inputs: { base: { parameter: 'value' }, exponent: 2 } }] };
source.extensions = [{ id: 'fixture/math', module: { functions: [fn] } }];
graph.functions = [{ ...fn, id: 'fixture/math/power', nodes: [{ id: 'square', operator: 'math.pow' }], edges: [] }];
graph.handlers[0].event.input = 'closed-bars';
graph.handlers[0].steps = [{ id: 'positions', forEach: { input: { input: 'positions' }, item: 'position', maxItems: 50 }, steps: [{ id: 'children', forEach: { input: { local: 'position', field: 'children' }, item: 'child', maxItems: 20 }, steps: graph.handlers[0].steps }] }];
source.handlers = graph.handlers;
source.language = 'svl/1';
source.parameters = { lookback: { type: 'integer', default: 20 } }; source.inputs = { 'closed-bars': { kind: 'bars' } }; source.state = { count: { type: { kind: 'integer' }, initial: 0 } };
const base = { output_path: 'strategy.html', title: 'Demo strategy comparison', summary: 'Fictional evidence tests inspection, not profitability.', strategy_source: ref, data_id: 'trials', parameters: ['lookback', 'net_profit'], selection_rule: 'Training Sharpe, then smaller drawdown, then trial ID; no holdout selection.', source_note: 'Synthetic fixture, USD, one fixed sample; no orders.', currency: 'USD', demo: true };
async function template(input = {}) {
  const args = { ...base, ...input }, escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const config = { title: args.title, summary: args.summary, dataId: args.data_id, parameters: args.parameters, parameterLabels: args.parameter_labels, selectionMetric: args.selection_metric ?? 'sharpe', selectionRule: args.selection_rule, sourceNote: args.source_note, currency: args.currency, source: ref, graph, definition: source, demo: args.demo === true };
  const asset = p => readFile(new URL(p, root), 'utf8');
  const tokens = { LOCALE: args.locale ?? 'en', TITLE: escape(args.title), STYLES: await asset('assets/editorial.css') + '\n' + await asset('assets/backtest.css') + '\n' + await asset('assets/svl-graph.css'), KIT: await asset('assets/report-kit.js'), CHARTS: await asset('assets/editorial-charts.js'), EXPLORER: await asset('assets/svl-graph.js') + '\n' + script, CONFIG: json(config) };
  const html = (await asset('templates/backtest.html')).replace(/\{\{(LOCALE|TITLE|STYLES|KIT|CHARTS|EXPLORER|CONFIG)\}\}/g, (_, key) => tokens[key]);
  return { html: withEvidenceAppendix(html) };
}

test('frozen trials reject conflicting winners, mixed samples, absent metrics and fake failed winners', () => {
  assert.equal(validate([trial()], base.parameters).size, 1);
  const other = extra => trial({ trial_id: 'B', selected: false, ...extra });
  for (const [rows, pattern] of [
    [[trial(), other({ selected: true })], /exactly one/], [[trial(), trial()], /unique/],
    [[trial({ selected: false })], /exactly one/], [[trial({ status: 'failed' })], /Failed/],
    [[trial(), other({ symbol: 'ETHUSD', selected: true, sample: 'holdout' })], /mix training/],
    [[trial({ max_drawdown_pct: '-1' })], /nonnegative/], [[trial({ sharpe: '' })], /finite/],
  ]) assert.throws(() => validate(rows, base.parameters), pattern);
  const missing = trial(); delete missing.net_profit; assert.throws(() => validate([missing], base.parameters), /Missing metric/);
  assert.equal(validate([trial({ status: 'failed', selected: false, sharpe: null, max_drawdown_pct: null, net_profit: null })], base.parameters).size, 1);
});

test('parameter display names are optional, bounded and restricted to declared keys in both render paths', async () => {
  const { buildBacktestReport } = await import('../packages/reports/backtest-template.js');
  const evidence = { ...ref, kind: 'resource' };
  const host = { resources: { read: async () => ({ content: {} }) } };
  const input = { ...base, strategy_source: undefined, strategy_evidence: { engine: 'Fixture', summary: 'Schema regression only', references: [evidence] }, references: [evidence] };
  assert.equal(validate([trial()], base.parameters, { lookback: '回看期' }).size, 1);
  for (const labels of [{ undeclared: '未声明' }, { lookback: '' }, { lookback: ' ' }, { lookback: 'x'.repeat(65) }, { lookback: 'line\nbreak' }, { lookback: 20 }, []]) {
    assert.throws(() => validate([trial()], base.parameters, labels), /Parameter labels/);
    await assert.rejects(buildBacktestReport(host, { ...input, parameter_labels: labels }), /Parameter labels/);
  }
  const html = (await buildBacktestReport(host, { ...input, parameter_labels: { lookback: '回看期' } })).html;
  assert.match(html, /"parameterLabels":\{"lookback":"回看期"\}/);
  const declaration = JSON.parse(await readFile(new URL('capabilities.json', root), 'utf8'));
  const schemas = [];
  const visit = value => { if (!value || typeof value !== 'object') return; if (value.properties?.kind?.const === 'backtest') schemas.push(value.properties.parameter_labels); for (const child of Object.values(value)) visit(child); };
  visit(declaration);
  schemas.push(declaration.capabilities.find(c => c.id === 'report_backtest_template').inputSchema.properties.parameter_labels);
  assert.equal(schemas.length, 4);
  for (const schema of schemas) { assert.equal(schema.maxProperties, 32); assert.equal(schema.additionalProperties.maxLength, 64); assert.match(schema.description, /declared|listed in parameters/); }
});

test('native backtest judgments are supplied arrays and never inferred from result metrics', async () => {
  const { buildBacktestReport } = await import('../packages/reports/backtest-template.js');
  const evidence = { ...ref, kind: 'resource' }, host = { resources: { read: async () => ({ content: {} }) } };
  const input = { ...base, strategy_source: undefined, strategy_evidence: { engine: 'Fixture', summary: 'Schema regression only', references: [evidence] }, references: [evidence] };
  const absent = await buildBacktestReport(host, input);
  assert.doesNotMatch(absent.html, /data-backtest-judgments/);
  for (const judgments of [null, {}, [], Array(201).fill({ 问题: 'Q', 判断: 'J' })]) {
    await assert.rejects(buildBacktestReport(host, { ...input, strategy_evidence: { ...input.strategy_evidence, judgments } }), /1–200.*array/);
  }
  const fallback = await buildBacktestReport(host, { ...input, strategy_evidence: { ...input.strategy_evidence, judgments: [{ 原始记录: '未提供映射文本' }] } });
  assert.match(fallback.html, /未提供映射文本/);
  assert.doesNotMatch(fallback.html, /class=\\"module-judgments/);
});

test('strategy report renders real controls, every trial, stable winners and missing cells on desktop and mobile', { skip: !hostRoot, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(hostRoot, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // More than one table page; the unselected B trial has a greater profit than the selected trial.
  const rows = Array.from({ length: 55 }, (_, i) => trial({ trial_id: `A${i}`, selected: i === 0, parameters: { lookback: String(10 + i), net_profit: 'parameter-only' }, net_profit: String(i ? 500 + i : -10), sharpe: String(1 - i / 100) }));
  rows.push(trial({ trial_id: 'ETH', symbol: 'ETHUSD', timeframe: 'M5', parameters: { lookback: '30', net_profit: 'parameter-only' }, net_profit: '30' }));
  const { html } = await template({ selection_metric: 'net_profit', demo: false });
  try {
    await page.addInitScript(() => {});
    await page.setContent(html.replace('<script>', `<script>window.report={readData:async()=>({rows:${JSON.stringify(rows)},page:{},provenance:{kind:'demo'}}),track:p=>{window.ready=p;return p;}};</script><script>`));
    await page.evaluate(() => window.ready);
    assert.match(await page.locator('.kit-eyebrow').innerText(), /DEMO SAMPLE/);
    assert.equal(await page.locator('.backtest-matrix [data-row-index]').count(), 4);
    assert.equal(await page.getByRole('combobox', { name: 'Color metric' }).inputValue(), 'net_profit');
    for(const [theme,gain,loss] of [['light','rgb(36, 115, 74)','rgb(178, 67, 67)'],['dark','rgb(95, 227, 169)','rgb(255, 122, 143)']]){
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      assert.equal(await page.locator('.backtest-matrix [data-row-index="0"]').evaluate(n=>getComputedStyle(n).fill),loss,'Negative P&L retains its loss color');
      assert.equal(await page.locator('.backtest-matrix [data-row-index="3"]').evaluate(n=>getComputedStyle(n).fill),gain,'Positive P&L retains its gain color instead of theme blue');
    }
    await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
    assert.equal(await page.locator('.backtest-trials tbody tr').count(), 50);
    assert.equal(await page.locator('.svl-logic-loop').count(), 2);
    assert.match(await page.locator('.svl-logic-handler').innerText(), /positions.*limit 50.*children.*limit 20/s);
    assert.equal(await page.locator('[data-step-path="closed/positions/children/enter"] [data-branch=true] [data-action-id=buy]').count(),1);
    assert.equal(await page.locator('[data-step-path="closed/positions/children/enter"] [data-branch=false] [data-action-id=wait]').count(),1);
    assert.equal(await page.locator('[data-step-path="closed/positions/children/enter"] [data-branch=not-ready] [data-action-id]').count(),0);
    await page.setViewportSize({width:390,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.getByRole('button',{name:'See calculation ↗',exact:true}).click();
    assert.equal(await page.locator('[data-expression-node="signal"]').count(),1);
    assert.equal(await page.locator('[data-expression-node="close"]').count(),1);
    assert.match(await page.locator('.svl-expression-tree').innerText(),/lookback = 20/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.getByRole('button',{name:'Collapse Greater than',exact:true}).click();
    assert.equal(await page.locator('[data-expression-node="close"]').count(),0);
    await page.getByRole('button',{name:'Expand Greater than',exact:true}).click();
    assert.equal(await page.locator('[data-expression-node="close"]').count(),1);
    assert.equal(await page.getByRole('button',{name:'Show all calculations',exact:true}).count(),1);
    await page.getByRole('tab',{name:'Trading logic',exact:true}).click();
    assert.equal(await page.locator('.svl-logic-loop').count(),2);
    await page.setViewportSize({width:1200,height:900});
    await page.getByRole('button', { name: 'Table trials: next page', exact: true }).click();
    assert.equal(await page.locator('.backtest-trials tbody tr').count(), 5);
    assert.equal(await page.getByRole('button', { name: 'Trial 55', exact: true }).getAttribute('title'), 'A54');
    await page.getByRole('button', { name: 'Trial 55', exact: true }).click();
    assert.match(await page.locator('.report-evidence-entry > details[open] .backtest-node').innerText(), /"trial_id": "A54"/);
    const oldTrialEntry = await page.locator('.report-evidence-entry > details[open]').evaluate(node => node.parentElement.id);
    await page.getByRole('combobox', { name: 'Color metric' }).selectOption('net_profit');
    assert.match(await page.locator('.backtest-matrix [data-row-index="0"]').getAttribute('aria-label'), /-10 USD/);
    // Changing the display metric did not pick A54's higher profit.
    await page.locator('.backtest-matrix [data-row-index="3"]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.backtest-detail h3').innerText(), 'ETHUSD · M5');
    await page.waitForFunction(id => !document.getElementById(id), oldTrialEntry);
    assert.equal(await page.locator('.backtest-matrix').evaluate(node => Boolean(node.closest('[data-report-evidence-appendix]'))), false);
    await page.locator('.backtest-matrix [data-row-index="1"]').click();
    assert.match(await page.locator('.backtest-detail').innerText(), /No backtest was recorded/);
    await page.locator('.backtest-matrix [data-row-index="0"]').click();
    await page.getByRole('combobox', { name: 'Parameter', exact: true }).selectOption('net_profit');
    assert.equal(await page.locator('.backtest-sensitivity .kit-chart').count(), 3);
    assert.match(await page.locator('.backtest-trials tbody tr').first().innerText(), /parameter-only.*-10/);
    await page.getByRole('tab',{name:'Node graph',exact:true}).click();
    await page.locator('.svl-node[data-node-id="signal"]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.report-evidence-entry .backtest-node').filter({ hasText: '"parameter": "lookback"' }).count(), 1);
    await page.locator('summary').filter({ hasText: 'Function: fixture/math/power' }).click();
    await page.locator('.svl-node[data-node-id="square"]').click();
    const functionText = await page.locator('details').filter({ has: page.locator('summary', { hasText: 'Function: fixture/math/power' }) }).innerText();
    assert.match(functionText, /"exponent": 2/); assert.match(functionText, /"result"/); assert.match(functionText, /"parameters"/);
    await page.getByRole('combobox', { name: 'Color metric' }).selectOption('max_drawdown_pct');
    const drawdownColor = () => page.locator('.backtest-matrix .sc-bar').first().evaluate(node => getComputedStyle(node).fill);
    const before = await drawdownColor();
    assert.equal(before, 'rgb(51, 78, 172)', 'Drawdown uses the blue comparison palette, not P&L red');
    assert.ok((await page.locator('.backtest-sensitivity .kit-dot').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).fill))).includes('rgb(51, 78, 172)'));
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForFunction(() => document.querySelector('.backtest-matrix svg').viewBox.baseVal.width < 400);
    assert.equal(await drawdownColor(), before);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    // Page changes and resizing retain one global heat scale.
    await page.evaluate(() => {
      const rows = Array.from({ length: 21 }, (_, i) => ({ ...config, trial_id: String(i), symbol: 'Symbol' + i, timeframe: 'M5', sample: 'demo', selected: true, status: 'completed', parameters: { lookback: '20', net_profit: 'param' }, sharpe: i === 19 ? '200' : '2', max_drawdown_pct: '2', net_profit: '3' }));
      SesameBacktest.render('#report', { ...config, selectionMetric: 'sharpe', rows });
    });
    const opacity = await page.locator('.backtest-matrix [data-row-index="0"]').getAttribute('opacity');
    await page.getByRole('combobox', { name: 'Symbol range' }).selectOption('1');
    assert.equal(await page.locator('.backtest-matrix [data-row-index="0"]').getAttribute('opacity'), opacity);
    assert.equal(await page.locator('details:not([data-report-evidence-appendix] details)').count(), 0);
    assert.equal(await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(node => node.id); return ids.length === new Set(ids).size && [...document.querySelectorAll('.report-evidence-links a')].every(link => document.getElementById(link.hash.slice(1))); }), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/sesame-backtest-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.screenshot({ path: '/tmp/sesame-backtest-desktop.png', fullPage: true });
  } finally { await page.close(); await browser.close(); }
});

test('native backtests retain matrix, recorded winners, trial pagination and sensitivity without synthetic SVL', { skip: !hostRoot, timeout: 60000 }, async t => {
  const { buildBacktestReport } = await import('../packages/reports/backtest-template.js');
  const { renderStructuredReport } = await import('../packages/reports/report-content.js');
  const evidence={...ref,id:'native-fixture-evidence',kind:'resource'};
  const host={resources:{read:async(actual,options)=>{assert.deepEqual(actual,evidence);assert.equal(options.part,'manifest');return {content:{}};}}};
  const judgments=[{问题:'是否继续验证',判断:'继续观察；保留原实验限制',对象:'合成策略',期限:'记录中的实验期',依据:'已有样本仅作回归验收',改判条件:'取得额外独立证据',历史参照:'没有可比历史',未映射:'{{TITLE}} </script><img src=x onerror="window.JUDGMENT_ATTACK=1">'}];
  const native={engine:'Synthetic native fixture',summary:'Recorded native strategy; software test only',references:[evidence],judgments,
    logic:{title:'Recorded native rule',nodes:[{id:'input',label:'Recorded signal'},{id:'action',label:'Recorded action'}],edges:[{from:'input',to:'action'}]}};
  const originalNative=structuredClone(native);
  const input={...base,strategy_source:undefined,strategy_evidence:native,references:[evidence],selection_metric:'net_profit',locale:'en',provenance_kind:'demo',data:[{id:'trials',ref:{...ref,kind:'data'}}]};
  const {html:unstyled,graph:nativeGraph}=await buildBacktestReport(host,input);
  assert.equal(nativeGraph,undefined);assert.doesNotMatch(unstyled,/"source":\{"id":"source"/);
  const html=await renderStructuredReport(host,{...input,content:{kind:'backtest',data_id:'trials',parameters:base.parameters,selection_metric:'net_profit',selection_rule:base.selection_rule,source_note:base.source_note,currency:base.currency}});
  const rows=Array.from({length:55},(_,i)=>trial({trial_id:`native-${i}`,selected:i===0,parameters:{lookback:String(i+10),net_profit:'kept-parameter'},net_profit:String(i===0?-10:500+i),sharpe:String(1-i/100)}));
  rows.push(trial({trial_id:'native-eth',symbol:'ETHUSD',timeframe:'M5',net_profit:'30'}));
  const {chromium}=createRequire(join(hostRoot,'package.json'))('playwright');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent(html.replace('<script>',`<script>window.report={readData:async()=>({rows:${JSON.stringify(rows)},page:{},provenance:{kind:'demo'}}),track:p=>{window.ready=p;return p;}};</script><script>`));
  await page.evaluate(()=>window.ready);
  assert.equal(await page.locator('[data-backtest-judgments] .module-judgment-value').innerText(),'继续观察；保留原实验限制');
  assert.equal(await page.evaluate(()=>document.querySelector('#report .kit-section').hasAttribute('data-backtest-judgments')),true);
  assert.equal(await page.evaluate(()=>window.JUDGMENT_ATTACK),undefined);
  assert.deepEqual(await page.evaluate(()=>config.strategyEvidence),originalNative);
  assert.deepEqual(native,originalNative);
  assert.equal(await page.locator('[data-report-svl] .svl-node').count(),2);
  assert.equal(await page.locator('.backtest-matrix [data-row-index]').count(),4);
  assert.equal(await page.locator('[aria-label="SVL strategy logic"]').count(),0);
  assert.match(await page.locator('body').innerText(),/Recorded native strategy/);
  assert.equal(await page.locator('.backtest-trials tbody tr').count(),50);
  await page.getByRole('button',{name:'Table trials: next page',exact:true}).click();
  assert.equal(await page.locator('.backtest-trials tbody tr').count(),5);
  await page.getByRole('combobox',{name:'Color metric',exact:true}).selectOption('sharpe');
  assert.match(await page.locator('.backtest-matrix [data-row-index="0"]').getAttribute('aria-label'),/1/);
  await page.getByRole('combobox',{name:'Color metric',exact:true}).selectOption('net_profit');
  assert.match(await page.locator('.backtest-matrix [data-row-index="0"]').getAttribute('aria-label'),/-10/,'color switching must not select larger-profit trials');
  assert.equal(await page.locator('.backtest-sensitivity svg').count(),3);
  await page.getByRole('combobox',{name:'Parameter',exact:true}).selectOption('net_profit');
  assert.equal(await page.locator('.backtest-sensitivity svg').count(),3);
  await page.locator('.backtest-matrix [data-row-index="1"]').click();
  assert.match(await page.locator('.backtest-detail').innerText(),/No backtest was recorded/);
  await page.locator('.backtest-matrix [data-row-index="3"]').click();
  assert.equal(await page.locator('.backtest-trials tbody tr').count(),1);
  for(const width of [1100,390]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no native layout overflow at ${width}`);
  }
  assert.match(await page.locator('[data-report-evidence-appendix]').textContent(),/native-fixture-evidence/);
  assert.match(await page.locator('[data-report-evidence-appendix]').textContent(),/\{\{TITLE\}\}.*JUDGMENT_ATTACK/s);
  assert.equal(await page.locator('[data-backtest-judgments] .module-judgment').count(),1,'original chart controls retain the supplied judgment');
  assert.equal(await page.locator('main details:not([data-report-evidence-appendix] details)').count(),0);
  assert.deepEqual(errors,[]);
});

test('Chinese backtest labels and all two-parameter trials remain inspectable without rounding parameters or reselecting', { skip: !hostRoot, timeout: 60000 }, async t => {
  const { renderStructuredReport } = await import('../packages/reports/report-content.js');
  const evidence = { ...ref, id: 'native-grid-fixture', kind: 'resource' };
  const host = { resources: { read: async () => ({ content: {} }) } };
  const parameters = ['entry_period', 'exit_period'], labels = { entry_period: '入场周期', exit_period: '出场周期' };
  const content = { kind: 'backtest', data_id: 'trials', parameters, parameter_labels: labels, selection_metric: 'net_profit', selection_rule: 'Fixture: retain recorded selection', source_note: 'Synthetic regression; not market results.', currency: 'USDT' };
  const args = { title: '参数网格', summary: '只读已记录结果', locale: 'zh-CN', provenance_kind: 'demo', data: [{ id: 'trials', ref: { ...ref, kind: 'data' } }], references: [evidence], strategy_evidence: { engine: 'Fixture', summary: '纯软件回归', references: [evidence] }, content };
  const rows = ['BTCUSDT','ETHUSDT'].flatMap((symbol, s) => ['20.0000000000000000001','40','60'].flatMap((entry, i) => ['10','20'].map((exit, j) => trial({
    trial_id: `${symbol}-exact-trial-${i}-${j}`, symbol, timeframe: '1d', selected: i === 0 && j === 0,
    parameters: { entry_period: entry, exit_period: exit }, sharpe: '1.23456789012345678901234567', max_drawdown_pct: '12.3456789012345678901234567',
    net_profit: i === 0 && j === 0 ? '-1234.56789012345678901234567' : i === 1 ? '9007199254740993.1250000001' : '500',
    ...(i === 2 && j === 1 ? { status: s ? 'not_run' : 'failed', sharpe: null, max_drawdown_pct: null, net_profit: null } : {}),
  }))));
  const original = JSON.stringify(rows), html = await renderStructuredReport(host,args);
  const { chromium } = createRequire(join(hostRoot,'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } }), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(html.replace('<script>', `<script>window.report={readData:async()=>({rows:${original},page:{},provenance:{kind:'demo'}}),track:p=>{window.ready=p;return p;}};</script><script>`));
  await page.evaluate(() => window.ready);
  const inspected = [];
  for (let s=0;s<2;s++) {
    await page.locator(`.backtest-matrix [data-row-index="${s}"]`).click();
    assert.equal(await page.locator('.backtest-trial-grid button[data-trial-id]').count(),6);
    assert.equal(await page.locator('.backtest-trials tbody tr').count(),6);
    assert.equal(await page.locator('.backtest-trial-grid button[data-selected="true"]').count(),1);
    assert.match(await page.locator('.backtest-trials tbody tr').first().innerText(), /组合 1.*完成.*已选.*20\.0000000000000000001.*1\.23.*12\.35.*-1,234\.57/s);
    assert.match(await page.locator('.backtest-trials tbody tr').nth(2).innerText(), /9,007,199,254,740,993\.13/);
    assert.doesNotMatch(await page.locator('.backtest-trials').innerText(), /completed|true|false|12345678901234567/);
    assert.match(await page.locator('.backtest-trial-grid').innerText(), /出场周期 × 入场周期/);
    assert.match(await page.locator('.backtest-trial-grid').innerText(), s ? /未运行/ : /失败/);
    for (const row of rows.filter(r=>r.symbol === (s ? 'ETHUSDT' : 'BTCUSDT'))) {
      await page.locator(`.backtest-trial-grid button[data-trial-id="${row.trial_id}"]`).click();
      const detail = await page.locator('.report-evidence-entry > details[open] .backtest-node').innerText();
      assert.deepEqual(JSON.parse(detail),row); inspected.push(row.trial_id);
    }
    const winner = await page.locator('.backtest-trial-grid button[data-selected="true"]').getAttribute('data-trial-id');
    await page.getByRole('combobox',{name:'热力指标',exact:true}).selectOption('sharpe');
    assert.equal(await page.locator('.backtest-trial-grid button[data-selected="true"]').getAttribute('data-trial-id'),winner);
    await page.getByRole('combobox',{name:'分析参数',exact:true}).selectOption('exit_period');
    assert.match(await page.locator('.backtest-sensitivity').innerText(), /出场周期 →/);
    assert.equal(await page.getByRole('combobox',{name:'分析参数',exact:true}).inputValue(),'exit_period');
    await page.getByRole('combobox',{name:'热力指标',exact:true}).selectOption('net_profit');
  }
  assert.equal(new Set(inspected).size,12);
  await page.setViewportSize({width:390,height:900});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('.backtest-trial-grid button[data-trial-id]').count(),6);
  await page.locator('.backtest-trial-grid button[data-selected="true"]').click();
  assert.match(await page.locator('.report-evidence-entry > details[open] .backtest-node').innerText(),/-1234\.56789012345678901234567/);
  // A duplicated pair stays as two original trial records, never a mean cell.
  const duplicate = [...rows, { ...rows[0], trial_id: 'duplicate-pair', selected: false }];
  await page.evaluate(rows=>SesameBacktest.render('#report',{...config,rows}),duplicate);
  assert.match(await page.locator('.backtest-trial-grid').innerText(),/参数对存在重复/);
  assert.equal(await page.locator('.backtest-trial-grid button').count(),0);
  assert.equal(await page.locator('.backtest-trials tbody tr').count(),7);
  assert.equal(await page.locator('.backtest-sensitivity svg').count(),3);
  const missingPair = rows.filter(row=>row.trial_id !== 'BTCUSDT-exact-trial-2-1');
  await page.evaluate(rows=>SesameBacktest.render('#report',{...config,rows}),missingPair);
  assert.equal(await page.locator('.backtest-trial-grid button[data-trial-id]').count(),5);
  assert.equal(await page.locator('.backtest-trial-grid [title="无试验记录"]').count(),1,'absent parameter pair is explicit, not an invented zero trial');
  assert.equal(await page.locator('.backtest-trials tbody tr').count(),5);
  assert.equal(JSON.stringify(rows),original,'display does not mutate original rows');
  assert.deepEqual(errors,[]);
});
