import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const host = process.env.SESAME_HOST_ROOT;
const assets = new URL('../packages/reports/assets/', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('../packages/reports/examples/temporal-fixtures.json', import.meta.url), 'utf8'));
const [css, core, temporal] = await Promise.all(['editorial.css', 'editorial-charts.js', 'charts-temporal.js'].map(file => readFile(new URL(file, assets), 'utf8')));

test('lifecycle long labels stay readable on fresh widths and resize without changing R09 events', { skip: !host && 'Set SESAME_HOST_ROOT to an application checkout with Playwright installed', timeout: 60000 }, async () => {
  // Exact five public schedule rows from R09 revision_814b3365-5e8e-4180-9b20-cb41efecc372.
  // This is a renderer regression, not a new source fetch, research run or publication.
  const rows = [
    { evidence: [{ href: 'https://www.federalreserve.gov/newsevents/2026-october.htm', label: 'Fed' }], id: 'fed-2026-10-29-H.4.1', item: '美联储资产负债表（H.4.1）', state: '预定', time: '2026-10-29T20:30:00Z' },
    { evidence: [{ href: 'https://events-delivery.apple.com/15pijbsdfvpiqhb10/js_files/event/url.json', label: 'Apple IR' }], id: 'apple-q4-2026', item: 'Apple 2026财年第四季度电话会', state: '预定', time: '2026-11-02T22:00:00Z' },
    { evidence: [{ href: 'https://www.bls.gov/schedule/2026/11_sched.htm', label: 'BLS · 浏览文字记录' }], id: 'bls-visible-1', item: '职位空缺与劳动力流动（9月JOLTS）', state: '预定', time: '2026-11-03T15:00:00Z' },
    { evidence: [{ href: 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics', label: 'BEA / Census' }], id: 'bea-a270c9cd-70a1-48d2-8924-cdebab79dc9a', item: '美国货物与服务贸易（9月）', state: '预定', time: '2026-11-04T13:30:00Z' },
    { evidence: [{ href: 'https://www.bls.gov/schedule/2026/11_sched.htm', label: 'BLS · 浏览文字记录' }], id: 'bls-visible-2', item: '生产率与成本（第三季度初值）', state: '预定', time: '2026-11-05T13:30:00Z' },
  ];
  const require = createRequire(join(resolve(host), 'package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const draw = async (page, sourceRows, lang = 'zh-CN') => {
    await page.evaluate(({ rows, lang }) => {
      const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
      document.documentElement.lang = lang;
      window.timelineRows = freeze(rows); window.timelineSelection = null;
      window.timeline = SesameCharts.chart(document.querySelector('#timeline'), { kind: 'lifecycle', timezone: 'America/New_York', rows: timelineRows,
        onSelect: (row, index) => { timelineSelection = { row, index, same: row === timelineRows[index] }; },
      });
    }, { rows: sourceRows, lang });
  };
  const inspect = async (page, sourceRows) => {
    await page.waitForFunction(() => Math.abs(document.querySelector('#timeline').clientWidth - document.querySelector('#timeline svg').viewBox.baseVal.width) <= 2);
    const result = await page.evaluate(() => {
      const svg = document.querySelector('#timeline svg'), width = svg.viewBox.baseVal.width, height = svg.viewBox.baseVal.height;
      const box = node => { const b = node.getBBox(); return { x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height }; };
      const labels = [...svg.querySelectorAll('text')].filter(n => timelineRows.some(r => n.querySelector('title')?.textContent === r.item));
      const texts = [...svg.querySelectorAll('text')].map(node => ({ text: node.textContent, ...box(node) }));
      const overlaps = [];
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > .5) overlaps.push([a.text, b.text]);
      }
      return { width, height, scroll: document.documentElement.scrollWidth, viewport: innerWidth, overlaps,
        texts, labels: labels.map(n => ({ text: [...n.childNodes].filter(c => c.nodeType === Node.TEXT_NODE || c.nodeName === 'tspan').map(c => c.textContent).join(''), font: parseFloat(getComputedStyle(n).fontSize), ...box(n), lines: n.querySelectorAll('tspan').length })),
        marks: [...svg.querySelectorAll('[data-row-index]')].map(n => ({ index: Number(n.dataset.rowIndex), x: Number(n.querySelector('circle').getAttribute('cx')), aria: n.getAttribute('aria-label'), title: n.querySelector('title').textContent })),
        rows: timelineRows,
      };
    });
    assert.equal(result.scroll, result.viewport, 'no page overflow');
    assert.equal(result.labels.length, sourceRows.length);
    assert.deepEqual(result.labels.map(n => n.text), sourceRows.map(r => r.item), 'every event name is complete, never ellipsized');
    for (const label of result.labels) assert.ok(label.font >= 12, 'event names remain at least 12px');
    for (const label of result.texts) assert.ok(label.x >= -.5 && label.right <= result.width + .5 && label.y >= -.5 && label.bottom <= result.height + .5, `text stays inside SVG: ${JSON.stringify(label)}`);
    assert.deepEqual(result.overlaps, [], 'name, state and date labels do not overlap');
    assert.deepEqual(result.rows, sourceRows, 'source rows remain unchanged');
    assert.deepEqual(result.marks.map(m => m.index), sourceRows.map((_, i) => i));
    const min = Math.min(...sourceRows.map(r => Date.parse(r.time))), max = Math.max(...sourceRows.map(r => Date.parse(r.time)));
    const left = Math.min(105, Math.max(64, result.width * .2)), right = result.width - 25;
    for (const mark of result.marks) {
      const time = Date.parse(sourceRows[mark.index].time), expected = min === max ? (left + right) / 2 : left + (time - min) / (max - min) * (right - left);
      assert.ok(Math.abs(mark.x - expected) < 1e-7, 'recorded time retains the original scale and x position');
      assert.equal(mark.title, mark.aria);
      assert.ok(mark.aria.endsWith(sourceRows[mark.index].time), 'original source timestamp is preserved');
    }
    return result;
  };
  try {
    for (const width of [1000, 720, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      try {
        await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}body{margin:0;padding:18px}.plot{min-width:0}</style></head><body><div id="timeline" class="plot"></div><script>${core}</script><script>${temporal}</script></body></html>`);
        await page.evaluate(() => document.fonts.ready);
        await draw(page, rows);
        const initial = await inspect(page, rows);
        for (const mark of initial.marks) {
          assert.match(mark.aria, /1 个依据链接 · 来源时间：/);
          assert.doesNotMatch(mark.aria, /evidence links|source time/);
        }
        for (let i = 0; i < rows.length; i++) {
          await page.locator(`#timeline [data-row-index="${i}"] circle`).click();
          assert.deepEqual(await page.evaluate(() => timelineSelection), { row: rows[i], index: i, same: true });
          assert.equal(await page.locator('#timeline .report-source a').getAttribute('href'), rows[i].evidence[0].href);
        }
        if (width === 390) {
          for (const resized of [1000, 720, 390]) { await page.setViewportSize({ width: resized, height: 900 }); await inspect(page, rows); }
          await draw(page, rows, 'en');
          const english = await inspect(page, rows);
          assert.deepEqual(english.marks.map(m => m.x), initial.marks.map(m => m.x));
          assert.ok(english.marks.every(m => /1 evidence links · source time:/.test(m.aria)), 'English remains available');
          // Longer synthetic name exercises measured multiline wrapping without
          // representing another real calendar event or changing the five rows.
          const longRows = [{ ...rows[0], item: rows[2].item.repeat(5) }];
          await draw(page, longRows);
          const wrapped = await inspect(page, longRows);
          assert.ok(wrapped.labels[0].lines > 1, 'long names increase lane height instead of clipping');
          await page.locator('#timeline [data-row-index="0"] circle').click();
          assert.deepEqual(await page.evaluate(() => timelineSelection), { row: longRows[0], index: 0, same: true });
        }
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('temporal charts preserve source semantics through real browser interaction', { skip: !host && 'Set SESAME_HOST_ROOT to an application checkout with Playwright installed', timeout: 90000 }, async t => {
  const require = createRequire(join(resolve(host), 'package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}
      body{margin:0;padding:18px}main{max-width:920px;margin:auto}section{margin-bottom:42px}.plot{min-width:0}.sc-missing-note{overflow-wrap:anywhere}
    </style></head><body><main id="gallery"></main><div id="scratch"></div><div id="demo-report">Fictional demo report evidence</div>
    <script>
      window.liveObservers=new Set();
      const NativeResizeObserver=ResizeObserver;
      window.ResizeObserver=class extends NativeResizeObserver {
        observe(target,options){liveObservers.add(this);super.observe(target,options);}
        disconnect(){liveObservers.delete(this);super.disconnect();}
      };
    </script><script>${core}</script><script>${temporal}</script></body></html>`);
    await page.evaluate(fixture => {
      const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze);Object.freeze(value); }return value; };
      window.fixture = freeze(fixture);window.selected = {};window.filters = {};window.filterCounts = {};window.handles = {};
      window.originalJSON = JSON.stringify(fixture);
      for (const chart of fixture.charts) {
        const section = document.createElement('section'), heading = document.createElement('h2'), plot = document.createElement('div');
        heading.textContent = chart.title;plot.id = chart.id;plot.className = 'plot';section.append(heading, plot);document.getElementById('gallery').append(section);
        filterCounts[chart.id] = 0;
        plot.addEventListener('chartfilter', () => { filterCounts[chart.id]++; });
        handles[chart.id] = SesameCharts.chart(plot, {
          ...chart.spec,
          onSelect: (row, index) => { selected[chart.id] = { row, index, same: row === chart.spec.rows[index] }; },
          onFilter: (rows, indices) => { filters[chart.id] = { rows, indices, same: rows.every((row, index) => row === chart.spec.rows[indices[index]]) }; }
        });
      }
      window.drawScratch = spec => { window.scratchHandle?.destroy();window.scratchHandle = SesameCharts.chart(document.getElementById('scratch'), spec); };
      window.reject = spec => { try { drawScratch(spec);return ''; } catch (error) { return error.message; } };
    }, fixture);

    await t.test('desktop, 390px and dark theme fit finite geometry without duplicate inspectors', async () => {
      assert.equal(fixture.provenance.kind, 'demo');
      for (const width of [1000, 390]) {
        await page.setViewportSize({ width, height: 850 });
        await page.waitForFunction(() => [...document.querySelectorAll('.plot')].every(n => Math.abs(n.clientWidth - n.querySelector('svg').viewBox.baseVal.width) <= 2));
        const result = await page.evaluate(() => ({
          width: innerWidth, scroll: document.documentElement.scrollWidth,
          bad: [...document.querySelectorAll('svg *')].flatMap(n => [...n.attributes].filter(a => /NaN|Infinity/.test(a.value)).map(a => a.name)),
          marks: [...document.querySelectorAll('.plot')].map(n => n.querySelectorAll('[data-row-index]').length),
          inspectors: document.querySelectorAll('.report-inspect').length,
          observers: liveObservers.size,
          calendarHeight: handles.calendar.svg.viewBox.baseVal.height,
          rankAxis: [...handles.bump.svg.querySelectorAll(`text[y="${handles.bump.svg.viewBox.baseVal.height - 16}"]`)].map(n => { const box = n.getBBox();return { x: box.x, end: box.x + box.width }; })
        }));
        assert.equal(result.scroll, result.width);assert.deepEqual(result.bad, []);
        assert.deepEqual(result.marks, fixture.charts.map(c => c.spec.rows.length));
        assert.equal(result.inspectors, 0);assert.equal(result.observers, 4);
        assert.ok(result.calendarHeight <= 200, 'short calendar ranges do not reserve unused month rows');
        assert.ok(result.rankAxis.slice(1).every((box, i) => box.x > result.rankAxis[i].end), 'time labels must not overlap on mobile');
      }
      const before = await page.locator('#calendar [data-row-index="0"] rect').evaluate(n => getComputedStyle(n).fill);
      assert.equal(before,'rgb(36, 115, 74)','Calendar gains keep the financial green, independent of theme accents');
      assert.equal(await page.locator('#calendar [data-row-index="5"] rect').evaluate(n=>getComputedStyle(n).fill),'rgb(178, 67, 67)');
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      const after = await page.locator('#calendar [data-row-index="0"] rect').evaluate(n => getComputedStyle(n).fill);
      assert.equal(after,'rgb(95, 227, 169)');
      assert.equal(await page.locator('#calendar [data-row-index="5"] rect').evaluate(n=>getComputedStyle(n).fill),'rgb(255, 122, 143)');
      for (const { id, spec } of fixture.charts) {
        const mark = page.locator(`#${id} [data-row-index="0"]`);
        // A multi-axis SVG group's bounding-box center need not be on its
        // painted polyline. Click an actual source point, as a reader would.
        await (id === 'parallel' || id === 'lifecycle' ? mark.locator('circle').first() : mark).click();
        assert.deepEqual(await page.evaluate(id => selected[id], id), { row: spec.rows[0], index: 0, same: true });
        await mark.focus();await page.keyboard.press(' ');
        assert.equal(await page.locator(`#${id} .sc-selected`).count(), 1);
      }
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    });

    await t.test('calendar distinguishes zero, missing, closure, absent rows and timezone days', async () => {
      const result = await page.evaluate(() => {
        const cell = date => document.querySelector(`#calendar [data-date="${date}"]`);
        return {
          zero: { state: cell('2026-01-02').dataset.state, text: cell('2026-01-02').textContent },
          missing: cell('2026-01-03').dataset.state, closed: cell('2026-01-04').dataset.state,
          timezoneIndex: cell('2026-01-05').dataset.rowIndex,
          absent: { state: cell('2026-01-06').dataset.state, index: cell('2026-01-06').dataset.rowIndex ?? null, text: cell('2026-01-06').textContent },
          note: document.querySelector('#calendar .sc-missing-note').textContent
        };
      });
      assert.equal(result.zero.state, 'observed');assert.match(result.zero.text, /0/);
      assert.equal(result.missing, 'missing');assert.equal(result.closed, 'closed');assert.equal(result.timezoneIndex, '4');
      assert.equal(result.absent.state, 'no-source-row');assert.equal(result.absent.index, null);assert.match(result.absent.text, /status unknown/);
      assert.match(result.note, /America\/New_York/);
      await page.locator('#calendar [data-row-index="0"]').focus();
      assert.match(await page.locator('#calendar .sc-tooltip').innerText(), /125\.25000000000000001/);
      const rejected = await page.evaluate(() => {
        const base = fixture.charts.find(c => c.id === 'calendar').spec;
        return [
          reject({ ...base, rows: [{ day: '2026-01-05', pnl: 1 }, { day: '2026-01-06T00:30:00Z', pnl: 2 }] }),
          reject({ ...base, rows: [{ day: '2026-01-04', pnl: 0, status: 'closed' }] }),
          reject({ ...base, rows: [{ day: '2026-02-30', pnl: 1 }], from: undefined, to: undefined }),
          reject({ ...base, timezone: undefined }),
          reject({ ...base, rows: [{ day: '2026-01-01T10:00:00', pnl: 1 }] }),
          reject({ ...base, from: '2026-01-02' })
        ];
      });
      assert.match(rejected[0], /duplicate calendar day/);assert.match(rejected[1], /closed\/missing/);
      assert.match(rejected[2], /invalid calendar date/);assert.match(rejected[3], /timezone/);
      assert.match(rejected[4], /explicit UTC offset/);assert.match(rejected[5], /excludes source/);
    });

    await t.test('four-year calendars page honestly on mobile and retain year through resize without stale controls', async () => {
      await page.setViewportSize({ width: 1000, height: 850 });
      await page.evaluate(() => {
        window.longRows = [{ date: '2020-01-01', value: 0 }, { date: '2023-12-31', value: 2 }]; window.longCount = 0;
        drawScratch({ kind: 'calendar', timezone: 'UTC', from: '2020-01-01', to: '2023-12-31', rows: longRows,
          onSelect: (row, index) => { window.longSelection = { index, same: longRows[index] === row }; },
          onFilter: (rows, indices) => { window.longFilter = { indices, same: rows.every((row, i) => row === longRows[indices[i]]) };longCount++; }
        });
      });
      const picker = page.getByRole('combobox', { name: 'Calendar year' });
      assert.deepEqual(await picker.locator('option').allTextContents(), ['2020', '2021', '2022', '2023']);
      assert.match(await page.locator('#scratch [data-calendar-range]').innerText(), /Current: 2020-01-01 – 2020-12-31 · Full range: 2020-01-01 – 2023-12-31/);
      await picker.selectOption('2022');
      assert.equal(await page.locator('#scratch [data-row-index]').count(), 0);
      assert.equal(await page.locator('#scratch [data-state="no-source-row"]').count(), 365);
      assert.deepEqual(await page.evaluate(() => longFilter), { indices: [], same: true });
      assert.match(await page.locator('#scratch .sc-missing-note').last().innerText(), /closure is not inferred/);
      await picker.selectOption('2023');
      await page.evaluate(() => { window.oldYearPicker = document.querySelector('#scratch select'); });
      await page.setViewportSize({ width: 390, height: 850 });
      await page.waitForFunction(() => document.querySelector('#scratch select') !== oldYearPicker);
      assert.equal(await picker.inputValue(), '2023');
      assert.ok(await page.evaluate(() => scratchHandle.svg.viewBox.baseVal.height < 12000));
      assert.equal(await page.locator('#scratch [data-row-index]').count(), 1);
      await page.locator('#scratch [data-row-index="1"]').focus();await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => longSelection), { index: 1, same: true });
      const cleaned = await page.evaluate(() => {
        const before = longCount;oldYearPicker.value = '2020';oldYearPicker.dispatchEvent(new Event('change'));
        const afterResize = longCount, currentPicker = document.querySelector('#scratch select');
        scratchHandle.destroy();currentPicker.value = '2021';currentPicker.dispatchEvent(new Event('change'));
        return { before, afterResize, afterDestroy: longCount, observers: liveObservers.size };
      });
      assert.equal(cleaned.before, cleaned.afterResize);assert.equal(cleaned.before, cleaned.afterDestroy);assert.equal(cleaned.observers, 4);
    });

    await t.test('parallel filters exact fixed rows, handles null independently, and keeps invalid edits from changing results', async () => {
      const min = page.getByRole('spinbutton', { name: 'Sharpe minimum', exact: true });
      const max = page.getByRole('spinbutton', { name: 'Sharpe maximum', exact: true });
      await min.fill('1');
      assert.deepEqual(await page.evaluate(() => filters.parallel.indices), [0, 2, 3]);
      assert.equal(await page.evaluate(() => filters.parallel.same), true);
      await page.getByRole('checkbox', { name: 'Include rows with missing dimensions' }).uncheck();
      assert.deepEqual(await page.evaluate(() => filters.parallel.indices), [0, 2]);
      assert.equal(await page.locator('#parallel [data-row-index="1"]').getAttribute('tabindex'), '-1');
      await max.fill('0.5');
      assert.deepEqual(await page.evaluate(() => filters.parallel.indices), [0, 2]);
      assert.equal(await max.getAttribute('aria-invalid'), 'true');
      assert.match(await page.locator('#parallel [role=status]').last().innerText(), /last valid filter/);
      await max.fill('1.3');
      assert.deepEqual(await page.evaluate(() => filters.parallel.indices), [0]);
      await page.locator('#parallel [data-row-index="0"]').focus();await page.keyboard.press('Enter');
      assert.match(await page.locator('#parallel .sc-tooltip').innerText(), /1\.20000000000000001/);
      assert.equal(await page.evaluate(() => filters.parallel.rows[0] === fixture.charts.find(c => c.id === 'parallel').spec.rows[0]), true);

      await page.evaluate(() => { window.detachedMin = document.querySelector('#parallel input[aria-label="Sharpe minimum"]'); });
      await page.setViewportSize({ width: 850, height: 850 });
      await page.waitForFunction(() => document.querySelector('#parallel input[aria-label="Sharpe minimum"]') !== detachedMin);
      assert.equal(await page.getByRole('spinbutton', { name: 'Sharpe minimum', exact: true }).inputValue(), '1');
      assert.equal(await page.getByRole('spinbutton', { name: 'Sharpe maximum', exact: true }).inputValue(), '1.3');
      assert.deepEqual(await page.evaluate(() => filters.parallel.indices), [0]);
      const cleanup = await page.evaluate(() => {
        const before = filterCounts.parallel;detachedMin.value = '-1';detachedMin.dispatchEvent(new Event('input'));
        return { before, after: filterCounts.parallel, observers: liveObservers.size };
      });
      assert.equal(cleanup.after, cleanup.before);assert.equal(cleanup.observers, 4);
      const before = await page.evaluate(() => filterCounts.parallel);
      await page.getByRole('spinbutton', { name: 'Sharpe minimum', exact: true }).fill('1.1');
      assert.equal(await page.evaluate(() => filterCounts.parallel), before + 1);
      await page.getByRole('button', { name: 'Reset filters' }).click();
      assert.deepEqual(await page.evaluate(() => filters.parallel.indices), [0, 1, 2, 3, 4]);
    });

    await t.test('bump displays actual ranks and missing gaps while legend filters never rerank', async () => {
      const result = await page.evaluate(() => {
        const first = document.querySelector('#bump [data-row-index="0"]'), tied = document.querySelector('#bump [data-row-index="1"]');
        return { y: first.getAttribute('cy'), tiedY: tied.getAttribute('cy'), x: first.getAttribute('cx'), tiedX: tied.getAttribute('cx'),
          missing: document.querySelector('#bump [data-row-index="7"]').dataset.rank,
          segments: (document.querySelector('#bump [data-bump-item="B"]').getAttribute('d').match(/M/g) || []).length,
          absent: document.querySelector('#bump .sc-missing-note').textContent
        };
      });
      assert.equal(result.y, result.tiedY);assert.notEqual(result.x, result.tiedX);assert.equal(result.missing, 'missing');assert.equal(result.segments, 2);assert.match(result.absent, /1 item\/period cells have no source row/);
      const expected = await page.locator('#bump [data-row-index="2"]').getAttribute('cy');
      await page.locator('#bump button').filter({ hasText: /^A$/ }).click();
      assert.deepEqual(await page.evaluate(() => filters.bump.indices), [1, 2, 4, 5, 7, 8, 10]);
      assert.equal(await page.locator('#bump [data-row-index="2"]').getAttribute('cy'), expected);
      assert.equal(await page.locator('#bump [data-row-index="2"]').getAttribute('data-rank'), '3');
      await page.setViewportSize({ width: 390, height: 850 });
      await page.waitForFunction(() => Math.abs(document.getElementById('bump').clientWidth - handles.bump.svg.viewBox.baseVal.width) <= 2);
      assert.equal(await page.locator('#bump button').filter({ hasText: /^A$/ }).getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#bump [data-row-index="0"]').getAttribute('tabindex'), '-1');
      const rejected = await page.evaluate(() => {
        const base = fixture.charts.find(c => c.id === 'bump').spec;
        return [reject({ ...base, ties: 'ordinal' }), reject({ ...base, ties: 'dense' }), reject({ ...base, universe: undefined }),
          reject({ ...base, rows: [{ period: '2026-01-01', candidate: 'outsider', rank: 1 }] }),
          reject({ ...base, rows: [base.rows[0], base.rows[0]] }), reject({ ...base, rows: [{ ...base.rows[0], rank: 1.2 }] }),
          reject({ ...base, rows: [{ ...base.rows[0], rank: '0.99999999999999999' }] }),
          reject({ ...base, universe: ['A', 'B', 'C', 'D'], rows: [{ ...base.rows[0], rank: 1 }, { ...base.rows[1], rank: 1 }, { ...base.rows[2], rank: 2 }] }),
          reject({ ...base, universe: ['A', 'B', 'C', 'D'], rows: [{ ...base.rows[0], rank: 4 }, { ...base.rows[1], rank: 4 }] }),
          reject({ ...base, ties: 'dense', universe: ['A', 'B', 'C', 'D'], rows: [{ ...base.rows[0], rank: 3 }, { ...base.rows[1], rank: 3 }, { ...base.rows[2], rank: 3 }] })];
      });
      assert.match(rejected[0], /cannot tie/);assert.match(rejected[1], /contradict dense/);assert.match(rejected[2], /fixed universe/);
      assert.match(rejected[3], /fixed universe/);assert.match(rejected[4], /duplicate item\/time/);assert.match(rejected[5], /positive integer/);
      assert.match(rejected[6], /exact integers/);assert.match(rejected[7], /already occupy/);assert.match(rejected[8], /already occupy/);
      assert.match(rejected[9], /contradict dense.*fixed universe/);
      assert.equal(await page.evaluate(() => {
        const base = fixture.charts.find(c => c.id === 'bump').spec;
        return reject({ ...base, universe: ['A', 'B', 'C', 'D'], rows: [{ ...base.rows[0], rank: '1.000' }, { ...base.rows[1], rank: 1 }, { ...base.rows[2], rank: 3 }] });
      }), '', 'possible partial competition ranks and exact integer decimal strings remain valid');
      assert.equal(await page.evaluate(() => {
        const base = fixture.charts.find(c => c.id === 'bump').spec;
        return reject({ ...base, ties: 'dense', universe: ['A', 'B', 'C', 'D', 'E'], rows: [{ ...base.rows[0], rank: 3 }, { ...base.rows[1], rank: 3 }, { ...base.rows[2], rank: 3 }] });
      }), '', 'missing members can fill ranks 1 and 2 in a five-member universe without inventing rows');
      await page.locator('#bump button').filter({ hasText: /^A$/ }).click();
    });

    await t.test('lifecycle selects recorded events and only provided evidence without inventing order or links', async () => {
      const coincident = await page.evaluate(() => [1, 2].map(index => {
        const mark = document.querySelector(`#lifecycle [data-row-index="${index}"] circle`);
        return { x: mark.getAttribute('cx'), y: mark.getAttribute('cy') };
      }));
      assert.equal(coincident[0].x, coincident[1].x);assert.notEqual(coincident[0].y, coincident[1].y);
      const event = page.locator('#lifecycle [data-row-index="1"]');
      await event.focus();await page.keyboard.press('Enter');
      const link = page.locator('#lifecycle a').filter({ hasText: 'Demo report' });
      assert.equal(await link.getAttribute('href'), '#demo-report');await link.click();
      assert.match(page.url(), /#demo-report$/);
      assert.equal(await page.evaluate(() => selected.lifecycle.same), true);
      await page.locator('#lifecycle [data-row-index="4"]').focus();await page.keyboard.press(' ');
      assert.equal(await page.locator('#lifecycle a').count(), 0);
      assert.match(await page.locator('#lifecycle .report-source').innerText(), /No attached evidence link/);
      assert.match(await page.locator('#lifecycle .sc-missing-note').innerText(), /not duration or causality/);
      const result = await page.evaluate(() => {
        const base = fixture.charts.find(c => c.id === 'lifecycle').spec;
        const rejected = [reject({ ...base, rows: [base.rows[0], base.rows[0]] }),
          reject({ ...base, rows: [{ ...base.rows[0], evidence: [{ label: 'Bad', href: 'javascript:alert(1)' }] }] }),
          reject({ ...base, rows: [{ ...base.rows[0], recorded_at: '2026-01-01T10:00:00' }] }),
          reject({ ...base, rows: [{ ...base.rows[0], state: '' }] })];
        drawScratch({ ...base, timezone: 'America/New_York', rows: [base.rows[0]] });
        return { rejected, label: document.querySelector('#scratch [data-row-index]').getAttribute('aria-label') };
      });
      assert.match(result.rejected[0], /unique/);assert.match(result.rejected[1], /HTTP\(S\)/);assert.match(result.rejected[2], /explicit UTC offset/);assert.match(result.rejected[3], /nonempty/);
      assert.match(result.label, /2026-01-01 05:00:00 \(America\/New_York\)/);assert.match(result.label, /source time: 2026-01-01T10:00:00Z/);
    });

    await t.test('lifecycle reader prompts follow locale without moving events or changing evidence', async subtest => {
      subtest.after(() => page.evaluate(() => { document.documentElement.lang = 'en'; }));
      let geometry;
      for (const lang of ['zh-CN', 'en']) {
        const initial = await page.evaluate(lang => {
          document.documentElement.lang = lang;
          const base = fixture.charts.find(c => c.id === 'lifecycle').spec;
          window.localeSelection = null;
          drawScratch({ ...base, timezone: 'America/New_York', onSelect: (row, index) => { window.localeSelection = { index, row, same: row === base.rows[index] }; } });
          return {
            prompt: document.querySelector('#scratch .report-source').textContent,
            note: document.querySelector('#scratch .sc-missing-note').textContent,
            geometry: [...document.querySelectorAll('#scratch [data-row-index]')].map(mark => ({ index: mark.dataset.rowIndex, cx: mark.querySelector('circle').getAttribute('cx'), cy: mark.querySelector('circle').getAttribute('cy') })),
          };
        }, lang);
        if (lang === 'zh-CN') {
          assert.equal(initial.prompt, '选择事件，查看依据。');
          assert.match(initial.note, /^America\/New_York · 只显示已记录事件；间距表示记录时间，不表示持续时长或因果关系。选择事件可查看附带的依据或报告链接。/);
          assert.match(initial.note, /\d+ 个事件未附带依据链接/);
          assert.doesNotMatch(initial.note, /recorded events|Select a source row/);
          geometry = initial.geometry;
        } else {
          assert.equal(initial.prompt, 'Select an event to inspect its evidence.');
          assert.match(initial.note, /recorded events only; spacing represents recorded time, not duration or causality/);
          assert.deepEqual(initial.geometry, geometry);
        }
        await page.locator('#scratch [data-row-index="4"]').focus();
        await page.keyboard.press(' ');
        const selected = await page.evaluate(() => localeSelection);
        assert.equal(selected.same, true); assert.deepEqual(selected.row, fixture.charts.find(c => c.id === 'lifecycle').spec.rows[4]);
        assert.match(await page.locator('#scratch .report-source').innerText(), lang === 'zh-CN' ? /未附带依据链接/ : /No attached evidence link/);
        assert.equal(await page.evaluate(() => originalJSON === JSON.stringify(fixture)), true);
      }
    });

    await t.test('empty and invalid datasets remain honest, and optional inspector retains exact fields', async () => {
      const result = await page.evaluate(() => {
        const empty = fixture.charts.map(({ spec }) => { drawScratch({ ...spec, rows: [] });return document.querySelector('#scratch svg').textContent; });
        const base = fixture.charts.find(c => c.id === 'parallel').spec;
        const rejected = [reject({ ...base, dimensions: base.dimensions.slice(0, 2) }),
          reject({ ...base, dimensions: [base.dimensions[0], base.dimensions[0], base.dimensions[1]] }),
          reject({ ...base, dimensions: [{ ...base.dimensions[0], domain: [0, 1] }, ...base.dimensions.slice(1)] }),
          reject({ ...base, rows: [{ sharpe: Infinity }] }), reject({ ...base, rows: Array.from({ length: 2501 }, () => base.rows[0]) })];
        drawScratch({ ...base, inspector: true });
        return { empty, rejected };
      });
      assert.ok(result.empty.every(text => text === 'No observations'));
      assert.match(result.rejected[0], /3–6/);assert.match(result.rejected[1], /unique/);assert.match(result.rejected[2], /contain every observed/);assert.match(result.rejected[3], /invalid numeric/);assert.match(result.rejected[4], /2,500/);
      await page.locator('#scratch summary').click();
      await page.getByRole('combobox', { name: 'Inspect source row' }).selectOption('0');
      assert.match(await page.locator('#scratch pre').innerText(), /1\.20000000000000001/);
      assert.match(await page.locator('#scratch pre').innerText(), /demo-run-a/);
      const allMissing = await page.evaluate(() => {
        drawScratch({ kind: 'parallel', dimensions: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], rows: [{ a: null, b: null, c: null, source: 'missing' }] });
        return { points: document.querySelectorAll('#scratch circle').length, text: document.querySelector('#scratch svg').textContent, filters: document.querySelector('#scratch [role=status]:not(.sc-tooltip)').textContent };
      });
      assert.equal(allMissing.points, 0);assert.match(allMissing.text, /No values/);assert.match(allMissing.filters, /1 \/ 1/);
      const closeDomains = await page.evaluate(() => [[.00001, .00003], [1.00001, 1.00003]].map(domain => {
        drawScratch({ kind: 'parallel', dimensions: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], rows: domain.map(value => ({ a: value, b: value, c: value })) });
        return { ticks: [...document.querySelectorAll('#scratch [data-domain-value]')].map(n => n.firstChild.textContent), placeholders: [...document.querySelectorAll('#scratch input[type=number]')].map(n => n.placeholder) };
      }));
      assert.deepEqual(closeDomains[0].ticks, ['1e-5', '3e-5', '1e-5', '3e-5', '1e-5', '3e-5']);
      assert.deepEqual(closeDomains[0].placeholders, ['0.00001', '0.00003', '0.00001', '0.00003', '0.00001', '0.00003']);
      assert.deepEqual(closeDomains[1].ticks, ['1.00001', '1.00003', '1.00001', '1.00003', '1.00001', '1.00003']);
      assert.deepEqual(closeDomains[1].placeholders, closeDomains[1].ticks);
      const sixAxes = await page.evaluate(async () => {
        const spec = { kind: 'parallel', dimensions: Array.from({ length: 6 }, (_, index) => ({ key: `d${index}`, label: `Dimension ${index} long label` })), rows: [Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`d${index}`, index]))] };
        drawScratch(spec);
        const labels = [...scratchHandle.svg.querySelectorAll('text[y="20"]')].map(n => { const box = n.getBBox();return { x: box.x, end: box.x + box.width }; });
        const input = document.querySelector('#scratch input');input.value = '5';input.dispatchEvent(new Event('input'));
        scratchHandle.destroy();await Promise.resolve();drawScratch(spec);
        return { labels, reset: document.querySelector('#scratch input').value };
      });
      assert.ok(sixAxes.labels.slice(1).every((box, i) => box.x > sixAxes.labels[i].end), 'six dimension labels must remain separable at 390px');
      assert.equal(sixAxes.reset, '', 'destroy must release the old view even when the target and spec are retained');
    });

    await t.test('redraw and destroy clean event listeners and resize observers without source mutation', async () => {
      await page.evaluate(() => { window.oldEvidence = document.querySelector('#lifecycle .report-source');window.oldEvidenceText = oldEvidence.textContent; });
      await page.setViewportSize({ width: 780, height: 850 });
      await page.waitForFunction(() => document.querySelector('#lifecycle .report-source') !== oldEvidence);
      await page.locator('#lifecycle [data-row-index="0"]').focus();await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => oldEvidence.textContent), await page.evaluate(() => oldEvidenceText));
      const result = await page.evaluate(async () => {
        const staleInput = document.querySelector('#parallel input'), before = filterCounts.parallel;
        scratchHandle.destroy();Object.values(handles).forEach(handle => handle.destroy());
        staleInput.value = '9';staleInput.dispatchEvent(new Event('input'));
        document.getElementById('parallel').style.width = '310px';
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { before, after: filterCounts.parallel, observers: liveObservers.size, plots: document.querySelectorAll('.plot svg,#scratch svg').length, unchanged: originalJSON === JSON.stringify(fixture) };
      });
      assert.equal(result.before, result.after);assert.equal(result.observers, 0);assert.equal(result.plots, 0);assert.equal(result.unchanged, true);
      assert.deepEqual(errors, []);
    });
  } finally { await browser.close(); }
});
