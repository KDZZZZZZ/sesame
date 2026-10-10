import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const host = process.env.SESAME_HOST_ROOT;
const assets = new URL('../packages/reports/assets/', import.meta.url);
const [css, kit] = await Promise.all(['editorial.css', 'report-kit.js'].map(name => readFile(new URL(name, assets), 'utf8')));

test('original report charts preserve coordinates, category rows and finite domains', { skip: !host, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(`<!doctype html><html lang="en"><head><style>${css}</style></head><body><main id="chart"></main><script>${kit}</script></body></html>`);
    await page.evaluate(() => {
      window.draw = input => {
        reportKit.destroy('#chart');document.getElementById('chart').replaceChildren();
        const spec = { kind: 'scatter', title: 'Fictional numerical fixture', caption: 'Registered fixture values', x: 'x', y: 'value', ...input };
        window.source = spec.data;
        return reportKit.chart('#chart', { ...spec, onSelect: (row, index) => { window.selected = { row, index, same: row === source[index] }; } });
      };
      window.rejected = spec => { try { draw(spec);return ''; } catch (error) { return error.message; } };
    });

    await t.test('missing numeric or time coordinates are rejected rather than turned into zero', async () => {
      const result = await page.evaluate(() => {
        const messages = [null, undefined, '', ' '].map(x => rejected({ xType: 'number', data: [{ x, value: 1 }, { x: 2, value: 3 }] }));
        messages.push(rejected({ data: [{ x: null, value: 1 }, { x: 2, value: 3 }] }));
        messages.push(rejected({ xType: 'time', data: [{ x: null, value: 1 }, { x: '2026-01-01', value: 3 }] }));
        draw({ data: [{ x: 0, value: 1 }, { x: 2, value: 3 }] });
        return { messages, marks: document.querySelectorAll('.kit-dot').length, label: document.querySelector('[data-row-index="0"]').getAttribute('aria-label') };
      });
      result.messages.forEach(message => assert.match(message, /missing (number|time) coordinate/));
      assert.equal(result.marks, 2);assert.match(result.label, /^0:/);
    });

    await t.test('numeric strings use numeric spacing and selections keep unsorted original rows', async () => {
      const rows = [{ x: '100', value: '1.00000000000000001' }, { x: '1', value: '2' }, { x: '2', value: '3' }];
      const coordinates = await page.evaluate(data => {
        draw({ data });return [1, 2, 0].map(index => Number(document.querySelector(`[data-row-index="${index}"]`).getAttribute('cx')));
      }, rows);
      assert.ok(Math.abs((coordinates[1] - coordinates[0]) / (coordinates[2] - coordinates[0]) - 1 / 99) < 1e-10);
      await page.locator('[data-row-index="0"]').focus();await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => selected), { row: rows[0], index: 0, same: true });
      assert.deepEqual(await page.evaluate(() => source), rows);
      await page.evaluate(() => draw({ data: [{ x: '0', value: 0 }, { x: '1.00000000000000001', value: 1 }, { x: '2', value: 2 }] }));
      // The original chart's transparent plot overlay intentionally receives
      // pointer movement and chooses the nearest original observation.
      const point = await page.locator('[data-row-index="1"]').boundingBox();
      await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
      assert.match(await page.locator('.kit-tooltip').innerText(), /1\.00000000000000001/);
    });

    await t.test('bar charts reject repeated category/series keys and retain legitimate grouped rows', async () => {
      const result = await page.evaluate(() => ['bar', 'hbar'].map(kind => {
        const duplicate = rejected({ kind, data: [{ x: 'A', value: 1 }, { x: 'A', value: 2 }] });
        const groupedDuplicate = rejected({ kind, series: 'group', data: [{ x: 'A', group: 'one', value: 1 }, { x: 'A', group: 'one', value: 2 }] });
        draw({ kind, series: 'group', data: [{ x: 'A', group: 'one', value: '1' }, { x: 'A', group: 'two', value: '2' }] });
        return { kind, duplicate, groupedDuplicate, indices: [...document.querySelectorAll('.kit-bar')].map(n => Number(n.dataset.rowIndex)) };
      }));
      for (const entry of result) {
        assert.match(entry.duplicate, /duplicate category.*aggregate explicitly/);
        assert.match(entry.groupedDuplicate, /duplicate category.*aggregate explicitly/);
        assert.deepEqual(entry.indices, [0, 1]);
      }
    });

    await t.test('ticks finish for sub-ULP nice steps, wide finite spans and subnormal spans', async () => {
      let timeout;
      const rendering = page.evaluate(() => [
        [1e16, 1e16 + 2], [-1e308, 1e308], [1e308, 1.1e308], [Number.MIN_VALUE, Number.MIN_VALUE * 2]
      ].map(values => {
        draw({ data: values.map(x => ({ x, value: x })) });
        const svg = document.querySelector('svg'), dots = [...svg.querySelectorAll('.kit-dot')];
        return { values, invalid: /NaN|Infinity/.test(svg.outerHTML), axisCount: svg.querySelectorAll('.kit-axis').length,
          positions: dots.map(n => [Number(n.getAttribute('cx')), Number(n.getAttribute('cy'))]) };
      }));
      try {
        const results = await Promise.race([rendering, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Finite chart domains did not finish rendering within 3 seconds')), 3000); })]);
        for (const result of results) {
          assert.equal(result.invalid, false);assert.ok(result.axisCount > 0 && result.axisCount <= 40);
          assert.equal(result.positions.length, 2);assert.ok(result.positions.flat().every(Number.isFinite));
          assert.ok(result.positions[1][0] > result.positions[0][0]);assert.ok(result.positions[1][1] < result.positions[0][1]);
        }
      } finally { clearTimeout(timeout); }
      assert.match(await page.evaluate(() => rejected({ baseline: Infinity, data: [{ x: 1, value: 1 }] })), /finite ordered endpoints/);
      await page.setViewportSize({ width: 390, height: 850 });
      await page.evaluate(() => draw({ data: [{ x: 1e16, value: 1e16 }, { x: 1e16 + 2, value: 1e16 + 2 }] }));
      assert.equal(await page.evaluate(() => /NaN|Infinity/.test(document.querySelector('svg').outerHTML)), false);
    });
    assert.deepEqual(errors, []);
  } finally { await page.close();await browser.close(); }
});
