import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderStructuredReport } from '../packages/reports/report-content.js';

const host = process.env.SESAME_HOST_ROOT;
const root = new URL('../packages/reports/', import.meta.url);
const collections = await Promise.all(['statistical', 'temporal', 'structural'].map(async family => JSON.parse(await readFile(new URL(`examples/${family}-fixtures.json`, root), 'utf8'))));
const examples = collections.flatMap(collection => collection.charts);
const ref = { id:'chart-data',revision:'fixed-v1',digest:`sha256:${'a'.repeat(64)}`,kind:'data',schemaVersion:'1.0.0' };
const document = (block, ids = ['rows']) => renderStructuredReport({}, {
  title:'Fictional comparison',locale:'en',provenance_kind:'demo',
  data:ids.map(id=>({id,ref,usage:'Supplied chart values'})),
  content:{kind:'document',sections:[{title:'',blocks:[block]}]}
});
const base = { type:'chart',title:'Fixture chart',kind:'waterfall',data_id:'rows',columns:['value'],options:{} };

test('component renderer prevents accidental data and identity overrides', async () => {
  for (const options of [{ rows: [] }, { kind: 'flow' }, { onSelect: 'override' }, JSON.parse('{"__proto__":{}}'), {nodes:[{id:'unbound'}]}]) await assert.rejects(document({ ...base, options }), /cannot be supplied/);
  await assert.rejects(document({ ...base,kind:'flow',chart_data:[{property:'rows',data_id:'rows'}] }), /declared nodes binding/);
  await assert.rejects(document({ ...base,kind:'flow',chart_data:[{property:'nodes',data_id:'a'},{property:'nodes',data_id:'b'}] }, ['rows','a','b']), /one fixed nodes input/);
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
      const block = { ...base,title:title ?? entry.title,kind,columns:[...new Set(rows.flatMap(row=>Object.keys(row)))].slice(0,32),options:{...options,...(x?{x}:{}),...(y?{y}:{}),unit:unit || 'demo records'},...(nodes?{chart_data:[{property:'nodes',data_id:'nodes'}]}:{}) };
      const bindings = {rows,...(nodes?{nodes}:{})}, html = await document(block,Object.keys(bindings));
      assert.doesNotMatch(html, /\{\{(?:CHARTS|KIT|STYLES|CONFIG)\}\}/);
      for (const width of [1000, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('about:blank');
        const bridge = `<script>window.bindings=${JSON.stringify(bindings).replace(/</g, '\\u003c')};window.reads=[];window.report={readData:async(id)=>{reads.push(id);if(!Object.hasOwn(bindings,id))throw Error('Unbound data');return{rows:bindings[id],page:{nextCursor:null}};},track:p=>{window.initialized=p;return p;}};</script>`;
        await page.setContent(html.replace('</head>', bridge + '</head>'));
        await page.evaluate(() => window.initialized);
        assert.equal(await page.locator('.status-error').count(), 0, `${kind} failed initialization`);
        const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, invalid: /NaN|Infinity/.test(document.querySelector('.module-chart-plot svg').outerHTML), calls: reads }));
        assert.equal(geometry.overflow, false, `${kind} at ${width}px`); assert.equal(geometry.invalid, false);
        assert.deepEqual(geometry.calls.sort(), Object.keys(bindings).sort());
        const mark = page.locator('.module-chart-plot [data-row-index]:not([data-row-index="-1"])').first();
        assert.ok(await mark.count(), kind);
        await page.evaluate(() => document.querySelector('.module-chart-plot').addEventListener('chartselect', event => { window.selectedObservation = event.detail; }));
        await mark.focus(); await page.keyboard.press('Enter');
        const selection = await page.evaluate(() => selectedObservation);
        assert.deepEqual(selection.row, rows[selection.index], 'Selection retains the exact bound observation');
        assert.equal(await page.locator('.module-chart-plot .sc-selected').count(), 1);
        assert.deepEqual(await page.evaluate(() => window.bindings), bindings, 'Rendering retains every fixed source row and node unchanged');
        assert.equal(await page.locator('[id$="-evidence"], [data-report-evidence-appendix]').count(), 0, 'Charts do not create an automatic source appendix');
        if (nodes && kind.startsWith('network-')) {
          const node = page.locator('.module-chart-plot [data-row-index="-1"]').first();
          await node.focus(); await page.keyboard.press('Enter');
          assert.equal(await page.evaluate(() => selectedObservation.index), -1);
          assert.ok(nodes.some(n=>n.id===selection.row.source||n.id===selection.row.target));
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
    const css = await readFile(new URL('assets/editorial.css',root),'utf8');
    const scripts = await Promise.all(['report-kit.js','editorial-charts.js','charts-statistics.js','charts-temporal.js','charts-structure.js'].map(name=>readFile(new URL(`assets/${name}`,root),'utf8')));
    const html = `<!doctype html><html data-theme="light"><head><style>${css}</style></head><body><main id="report"><div id="gallery-plot"></div></main>${scripts.map(script=>`<script>${script}</script>`).join('')}</body></html>`;
    const instrument = `<script>window.activeObservers=new Set();const RO=ResizeObserver;window.ResizeObserver=class extends RO{observe(...args){activeObservers.add(this);super.observe(...args)}disconnect(){activeObservers.delete(this);super.disconnect()}};</script>`;
    await page.setContent(html.replace('<body>', '<body>' + instrument));
    for (const entry of examples) {
      await page.evaluate(spec=>{reportKit.destroy('#report');document.getElementById('gallery-plot').replaceChildren();SesameCharts.chart('#gallery-plot',spec);},entry.spec);
      assert.equal(await page.evaluate(() => activeObservers.size), 1);
      assert.equal(await page.locator('#gallery-plot svg').count(), 1);
    }
    const before = await page.locator('#gallery-plot svg text').first().evaluate(n => getComputedStyle(n).fill);
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
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
