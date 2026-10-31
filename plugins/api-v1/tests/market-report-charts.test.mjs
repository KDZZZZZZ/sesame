import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const host = process.env.SESAME_HOST_ROOT;
const root = new URL('../packages/reports/', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');
const rows = [
  { time: '2026-01-02 09:00:00', open: '105.00', high: '106.00', low: '98.00', close: '99.00' },
  { time: '2026-01-01 09:00:00', open: '100.00', high: '107.00', low: '99.00', close: '105.00' },
  { time: '2026-01-03 09:00:00', open: null, high: null, low: null, close: null },
  { time: '2026-01-04 09:00:00', open: '101.00', high: '103.00', low: '100.00', close: '102.00' },
];

test('default report candles reuse the market runtime, preserve source times/rows, theme colors and cleanup', { skip: !host, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const [base, vendor, extension, css] = await Promise.all(['assets/editorial-charts.js', 'assets/vendor/lightweight-charts.js', 'assets/charts-market.js', 'assets/editorial.css'].map(read));
  assert.equal(vendor, await readFile(join(host, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'), 'utf8'));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, timezoneId: 'America/New_York' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<html lang="zh-CN"><body><main id="plot"></main></body></html>');
  await page.addStyleTag({ content: css });
  // Existing authored reports constrain ordinary tables. These rules must not
  // divide the chart's hidden left axis and right price axis into equal cells.
  await page.addStyleTag({ content: 'body{padding:24px}#plot{width:100%}table{width:100%;table-layout:fixed}th,td{white-space:normal!important;overflow-wrap:anywhere;word-break:normal}' });
  for (const content of [base, vendor, extension]) await page.addScriptTag({ content });
  // Observe real chart objects to assert library options and exact coordinates.
  await page.evaluate(() => {
    const original = LightweightCharts;
    window.LightweightCharts = { ...original, createChart(...args) {
      const chart = original.createChart(...args), add = chart.addSeries.bind(chart);
      chart.addSeries = (...args) => { window.candleSeries = add(...args); return candleSeries; };
      window.candleChart = chart; return chart;
    } };
  });
  await page.evaluate(rows => {
    window.sourceRows = rows; rows.forEach(Object.freeze); Object.freeze(rows);
    window.selections = [];
    window.handle = SesameCharts.chart('#plot', { kind: 'candlestick', rows, title: '演示：默认蜡烛图', digits: 2, unit: '演示单位', onSelect(row, index) { selections.push({ index, original: row === sourceRows[index] }); } });
  }, rows);
  await page.waitForFunction(() => document.querySelector('.sc-market-chart canvas')?.width > 0 && candleChart.timeScale().timeToCoordinate(Date.parse('2026-01-01T09:00:00Z') / 1000) !== null);
  assert.deepEqual(await page.evaluate(() => candleSeries.data()), [
    { time: 1767258000, open: 100, high: 107, low: 99, close: 105 },
    { time: 1767344400, open: 105, high: 106, low: 98, close: 99 },
    { time: 1767517200, open: 101, high: 103, low: 100, close: 102 },
  ]);
  assert.ok(await page.evaluate(() => {
    const scale = candleChart.timeScale(), before = scale.timeToCoordinate(1767344400), missing = scale.timeToCoordinate(1767430800), after = scale.timeToCoordinate(1767517200);
    return missing !== null && before < missing && missing < after;
  }), 'Missing OHLC retains its time slot without inventing a candle');
  assert.deepEqual(await page.evaluate(() => sourceRows), rows);
  assert.equal(await page.evaluate(() => candleChart.options().localization.timeFormatter(1767258000)), rows[1].time);
  assert.match(await page.locator('.sc-market-values').innerText(), /开 101\.00.*高 103\.00.*低 100\.00.*收 102\.00/);
  assert.equal(await page.evaluate(() => candleSeries.options().borderVisible), false);
  assert.equal(await page.evaluate(() => candleChart.options().layout.attributionLogo), false);
  assert.equal(await page.locator('.sc-market-chart a').count(), 0, 'Use the existing settings attribution without a duplicate chart logo');
  const assertAxesFit = async () => assert.deepEqual(await page.locator('.sc-market-chart').evaluate(el => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll('canvas')].flatMap(canvas => {
      const rect = canvas.getBoundingClientRect();
      return rect.right > box.right + 1 || rect.bottom > box.bottom + 1 ? [{ right: rect.right - box.right, bottom: rect.bottom - box.bottom }] : [];
    });
  }), [], 'Price/time axis canvases must fit the visible chart, not just the document width');
  await assertAxesFit();
  const point = await page.evaluate(() => ({ x: candleChart.timeScale().timeToCoordinate(1767258000), y: candleSeries.priceToCoordinate(103) }));
  const box = await page.locator('.sc-market-chart').boundingBox();
  await page.mouse.click(box.x + point.x, box.y + point.y);
  assert.deepEqual(await page.evaluate(() => selections.at(-1)), { index: 1, original: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const colors = theme === 'light' ? [[36, 115, 74], [178, 67, 67]] : [[95, 227, 169], [255, 122, 143]];
    await page.waitForFunction(colors => {
      const canvases = [...document.querySelectorAll('.sc-market-chart canvas')];
      return colors.every(color => canvases.some(canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === color[0] && pixels[i + 1] === color[1] && pixels[i + 2] === color[2] && pixels[i + 3] === 255) return true;
        return false;
      }));
    }, colors);
    assert.equal(await page.evaluate(() => candleSeries.options().upColor), `rgb(${colors[0].join(', ')})`);
    if (process.env.SESAME_MARKET_SCREENSHOTS) {
      await mkdir(process.env.SESAME_MARKET_SCREENSHOTS, { recursive: true });
      await page.locator('#plot').screenshot({ path: join(process.env.SESAME_MARKET_SCREENSHOTS, `candles-${theme}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 700 });
  await page.waitForFunction(() => {
    const surface = document.querySelector('.sc-market-chart');
    return surface?.clientWidth < 390 && [...surface.querySelectorAll('canvas')].every(canvas => canvas.getBoundingClientRect().width <= surface.clientWidth);
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await assertAxesFit();
  const pdf = await page.pdf({ format: 'A4', printBackground: true }); assert.ok(pdf.length > 1000);
  await page.evaluate(() => handle.destroy());
  assert.equal(await page.locator('#plot canvas').count(), 0);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.fonts.dispatchEvent(new Event('loadingdone')); });
  assert.deepEqual(errors, []);
  for (const [bad, pattern] of [
    [[rows[0], rows[0]], /duplicate candle times/],
    [[{ ...rows[0], close: null }], /all four prices/],
    [[{ ...rows[0], high: 50 }], /invalid OHLC bounds/],
    [[{ ...rows[0], time: 'yesterday' }], /ISO text/],
  ]) assert.match(await page.evaluate(rows => { try { SesameCharts.chart('#plot', { kind: 'candlestick', rows }); return ''; } catch (error) { return error.message; } }, bad), pattern);
});

test('candlestick template includes the default runtime only when requested', { skip: !host }, async () => {
  const { createCapabilities } = await import('../packages/reports/index.js');
  const writes = [];
  const template = createCapabilities({ capabilities: { invoke: async (_, input) => { writes.push(input); return { type: 'result', value: { path: input.path } }; } } }).find(item => item.name === 'report_template');
  const args = { output_path: 'candles-demo.html', title: '演示', summary: '组件演示', data_id: 'fixed-ohlc', chart_title: '默认蜡烛', takeaway: '固定演示记录', source_note: '非市场数据', kind: 'candlestick', unit: 'demo', columns: Object.keys(rows[0]), chart_options: { digits: 2 } };
  await template.execute(args);
  assert.match(writes[0].content, /Lightweight Charts™ v5\.2\.1|Lightweight Charts.*v5\.2\.1/);
  assert.match(writes[0].content, /register\('candlestick'/);
  assert.ok(Buffer.byteLength(writes[0].content) < 1024 * 1024);
  await template.execute({ ...args, kind: 'decision-tree' });
  assert.doesNotMatch(writes[1].content, /register\('candlestick'/);
});

test('real candle hover shares axis precision, preserves missing values and formats supplied overlays', { skip: !host, timeout: 60000 }, async t => {
  const {chromium}=createRequire(join(host,'package.json'))('playwright');
  const [base,vendor,extension,css]=await Promise.all(['assets/editorial-charts.js','assets/vendor/lightweight-charts.js','assets/charts-market.js','assets/editorial.css'].map(read));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:720,height:650}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const frozenRows=[
    {time:'2026-10-26',open:'80909.77000000',high:'81823.00000000',low:'80397.14000000',close:'81343.50000000',line:'80999.12345678'},
    {time:'2026-10-27',open:null,high:null,low:null,close:null,line:null},
    {time:'2026-10-28',open:'81909.12500000',high:'82823.00000000',low:'81397.14000000',close:'82343.50000000',line:'81999.12345678'},
  ];
  // Synthetic software fixture values only. The test does not execute analysis.
  const cases=[{locale:'zh-CN',digits:2,open:'80909.77',overlay:'80999.12',labels:['开','高','低','收']},
    {locale:'en',digits:0,open:'80909',overlay:'80999',labels:['O','H','L','C']},
    {locale:'en',digits:4,open:'80909.7700',overlay:'80999.1235',labels:['O','H','L','C']},
    {locale:'zh-Hant',digits:8,open:'80909.77000000',overlay:'80999.12345678',labels:['开','高','低','收']}];
  for(const example of cases){
    await page.goto('about:blank');
    await page.setViewportSize({width:example.digits===2?390:720,height:650});
    await page.setContent(`<html lang="${example.locale}"><body><main id="plot"></main></body></html>`);
    await page.addStyleTag({content:css});await page.addStyleTag({content:'body{padding:20px}#plot{width:100%;min-width:0}'});
    for(const content of [base,vendor,extension])await page.addScriptTag({content});
    await page.evaluate(()=>{const original=LightweightCharts;window.LightweightCharts={...original,createChart(...args){const chart=original.createChart(...args),add=chart.addSeries.bind(chart);chart.addSeries=(type,...options)=>{const series=add(type,...options);if(type===original.CandlestickSeries)window.testCandles=series;return series;};window.testChart=chart;return chart;}};});
    await page.evaluate(({rows,digits})=>{window.originalRows=rows;rows.forEach(Object.freeze);Object.freeze(rows);window.testHandle=SesameCharts.chart('#plot',{kind:'candlestick',title:'Synthetic price-format fixture',rows,digits,unit:'USD',overlays:[{field:'line',label:'Supplied line'}]});},{rows:frozenRows,digits:example.digits});
    await page.waitForFunction(()=>testChart.timeScale().timeToCoordinate(Date.parse('2026-10-26T00:00:00Z')/1000)!==null);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const geometry=await page.evaluate(()=>({x:testChart.timeScale().timeToCoordinate(Date.parse('2026-10-26T00:00:00Z')/1000),missingX:testChart.timeScale().timeToCoordinate(Date.parse('2026-10-27T00:00:00Z')/1000),y:testCandles.priceToCoordinate(81343.5)}));
    const box=await page.locator('.sc-market-chart').boundingBox();
    await page.mouse.move(box.x+geometry.x,box.y+geometry.y);
    await page.waitForFunction(()=>document.querySelector('.sc-market-values').textContent.startsWith('2026-10-26'),{},{timeout:5000});
    const actual=await page.locator('.sc-market-values').textContent();
    assert.ok(actual.includes(`${example.labels[0]} ${example.open}`),actual);assert.ok(actual.includes(`Supplied line ${example.overlay}`),actual);
    const axis=await page.evaluate(()=>testCandles.priceFormatter().format(Number(originalRows[0].open)));assert.equal(axis,example.open);
    for(const label of example.labels)assert.ok(actual.includes(label+' '),actual);
    if(example.digits===2)assert.doesNotMatch(actual,/80909\.77000000|80999\.12345678/);
    await page.mouse.move(box.x+geometry.missingX,box.y+geometry.y);
    await page.waitForFunction(()=>document.querySelector('.sc-market-values').textContent.startsWith('2026-10-27'),{},{timeout:5000});
    const missing=await page.locator('.sc-market-values').textContent();for(const label of example.labels)assert.ok(missing.includes(label+' —'),missing);
    assert.doesNotMatch(missing,/NaN|undefined|0\.00/);assert.deepEqual(await page.evaluate(()=>originalRows),frozenRows);
    await page.getByRole('checkbox',{name:'Supplied line'}).uncheck();assert.doesNotMatch(await page.locator('.sc-market-values').textContent(),/Supplied line/);
    await page.getByRole('checkbox',{name:'Supplied line'}).check();assert.match(await page.locator('.sc-market-values').textContent(),/Supplied line/);
    if(process.env.SESAME_MARKET_SCREENSHOTS&&example.digits===2){
      await mkdir(process.env.SESAME_MARKET_SCREENSHOTS,{recursive:true});
      await page.mouse.move(box.x+geometry.x,box.y+geometry.y);
      await page.waitForFunction(()=>document.querySelector('.sc-market-values').textContent.startsWith('2026-10-26'),{},{timeout:5000});
      await page.locator('#plot').screenshot({path:join(process.env.SESAME_MARKET_SCREENSHOTS,'candles-formatted-hover.png')});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.locator('#plot').screenshot({path:join(process.env.SESAME_MARKET_SCREENSHOTS,'candles-formatted-hover-narrow.png')});
    }
    await page.evaluate(()=>testHandle.destroy());
  }
  assert.deepEqual(errors,[]);
});

test('Unix candle times display as UTC dates while source seconds and selection remain exact', { skip: !host, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(host, 'package.json'))('playwright');
  const contents = await Promise.all(['assets/editorial-charts.js', 'assets/vendor/lightweight-charts.js', 'assets/charts-market.js'].map(read));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  // These two distinct UTC hours straddle New York's repeated 01:00 hour.
  const fixture = ['2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z'].map(time => ({
    time: Date.parse(time) / 1000, open: '100.123456', high: '102', low: '99', close: '101.234567',
  }));
  for (const width of [720, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 600 }, timezoneId: 'America/New_York' });
    await page.setContent('<html lang="zh-CN"><body><main id="plot"></main></body></html>');
    for (const content of contents) await page.addScriptTag({ content });
    await page.evaluate(() => {
      const library = LightweightCharts;
      window.LightweightCharts = { ...library, createChart(...args) {
        const chart = library.createChart(...args), add = chart.addSeries.bind(chart);
        chart.addSeries = (...args) => { window.numericSeries = add(...args); return numericSeries; };
        window.numericChart = chart; return chart;
      } };
    });
    await page.evaluate(rows => {
      window.numericRows = rows; rows.forEach(Object.freeze); Object.freeze(rows);
      window.numericSelections = [];
      SesameCharts.chart('#plot', { kind: 'candlestick', rows, digits: 2,
        onSelect(row, index) { numericSelections.push({ row, index, original: row === numericRows[index] }); } });
    }, fixture);
    await page.waitForFunction(() => numericChart.timeScale().timeToCoordinate(numericRows[0].time) !== null);
    assert.match(await page.locator('.sc-market-values').innerText(), /^2026-11-01 06:00 UTC.*开 100\.12.*收 101\.23/);
    assert.deepEqual(await page.evaluate(() => numericRows.map(row => ({
      time: numericChart.options().localization.timeFormatter(row.time),
      tick: numericChart.options().timeScale.tickMarkFormatter(row.time),
    }))), [
      { time: '2026-11-01 05:00 UTC', tick: '11-01 05:00' },
      { time: '2026-11-01 06:00 UTC', tick: '11-01 06:00' },
    ]);
    const point = await page.evaluate(() => ({
      x: numericChart.timeScale().timeToCoordinate(numericRows[0].time), y: numericSeries.priceToCoordinate(101),
    }));
    const box = await page.locator('.sc-market-chart').boundingBox();
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.waitForFunction(() => document.querySelector('.sc-market-values').textContent.startsWith('2026-11-01 05:00 UTC'));
    await page.mouse.click(box.x + point.x, box.y + point.y);
    assert.deepEqual(await page.evaluate(() => numericSelections.at(-1)), { row: fixture[0], index: 0, original: true });
    assert.deepEqual(await page.evaluate(() => numericRows), fixture);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.close();
  }
});
