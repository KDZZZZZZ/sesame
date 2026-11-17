import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderStructuredReport } from '../packages/reports/report-content.js';
import { validateComponents } from '../packages/reports/component-tools.js';

const records = [
  { id: 'a', asset: 'A', time: 1, profit: 10, risk: 3 },
  { id: 'b', asset: 'A', time: 2, profit: 20, risk: 4 },
  { id: 'c', asset: 'B', time: 3, profit: 30, risk: 5 },
];
const select = (id, values) => ({ id, label: id, kind: 'select', options: values.map(value => ({ value })), value: values[0] });
const group = () => ({ type: 'group', layout: 'stack', controls: [select('asset', ['A', 'B']), select('metric', ['profit', 'risk']), select('record', ['a', 'b', 'c']),
  { id: 'period', label: 'Period', kind: 'range', min: 1, max: 3, value: [1, 3], step: 1 }], blocks: [
  { type: 'chart', kind: 'bar', rows: records, options: { x: 'time', y: 'profit' }, option_controls: { y: 'metric' }, filter: [{ field: 'asset', control: 'asset' }, { field: 'time', control: 'period', operator: 'between' }] },
  { type: 'table', columns: Object.keys(records[0]), rows: records.map(Object.values), page_size: 1, filter: [{ field: 'asset', control: 'asset' }], selection: { column: 'id', control: 'record' } },
  { type: 'chart', kind: 'bar', rows: records, options: { x: 'id', y: 'risk' }, filter: [{ field: 'id', control: 'record' }] },
] });
const content = () => ({ kind: 'document', sections: [{ title: '', blocks: [group(), group()] }] });
const render = content => renderStructuredReport({}, { title: 'Fixed record views', lead: 'Supplied records can be compared in controlled views.', data: [], provenance_kind: 'demo', locale: 'en', content });

test('controlled views validate local fields without mutating records or inventing calculations', async () => {
  const source = content(), before = structuredClone(source);
  assert.equal((await validateComponents({}, { content: source, provenance_kind: 'demo', target: 'answer' })).valid, true);
  await render(source); assert.deepEqual(source, before);
  for (const mutate of [g => g.controls.push(g.controls[0]), g => g.blocks[0].filter[0].control = 'outside',
    g => g.blocks[0].filter[0].field = 'missing', g => g.controls[1].options[1].value = 'calculated',
    g => g.blocks[1].selection.column = 'missing', g => g.controls[3].value = [3, 1]]) {
    const invalid = content(); mutate(invalid.sections[0].blocks[0]);
    await assert.rejects(render(invalid));
    assert.equal((await validateComponents({}, { content: invalid })).valid, false);
  }
});

test('selectors, linked records, shared ranges and pagination remain independent in real browser and export', { skip: !process.env.SESAME_HOST_ROOT, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(process.env.SESAME_HOST_ROOT, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1050, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => route.abort());
  await page.setContent(await render(content()));
  await page.waitForFunction(() => document.querySelectorAll('.kit-bar').length === 6);
  const bars = id => page.locator(`#${id} .kit-value`).allTextContents();
  const original = await page.locator('#sesame-module-charts').textContent();
  assert.deepEqual(await bars('content-chart-1'), ['10', '20']);
  await page.locator('#report-controls-1 select[data-control=metric]').selectOption('1');
  await page.waitForFunction(() => document.querySelector('#content-chart-1 .kit-value')?.textContent === '3');
  assert.deepEqual(await bars('content-chart-3'), ['10', '20'], 'second instance keeps its own state');
  assert.equal(await page.locator('#report-table-1 tbody tr:visible').count(), 1);
  await page.locator('#report-table-1 button[aria-label="Next page"]').click();
  await page.locator('#report-table-1 tbody tr:visible').click();
  await page.waitForFunction(() => document.querySelector('#content-chart-2 .kit-value')?.textContent === '4');
  assert.deepEqual(await bars('content-chart-4'), ['3']);
  await page.locator('#report-controls-1 input[data-control=period]').first().fill('2');
  await page.locator('#report-controls-1 input[data-control=period]').first().dispatchEvent('input');
  await page.waitForFunction(() => document.querySelectorAll('#content-chart-1 .kit-bar').length === 1);
  assert.deepEqual(await bars('content-chart-1'), ['4']);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  assert.equal(await page.locator('#report-table-1 tbody tr:visible').count(), 2, 'print includes all filtered records');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  assert.equal(await page.locator('#report-table-1 tbody tr:visible').count(), 1);
  for (const width of [390, 1050]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  assert.ok((await page.screenshot({ fullPage: true })).length > 1000);
  assert.ok((await page.pdf()).length > 1000);
  assert.equal(await page.locator('#sesame-module-charts').textContent(), original, 'selections never rewrite fixed source');
  assert.deepEqual(errors, []);
});
