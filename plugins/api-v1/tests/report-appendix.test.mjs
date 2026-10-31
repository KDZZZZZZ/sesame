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
const noDuplicates = page => page.evaluate(() => {
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
  return ids.length === new Set(ids).size;
});
const launch = async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [])); return page;
};

test('appendix packaging is idempotent and leaves authored dollar expressions literal', () => {
  const html = document('<p>$& $1 {{BODY}}</p>');
  assert.equal(withEvidenceAppendix(html), html);
  assert.match(html, /<p>\$& \$1 \{\{BODY\}\}<\/p>/);
  assert.equal((html.match(/id="sesame-evidence-appendix-runtime"/g) ?? []).length, 1);
});

test('composed evidence moves to the end while charts, inference and exact data remain usable', { skip: !host, timeout: 60000 }, async t => {
  const page = await launch(t);
  const structure = resolveStructure({ template_id: 'R02' });
  const html = renderComposedReport({ title: '附录布局 · 合成示例', structure, bound: bindResults(structure, fixture.rows), data: [], references: [], demo: true });
  await page.setContent(html);
  await page.waitForFunction(() => document.querySelector('.module-chart-plot[data-chart-status="ready"]') && window.SesameAppendix);
  assert.equal(await page.locator('details:not([data-report-evidence-appendix] details)').count(), 0);
  assert.ok(await page.locator('.report-evidence-entry').count() > 10);
  assert.equal(await page.evaluate(() => document.querySelector('main').lastElementChild.matches('[data-report-evidence-appendix]')), true);
  const mainChart = page.locator('#section-M01 .module-chart-plot').first();
  assert.equal(await mainChart.getAttribute('data-chart-status'), 'ready');
  assert.ok((await mainChart.boundingBox()).height > 100);
  assert.ok(await page.locator('#section-M13 .report-reasoning').count() > 0, 'reasoning remains in the reading path');
  const link = page.locator('#section-M01 .report-evidence-links a').first();
  const id = (await link.getAttribute('href')).slice(1), linkId = await link.getAttribute('id');
  await link.click();
  const entry = page.locator(`#${id}`);
  assert.equal(await entry.locator(':scope > details').getAttribute('open'), '');
  await page.waitForFunction(id => document.querySelector(`#${id} .module-chart-table table`), id);
  assert.ok(await entry.locator('tbody tr').count() > 0);
  await entry.locator(':scope > details > .report-evidence-return').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), linkId);
  const folded = page.locator('.report-evidence-entry details.module-field').filter({ has: page.locator('.module-chart-plot:not([data-chart-status])') }).first();
  if (await folded.count()) {
    const plotId = await folded.locator('.module-chart-plot').getAttribute('id');
    await folded.locator(':scope > summary').click();
    const plot = page.locator(`#${plotId}[data-chart-status="ready"]`);
    await plot.waitFor();
    assert.ok((await plot.boundingBox()).width > 200, 'lazy auxiliary charts measure their opened appendix');
  }
  assert.equal(await noDuplicates(page), true);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => { document.querySelectorAll('details[open]').forEach(node => { node.open = false; }); });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
});

test('custom controls and inline overrides remain in place; replaced owners leave no stale appendix and print preserves records', { skip: !host, timeout: 30000 }, async t => {
  const page = await launch(t);
  await page.setContent(document(`<section id="reading"><h2>判断</h2><p>判断、主要统计与条件保持正文。</p><div id="dynamic"><details id="raw" data-report-evidence><summary>原始样本</summary><pre>exact: 9007199254740993.0000000001</pre><details><summary>复核计算</summary><p>all 3 original cases</p></details></details></div><details id="controls" data-report-disclosure="controls" data-report-evidence><summary>图表筛选</summary><button onclick="this.textContent='已选择'">选择</button></details><details id="unknown-control"><summary>自定义交互</summary><p>作者尚未分类</p></details><div data-report-evidence-layout="inline"><details id="inline" data-report-evidence><summary>用户要求原位</summary><p>明示布局覆盖</p></details></div></section>`));
  await page.locator('.report-evidence-entry').waitFor();
  assert.equal(await page.locator('#reading > #controls').count(), 1);
  assert.equal(await page.locator('#reading > #unknown-control').count(), 1);
  assert.equal(await page.locator('#reading #inline').count(), 1);
  await page.locator('#controls > summary').click(); await page.getByRole('button', { name: '选择', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '已选择', exact: true }).count(), 1);
  const oldId = await page.locator('.report-evidence-entry').getAttribute('id');
  await page.evaluate(() => { document.getElementById('dynamic').innerHTML = '<details id="new-raw" data-report-evidence><summary>新选择</summary><pre>all new original rows</pre></details>'; });
  await page.waitForFunction(id => !document.getElementById(id), oldId);
  assert.equal(await page.locator('.report-evidence-entry').count(), 1);
  assert.equal(await page.locator('#raw').count(), 0);
  await page.evaluate(() => { SesameAppendix.collect(); SesameAppendix.collect(); });
  assert.equal(await page.locator('.report-evidence-entry').count(), 1);
  assert.equal(await noDuplicates(page), true);
  await page.emulateMedia({ media: 'print' });
  assert.ok((await page.locator('#new-raw > pre').boundingBox()).height > 0, 'closed original records remain visible in print CSS');
  const pdf = await page.pdf(); assert.ok(pdf.length > 1000);
});

test('signal study keeps original results in the end appendix and preserves chart selection', { skip: !host, timeout: 30000 }, async t => {
  const page = await launch(t);
  const run = JSON.parse(readFileSync(new URL('../../optional-api-v1/packages/auto-factor-mining/examples/demo-run.json', import.meta.url)));
  const before = JSON.stringify(run);
  await page.setContent(document(renderSignalStudy(run, {demo:true})));
  await page.locator('.report-evidence-entry').first().waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(JSON.parse(document.getElementById('run-snapshot').textContent))), before);
  assert.equal(await page.locator('details:not([data-report-evidence-appendix] details)').count(), 0);
  assert.equal(await page.locator('#factor-matrix').evaluate(n => Boolean(n.closest('[data-report-evidence-appendix]'))), false);
  await page.locator('#factor-focus').selectOption('1');
  assert.equal(await page.locator('[data-factor-condition="1"]').isVisible(), true);
  assert.equal(await page.locator('[data-factor-condition="0"]').isHidden(), true);
  const link=page.locator('.report-evidence-links a').first(), linkId=await link.getAttribute('id');
  await link.click();
  assert.equal(await page.locator('.report-evidence-entry>details').getAttribute('open'), '');
  await page.locator('.report-evidence-return').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id), linkId);
  assert.equal(await noDuplicates(page),true);
});
