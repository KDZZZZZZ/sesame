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

      // Reuse this page to exercise real ResizeObserver redraws with full CJK
      // labels, one missing endpoint, two missing endpoints and a real zero.
      const rows = [
        { label: '全部既有历史 · 低波', before: '0.52000000000000001', after: 0.55 },
        { label: '近90日 · 高波：无匹配', before: 0.75, after: null },
        { label: '没有任何已登记样本的较长中文分组标签', before: null, after: null },
        { label: '[0.8,1] · n=26', before: 0, after: 1 },
      ];
      await page.evaluate(rows => {
        document.documentElement.lang = 'zh-CN';document.getElementById('scratch').style.width = '';
        window.longLabels = { kind: 'dumbbell', title: '合成中文标签', beforeLabel: '同组基线', afterLabel: '匹配样本', unit: '频率（0–1）', rows };
        window.originalLongLabels = JSON.stringify(rows);drawScratch(longLabels);
      }, rows);
      for (const width of [1000, 390]) {
        await page.setViewportSize({ width, height: 850 });
        await page.waitForFunction(() => Math.abs(document.getElementById('scratch').clientWidth - scratchHandle.svg.viewBox.baseVal.width) <= 2);
        const state = await page.evaluate(() => {
          const target = document.getElementById('scratch'), svg = target.querySelector('svg');
          const labels = [...svg.querySelectorAll('[data-dumbbell-label]')].map(n => {
            const bounds = n.getBBox();return { text: [...n.querySelectorAll('tspan')].map(s => s.textContent).join(''),
              x: bounds.x, right: bounds.x + bounds.width, y: bounds.y, bottom: bounds.y + bounds.height, lines: n.querySelectorAll('tspan').length };
          });
          const marks = [...svg.querySelectorAll('[data-row-index]')].map(n => ({ index: Number(n.dataset.rowIndex), label: n.getAttribute('aria-label'),
            before: n.querySelectorAll('[data-endpoint="before"]').length, after: n.querySelectorAll('[data-endpoint="after"]').length,
            lines: n.querySelectorAll('line').length, missing: n.dataset.missing === 'true' }));
          return { labels, marks, plotStart: Math.min(...[...svg.querySelectorAll('line.sc-grid')].map(n => Number(n.getAttribute('x1')))),
            note: target.querySelector('.sc-missing-note').textContent, notes: target.querySelectorAll('.sc-missing-note').length,
            unchanged: JSON.stringify(longLabels.rows) === originalLongLabels, width: innerWidth, scroll: document.documentElement.scrollWidth };
        });
        assert.deepEqual(state.labels.map(n => n.text), rows.map(row => row.label));
        assert.ok(state.labels.every(n => n.x >= 0 && n.right + 8 <= state.plotStart), 'Complete labels fit their own column');
        assert.ok(state.labels.slice(1).every((n, i) => n.y >= state.labels[i].bottom + 8), 'Wrapped labels never overlap adjacent rows');
        if (width === 390) assert.ok(state.labels.some(n => n.lines > 1), 'Narrow views wrap instead of truncating');
        assert.match(state.marks[0].label, /0\.52000000000000001/);
        assert.deepEqual(state.marks.map(n => [n.before, n.after, n.lines, n.missing]), [[1, 1, 1, false], [1, 0, 0, false], [0, 0, 0, true], [1, 1, 1, false]]);
        assert.match(state.marks[3].label, /同组基线: 0;/);
        assert.equal(state.note, '空心：同组基线；实心：匹配样本。 2 组有缺失，缺失端点不连线。');
        assert.equal(state.notes, 1);assert.equal(state.unchanged, true);assert.equal(state.scroll, state.width);
        if (screenshots) await page.locator('#scratch').screenshot({ path: join(screenshots, `statistics-dumbbell-${width}-zh.png`) });
      }
      await page.evaluate(() => { document.documentElement.lang = 'en';drawScratch(longLabels); });
      assert.match(await page.locator('#scratch .sc-missing-note').textContent(), /Hollow = .*filled = .*2 incomplete comparison\(s\)/);
      await page.evaluate(() => scratchHandle.destroy());
    });
    await t.test('strip readout explains original points and missingness in the report locale', async () => {
      const rows=[{group:'Same condition',value:'1.2408098449819225'},{group:'Same condition',value:null},{group:'Baseline',value:'-0.8425153843437879'}];
      const states=[];
      for(const locale of ['zh-CN','en']){
        const state=await page.evaluate(({locale,rows})=>{
          document.documentElement.lang=locale;
          drawScratch({kind:'strip',x:'group',y:'value',rows,jitter:.15});
          return {note:document.querySelector('#scratch .sc-missing-note').textContent,marks:[...document.querySelectorAll('#scratch [data-stat-mark="strip"]')].map(e=>({index:e.dataset.rowIndex,x:e.getAttribute('cx'),y:e.getAttribute('cy'),label:e.getAttribute('aria-label')}))};
        },{locale,rows});
        states.push(state);assert.deepEqual(state.marks.map(m=>m.index),['0','2']);
        assert.match(state.marks[0].label,/1\.2408098449819225/);
      }
      assert.equal(states[0].note,'每个点代表一条原始记录；上下错开仅为避免重叠。 1 条记录缺少数值，未画成零。');
      assert.equal(states[1].note,'One point = one registered row; vertical offset only separates overlapping points. 1 missing value(s) are omitted, not plotted at zero.');
      assert.deepEqual(states[0].marks,states[1].marks,'Language changes only the explanatory note');
    });
    assert.deepEqual(errors, []);
  } finally { await page.close();await browser.close(); }
});
