import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCapabilities } from '../packages/reports/index.js';
import { listComponents } from '../packages/reports/component-catalog.js';
import { renderStructuredReport } from '../packages/reports/report-content.js';

const readJSON = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const document = blocks => ({ kind: 'document', sections: [{ title: '', blocks }] });
const args = content => ({ title: 'Supplied results', lead: 'The supplied results support this comparison.', content, data: [], provenance_kind: 'derived', locale: 'en' });

test('Reports exposes one visual publication path and only generic document input', async () => {
  const manifest = await readJSON('../packages/reports/capabilities.json');
  const ids = ['components_list', 'components_describe', 'components_validate', 'components_show', 'report_render',
    'report_read', 'report_prepare', 'report_check', 'report_export_check', 'report_styles', 'report_style_save'].sort();
  assert.deepEqual(manifest.capabilities.map(item => item.id).sort(), ids);
  assert.deepEqual(createCapabilities({}).map(item => item.name).sort(), ids);
  const provider = manifest.capabilities.find(item => item.id === 'report_render').inputSchema.properties.input;
  assert.deepEqual(Object.keys(provider.properties).sort(), ['assets', 'content', 'lead', 'style', 'target']);
  assert.equal(provider.properties.content.properties.kind.const, 'document');
  assert.deepEqual(Object.keys(provider.properties.content.properties).sort(), ['kind', 'sections']);
  const catalog = listComponents({ limit: 100 });
  assert.equal(catalog.items.filter(item => item.id.startsWith('chart.')).length, 38);
  assert.equal(catalog.items.filter(item => item.id.startsWith('block.')).length, 15);
});

test('generic judgments do not invent research fields or duplicate explanatory slots', async () => {
  const html = await renderStructuredReport({}, args(document([
    { type: 'judgments', items: [{ label: 'Capacity', value: 'Sufficient' }] },
    { type: 'markdown', text: '**Supplied explanation.**' },
  ])));
  assert.match(html, /Capacity/); assert.match(html, /Sufficient/);
  assert.doesNotMatch(html, /Change conditions|Historical reference|Data and definitions|分项判断|依据|改判/);
  assert.equal(html.match(/Supplied explanation\./g)?.length, 1);
  for (const content of [ { kind: 'backtest' }, { kind: 'modules' }, { kind: 'signal-study' },
    { ...document([]), overview: {} }, { ...document([]), appendix: [] } ]) {
    await assert.rejects(renderStructuredReport({}, args(content)));
  }
});

test('historical fixed reports are read and inspected without reinterpreting old input', async () => {
  const ref = { id: 'historic-report', revision: 'r1', digest: `sha256:${'b'.repeat(64)}`, kind: 'report', schemaVersion: '1.0.0' };
  const calls = [], metadata = { title: 'Existing report', presentation: { version: '5.2.0' } };
  const host = { resources: { read: async (actual, request) => {
    assert.deepEqual(actual, ref); calls.push(request.part);
    return request.part === 'metadata' ? metadata : request.part === 'receipts' ? { items: [] } : { entry: 'index.html', blobs: [{ path: 'index.html' }] };
  } }, views: { inspect: async request => { assert.deepEqual(request.ref, ref); return request.surface; } } };
  const capabilities = new Map(createCapabilities(host).map(item => [item.name, item.execute]));
  assert.equal((await capabilities.get('report_read')({ ref, include_checks: true })).title, metadata.title);
  assert.deepEqual(calls, ['manifest', 'metadata', 'receipts']);
  assert.equal(await capabilities.get('report_check')({ ref }), 'artifact');
  assert.equal(await capabilities.get('report_export_check')({ ref }), 'report-export');
});
