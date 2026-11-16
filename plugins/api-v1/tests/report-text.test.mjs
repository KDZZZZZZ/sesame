import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStructuredReport } from '../packages/reports/report-content.js';

const chart = extra => ({ type: 'chart', kind: 'bar', title: '数量比较', columns: ['label', 'value'],
  rows: [{ label: 'A', value: 0 }, { label: 'B', value: 4 }], options: { x: 'label', y: 'value', unit: '个' },
  takeaway: 'B 比 A 多四个', source_note: 'Synthetic input, exact rows retained', ...extra });
const render = (blocks, extra = {}) => renderStructuredReport({}, {
  title: '数量比较', summary: '', locale: 'zh-CN', provenance_kind: 'demo', data: [],
  content: { kind: 'document', sections: [{ title: '数量比较', blocks }] }, ...extra,
});
const markup = html => (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
const count = (html, text) => markup(html).split(text).length - 1;

test('report, section and chart share a single visible title while the chart retains its accessible name', async () => {
  const html = await render([chart()]);
  assert.equal(count(html, '数量比较'), 1);
  const config = JSON.parse(html.match(/id="sesame-module-charts"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(config[0].title, '数量比较');
  assert.deepEqual(config[0].rows, chart().rows);
});

test('an authored conclusion appears once as body text, never as a second small caption', async () => {
  const html = await render([{ type: 'paragraph', text: 'B 比 A 多四个' }, chart()]);
  assert.equal(count(html, 'B 比 A 多四个'), 1);
  assert.doesNotMatch(markup(html), /kit-chart-caption/);
  assert.match(markup(await render([chart()])), /data-report-text="body"[^>]*>B 比 A 多四个<\/p>/);
});

test('nearby but different statements and actual conditions are preserved', async () => {
  const html = await render([
    { type: 'paragraph', text: 'B 比 A 多四个，仅适用于当前样本' }, chart(),
    { type: 'judgment', text: '保留样本 A', note: '数量为 0，不能当作缺失' },
  ]);
  assert.equal(count(html, '仅适用于当前样本'), 1);
  assert.equal(count(html, '数量为 0，不能当作缺失'), 1);
  assert.equal(count(html, 'B 比 A 多四个'), 2);
});

test('optional contextual text uses one shared role and omits only exact repetition', async () => {
  const html = await render([
    { type: 'metrics', items: [{ label: '数量', value: 0, note: '数量' }, { label: '价格', value: 12, note: 'USD' }] },
    { type: 'range', label: '区间', min: 0, max: 10, value: 4, note: '收盘价落在此区间时' },
    { type: 'formula', latex: 'a/b', caption: 'b 必须非零' },
  ]);
  assert.doesNotMatch(markup(html), /<small>数量<\/small>/);
  for (const value of ['USD', '收盘价落在此区间时', 'b 必须非零'])
    assert.match(markup(html), new RegExp(`data-report-text="context"[^>]*>${value}<`));
  assert.match(markup(html), /<dd>0<\/dd>/);
});

test('report-list summary is not automatically added as visible report prose', async () => {
  const html = await render([chart()], { summary: '仅供列表检索的摘要' });
  assert.doesNotMatch(markup(html), /仅供列表检索的摘要/);
  assert.equal(count(html, 'B 比 A 多四个'), 1);
  assert.doesNotMatch(markup(html), /Synthetic input/);
  assert.match(html, /Synthetic input, exact rows retained/);
});

test('the same author title remains visible once in the answer surface without the report wrapper', async () => {
  const html = await render([chart()], { target: 'answer', content: { kind: 'document', sections: [{ title: '', blocks: [chart()] }] } });
  // The answer package hides report-level chrome; its title must belong to the component.
  assert.match(markup(html), /<strong[^>]*>数量比较<\/strong>/);
});

test('distinct named sections and details reset the adjacent title scope', async () => {
  const siblings = [chart({ title: '营业收入' }),
    { type: 'table', caption: '营业收入', columns: ['地区', '金额'], rows: [['华东', 42]] },
    { type: 'logic', title: '营业收入', nodes: [{ id: 'sales', label: '已记录销售' }], edges: [] }];
  const html = markup(await render([], { title: '营业收入', content: { kind: 'document', sections: [
    { title: '子公司 A', blocks: [...siblings, { type: 'details', title: '分地区记录', blocks: siblings }] },
    { title: '', blocks: [chart({ title: '营业收入' })] },
  ] } }));
  assert.equal((html.match(/<strong>营业收入<\/strong>/g) ?? []).length, 2);
  assert.equal((html.match(/<caption[^>]*>营业收入<\/caption>/g) ?? []).length, 2);
  assert.equal((html.match(/<h3>营业收入<\/h3>/g) ?? []).length, 2);
  assert.match(html, /<summary>分地区记录<\/summary>/);
});
