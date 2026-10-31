import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const host = process.env.SESAME_HOST_ROOT;
const assets = new URL('../packages/reports/assets/', import.meta.url);
const [css, kit] = await Promise.all(['editorial.css', 'report-kit.js'].map(name => readFile(new URL(name, assets), 'utf8')));
// Synthetic results reproduce the twelve-row report shape without replacing
// any real study or rounding the source decimal strings.
const rows = Array.from({ length: 12 }, (_, index) => ({
  category: `时期 ${String(index + 1).padStart(2, '0')} · 方案`,
  primary: index % 3 === 0 ? `-${index + 1}.123456789012345` : `${index + 1}.123456789012345`,
  comparison: `${index + 2}.987654321098765`,
  third: index === 4 ? null : `${index + 3}.25`,
}));

test('horizontal bars keep every supplied row inside the SVG at authored minimum heights', { skip: !host, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><style>${css}
    body{margin:0;padding:18px}main{max-width:904px;margin:auto;min-width:0}
  </style></head><body><main id="plot"></main><script>${kit}</script></body></html>`);
  await page.evaluate(() => {
    window.draw = ({ data, height, y }) => {
      reportKit.destroy('#plot'); document.getElementById('plot').replaceChildren();
      window.sourceRows = data; data.forEach(Object.freeze); Object.freeze(data);
      window.selected = null;
      reportKit.chart('#plot', {
        kind: 'hbar', title: '演示：十二行原始结果', caption: '虚构数值，仅用于呈现回归',
        data, x: 'category', y, height, digits: 2,
        onSelect(row, index) { window.selected = { row, index, same: row === sourceRows[index] }; },
      });
    };
    window.geometry = () => {
      const svg = document.querySelector('#plot svg'), box = svg.viewBox.baseVal;
      const marks = [...svg.querySelectorAll('rect.kit-bar, text')].map(node => {
        const b = node.getBBox();
        return { tag: node.tagName, text: node.textContent, index: node.dataset.rowIndex, x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height };
      });
      return { width: box.width, height: box.height, bars: svg.querySelectorAll('.kit-bar').length,
        clipped: marks.filter(b => b.x < -1 || b.y < -1 || b.right > box.width + 1 || b.bottom > box.height + 1),
        source: sourceRows, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth };
    };
  });
  const screenshots = process.env.SESAME_CHART_SCREENSHOT_DIR;
  if (screenshots) await mkdir(screenshots, { recursive: true });

  for (const width of [1000, 720, 390]) await t.test(`all twelve rows and grouped series fit at ${width}px`, async () => {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, y, expectedBars, expectedHeight] of [
      ['single', 'primary', 12, 384],
      ['grouped', ['primary', 'comparison', 'third'], 35, 696],
    ]) {
      await page.evaluate(input => draw(input), { data: rows, height: 300, y });
      const geometry = await page.evaluate(() => window.geometry());
      assert.equal(geometry.height, expectedHeight, 'An authored height cannot crop the supplied category rows');
      assert.equal(geometry.bars, expectedBars);
      assert.deepEqual(geometry.clipped, [], 'Every bar, category label and value label must fit the viewBox');
      assert.equal(geometry.documentWidth, geometry.viewport);
      assert.deepEqual(geometry.source, rows, 'Rendering must retain exact original values and missingness');
      const last = page.locator('.kit-bar[data-row-index="11"]').last();
      await last.click();
      assert.deepEqual(await page.evaluate(() => selected), { row: rows[11], index: 11, same: true });
      await last.focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => selected), { row: rows[11], index: 11, same: true });
      if (screenshots) await page.locator('#plot').screenshot({ path: join(screenshots, `hbar-${width}-${name}.png`) });
    }
  });

  await t.test('short data keeps the requested height and omitting height preserves auto sizing', async () => {
    for (const [data, height, expected] of [[rows.slice(0, 2), 300, 300], [rows, 900, 900], [rows, undefined, 384], [rows, 100, 384]]) {
      await page.evaluate(input => draw(input), { data, height, y: 'primary' });
      const geometry = await page.evaluate(() => window.geometry());
      assert.equal(geometry.height, expected); assert.deepEqual(geometry.clipped, []); assert.deepEqual(geometry.source, data);
    }
  });

  await t.test('legend hide/restore recomputes required space without changing source identity', async () => {
    await page.evaluate(input => draw(input), { data: rows, height: 300, y: ['primary', 'comparison', 'third'] });
    const legend = page.locator('.kit-legend button');
    await legend.nth(2).click();
    assert.equal((await page.evaluate(() => window.geometry())).height, 516);
    await legend.nth(1).click();
    assert.equal((await page.evaluate(() => window.geometry())).height, 384);
    await legend.nth(0).click();
    assert.match(await page.locator('#plot').innerText(), /没有可绘制的数值/);
    for (let index = 0; index < 3; index++) await legend.nth(index).click();
    const geometry = await page.evaluate(() => window.geometry());
    assert.equal(geometry.height, 696); assert.equal(geometry.bars, 35); assert.deepEqual(geometry.clipped, []); assert.deepEqual(geometry.source, rows);
    await page.locator('.kit-bar[data-row-index="11"]').first().click();
    assert.deepEqual(await page.evaluate(() => selected), { row: rows[11], index: 11, same: true });
  });
  assert.deepEqual(errors, []);
});
