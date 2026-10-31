import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStructuredReport } from '../packages/reports/report-content.js';

const overview = {
  conclusion: '合成示例：短期偏强，长期仍需等待。',
  facts: [{ label: '短期走势', value: '偏强' }, { label: '最大回撤', value: '-10%', format: 'number' }],
};
const input = value => ({ title: '合成首屏测试', summary: '只用于报告列表的摘要', locale: 'zh-CN',
  provenance_kind: 'demo', data: [], content: { kind: 'document', overview: value,
    sections: [{ title: '依据', blocks: [{ type: 'paragraph', text: '完整研究保留在后面。' }] }] } });

test('overview is before analysis, suppresses duplicate metadata summary and preserves supplied results', async () => {
  const original = structuredClone(overview);
  const html = await renderStructuredReport({}, input(overview));
  assert.ok(html.indexOf('class="report-overview"') < html.indexOf('id="content-section-1"'));
  assert.match(html, /短期走势<\/dt><dd>偏强/);
  assert.match(html, /最大回撤<\/dt><dd>-10%/);
  assert.doesNotMatch(html, /只用于报告列表的摘要/);
  assert.match(html, /完整研究保留在后面/);
  assert.match(html, /href="#content-section-1"/);
  assert.deepEqual(overview, original);
});

test('overview rejects prose dumps without silently shortening or inventing a result', async () => {
  for (const value of [
    { ...overview, conclusion: '长'.repeat(49) },
    { ...overview, facts: [{ label: '方向', value: '长'.repeat(17) }] },
    { ...overview, facts: [{ label: '理由', value: '长'.repeat(49), format: 'sentence' }] },
    { ...overview, facts: [overview.facts[0], overview.facts[0]] },
    { ...overview, facts: [], conclusion: '没有结果' },
  ]) await assert.rejects(renderStructuredReport({}, input(value)), /Overview/);
});

test('overview escapes text and supports full table labels on narrow screens', async () => {
  const value = { conclusion: '合成示例', facts: [{ label: '<b>', value: '<script>', format: 'phrase' }],
    table: { columns: ['证券', '<img>'], rows: [['合成A', '偏强']] } };
  const html = await renderStructuredReport({}, input(value));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-label="&lt;img&gt;">偏强/);
  assert.doesNotMatch(html, /<img>/);
  assert.match(html, /content:attr\(data-label\)/);
});

test('overview uses the same native charts and evidence appendix without changing financial values', async () => {
  const value = { ...overview, chart: { type: 'chart', title: '合成收益', kind: 'bar',
    columns: ['label','value'], rows: [{ label: '合成A', value: -2 }, { label: '合成B', value: 3 }],
    options: { x: 'label', y: 'value', valueType: 'return' },
    takeaway: '保留两个真实输入值', source_note: 'Synthetic software values only' } };
  const html = await renderStructuredReport({}, input(value));
  const charts = JSON.parse(html.match(/id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(charts[0].rows, value.chart.rows);
  assert.equal(charts[0].options.height, 200);
  assert.match(html, /附录/);
  assert.ok(html.indexOf('id="content-chart-1"') < html.indexOf('id="content-section-1"'));
  await assert.rejects(renderStructuredReport({}, input({ ...value, chart: { ...value.chart, options: { ...value.chart.options, height: 500 } } })), /180–280/);
});
