import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderStructuredReport } from '../packages/reports/report-content.js';
import { renderReport } from '../packages/reports/report-provider.js';
import { createCapabilities } from '../packages/reports/index.js';
import { listComponents, describeComponents, getBlockSchema } from '../packages/reports/component-catalog.js';

// Synthetic presentation data, not market research or measured factor performance.
const content = { kind: 'document', sections: [{ title: 'Evidence', blocks: [{ type: 'paragraph', text: 'Supplied supporting evidence.' }] }] };
const highlights = [{ label: 'RankIC', value: 0.03 }, { label: 'Annual return', value: '+8%', tone: 'positive' }, { label: 'Significance', value: 'Not significant' }];
const base = { title: 'Synthetic results', lead: 'The supplied results need further observation.', highlights, content, data: [], provenance_kind: 'demo' };
const capability = (host, name) => createCapabilities(host).find(item => item.name === name).execute;
const fixed = (id, kind = 'report') => ({ id, kind, revision: 'fixture-v1', digest: `sha256:${'2'.repeat(64)}`, schemaVersion: '1.0.0' });

test('full reports require one to six explicitly supplied highlights', async () => {
  for (const value of [undefined, [], Array(7).fill(highlights[0]), [{ label: 'Value', value: NaN }], [{ label: 'Value', value: 1, note: 'Not a field' }]]) {
    await assert.rejects(renderStructuredReport({}, { ...base, highlights: value }), /highlights/);
  }
  for (const count of [1, 2, 6]) await renderStructuredReport({}, { ...base, highlights: Array(count).fill(highlights[0]) });
});

test('opening highlights reject blank labels and blank text values while retaining zero and body metric behavior', async () => {
  for (const item of [{ label: ' ', value: 1 }, { label: 'Result', value: '' }, { label: 'Result', value: ' \n ' }]) {
    await assert.rejects(renderStructuredReport({}, { ...base, highlights: [item] }), /highlights/);
    const result = await capability({}, 'components_validate')({ ...base, highlights: [item] });
    assert.equal(result.valid, false);
  }
  await renderStructuredReport({}, { ...base, highlights: [{ label: 'Zero', value: 0 }] });
  await renderStructuredReport({}, { target: 'answer', content: { kind: 'document', sections: [{ title: '', blocks: [{ type: 'metrics', items: [{ label: ' ', value: '' }] }] }] } });
});

test('opening highlights follow lead, precede sections and preserve escaped supplied values', async () => {
  const html = await renderStructuredReport({}, { ...base, highlights: [{ label: '<script>Label</script>', value: 'Not significant & uncertain' }, { label: 'Zero', value: 0 }] });
  const position = html.indexOf('class="report-metrics report-highlights"');
  assert.ok(position > html.indexOf('class="report-lead"'));
  assert.ok(position < html.indexOf('<h2>Evidence'));
  assert.match(html, /&lt;script&gt;Label&lt;\/script&gt;/);
  assert.match(html, /Not significant &amp; uncertain/);
  assert.match(html, /<dt>Zero<\/dt><dd>0<\/dd>/);
  assert.doesNotMatch(html, /<script>Label/);
});

test('inline and fixed reports reject missing highlights before publication, answer remains independent', async () => {
  const publications = [], inputRef = fixed('input', 'resource');
  let stored = { content, lead: base.lead };
  const host = { resources: { read: async (_ref, request) => request.part === 'manifest'
    ? { blobs: [{ path: 'input.json', mediaType: 'application/json' }] }
    : { content: Buffer.from(JSON.stringify(stored)).toString('base64'), total: Buffer.byteLength(JSON.stringify(stored)) } },
  capabilities: { invoke: async (_id, request) => { publications.push(request); return { type: 'result', value: { ref: fixed('published') } }; } } };
  const show = capability(host, 'components_show');
  const inline = { title: base.title, lead: base.lead, content, operation_id: 'inline' };
  await assert.rejects(show(inline), /highlights/);
  const checked = await capability(host, 'components_validate')({ title: base.title, lead: base.lead, content });
  assert.equal(checked.valid, false); assert.match(checked.diagnostics[0].path, /highlights/);
  const reference = { title: base.title, operation_id: 'fixed', input_ref: { ref: inputRef, entry: 'input.json' } };
  await assert.rejects(show(reference), /highlights/);
  await assert.rejects(renderReport(host, { metadata: { title: base.title, provenanceKind: 'derived' }, data: [], related: [], references: [], input: stored }), /highlights/);
  assert.equal(publications.length, 0);
  await show({ ...inline, highlights });
  assert.deepEqual(publications[0].input.highlights, highlights);
  stored = { ...stored, highlights }; await show(reference);
  stored = { target: 'answer', content }; await show({ operation_id: 'answer', input_ref: reference.input_ref });
  assert.equal(publications.length, 3);
  const answer = await renderStructuredReport({}, { target: 'answer', content });
  assert.doesNotMatch(answer, /class="report-metrics report-highlights"/);
});

test('the structural catalog exposes the actual highlights placement and shared metric item schema', () => {
  const listed = listComponents({ query: '首屏', limit: 100 });
  assert.ok(listed.items.some(item => item.id === 'report.highlights'));
  const [item] = describeComponents(['report.highlights']).items;
  assert.deepEqual(item.placement, ['highlights', 'input.highlights']);
  const expected = getBlockSchema('metrics').properties.items.items;
  Object.assign(expected.properties.label, { minLength: 1, pattern: '\\S' });
  Object.assign(expected.properties.value, { minLength: 1, pattern: '\\S' });
  assert.deepEqual(item.inputSchema.items, expected, 'opening items share the metric contract and only narrow empty strings');
  assert.equal(item.inputSchema.minItems, 1); assert.equal(item.inputSchema.maxItems, 6);
  assert.ok(Array.isArray(item.example));
});

test('highlight grid is borderless, keeps financial tones and fits desktop and narrow viewports', { skip: !process.env.SESAME_HOST_ROOT, timeout: 30000 }, async t => {
  const { chromium } = createRequire(join(process.env.SESAME_HOST_ROOT, 'package.json'))('playwright');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  for (const width of [1000, 390]) for (const count of [1, 2, 6]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(await renderStructuredReport({}, { ...base, highlights: Array.from({ length: count }, (_, index) => ({ label: `Result ${index + 1}`, value: index === 0 ? 'Not significant' : index, ...(index === 1 ? { tone: 'positive' } : index === 2 ? { tone: 'negative' } : {}) })) }));
    const layout = await page.locator('.report-highlights').evaluate(element => {
      const style = getComputedStyle(element), metric = element.querySelector('.report-metric');
      return { columns: style.gridTemplateColumns.split(' ').length, border: getComputedStyle(metric).borderTopWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        tones: [...element.querySelectorAll('dd')].map(node => getComputedStyle(node).color) };
    });
    assert.equal(layout.columns, width === 1000 ? Math.min(count, 3) : Math.min(count, 2));
    assert.equal(layout.border, '0px'); assert.equal(layout.overflow, false);
    if (count === 6) { assert.notEqual(layout.tones[0], layout.tones[1]); assert.notEqual(layout.tones[1], layout.tones[2]); }
  }
});
