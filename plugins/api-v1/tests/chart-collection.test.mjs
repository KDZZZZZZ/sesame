import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createTools } from '../packages/reports/index.js';

const host = process.env.SESAME_HOST_ROOT;
const root = new URL('../packages/reports/', import.meta.url);
const collections = await Promise.all(['statistical', 'temporal', 'structural'].map(async family => JSON.parse(await readFile(new URL(`examples/${family}-fixtures.json`, root), 'utf8'))));
const examples = collections.flatMap(collection => collection.charts);
const Type = new Proxy({}, { get: () => () => ({}) });
async function template(input) {
  let html;
  const tool = createTools({ tools: { Type, string: () => ({}), optional: () => ({}), define: (name, description, schema, execute) => ({ name, execute }) }, workspace: { file: async (_op, _path, bytes) => { html = bytes; } } }).find(tool => tool.name === 'report_template');
  await tool.execute(input);
  return html;
}
const base = { output_path: 'example.html', title: 'Fictional comparison', summary: 'Rendering fixture only', data_id: 'rows', chart_title: 'Fixture chart', takeaway: 'Inspect the source rows', source_note: 'Authored demo values', unit: 'demo units', columns: ['value'], demo: true };

test('chart template prevents accidental data and identity overrides', async () => {
  for (const chart_options of [{ rows: [] }, { kind: 'flow' }, { onSelect: 'override' }, JSON.parse('{"__proto__":{}}')]) await assert.rejects(template({ ...base, kind: 'waterfall', chart_options }), /cannot be supplied/);
  await assert.rejects(template({ ...base, kind: 'network-force', chart_options: { nodes: [{ id: 'unbound' }] } }), /fixed nodes binding/);
  await assert.rejects(template({ ...base, kind: 'bar' }), /x and y/);
  await assert.rejects(template({ ...base, kind: 'flow', chart_data: [{ property: 'rows', data_id: 'other' }] }), /unreserved/);
  await assert.rejects(template({ ...base, kind: 'flow', chart_data: [{ property: 'nodes', data_id: 'a' }, { property: 'nodes', data_id: 'b' }] }), /unique/);
});

test('all optional charts work through the authoring tool and real read-only binding bridge', { skip: !host, timeout: 120000 }, async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const snapshots = process.env.SESAME_CHART_SCREENSHOT_DIR;
  if (snapshots) await mkdir(snapshots, { recursive: true });
  try {
    assert.equal(examples.length, 16);
    for (const entry of examples) await t.test(entry.spec.kind, async () => {
      const { rows, nodes, kind, title, x, y, unit, ...options } = entry.spec;
      const input = { ...base, title: entry.title, chart_title: title ?? entry.title, source_note: entry.caption, kind, ...(x ? { x } : {}), ...(y ? { y } : {}), unit: unit || 'demo records', columns: [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 32), chart_options: options, ...(nodes ? { chart_data: [{ property: 'nodes', data_id: 'nodes' }] } : {}) };
      const html = await template(input), bindings = { rows, ...(nodes ? { nodes } : {}) };
      assert.doesNotMatch(html, /\{\{(?:CHARTS|KIT|STYLES|CONFIG)\}\}/);
      for (const width of [1000, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('about:blank');
        const bridge = `<script>window.bindings=${JSON.stringify(bindings).replace(/</g, '\\u003c')};window.reads=[];window.report={readData:async(id)=>{reads.push(id);if(!Object.hasOwn(bindings,id))throw Error('Unbound data');return{rows:bindings[id],page:{nextCursor:null}};},track:p=>{window.initialized=p;return p;}};</script>`;
        await page.setContent(html.replace('<body>', '<body>' + bridge));
        await page.evaluate(() => window.initialized);
        assert.equal(await page.locator('.status-error').count(), 0, `${kind} failed initialization`);
        const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, invalid: /NaN|Infinity/.test(document.querySelector('#chart svg').outerHTML), calls: reads }));
        assert.equal(geometry.overflow, false, `${kind} at ${width}px`); assert.equal(geometry.invalid, false);
        assert.deepEqual(geometry.calls.sort(), Object.keys(bindings).sort());
        const mark = page.locator('#chart [data-row-index]:not([data-row-index="-1"])').first();
        assert.ok(await mark.count(), kind);
        await mark.focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('details.report-inspect').evaluate(n => n.open), true);
        assert.equal(await page.locator('#table .sc-row-selected').count(), 1);
        const originalMarks = await page.locator('#chart [data-row-index]').count();
        await page.locator('#filter').fill('no-such-fixture-value');
        assert.equal(await page.locator('#table tbody tr').count(), 0);
        assert.equal(await page.locator('#chart [data-row-index]').count(), originalMarks, 'Inspector search must not truncate chart data');
        await mark.focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#filter').inputValue(), '');
        assert.equal(await page.locator('#table .sc-row-selected').count(), 1);
        if (nodes && kind.startsWith('network-')) {
          const node = page.locator('#chart [data-row-index="-1"]').first();
          await node.focus(); await page.keyboard.press('Enter');
          assert.equal(await page.locator('#table .sc-row-selected').count(), 0);
          assert.equal(await page.locator('.report-selected-record tbody tr').count(), 1);
        }
        if (snapshots && ['waterfall', 'parallel', 'network-force'].includes(kind)) await page.screenshot({ path: join(snapshots, `collection-${kind}-${width}.png`), fullPage: true });
      }
    });
    assert.deepEqual(errors, []);
  } finally { await page.close(); await browser.close(); }
});

test('collection gallery changes charts without leaking observers and tables inspect late rows', { skip: !host, timeout: 60000 }, async () => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 950 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const html = await readFile(new URL('examples/chart-gallery.html', root), 'utf8');
    const instrument = `<script>window.activeObservers=new Set();const RO=ResizeObserver;window.ResizeObserver=class extends RO{observe(...args){activeObservers.add(this);super.observe(...args)}disconnect(){activeObservers.delete(this);super.disconnect()}};</script>`;
    await page.setContent(html.replace('<body>', '<body>' + instrument));
    for (const entry of examples) {
      await page.selectOption('#chart-choice', entry.id);
      assert.equal(await page.evaluate(() => activeObservers.size), 1);
      assert.equal(await page.locator('#gallery-plot svg').count(), 1);
    }
    await page.selectOption('#chart-choice', 'parallel');
    await page.getByRole('spinbutton', { name: 'Sharpe minimum', exact: true }).fill('1');
    const filteredCount = await page.locator('#source-table tbody tr').count();
    assert.equal(filteredCount, 3);
    await page.locator('#gallery-plot [data-row-index="2"]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#source-table tbody tr').count(), filteredCount);
    assert.equal(await page.getByRole('spinbutton', { name: 'Sharpe minimum', exact: true }).inputValue(), '1');
    const before = await page.locator('#gallery-plot svg text').first().evaluate(n => getComputedStyle(n).fill);
    await page.click('#theme');
    const after = await page.locator('#gallery-plot svg text').first().evaluate(n => getComputedStyle(n).fill);
    assert.notEqual(after, before);
    const result = await page.evaluate(() => {
      reportKit.destroy('#report');
      const rows = Array.from({ length: 235 }, (_, i) => ({ id: `fixed-${i}`, exact: `${i}.000000000000001`, nested: { retained: true } }));
      const table = SesameCharts.table('#report', rows, ['id', 'exact', 'nested']); table.select(211);
      return { observers: activeObservers.size, selected: document.querySelector('.sc-row-selected').textContent, index: document.querySelector('.sc-row-selected').dataset.rowIndex, count: document.querySelectorAll('tbody tr').length };
    });
    assert.equal(result.observers, 0); assert.equal(result.index, '211'); assert.equal(result.count, 35);
    assert.match(result.selected, /211\.000000000000001/); assert.match(result.selected, /"retained":true/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); await browser.close(); }
});
