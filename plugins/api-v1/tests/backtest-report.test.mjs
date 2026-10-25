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
source.parameters = { lookback: { type: 'integer', default: 20 } }; source.inputs = { 'closed-bars': { kind: 'bars' } }; source.state = { count: { type: { kind: 'integer' }, initial: 0 } };
const base = { output_path: 'strategy.html', title: 'Demo strategy comparison', summary: 'Fictional evidence tests inspection, not profitability.', strategy_source: ref, data_id: 'trials', parameters: ['lookback', 'net_profit'], selection_rule: 'Training Sharpe, then smaller drawdown, then trial ID; no holdout selection.', source_note: 'Synthetic fixture, USD, one fixed sample; no orders.', currency: 'USD', demo: true };
async function template(input = {}) {
  const args = { ...base, ...input }, escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const config = { title: args.title, summary: args.summary, dataId: args.data_id, parameters: args.parameters, selectionMetric: args.selection_metric ?? 'sharpe', selectionRule: args.selection_rule, sourceNote: args.source_note, currency: args.currency, source: ref, graph, definition: source, demo: args.demo === true };
  const asset = p => readFile(new URL(p, root), 'utf8');
  const tokens = { LOCALE: args.locale ?? 'en', TITLE: escape(args.title), STYLES: await asset('assets/editorial.css') + '\n' + await asset('assets/backtest.css'), KIT: await asset('assets/report-kit.js'), CHARTS: await asset('assets/editorial-charts.js'), EXPLORER: script, CONFIG: json(config) };
  const html = (await asset('templates/backtest.html')).replace(/\{\{(LOCALE|TITLE|STYLES|KIT|CHARTS|EXPLORER|CONFIG)\}\}/g, (_, key) => tokens[key]);
  return { html };
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
    assert.equal(await page.locator('.backtest-detail tbody tr').count(), 50);
    assert.equal(await page.locator('.backtest-loop').count(), 2);
    assert.match(await page.locator('.backtest-handler').innerText(), /closed-bars.*positions.*limit 50.*children.*limit 20.*When: signal.*buy/s);
    await page.getByRole('button', { name: 'Table trials: next page', exact: true }).click();
    assert.equal(await page.locator('.backtest-detail tbody tr').count(), 5);
    await page.getByRole('button', { name: 'A54', exact: true }).click();
    assert.match(await page.locator('.backtest-detail .backtest-node').innerText(), /"trial_id": "A54"/);
    await page.getByRole('combobox', { name: 'Color metric' }).selectOption('net_profit');
    assert.match(await page.locator('.backtest-matrix [data-row-index="0"]').getAttribute('aria-label'), /-10 USD/);
    // Changing the display metric did not pick A54's higher profit.
    await page.locator('.backtest-matrix [data-row-index="3"]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.backtest-detail h3').innerText(), 'ETHUSD · M5');
    await page.locator('.backtest-matrix [data-row-index="1"]').click();
    assert.match(await page.locator('.backtest-detail').innerText(), /No backtest was recorded/);
    await page.locator('.backtest-matrix [data-row-index="0"]').click();
    await page.getByRole('combobox', { name: 'Parameter', exact: true }).selectOption('net_profit');
    assert.equal(await page.locator('.backtest-sensitivity .kit-chart').count(), 3);
    assert.match(await page.locator('.backtest-detail tbody tr').first().innerText(), /parameter-only.*-10/);
    await page.locator('.backtest-logic [aria-label="signal: compare.gt"]').focus(); await page.keyboard.press('Enter');
    assert.match(await page.locator('.backtest-logic + details').innerText(), /"parameter": "lookback"/);
    await page.locator('summary').filter({ hasText: 'Function: fixture/math/power' }).click();
    await page.locator('.backtest-logic [aria-label="square: math.pow"]').click();
    const functionText = await page.locator('details').filter({ has: page.locator('summary', { hasText: 'Function: fixture/math/power' }) }).innerText();
    assert.match(functionText, /"exponent": 2/); assert.match(functionText, /"result"/); assert.match(functionText, /"parameters"/);
    await page.getByRole('combobox', { name: 'Color metric' }).selectOption('max_drawdown_pct');
    const red = () => page.locator('.backtest-matrix .sc-bar').first().evaluate(node => getComputedStyle(node).fill);
    const before = await red();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForFunction(() => document.querySelector('.backtest-matrix svg').viewBox.baseVal.width < 400);
    assert.equal(await red(), before);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    // Page changes and resizing retain one global heat scale.
    await page.evaluate(() => {
      const rows = Array.from({ length: 21 }, (_, i) => ({ ...config, trial_id: String(i), symbol: 'Symbol' + i, timeframe: 'M5', sample: 'demo', selected: true, status: 'completed', parameters: { lookback: '20', net_profit: 'param' }, sharpe: i === 19 ? '200' : '2', max_drawdown_pct: '2', net_profit: '3' }));
      SesameBacktest.render('#report', { ...config, selectionMetric: 'sharpe', rows });
    });
    const opacity = await page.locator('.backtest-matrix [data-row-index="0"]').getAttribute('opacity');
    await page.getByRole('combobox', { name: 'Symbol range' }).selectOption('1');
    assert.equal(await page.locator('.backtest-matrix [data-row-index="0"]').getAttribute('opacity'), opacity);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/sesame-backtest-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.screenshot({ path: '/tmp/sesame-backtest-desktop.png', fullPage: true });
  } finally { await page.close(); await browser.close(); }
});
