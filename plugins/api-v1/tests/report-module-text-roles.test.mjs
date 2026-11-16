import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { resolveStructure, bindResults } from '../packages/reports/report-structure.js';
import { renderComposedReport } from '../packages/reports/report-compose.js';
import { presentValue } from '../packages/reports/report-presentation.js';
import { renderOverview } from '../packages/reports/report-overview.js';
import { renderSignalStudy } from '../packages/reports/report-signal-study.js';
import { renderText } from '../packages/reports/report-text.js';
import { withEvidenceAppendix } from '../packages/reports/report-appendix.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const visibleMarkup = html => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
const words = html => visibleMarkup(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const count = (text, value) => text.split(value).length - 1;
const composed = ({ takeaway = 'Only after the 5-day window.', summary = 'Only after the 5-day window.', display = 'visible', title = 'Report', sectionTitle = 'Section', chartLabel = 'Recorded series', source = 'Fixed sample A', omitChartText = false, summaryUnit } = {}) => {
  const structure = resolveStructure({ locale: 'en-US', sections: [{ id: 'custom', title: sectionTitle, fields: [
    { key: 'summary', label: 'Finding', type: 'text', meaning: 'Authored finding', display, ...(summaryUnit ? { unit: summaryUnit } : {}) },
    { key: 'series', label: chartLabel, type: 'chart', meaning: 'Recorded values', chart: { kind: 'bar', columns: ['label', 'value'], options: { x: 'label', y: 'value', unit: 'USD' }, data_requirements: 'Recorded observations' } },
  ] }] });
  const rows = [{ section_id: 'custom', field: 'summary', value: summary }, { section_id: 'custom', field: 'series', value: { rows: [{ label: 'A', value: 1.23456789 }], ...omitChartText ? {} : { takeaway, source_note: source } } }];
  const before = structuredClone(rows);
  const html = renderComposedReport({ title, summary: 'INDEX METADATA ONLY', structure, bound: bindResults(structure, rows), data: [], references: [], demo: false });
  assert.deepEqual(rows, before);
  return html;
};

test('module headings and authored takeaways have one visible owner while exact data and sources remain local', () => {
  const html = composed({ takeaway: '  Only after the 5-day\nwindow.  ' });
  const visible = visibleMarkup(html);
  assert.match(visible, /<h3 data-report-text="title">Recorded series<\/h3>/);
  assert.equal(count(words(html), 'Only after the 5-day window.'), 1);
  assert.doesNotMatch(visible, /INDEX METADATA ONLY|Fixed sample A|module-chart-caption-repeated/);
  assert.match(html, /<details[^>]*class="module-chart-inspect">[\s\S]*data-report-text="evidence">Fixed sample A<\/p>/);
  assert.match(html, /Data and sources · 1 · USD/);
  const config = JSON.parse(html.match(/id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(config[0].title, 'Recorded series');
  assert.equal(config[0].caption, '  Only after the 5-day\nwindow.  ');
  assert.equal(config[0].rows[0].value, 1.23456789);
  assert.equal(count(words(composed({ takeaway: 'Only after the 10-day window.' })), 'Only after the 10-day window.'), 1);
  assert.equal(count(words(composed({ display: 'folded' })), 'Only after the 5-day window.'), 1, 'A folded summary cannot suppress the visible chart explanation');
  assert.match(visibleMarkup(composed({ summary: '5', summaryUnit: 'days', takeaway: '5' })), /data-report-text="body">5<\/p>/, 'A displayed unit changes the exact text being compared');
});

test('module charts allow omitted optional explanation and source text without displaying undefined', () => {
  const html = composed({ omitChartText: true });
  assert.doesNotMatch(visibleMarkup(html), /undefined|Fixed sample A/);
  assert.match(html, /Data and sources · 1 · USD/);
  const config = JSON.parse(html.match(/id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(config[0].caption, undefined);
  assert.equal(config[0].rows[0].value, 1.23456789);
});

test('module title ownership stops at a differently named section', () => {
  const html = visibleMarkup(composed({ title: 'Recorded series', sectionTitle: 'Subsidiary A', chartLabel: 'Recorded series' }));
  assert.match(html, /<h2 data-report-text="title">Subsidiary A<\/h2>/);
  assert.match(html, /<h3 data-report-text="title">Recorded series<\/h3>/);
  const prose = visibleMarkup(composed({ title: 'Annual sales', sectionTitle: 'Subsidiary A', chartLabel: 'Recorded series', takeaway: 'Annual sales' }));
  assert.match(prose, /data-report-text="body">Annual sales<\/p>/);
});

test('module parent titles deduplicate exact whitespace-normalized text without dropping different titles', () => {
  const html = composed({ title: 'Recorded series', sectionTitle: ' Recorded\nseries ', chartLabel: 'Recorded  series' });
  const visible = visibleMarkup(html);
  assert.equal((visible.match(/<h[123]\b[^>]*>\s*Recorded\s+series\s*<\/h[123]>/g) ?? []).length, 1);
  assert.match(visibleMarkup(composed({ sectionTitle: 'Recorded series 2' })), />Recorded series 2<\/h2>/);
});

const projection = (presentation, value, type = 'object') => presentValue({ type, label: 'Metric', meaning: 'Recorded definition', presentation }, value, {
  escape, valueHTML: value => `<pre>${escape(JSON.stringify(value))}</pre>`, locale: 'en-US', tr: (_zh, en) => en,
}).html;

test('projection caption and metadata share one context position, preserve conditions and keep original values in details', () => {
  const value = { result: 1.23456789, note: 'Only after 5 days; USD.', window: '10 days', checked: false, count: 0, source: 'Unmapped source record' };
  const html = projection({ kind: 'metric', value: 'result', unit: 'USD', caption: 'note', meta: ['note', 'window', 'checked', 'count'] }, value);
  const body = html.split('<details')[0];
  assert.equal(count(body, 'Only after 5 days; USD.'), 1);
  assert.equal(count(body, 'class="module-visual-context"'), 1);
  assert.match(body, /data-report-text="context"/);
  for (const text of ['10 days', 'false', '>0<', 'USD']) assert.ok(body.includes(text), text);
  assert.doesNotMatch(body, /module-visual-caption|module-meta|Unmapped source record|1\.23456789/);
  const detail = html.split('<details')[1];
  assert.match(detail, /data-report-text="evidence"/);
  assert.match(detail, /Unmapped source record/);
  assert.match(detail, /1\.23456789/);
  assert.deepEqual(value, { result: 1.23456789, note: 'Only after 5 days; USD.', window: '10 days', checked: false, count: 0, source: 'Unmapped source record' });
  const equalValues = projection({ kind: 'metric', value: 'result', meta: ['settlement', 'holding'] }, { result: 1, settlement: '5 days', holding: '5 days' }).split('<details')[0];
  assert.equal(count(equalValues, '5 days'), 2, 'Different property labels remain meaningful even when their values match');
});

test('score and range projections keep explicit scales, units, and mapped conditions in ordinary context text', () => {
  const score = projection({ kind: 'scores', label: 'name', value: 'score', min: 0, max: 5, unit: 'points', caption: 'note', meta: ['window'] }, [{ name: 'A', score: 0, note: 'A recorded condition', window: '5 days' }], 'array');
  const scoreBody = score.split('<details')[0];
  assert.match(scoreBody, /data-report-text="context">Source scale 0–5 points/);
  assert.match(scoreBody, /A recorded condition/); assert.match(scoreBody, /5 days/);
  assert.doesNotMatch(scoreBody, /module-scale-note|module-meta/);
  const range = projection({ kind: 'range', lower: 'low', upper: 'high', unit: 'USD', caption: 'note', meta: ['window'] }, { low: 1.23456789, high: 9, note: 'After costs', window: '30 days' });
  assert.match(range.split('<details')[0], /After costs/); assert.match(range.split('<details')[0], /30 days/);
  assert.match(range, /1\.23456789/);
});

test('overview passes exact authored context to its embedded chart without mutating the fixed input', () => {
  const chart = { type: 'chart', kind: 'bar', title: 'Observed values', takeaway: 'One authored conclusion.', rows: [{ label: 'A', value: 1 }] };
  const value = { conclusion: 'One authored conclusion.', meta: ' One authored\nconclusion. ', facts: [], chart };
  const before = structuredClone(value), calls = [];
  const html = renderOverview(value, (block, depth, path, context) => {
    calls.push({ block, depth, path, context });
    return renderText(block.takeaway, { role: 'body', against: context?.body });
  }, 'en-US', false);
  assert.equal(count(words(html), 'One authored conclusion.'), 1);
  assert.deepEqual(calls[0].context, { titles: [], body: [value.conclusion, value.meta] });
  assert.equal(calls[0].block.takeaway, chart.takeaway);
  assert.equal(calls[0].block.options.height, 200);
  assert.deepEqual(value, before);
  assert.match(html, /report-overview-conclusion" data-report-text="body"/);
});

const signalRun = () => ({ config: { rounds: 1, dataset: { costBps: 8, trainEnd: '2025-03-31', validationEnd: '2025-06-30', holdoutEnd: '2025-09-30' } },
  trials: [{ id: 'chosen', name: 'Recorded signal', review: { verdict: 'conditional' }, candidate: { op: 'field', name: 'close' }, metrics: { train: { meanNetReturn: 0.01, observations: 90 }, validation: { meanNetReturn: 0.02, observations: 64 } } }],
  selection: { trialIds: ['chosen'], applicability: { valid_when: ['Only when volume is recorded.'], stop_when: ['Stop after the stated cutoff.'] } },
  finalEvaluation: { holdoutStatus: 'evaluated' }, holdout: { chosen: { metrics: { meanNetReturn: 0.03, labelObservations: 7 } } } });

test('signal study removes unrequested tutorials and disclaimers while keeping cost, eligibility, conditions and the exact snapshot', () => {
  const run = signalRun(), before = structuredClone(run), html = renderSignalStudy(run), visible = visibleMarkup(html);
  assert.doesNotMatch(visible, /点击色块|实际买卖还可能不同|IC 表示信号|还不清楚这个信号|C 是收盘价，V 是成交量/);
  assert.match(visible, /data-report-text="context">估算成本：8 基点<\/p>/);
  assert.doesNotMatch(visible, /比较轮数|看过的信号|标签样本|组合期|IC：|factor-period-scope|factor-fold-scope/);
  assert.match(visible, /data-report-text="body">Only when volume is recorded\.<\/p>/);
  assert.match(visible, /data-report-text="body">Stop after the stated cutoff\.<\/p>/);
  assert.match(visible, /data-report-text="legend">绿：正 · 红：负 · 深浅：幅度 · —：缺失/);
  assert.doesNotMatch(visible, /class="factor-note"/);
  assert.match(html, /样本 90/); assert.match(html, /样本 64/); assert.match(html, /标签样本 7/);
  const snapshot = JSON.parse(html.match(/id="run-snapshot">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(snapshot, before); assert.deepEqual(run, before);
  const authored = renderSignalStudy(run, { presentation: { note: 'Actual costs may differ <recorded condition>.' } });
  assert.match(visibleMarkup(authored), /data-report-text="body">Actual costs may differ &lt;recorded condition&gt;\.<\/p>/);
  const zeroCost = signalRun(); zeroCost.config.dataset.costBps = 0;
  assert.match(visibleMarkup(renderSignalStudy(zeroCost)), /估算成本：0 基点/);
  delete zeroCost.config.dataset.costBps;
  assert.doesNotMatch(visibleMarkup(renderSignalStudy(zeroCost)), /估算成本：/);
  assert.match(visible, /data-report-text="legend">C：收盘价<\/p>/);
  assert.doesNotMatch(visible, /V：成交量|MA：均值/);
});

test('module and signal text ownership stays visible and accessible in a real narrow browser', { skip: !process.env.SESAME_HOST_ROOT, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(process.env.SESAME_HOST_ROOT, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(composed());
  await page.locator('.module-chart-plot[data-chart-status="ready"]').waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Recorded series', exact: true }).count(), 1);
  assert.equal(await page.locator('.module-chart-plot figcaption').count(), 0);
  assert.equal(await page.getByText('Only after the 5-day window.', { exact: true }).count(), 1);
  assert.match(await page.locator('.module-chart-plot svg').getAttribute('aria-label'), /Recorded series/);
  assert.equal(await page.getByText('Fixed sample A', { exact: true }).isVisible(), false);
  await page.locator('.module-chart-inspect > summary').click();
  assert.equal(await page.getByText('Fixed sample A', { exact: true }).isVisible(), true);
  assert.match(await page.locator('.module-chart-inspect table').innerText(), /1\.23456789/);
  await page.locator('.module-chart-inspect > summary').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  if (process.env.SESAME_REPORT_TEXT_SCREENSHOTS) {
    mkdirSync(process.env.SESAME_REPORT_TEXT_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: join(process.env.SESAME_REPORT_TEXT_SCREENSHOTS, 'module-text-roles-narrow.png'), fullPage: true });
  }

  const css = readFileSync(new URL('../packages/reports/assets/editorial.css', import.meta.url), 'utf8');
  const html = withEvidenceAppendix(`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="report">${renderSignalStudy(signalRun())}</main></body></html>`);
  // Published reports mount in separate documents; setContent alone retains
  // the previous report's nonconfigurable chart globals on the same Window.
  await page.goto('about:blank');
  await page.setContent(html);
  await page.locator('#factor-periods svg').waitFor();
  for (const text of ['估算成本：8 基点', 'Only when volume is recorded.']) {
    const element = page.getByText(text, { exact: true });
    assert.equal(await element.isVisible(), true);
    assert.ok(await element.evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 15), text);
  }
  assert.equal(await page.locator('#factor-period-scope, #factor-fold-scope').count(), 0);
  assert.equal(await page.locator('#factor-folds').isVisible(), false);
  assert.doesNotMatch(await page.locator('main').innerText(), /标签样本|比较轮数|样本 90|样本 64/);
  const description = await page.locator('#factor-periods svg desc').textContent();
  assert.match(description, /样本 90/);
  assert.match(description, /样本 64/);
  assert.match(description, /标签样本 7/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  if (process.env.SESAME_REPORT_TEXT_SCREENSHOTS) await page.screenshot({ path: join(process.env.SESAME_REPORT_TEXT_SCREENSHOTS, 'signal-text-roles-narrow.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
