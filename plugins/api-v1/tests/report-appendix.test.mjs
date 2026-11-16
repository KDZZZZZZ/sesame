import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { withEvidenceAppendix } from '../packages/reports/report-appendix.js';
import { resolveStructure, bindResults } from '../packages/reports/report-structure.js';
import { renderComposedReport } from '../packages/reports/report-compose.js';
import { renderSignalStudy } from '../packages/reports/report-signal-study.js';

const host = process.env.SESAME_HOST_ROOT;
const fixture = JSON.parse(readFileSync(new URL('../packages/reports/examples/module-visual-fixtures.json', import.meta.url)));
const document = body => withEvidenceAppendix(`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main>${body}</main></body></html>`);
const noAppendix = async page => assert.equal(await page.locator('[data-report-evidence-appendix], .report-evidence-links, .report-evidence-return, #sesame-evidence-appendix-runtime, .module-sources, #run-original-record').count(), 0);
const launch = async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [])); return page;
};

test('report initialization is idempotent and leaves authored disclosures and literal text unchanged', () => {
  const body = '<p>$& $1 {{BODY}}</p><section id="owner"><details data-report-evidence><summary>原始记录</summary><pre>9007199254740993.0000001</pre></details></section>';
  const html = document(body);
  assert.ok(html.includes(body));
  assert.equal(withEvidenceAppendix(html), html);
  assert.doesNotMatch(html, /sesame-evidence-appendix-runtime|report-evidence-return|report-evidence-links|data-report-evidence-appendix/);
  assert.equal((html.match(/id="sesame-report-detail-style"/g) ?? []).length, 1);
});

test('native chart and math initialization survive without appendix code', () => {
  const html = document('<div data-report-native-charts></div><div data-report-math="x^2"></div>');
  assert.equal(withEvidenceAppendix(html), html);
  assert.equal((html.match(/id="sesame-report-native-charts"/g) ?? []).length, 1);
  assert.equal((html.match(/id="sesame-report-math-runtime"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /sesame-evidence-appendix-runtime/);
});

test('composed charts and local disclosures stay usable without a generated source appendix', { skip: !host, timeout: 60000 }, async t => {
  const page = await launch(t), structure = resolveStructure({ template_id: 'R02' });
  const refs = [{ id: 'fixed-demo', revision: 'r1', digest: `sha256:${'a'.repeat(64)}`, kind: 'data', schemaVersion: '1.0.0' }];
  await page.setContent(renderComposedReport({ title: '原位明细 · 合成示例', structure, bound: bindResults(structure, fixture.rows), data: [{ id: 'results', ref: refs[0] }], references: refs, demo: true }));
  await page.locator('#section-M01 .module-chart-plot[data-chart-status="ready"]').first().waitFor();
  await noAppendix(page);
  assert.ok(await page.locator('#section-M13 .report-reasoning').count() > 0);
  const details = page.locator('#section-M01 .module-chart-inspect').first();
  await details.locator(':scope > summary').click();
  await details.locator('table').waitFor();
  assert.ok(await details.locator('tbody tr').count() > 0);
  const folded = page.locator('details.module-field').filter({ has: page.locator('.module-chart-plot:not([data-chart-status])') }).first();
  if (await folded.count()) {
    const plotId = await folded.locator('.module-chart-plot').getAttribute('id');
    await folded.locator(':scope > summary').click();
    await page.locator(`#${plotId}[data-chart-status="ready"]`).waitFor();
    assert.ok((await page.locator(`#${plotId}`).boundingBox()).width > 200);
  }
  const contract = await page.locator('#sesame-composition-bindings').evaluate(node => JSON.parse(node.textContent));
  assert.deepEqual(contract.references, refs);
  assert.deepEqual(contract.data[0].ref, refs[0]);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => document.querySelectorAll('details[open]').forEach(node => { node.open = false; }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
});

test('authored details and controls keep their owner through updates and print exact records', { skip: !host, timeout: 30000 }, async t => {
  const page = await launch(t);
  await page.setContent(document('<section id="reading"><div id="dynamic"><details id="raw" data-report-evidence><summary>原始样本</summary><pre>9007199254740993.0000000001</pre></details></div><details id="controls"><summary>图表筛选</summary><button onclick="this.textContent=\'已选择\'">选择</button></details></section>'));
  await noAppendix(page);
  assert.equal(await page.locator('#dynamic > #raw').count(), 1);
  await page.locator('#raw > summary').click();
  assert.equal(await page.locator('#raw > pre').innerText(), '9007199254740993.0000000001');
  await page.locator('#controls > summary').click(); await page.getByRole('button', { name: '选择', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '已选择', exact: true }).count(), 1);
  await page.evaluate(() => { document.getElementById('dynamic').innerHTML = '<details id="new-raw"><summary>新选择</summary><pre>all new original rows</pre></details>'; });
  assert.equal(await page.locator('#raw').count(), 0);
  assert.equal(await page.locator('#dynamic > #new-raw').count(), 1);
  await noAppendix(page);
  await page.emulateMedia({ media: 'print' });
  assert.ok((await page.locator('#new-raw > pre').boundingBox()).height > 0);
  assert.ok((await page.pdf()).length > 1000);
});

test('signal study retains its exact snapshot and chart selection without a default record appendix', { skip: !host, timeout: 30000 }, async t => {
  const page = await launch(t);
  const run = JSON.parse(readFileSync(new URL('../../optional-api-v1/packages/auto-factor-mining/examples/demo-run.json', import.meta.url)));
  const before = JSON.stringify(run);
  await page.setContent(document(renderSignalStudy(run, { demo: true })));
  await page.locator('#factor-matrix svg').waitFor();
  assert.equal(await page.locator('#run-snapshot').evaluate(node => JSON.stringify(JSON.parse(node.textContent))), before);
  await noAppendix(page);
  await page.locator('#factor-focus').selectOption('1');
  // A selected record without authored conditions has no placeholder prose.
  assert.equal(await page.locator('[data-factor-condition="1"]').getAttribute('hidden'), null);
  assert.notEqual(await page.locator('[data-factor-condition="0"]').getAttribute('hidden'), null);
  assert.equal(await page.locator('#factor-periods svg').count(), 1);
});
