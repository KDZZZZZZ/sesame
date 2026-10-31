import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderStructuredReport } from '../packages/reports/report-content.js';
import { createCapabilities } from '../packages/reports/index.js';

const pkg = new URL('../packages/reports/', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('examples/composition-fixtures.json', pkg), 'utf8'));
const block = chart => {
  const { rows, kind, ...options } = chart.spec;
  return { type: 'chart', kind, title: chart.title, takeaway: chart.caption, source_note: 'Explicit fictional demo', columns: [...new Set(rows.flatMap(Object.keys))], rows, options };
};
const report = { title: 'Composition collection', locale: 'zh-CN', provenance_kind: 'demo', content: { kind: 'document', sections: fixture.charts.map(chart => ({ title: chart.spec.kind, blocks: [block(chart)] })) } };

test('all selected kinds reach the production document and preview interfaces', async () => {
  const manifest = JSON.parse(await readFile(new URL('capabilities.json', pkg), 'utf8'));
  const publicKinds = manifest.capabilities.find(c => c.id === 'report_template').inputSchema.properties.kind.anyOf.map(v => v.const);
  for (const chart of fixture.charts) assert.ok(publicKinds.includes(chart.spec.kind), `${chart.spec.kind} must pass the public schema`);
  const html = await renderStructuredReport({}, report);
  assert.match(html, /function rankRace/);
  assert.match(html, /data-report-evidence/);
  const config = JSON.parse(html.match(/<script id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(config.map(c => c.kind), fixture.charts.map(c => c.spec.kind));
  assert.deepEqual(config.map(c => c.rows), fixture.charts.map(c => c.spec.rows));
  const writes = [];
  const tool = createCapabilities({ capabilities: { invoke: async (id, input) => { assert.equal(id, 'sesame/workspace#write'); writes.push(input); return { type: 'result', value: { path: input.path } }; } } }).find(t => t.name === 'report_template');
  for (const chart of fixture.charts) {
    const { rows, kind, ...chart_options } = chart.spec;
    await tool.execute({ kind, title: chart.title, takeaway: chart.caption, source_note: 'Demo', columns: Object.keys(rows[0]), data_id: 'fixed', output_path: 'preview.html', chart_options, demo: true });
  }
  assert.equal(writes.length, fixture.charts.length);
});

const host = process.env.SESAME_HOST_ROOT;
test('the host exports all selected charts to a complete PNG and static PDF', { skip: !host && 'Set SESAME_HOST_ROOT', timeout: 60000 }, async () => {
  const { PlaywrightReportRenderer } = await import(pathToFileURL(join(resolve(host), 'modules/agent/report-playwright.js')));
  const renderer = new PlaywrightReportRenderer({});
  const sections = [];
  for (let i = 0; i < fixture.charts.length; i += 2) sections.push({ title: 'Supplied observations', blocks: [{ type: 'group', layout: 'columns', blocks: fixture.charts.slice(i, i + 2).map(block) }] });
  const html = await renderStructuredReport({}, { ...report, content: { kind: 'document', sections } });
  try {
    for (const format of ['png', 'pdf']) {
      const result = await renderer.export({ html, format, source: true, locale: 'zh-CN', theme: 'light', report: { title: 'Composition export' } }, () => assert.fail('Fixed charts must not fetch data'));
      assert.equal(result.width, 1000); assert.ok(result.height > 2000);
      assert.equal(result.files.length, 1);
      const bytes = Buffer.from(result.files[0].base64, 'base64');
      if (format === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      else { assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert.equal(bytes.readUInt32BE(20), result.height); }
    }
  } finally { await renderer.close(); }
});

test('actual SVG charts preserve source data, distinguish missing values, and control playback', { skip: !host && 'Set SESAME_HOST_ROOT', timeout: 60000 }, async () => {
  const require = createRequire(join(resolve(host), 'package.json'));
  const browser = await require('playwright').chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  try {
    await page.setContent(await renderStructuredReport({}, report));
    await page.waitForFunction(count => document.querySelectorAll('.module-chart-plot svg').length === count, fixture.charts.length);
    const specs = fixture.charts.map(c => c.spec);
    await page.evaluate(specs => {
      window.fixtures = specs;
      const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
      freeze(fixtures);
      const target = document.createElement('div'); target.id = 'exercise'; target.style.width = '500px'; document.body.append(target);
      window.exercise = spec => {
        SesameCharts.destroy(target);
        window.pick = null;
        return SesameCharts.chart(target, { ...spec, onSelect: (row, index) => { window.pick = { row, index, original: row === spec.rows[index] }; } });
      };
    }, specs);
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => [...document.querySelectorAll('.module-chart-plot')].every(n => Math.abs(n.clientWidth - n.querySelector('svg').viewBox.baseVal.width) <= 2));
      // The separate fixed-width exercise container is not part of the report.
      const bounds = await page.evaluate(() => [...document.querySelectorAll('.module-chart-plot svg')].flatMap(svg => [...svg.querySelectorAll('text')].map(n => {
        const b = n.getBBox(); return { text: n.textContent, x: b.x, right: b.x + b.width, width: svg.viewBox.baseVal.width, y: b.y, bottom: b.y + b.height, height: svg.viewBox.baseVal.height };
      })));
      for (const b of bounds) assert.ok(b.x >= -1 && b.right <= b.width + 1 && b.y >= -1 && b.bottom <= b.height + 1, `text fits ${width}px: ${JSON.stringify(b)}`);
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; exercise(fixtures.find(s => s.kind === 'rank-race')); }, theme);
      const colors = await page.evaluate(() => [...document.querySelectorAll('#exercise rect[data-value]')].map(n => getComputedStyle(n).fill));
      assert.ok(new Set(colors).size >= 4);
      assert.ok(colors.every(c => c !== 'none' && !c.includes('rgba(0, 0, 0, 0)')));
    }
    const checked = await page.evaluate(() => {
      const read = kind => fixtures.find(s => s.kind === kind);
      const rejects = spec => { try { exercise(spec); return false; } catch { return true; } };
      const results = {};
      const stream = read('stream'); results.missingStream = rejects({ ...stream, rows: stream.rows.slice(1) });
      results.badCalendar = rejects({ ...stream, xType: 'time', rows: stream.rows.map((r,i) => ({...r,month:i<3?'2026-02-30':`2026-03-${String(1+Math.floor(i/3)).padStart(2,'0')}`})) });
      const stacked = read('stacked-rungs'); results.partialTick = rejects({ ...stacked, unitValue: 5 });
      results.exactDecimal = !rejects({ kind:'stacked-rungs', x:'x', series:'series', value:'v', unitValue:.1, rows:[{x:'A',series:'one',v:.2},{x:'A',series:'two',v:.3}] });
      const funnel = read('funnel'); results.growingFunnel = rejects({ ...funnel, rows: [funnel.rows[1], funnel.rows[0]] });
      const tally = read('outcome-tally'); results.tooManyHits = rejects({ ...tally, rows:[{outcome:'test',count:101,samples:100}] });
      results.overlappingNotDisjoint = rejects({ ...tally, overlap:false });
      const links = read('category-links'); results.duplicateItem = rejects({ ...links, rows:[links.rows[0],links.rows[0]] });
      const race = read('rank-race'); results.missingRaceItem = rejects({ ...race, rows:race.rows.slice(1) });
      exercise({kind:'dot-heatmap',x:'x',y:'y',value:'v',tone:'signed',rows:[{x:'zero',y:'A',v:0},{x:'missing',y:'A',v:null},{x:'up',y:'A',v:4},{x:'down',y:'A',v:-4}]});
      results.zeroVisible = document.querySelector('#exercise circle[data-value="0"]').getAttribute('fill') === 'none';
      results.missingVisible = !!document.querySelector('#exercise g[data-row-index="1"] path');
      const up = document.querySelector('#exercise circle[data-value="4"]'), down = document.querySelector('#exercise circle[data-value="-4"]');
      results.areaHonest = up.getAttribute('r') === down.getAttribute('r');
      results.signColors = getComputedStyle(up).fill !== getComputedStyle(down).fill;
      document.querySelector('#exercise [data-row-index="2"]').dispatchEvent(new MouseEvent('click'));
      results.sourceIdentity = pick.original && pick.row.v === 4;
      const spectrum = read('spectrum');
      results.unknownFocus = rejects({...spectrum,focus:'absent'});
      results.boundedSpectrum = rejects({...spectrum,rows:spectrum.rows.map((row,i)=>i?row:{...row,risk:101})});
      exercise({...spectrum,dimensions:spectrum.dimensions.slice(0,1),rows:spectrum.rows.map((row,i)=>i?row:{...row,risk:null})});
      results.missingSpectrum = document.querySelectorAll('#exercise circle[data-dimension]').length===3 && document.querySelector('#exercise svg').viewBox.baseVal.height>=120;
      const donut = read('tick-donut');
      results.donutExactUnit = rejects({...donut,unitValue:2});
      results.donutNegative = rejects({...donut,rows:[{asset:'negative',weight:-1}]});
      exercise({...donut,rows:[...donut.rows,{asset:'zero',weight:0}]});
      results.donutExactTotal = document.querySelectorAll('#exercise g[data-part] line').length===100;
      results.donutZero = document.querySelector('#exercise g[data-part="zero"]').children.length===1;
      const barcode = read('barcode');
      results.badBarcodeTime = rejects({...barcode,rows:[{day:'2026-02-30',amount:1}],highlights:[]});
      results.unknownHighlight = rejects({...barcode,highlights:['2027-01-01']});
      results.duplicateBarcode = rejects({...barcode,rows:[barcode.rows[0],barcode.rows[0]],highlights:[]});
      exercise({kind:'barcode',x:'x',value:'v',xType:'number',tone:'signed',rows:[{x:1,v:2},{x:2,v:null},{x:3,v:-2},{x:5,v:4}]});
      const points = [...document.querySelectorAll('#exercise circle[data-x]')];
      results.actualSpacing = Math.abs((+points[1].getAttribute('cx')-+points[0].getAttribute('cx'))-(+points[2].getAttribute('cx')-+points[1].getAttribute('cx')))<.01;
      results.barcodeSign = getComputedStyle(points[0]).fill!==getComputedStyle(points[1]).fill;
      results.barcodeMissing = !!document.querySelector('#exercise g[data-row-index="1"] path');
      const ledger = read('bubble-ledger');
      results.completeLedger = rejects({...ledger,rows:ledger.rows.slice(1)});
      results.duplicateLedger = rejects({...ledger,rows:[...ledger.rows,ledger.rows[0]]});
      results.ledgerStatusAgreement = rejects({...ledger,rows:ledger.rows.map((row,i)=>i?row:{...row,coverage:'missing'})});
      exercise({kind:'bubble-ledger',x:'x',y:'year',value:'v',status:'s',rows:[{x:'A',year:2020,v:4,s:'observed'},{x:'A',year:2021,v:16,s:'partial'},{x:'A',year:2023,v:null,s:'missing'}]});
      const bubbles = [...document.querySelectorAll('#exercise circle[data-value]')];
      results.ledgerArea = +bubbles[1].getAttribute('r')===2*+bubbles[0].getAttribute('r');
      results.ledgerYearSpacing = Math.abs((+bubbles[2].getAttribute('cy')-+bubbles[1].getAttribute('cy'))-2*(+bubbles[1].getAttribute('cy')-+bubbles[0].getAttribute('cy')))<.01;
      results.ledgerCoverage = bubbles[1].getAttribute('stroke-dasharray')==='2 2' && bubbles[1].getAttribute('fill')!=='none' && bubbles[2].getAttribute('fill')==='none';
      exercise({...race,tone:'signed'});
      results.allPositiveStillGreen = new Set([...document.querySelectorAll('#exercise rect[data-value]')].map(n=>getComputedStyle(n).fill)).size === 1;
      return results;
    });
    for (const [name, passed] of Object.entries(checked)) assert.equal(passed, true, name);
    await page.evaluate(() => exercise(fixtures.find(s => s.kind === 'rank-race')));
    assert.equal(await page.locator('#exercise [data-race-frame]').getAttribute('data-race-frame'), '2026');
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('#exercise [data-race-frame]').getAttribute('data-race-frame'), '2026', 'no automatic playback');
    await page.locator('#exercise button').click();
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#exercise [data-race-frame]').getAttribute('data-race-frame'), '2022');
    await page.locator('#exercise button').click();
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('#exercise [data-race-frame]').getAttribute('data-race-frame'), '2022', 'pause stops timer');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#exercise input').fill('2');
    assert.equal(await page.locator('#exercise [data-race-frame]').getAttribute('data-race-frame'), '2024');
    await page.evaluate(() => { document.querySelector('#exercise').style.width='300px'; });
    await page.waitForFunction(() => document.querySelector('#exercise svg').viewBox.baseVal.width === 300);
    assert.equal(await page.locator('#exercise [data-race-frame]').getAttribute('data-race-frame'), '2024', 'resize preserves selected frame');
    await page.evaluate(() => SesameCharts.destroy(document.querySelector('#exercise')));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#exercise svg').count(), 0);
    assert.deepEqual(await page.evaluate(() => fixtures), specs, 'input observations are unchanged');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
