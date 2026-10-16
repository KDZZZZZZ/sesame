import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const host = process.env.SESAME_HOST_ROOT;
const assets = new URL('../packages/reports/assets/', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('../packages/reports/examples/statistical-fixtures.json', import.meta.url), 'utf8'));
const [css, framework, statistics] = await Promise.all(['editorial.css', 'editorial-charts.js', 'charts-statistics.js'].map(file => readFile(new URL(file, assets), 'utf8')));

test('statistical charts render and select real fixed rows in Chromium', { skip: !host && 'Set SESAME_HOST_ROOT to an application checkout with Playwright installed', timeout: 90000 }, async t => {
  const require = createRequire(join(resolve(host), 'package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const screenshots = process.env.SESAME_CHART_SCREENSHOT_DIR;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}
      :root{--foreground:#151515;--surface-secondary:#fafafa;--muted:#777;--chart-series-1:#165a3d;--border:#ddd;--success:#367b48;--danger:#c43b43}
      :root[data-theme=dark]{--foreground:#f4f4f4;--surface-secondary:#101010;--muted:#aaa;--chart-series-1:#7794ff;--border:#333;--success:#6ea981;--danger:#ff7084}
      body{margin:0;padding:18px;background:var(--surface-secondary);color:var(--foreground)}main{max-width:920px;margin:auto}section{margin:0 0 42px}.plot{min-width:0}.sc-missing-note{overflow-wrap:anywhere}
    </style></head><body><main id="gallery"></main><div id="scratch"></div><script>${framework}</script><script>${statistics}</script></body></html>`);
    await page.evaluate(fixture => {
      window.fixture = fixture;window.selected = {};window.handles = {};
      for (const chart of fixture.charts) {
        const section = document.createElement('section'), heading = document.createElement('h2'), plot = document.createElement('div');
        heading.textContent = chart.title;plot.id = chart.id;plot.className = 'plot';section.append(heading, plot);document.getElementById('gallery').append(section);
        window.handles[chart.id] = SesameCharts.chart(plot, { ...chart.spec, onSelect: (row, index) => { window.selected[chart.id] = { row, index }; } });
      }
      window.drawScratch = spec => { window.scratchHandle?.destroy();window.scratchHandle = SesameCharts.chart(document.getElementById('scratch'), spec); };
    }, fixture);

    await t.test('all seven examples keep finite geometry and fit desktop, narrow, and dark views', async () => {
      for (const width of [1000, 390]) {
        await page.setViewportSize({ width, height: 850 });
        await page.waitForFunction(() => [...document.querySelectorAll('.plot')].every(n => Math.abs(n.clientWidth - n.querySelector('svg').viewBox.baseVal.width) <= 2));
        const result = await page.evaluate(() => ({
          kinds: SesameCharts.kinds(), width: innerWidth, scroll: document.documentElement.scrollWidth,
          bad: [...document.querySelectorAll('svg *')].flatMap(n => [...n.attributes].filter(a => /(?:NaN|Infinity)/.test(a.value)).map(a => `${n.tagName}:${a.name}`)),
          marks: [...document.querySelectorAll('.plot')].map(n => [n.id, n.querySelectorAll('[data-row-index]').length])
        }));
        assert.equal(result.scroll, result.width);assert.deepEqual(result.bad, []);
        for (const { spec } of fixture.charts) assert.ok(result.kinds.includes(spec.kind));
        assert.ok(result.marks.every(([_id, marks]) => marks > 0));
        if (screenshots) await page.screenshot({ path: join(screenshots, `statistics-${width}-light.png`), fullPage: true });
      }
      const before = await page.locator('#strip .sc-point').first().evaluate(n => getComputedStyle(n).fill);
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      const after = await page.locator('#strip .sc-point').first().evaluate(n => getComputedStyle(n).fill);
      assert.notEqual(after, before);
      if (screenshots) await page.screenshot({ path: join(screenshots, 'statistics-390-dark.png'), fullPage: true });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    });

    await t.test('mouse and keyboard selections return the unchanged source row', async () => {
      for (const { id, spec } of fixture.charts) {
        const mark = page.locator(`#${id} [data-row-index]`).first();
        const index = Number(await mark.getAttribute('data-row-index'));
        await mark.click();
        assert.deepEqual(await page.evaluate(id => window.selected[id], id), { row: spec.rows[index], index });
        await mark.focus();await page.keyboard.press('Enter');
        assert.deepEqual(await page.evaluate(id => window.selected[id], id), { row: spec.rows[index], index });
        assert.equal(await page.locator(`#${id} .sc-selected`).count(), 1);
      }
      const commission = page.locator('#waterfall [data-row-index="2"]');
      await commission.focus();
      assert.match(await page.locator('#waterfall .sc-tooltip').innerText(), /-1\.10000000000000001/);
      const outlier = page.locator('#boxplot [data-stat-mark="outlier"]').nth(1);
      await outlier.focus();await page.keyboard.press(' ');
      assert.match(await page.locator('#boxplot .sc-tooltip').innerText(), /2\.90000000000000001/);
      assert.equal((await page.evaluate(() => window.selected.boxplot)).index, 0);
    });

    await t.test('waterfall rejects false reconciliation even below floating-point precision', async () => {
      const result = await page.evaluate(() => {
        const original = fixture.charts.find(c => c.id === 'waterfall').spec, bad = structuredClone(original);
        bad.rows.at(-1).amount = '1024.20';
        let rejected;try { drawScratch(bad); } catch (error) { rejected = error.message; }
        drawScratch({ ...bad, balanceTolerance: '0.00000000000000001' });
        const note = document.querySelector('#scratch .sc-missing-note').textContent;
        const start = document.querySelector('#waterfall [data-row-index="1"]'), fee = document.querySelector('#waterfall [data-row-index="2"]');
        return { rejected, note, positive: Number(start.dataset.end) > Number(start.dataset.start), feeReduces: Number(fee.dataset.end) < Number(fee.dataset.start) };
      });
      assert.match(result.rejected, /does not reconcile/);assert.match(result.note, /rounding differences/);assert.ok(result.positive && result.feeReduces);
    });

    await t.test('histogram preserves bin width, missingness, and original row identity', async () => {
      const result = await page.evaluate(() => {
        const rows = [{ lower: 1, upper: 3, density: '.25' }, { lower: 0, upper: 1, density: '.5' }].map(r => ({ ...r, density: `0${r.density}` }));
        drawScratch({ kind: 'histogram', rows, x: 'lower', xEnd: 'upper', y: 'density', valueType: 'density', sampleCount: 20, method: 'Registered unequal-width density bins' });
        const bars = [...document.querySelectorAll('#scratch [data-stat-mark=histogram]')];
        const intervals = bars.map(n => ({ index: Number(n.dataset.rowIndex), lower: Number(n.dataset.binLower), upper: Number(n.dataset.binUpper), x: Number(n.getAttribute('x')), width: Number(n.getAttribute('width')) }));
        const cases = [
          { rows: [{ lower: 0, upper: 1, count: 2 }, { lower: 1, upper: 3, count: 2 }], sampleCount: 4 },
          { rows: [{ lower: 0, upper: 2, count: 2 }, { lower: 1, upper: 3, count: 2 }], sampleCount: 4 },
          { rows: [{ lower: 0, upper: 1, count: 2 }], sampleCount: 3 },
          { rows: [{ lower: 0, upper: 1, count: '2.00000000000000001' }], sampleCount: 2 }
        ];
        const errors = cases.map(spec => { try { drawScratch({ kind: 'histogram', method: 'Registered bins', ...spec });return ''; } catch (error) { return error.message; } });
        drawScratch({ kind: 'histogram', method: 'Registered incomplete bins', sampleCount: 4, rows: [{ lower: 0, upper: 1, count: 2 }, { lower: 1, upper: 2, count: null }] });
        return { intervals, errors, missing: document.querySelectorAll('#scratch [data-missing]').length, bars: document.querySelectorAll('#scratch [data-stat-mark=histogram]').length };
      });
      assert.equal(result.intervals[0].index, 1);assert.equal(result.intervals[1].index, 0);
      assert.ok(Math.abs((result.intervals[1].width + 1) / (result.intervals[0].width + 1) - 2) < .02);
      assert.match(result.errors[0], /unequal bins/);assert.match(result.errors[1], /overlap/);assert.match(result.errors[2], /sampleCount/);
      assert.match(result.errors[3], /exact integer/);
      assert.equal(result.missing, 1);assert.equal(result.bars, 1);
    });

    await t.test('box statistics and density grids validate semantics without estimating new statistics', async () => {
      const result = await page.evaluate(() => {
        const box = fixture.charts.find(c => c.id === 'boxplot').spec;
        const errors = [];
        for (const patch of [{ q1: 10 }, { outliers: [0] }, { n: 0 }]) {
          try { drawScratch({ ...box, rows: [{ ...box.rows[0], ...patch }] });errors.push(''); } catch (error) { errors.push(error.message); }
        }
        drawScratch({ ...box, rows: [{ ...box.rows[0], q1: null, outliers: [] }] });
        const missingBox = document.querySelectorAll('#scratch [data-missing]').length;
        const density = fixture.charts.find(c => c.id === 'ridgeline').spec;
        for (const patch of [{ density: -1 }, { value: null }, { n: 0 }]) {
          try { drawScratch({ ...density, rows: [{ ...density.rows[1], ...patch }] });errors.push(''); } catch (error) { errors.push(error.message); }
        }
        try { drawScratch({ ...box, rows: [{ ...box.rows[0], low: 0, q1: '1.00000000000000002', median: '1.00000000000000001', q3: 2, high: 3, outliers: [] }] });errors.push(''); } catch (error) { errors.push(error.message); }
        return { errors, missingBox, ridgeSegments: document.querySelectorAll('#ridgeline [data-density-segment]').length, missingDensity: document.querySelectorAll('#ridgeline [data-missing]').length, median: document.querySelector('#boxplot [data-box-median]').getAttribute('data-box-median') };
      });
      assert.match(result.errors[0], /low ≤ q1/);assert.match(result.errors[1], /outside/);assert.match(result.errors[2], /positive sample/);
      assert.match(result.errors[3], /negative/);assert.match(result.errors[4], /missing/);assert.match(result.errors[5], /positive registered/);
      assert.match(result.errors[6], /low ≤ q1/);
      assert.equal(result.missingBox, 1);assert.equal(result.ridgeSegments, 3);assert.equal(result.missingDensity, 1);assert.equal(result.median, '0.15');
    });

    await t.test('registered statistics require compatible sample counts', async () => {
      const result = await page.evaluate(() => {
        const density = { kind: 'histogram', sampleCount: 0, valueType: 'density', method: 'Registered fixture bins', y: 'density', rows: [{ lower: 0, upper: 1, density: 1 }] };
        const box = { kind: 'boxplot', method: 'Registered fixture quartiles and whiskers', rows: [{ group: 'A', n: 1, low: 0, q1: 0, median: 0, q3: 0, high: 0, outliers: [1, 2] }] };
        const errors = [density, { ...density, rows: [{ lower: 0, upper: 1, density: 0 }] }, box, { ...box, rows: [{ ...box.rows[0], n: 0, outliers: [] }] }, { ...box, rows: [{ ...box.rows[0], outliers: [1] }] }].map(spec => {
          try { drawScratch(spec);return ''; } catch (error) { return error.message; }
        });
        drawScratch({ ...density, sampleCount: 1 });
        const positiveDensity = document.querySelectorAll('#scratch [data-stat-mark="histogram"]').length;
        drawScratch({ kind: 'histogram', sampleCount: 0, method: 'Registered empty fixture count', rows: [{ lower: 0, upper: 1, count: 0 }] });
        const emptyCount = document.querySelector('#scratch [data-stat-mark="histogram"]').getAttribute('aria-label');
        drawScratch({ ...box, rows: [{ ...box.rows[0], outliers: [] }] });
        const singleton = { boxes: document.querySelectorAll('#scratch [data-stat-mark="boxplot"]').length, outliers: document.querySelectorAll('#scratch [data-stat-mark="outlier"]').length };
        drawScratch({ ...box, rows: [{ ...box.rows[0], n: 10 }] });
        return { errors, positiveDensity, emptyCount, singleton, outliers: document.querySelectorAll('#scratch [data-stat-mark="outlier"]').length };
      });
      assert.match(result.errors[0], /positive.*sample count/);
      assert.match(result.errors[1], /positive.*sample count/);
      assert.match(result.errors[2], /outlier.*sample count/);
      assert.match(result.errors[3], /positive sample count/);
      assert.match(result.errors[4], /outlier.*sample count/);
      assert.deepEqual(result.singleton, { boxes: 1, outliers: 0 });
      assert.equal(result.positiveDensity, 1);assert.match(result.emptyCount, /count: 0.*n=0/);assert.equal(result.outliers, 2);
    });

    await t.test('axis precision follows a close numeric span rather than collapsing all labels', async () => {
      const result = await page.evaluate(() => [[1.00001, 1.00003], [1e-12, 3e-12], [1e7, 1e7 + .01]].map(values => {
        drawScratch({ kind: 'strip', y: 'value', rows: values.map(value => ({ value })) });
        const svg = document.querySelector('#scratch svg'), baseline = svg.viewBox.baseVal.height - 31;
        return { values, ticks: [...svg.querySelectorAll(`text[y="${baseline}"]`)].map(n => n.firstChild.textContent),
          raw: [...svg.querySelectorAll('[data-row-index]')].map(n => n.getAttribute('aria-label')) };
      }));
      for (const entry of result) {
        assert.ok(entry.ticks.length >= 3);assert.equal(new Set(entry.ticks).size, entry.ticks.length);
        const numbers = entry.ticks.map(value => Number(value.replaceAll(',', '')));
        assert.ok(numbers.every(Number.isFinite));assert.equal(numbers[0], entry.values[0]);assert.equal(numbers.at(-1), entry.values.at(-1));
        assert.ok(numbers.slice(1).every((value, i) => value > numbers[i]));
      }
      assert.match(result[0].raw[0], /1\.00001/);assert.match(result[0].raw[1], /1\.00003/);
    });

    await t.test('empty, missing, extreme, resized, and destroyed charts keep honest states', async () => {
      const result = await page.evaluate(async () => {
        drawScratch({ kind: 'boxplot', rows: [] });const empty = document.querySelector('#scratch svg').textContent;
        drawScratch({ kind: 'strip', y: 'value', rows: [{ value: null }, { value: null }] });
        const missing = { marks: document.querySelectorAll('#scratch [data-row-index]').length, note: document.querySelector('#scratch .sc-missing-note').textContent };
        drawScratch({ kind: 'strip', y: 'value', rows: [{ value: -1e308 }, { value: 1e308 }] });
        const finite = !/NaN|Infinity/.test(document.querySelector('#scratch svg').outerHTML);
        const centers = [...document.querySelectorAll('#scratch .sc-point')].map(n => Number(n.getAttribute('cx')));
        const target = document.getElementById('scratch');target.style.width = '300px';
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const resized = scratchHandle.svg.viewBox.baseVal.width;
        scratchHandle.destroy();target.style.width = '320px';
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { empty, missing, finite, centers, resized, children: target.childElementCount };
      });
      assert.match(result.empty, /No observations/);assert.equal(result.missing.marks, 0);assert.match(result.missing.note, /2 missing/);
      assert.ok(result.finite);assert.ok(result.centers[0] < result.centers[1]);assert.equal(result.resized, 300);assert.equal(result.children, 0);
    });
    assert.deepEqual(errors, []);
  } finally { await page.close();await browser.close(); }
});
