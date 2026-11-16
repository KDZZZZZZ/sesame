import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { withBuiltins } from '../packages/reports/renderer/builtins.js';

const host = process.env.SESAME_HOST_ROOT;
const document = body => withBuiltins(`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main>${body}</main></body></html>`);
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
  assert.equal(withBuiltins(html), html);
  assert.doesNotMatch(html, /sesame-evidence-appendix-runtime|report-evidence-return|report-evidence-links|data-report-evidence-appendix/);
  assert.equal((html.match(/id="sesame-report-detail-style"/g) ?? []).length, 1);
});

test('native chart and math initialization survive without appendix code', () => {
  const html = document('<div data-report-native-charts></div><div data-report-math="x^2"></div>');
  assert.equal(withBuiltins(html), html);
  assert.equal((html.match(/id="sesame-report-native-charts"/g) ?? []).length, 1);
  assert.equal((html.match(/id="sesame-report-math-runtime"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /sesame-evidence-appendix-runtime/);
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
