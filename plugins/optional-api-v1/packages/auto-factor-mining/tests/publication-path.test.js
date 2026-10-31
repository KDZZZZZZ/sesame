import test from 'node:test';
import assert from 'node:assert/strict';
import { publishWorkflowReport } from '../report-publication.js';
import { reportDescription } from './workflow-report-fixture.mjs';

const ref = { id: 'synthetic-report', revision: 'fixture-v1', digest: `sha256:${'1'.repeat(64)}`, kind: 'report', schemaVersion: '1.0.0' };
const input = { operationId: 'path-boundary', title: 'Fixture', summary: 'Fixed document',
  content: { kind: 'document', sections: [{ title: 'Synthetic result', blocks: [{ type: 'paragraph', text: 'Fixture <literal>' }] }] },
  style: { custom: { reason: 'User requests a wider readable layout', tokens: { content_width: 1120 } } } };
const failure = code => Object.assign(new Error(code), { code });
const result = value => ({ type: 'result', value });
const describe = (id, next) => id === 'host.reports.describe' ? result(reportDescription()) : next();

test('workflow checks selected provider, publishes structured content and persists exact ref before inspection', async () => {
  const calls = [], saved = [], original = structuredClone(input);
  const host = { capabilities: { invoke: async (id, args, options) => {
    calls.push({ id, args, options });
    return describe(id, () => {
      if (id.endsWith('#report_publish')) return result({ ref, renderStatus: 'not_checked' });
      assert.equal(id, 'sesame/reports#report_check');
      assert.equal(saved.length, 1, 'Persist the publication before a potentially failing inspection');
      throw failure('INSPECTION_INTERRUPTED');
    });
  } } };
  const signal = new AbortController().signal;
  await assert.rejects(publishWorkflowReport(host, { ...input, signal, onPublication: value => saved.push(value) }), { code: 'INSPECTION_INTERRUPTED' });
  assert.deepEqual(calls.map(call => call.id), ['host.reports.describe', 'sesame/reports#report_publish', 'sesame/reports#report_check']);
  assert.deepEqual(calls[1].args.content, original.content);
  assert.deepEqual(calls[1].args.style, original.style);
  assert.equal(calls[1].args.operation_id, input.operationId);
  assert.equal(calls[1].options.signal, signal);
  assert.equal(Object.hasOwn(calls[1].args, 'html_path'), false);
  assert.equal(Object.hasOwn(calls[1].args, 'body_html'), false);
  assert.deepEqual(calls[2].args, { ref });
  assert.deepEqual(saved[0], { ref, entry: 'index.html', attachments: [], state: 'published', renderStatus: 'not_checked' });
  assert.deepEqual(input, original);
});

test('legacy HTML-only input is rejected without any service or template fallback', async () => {
  const host = { capabilities: { invoke: () => assert.fail('Legacy HTML must not reach a publisher') } };
  await assert.rejects(publishWorkflowReport(host, { operationId: 'old-input', title: 'Old', summary: 'Fixture', bodyHTML: '<p>Old custom page</p>' }), { code: 'INVALID_REPORT_CONTENT' });
});

test('unsupported selected provider or changed schema preserves results without writes or fallback', async () => {
  for (const change of [description => { description.provider.pluginId = 'custom/report'; },
    description => { description.inputSchema.$id = 'custom/input/2'; },
    description => { description.inputSchema.properties.content.oneOf = [{ properties: { kind: { const: 'different' } } }]; }]) {
    const description = reportDescription(); change(description); const calls = [];
    const host = { capabilities: { invoke: async (id, args) => { calls.push({ id, args }); assert.equal(id, 'host.reports.describe'); return result(description); } } };
    await assert.rejects(publishWorkflowReport(host, { ...input, attachments: [{ path: 'run.json', mediaType: 'application/json', content: '{}' }] }), error => error.code === 'REPORT_PROVIDER_UNSUPPORTED' && /never changes host provider settings/.test(error.message));
    assert.deepEqual(calls, [{ id: 'host.reports.describe', args: {} }]);
  }
});

test('attachment bytes use owned paths and never follow a returned workspace path', async () => {
  const calls = [], bytes = JSON.stringify({ original: '9007199254740993.0000001' });
  const host = { capabilities: { invoke: async (id, args) => describe(id, () => {
    calls.push({ id, args });
    if (id === 'sesame/workspace#write') return result({ path: '/unrelated/returned-path.json' });
    assert.equal(id, 'sesame/reports#report_publish'); throw failure('PUBLICATION_REACHED');
  }) } };
  await assert.rejects(publishWorkflowReport(host, { ...input, attachments: [{ path: 'run.json', mediaType: 'application/json', content: bytes }] }), { code: 'PUBLICATION_REACHED' });
  assert.equal(calls.length, 2); assert.equal(calls[0].args.content, bytes);
  assert.match(calls[0].args.path, /^workflow-reports\/[a-f0-9]{64}\/run\.json$/);
  assert.deepEqual(calls[1].args.assets, [{ path: 'run.json', media_type: 'application/json', source_path: calls[0].args.path }]);
  assert.equal(JSON.stringify(calls[1].args).includes('/unrelated/returned-path'), false);
});

test('escaping, reserved and duplicate attachment paths cannot reach publication', async () => {
  for (const paths of [['../escape.json'], ['/outside.json'], ['folder/run.json'], ['index.html'], ['report.html'], ['run.json', 'run.json']]) {
    const host = { capabilities: { invoke: async (id, args) => describe(id, () => {
      assert.equal(id, 'sesame/workspace#write'); return result({ path: args.path });
    }) } };
    await assert.rejects(publishWorkflowReport(host, { ...input, attachments: paths.map(path => ({ path, mediaType: 'application/json', content: '{}' })) }), { code: 'INVALID_REPORT_DOCUMENT' });
  }
});

test('unknown publication outcome does not fabricate a ref or proceed to inspection', async () => {
  let publications = 0, saves = 0;
  const host = { capabilities: { invoke: async id => describe(id, () => {
    publications++; assert.equal(id, 'sesame/reports#report_publish'); return result({ path: 'unverified.html' });
  }) } };
  await assert.rejects(publishWorkflowReport(host, { ...input, onPublication: () => saves++ }), { code: 'REPORT_PUBLICATION_UNKNOWN' });
  assert.equal(publications, 1); assert.equal(saves, 0);
});

test('retained publication rechecks its exact revision even if current provider changed, without rerunning or republishing', async () => {
  const saved = { ref, entry: 'index.html', attachments: [], state: 'published', renderStatus: 'not_checked' }, calls = [];
  const receipt = { artifact: ref, renderer: { name: 'sesame-report-inspector' }, observedAt: 20, status: 'rendered' };
  const host = {
    capabilities: { invoke: async (id, args) => { calls.push({ id, args }); assert.equal(id, 'sesame/reports#report_check', 'Do not select a new provider or republish a retained report'); return result({ valid: true }); } },
    resources: { read: async (selected, { part }) => {
      assert.deepEqual(selected, ref);
      if (part === 'manifest') return { kind: 'report', schemaVersion: '1.0.0', content: { runtime: 'sesame-report/1', runtimeRevision: '1.0.0' } };
      if (part === 'metadata') return { ref, producer: { id: 'sesame/reports' } };
      assert.equal(part, 'receipts'); return { items: [receipt] };
    } },
  };
  const actual = await publishWorkflowReport(host, { ...input, publication: saved, onPublication: () => assert.fail('A retained report is not a new write') });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].args, { ref });
  assert.equal(actual.renderStatus, 'rendered'); assert.deepEqual(actual.inspection, receipt);
  receipt.status = 'failed';
  await assert.rejects(publishWorkflowReport(host, { ...input, publication: saved }), { code: 'REPORT_NOT_RENDERED' });
});


test('default presentation leaves style to the provider instead of sending removed preset/theme controls', async () => {
  const { style, ...defaults } = input;
  const host = { capabilities: { invoke: async (id, args) => describe(id, () => {
    assert.equal(id, 'sesame/reports#report_publish'); assert.equal(Object.hasOwn(args, 'style'), false);
    throw failure('DEFAULT_STYLE_CHECKED');
  }) } };
  await assert.rejects(publishWorkflowReport(host, defaults), { code: 'DEFAULT_STYLE_CHECKED' });
});
