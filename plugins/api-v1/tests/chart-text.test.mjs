import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const host = process.env.SESAME_HOST_ROOT;
const asset = name => readFile(new URL(`../packages/reports/assets/${name}`, import.meta.url), 'utf8');
const fixture = async name => JSON.parse(await readFile(new URL(`../packages/reports/examples/${name}-fixtures.json`, import.meta.url), 'utf8'));
async function pageFor(t, scripts) {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.setContent(`<!doctype html><html lang="en"><head><style>${await asset('editorial.css')}</style></head><body><main id="chart"></main>${(await Promise.all(scripts.map(asset))).map(script => `<script>${script}</script>`).join('')}</body></html>`);
  return page;
}

test('direct charts need no authored title or caption and keep one explicit title with readable data', { skip: !host }, async t => {
  const page = await pageFor(t, ['report-kit.js']);
  const rows = [{ category: 'A', first: 3, second: 5 }, { category: 'B', first: 2, second: 4 }];
  await page.evaluate(rows => { window.rows = rows; reportKit.chart('#chart', { kind: 'bar', x: 'category', y: ['first', 'second'], unit: 'kg', data: rows }); }, rows);
  assert.equal(await page.locator('figcaption').count(), 0);
  assert.match(await page.locator('svg').getAttribute('aria-label'), /bar.*category.*first.*second/);
  assert.equal(await page.locator('.kit-bar').count(), 4);
  assert.match(await page.locator('[data-report-text="legend"]').innerText(), /first.*second/s);
  await page.evaluate(() => { reportKit.destroy('#chart'); document.getElementById('chart').replaceChildren(); reportKit.chart('#chart', { kind: 'bar', title: 'Supplied heading', caption: 'Author conclusion belongs in the document body', x: 'category', y: 'first', unit: 'kg', data: rows }); });
  assert.deepEqual(await page.locator('figcaption strong').allTextContents(), ['Supplied heading']);
  assert.doesNotMatch(await page.locator('#chart').innerText(), /Author conclusion/);
  assert.equal(await page.locator('svg').getAttribute('aria-label'), 'Supplied heading');
  assert.deepEqual(await page.evaluate(() => rows), rows);
});

test('chart context and legend stay visible once while method and help remain accessible across resize', { skip: !host }, async t => {
  const page = await pageFor(t, ['editorial-charts.js']);
  await page.evaluate(() => {
    SesameCharts.register('text-fixture', ctx => {
      ctx.note('n=10; missing stays missing', 'context');
      ctx.note('n=10; missing stays missing', 'context');
      ctx.note('Hollow = zero', 'legend');
      ctx.note('Method: source density', 'method');
      ctx.note('Select a point to inspect the source', 'help');
      ctx.note('Method: source density', 'method');
    });
    SesameCharts.chart('#chart', { kind: 'text-fixture', rows: [{}] });
  });
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForFunction(() => Math.abs(document.querySelector('#chart svg').viewBox.baseVal.width - Math.max(280, document.querySelector('#chart').clientWidth)) < 2);
    assert.equal(await page.locator('.sc-chart-reading').count(), 1);
    assert.deepEqual(await page.locator('[data-report-text="context"]').allTextContents(), ['n=10; missing stays missing']);
    assert.deepEqual(await page.locator('[data-report-text="legend"]').allTextContents(), ['Hollow = zero']);
    assert.doesNotMatch(await page.locator('#chart').innerText(), /Method:|Select a point/);
    const description = await page.locator('svg').getAttribute('aria-describedby');
    assert.ok(description);
    assert.equal(await page.locator(`#${description}`).textContent(), 'Method: source density\nSelect a point to inspect the source');
  }
});

test('document and module wrappers own visible chart titles and conclusions across resize', { skip: !host }, async t => {
  const rows = [{ category: 'A', value: 3 }, { category: 'B', value: 5 }];
  for (const runtime of ['content-charts.js', 'module-charts.js']) {
    const page = await pageFor(t, ['report-kit.js', 'editorial-charts.js']);
    await page.evaluate(rows => {
      document.querySelector('main').innerHTML = '<h3>Outer chart title</h3><p>Authored conclusion</p><div id="plot"></div><details id="plot-details"><summary>Exact records</summary><div class="module-chart-table"></div></details>';
      const config = document.createElement('script'); config.type = 'application/json'; config.id = 'sesame-module-charts';
      config.textContent = JSON.stringify([{ id: 'plot', kind: 'bar', title: 'Outer chart title', caption: 'Authored conclusion', rows, columns: ['category', 'value'], options: { x: 'category', y: 'value' } }]);
      document.body.append(config);
      window.report = { track(promise) { window.chartReady = promise; return promise; } };
    }, rows);
    await page.addScriptTag({ content: await asset(runtime) });
    await page.evaluate(() => chartReady);
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForFunction(() => Math.abs(document.querySelector('#plot svg').viewBox.baseVal.width - Math.max(280, document.querySelector('#plot').clientWidth)) < 2);
      assert.equal(await page.locator('#plot figcaption').count(), 0, runtime);
      assert.equal(await page.locator('#plot svg').getAttribute('aria-label'), 'Outer chart title');
      const visible = await page.locator('main').innerText();
      assert.equal(visible.split('Outer chart title').length - 1, 1, runtime);
      assert.equal(visible.split('Authored conclusion').length - 1, 1, runtime);
    }
    assert.deepEqual(await page.evaluate(() => JSON.parse(document.getElementById('sesame-module-charts').textContent)[0].rows), rows);
  }
});

test('real chart families retain scales, denominators, missing states and time zones without visible method tutorials', { skip: !host }, async t => {
  const page = await pageFor(t, ['editorial-charts.js', 'charts-statistics.js', 'charts-temporal.js', 'charts-composition.js']);
  const sets = await Promise.all(['statistical', 'temporal', 'composition'].map(fixture));
  const selected = sets.flatMap(set => set.charts).filter(item => ['histogram', 'boxplot', 'ridgeline', 'violin', 'calendar', 'bump', 'outcome-tally', 'tick-donut'].includes(item.spec.kind));
  const before = structuredClone(selected);
  await page.evaluate(charts => {
    window.chartTextSources = charts;
    for (const item of charts) {
      const target = document.createElement('div'); target.id = item.spec.kind; document.querySelector('main').append(target);
      SesameCharts.chart(target, item.spec);
    }
  }, selected);
  for (const item of selected.filter(item => item.spec.method)) {
    assert.ok((await page.locator(`#${item.spec.kind} svg > desc`).textContent()).includes(item.spec.method));
    assert.ok(!(await page.locator(`#${item.spec.kind}`).innerText()).includes(item.spec.method));
  }
  assert.match(await page.locator('#histogram svg > desc').textContent(), /n=\d+/);
  assert.doesNotMatch(await page.locator('#histogram').innerText(), /n=\d+/);
  assert.match(await page.locator('#calendar .sc-chart-reading').innerText(), /0: zero.*×: closed.*—: missing/s);
  const calendar = selected.find(item => item.spec.kind === 'calendar');
  assert.ok((await page.locator('#calendar .sc-chart-reading').innerText()).includes(calendar.spec.timezone));
  assert.match(await page.locator('#bump svg > desc').textContent(), /tie rule:/);
  assert.match(await page.locator('#outcome-tally .sc-chart-reading').innerText(), /1 tick = .*samples.*Overlapping|1 tick = .*samples.*Exclusive/s);
  assert.match(await page.locator('#tick-donut svg > desc').textContent(), /clockwise/);
  assert.doesNotMatch(await page.locator('#tick-donut').innerText(), /clockwise/);
  assert.deepEqual(await page.evaluate(() => chartTextSources), before);
});

test('default chart footers use short reading keys while full explanations remain accessible', { skip: !host }, async t => {
  const page = await pageFor(t, ['editorial-charts.js', 'charts-statistics.js', 'charts-temporal.js', 'charts-structure.js', 'charts-composition.js']);
  const sets = await Promise.all(['statistical', 'temporal', 'structural', 'composition'].map(fixture));
  const selected = sets.flatMap(set => set.charts).filter(item => ['dumbbell', 'strip', 'calendar', 'parallel', 'lifecycle', 'flow', 'network-circular', 'dot-heatmap', 'funnel', 'outcome-tally', 'bubble-ledger'].includes(item.spec.kind));
  await page.evaluate(charts => {
    window.footerSources = charts;
    for (const item of charts) {
      const target = document.createElement('div'); target.id = item.spec.kind; document.querySelector('main').append(target);
      SesameCharts.chart(target, item.spec);
    }
  }, selected);
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForFunction(() => [...document.querySelectorAll('main > div')].every(target => Math.abs(target.querySelector('svg').viewBox.baseVal.width - Math.max(280, target.clientWidth)) < 2));
    for (const text of await page.locator('.sc-chart-reading').allInnerTexts()) assert.doesNotMatch(text, /registered|recorded|source row|n=|fixed universe|not duration|not inferred|never replaced|conserve exactly|represents|indicate|表示|未附带依据链接/);
    assert.equal(await page.locator('#dumbbell [data-report-text="legend"]').innerText(), 'Hollow: IS · Filled: OOS');
    assert.match(await page.locator('#dumbbell svg > desc').textContent(), /missing endpoints are not connected/);
    assert.equal(await page.locator('#lifecycle .report-source').isHidden(), true);
    assert.match(await page.locator('#lifecycle svg > desc').textContent(), /not duration or causality.*no attached evidence link/s);
    assert.match(await page.locator('#network-circular svg > desc').textContent(), /Distance is layout only/);
    assert.match(await page.locator('#funnel svg > desc').textContent(), /preceding stage/);
    assert.match(await page.locator('#outcome-tally svg > desc').textContent(), /do not add rows/);
    for (const item of selected) {
      const svg = page.locator(`#${item.spec.kind} > .sc-frame > svg`), id = await svg.getAttribute('aria-describedby');
      assert.ok(id, item.spec.kind); assert.equal(await page.locator(`#${id}`).count(), 1, `${item.spec.kind} description survives redraw`);
    }
  }
  assert.deepEqual(await page.evaluate(() => footerSources), selected);
});

test('internal chart descriptions stay accessible through resize without printing source metadata', { skip: !host }, async t => {
  const page = await pageFor(t, ['editorial-charts.js']);
  const description = '2026-01-01 – 2026-03-31; n=12; supplied period metadata';
  await page.evaluate(description => SesameCharts.chart('#chart', { kind: 'bar', x: 'label', y: 'value', rows: [{ label: 'A', value: 2 }], description }), description);
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForFunction(() => Math.abs(document.querySelector('#chart svg').viewBox.baseVal.width - Math.max(280, document.querySelector('#chart').clientWidth)) < 2);
    const id = await page.locator('#chart svg').getAttribute('aria-describedby');
    assert.ok(id); assert.equal(await page.locator(`#${id}`).textContent(), description);
    assert.ok(!(await page.locator('#chart').innerText()).includes(description));
  }
  assert.match(await page.evaluate(() => { try { SesameCharts.chart('#chart', { kind: 'bar', rows: [], description: {} }); return ''; } catch (error) { return error.message; } }), /description.*text/);
});
