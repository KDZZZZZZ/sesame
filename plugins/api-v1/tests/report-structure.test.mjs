import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderStructuredReport } from '../packages/reports/report-content.js';
import { renderReport } from '../packages/reports/report-provider.js';
import { createCapabilities } from '../packages/reports/index.js';

const content = { kind: 'document', sections: [{ title: 'Evidence', blocks: [{ type: 'paragraph', text: 'Supplied supporting evidence.' }] }] };
const base = { title: 'Synthetic research', lead: 'The supplied comparison supports the stated conclusion.', highlights: [{ label: 'Fixture result', value: 'Supplied' }], summary: 'Index-only description', locale: 'en', provenance_kind: 'demo', data: [], content };
const capability = (host, name) => createCapabilities(host).find(item => item.name === name).execute;
const fixed = (id, kind = 'report') => ({ id, kind, revision: 'fixture-v1', digest: `sha256:${'1'.repeat(64)}`, schemaVersion: '1.0.0' });

test('full reports require a title, explicit opening answer and nonempty body', async () => {
  for (const [change, path] of [[{ title: ' ' }, /title/], [{ lead: undefined }, /lead/], [{ lead: ' ' }, /lead/], [{ content: { kind: 'document', sections: [] } }, /sections/], [{ content: { kind: 'document', sections: [{ title: 'Empty', blocks: [] }] } }, /blocks/]]) {
    await assert.rejects(renderStructuredReport({}, { ...base, ...change }), path);
  }
});

test('opening answer is escaped, shown once after title and before chapters, never inferred from summary', async () => {
  const lead = 'Existing answer <script>unsafe()</script> & evidence';
  const html = await renderStructuredReport({}, { ...base, lead });
  assert.match(html, /class="report-lead"/);
  assert.match(html, /Existing answer &lt;script&gt;unsafe\(\)&lt;\/script&gt; &amp; evidence/);
  assert.equal((html.match(/Existing answer/g) ?? []).length, 1);
  assert.ok(html.indexOf('<h1>') < html.indexOf('class="report-lead"'));
  assert.ok(html.indexOf('class="report-lead"') < html.indexOf('<h2>Evidence'));
  assert.doesNotMatch(html, /Index-only description|<script>unsafe/);
});

test('answer components remain independent of the report skeleton', async () => {
  const component = { type: 'chart', kind: 'bar', rows: [{ item: 'A', value: 2 }], options: { x: 'item', y: 'value' } };
  const result = await capability({}, 'components_validate')({ target: 'answer', component });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  const html = await renderStructuredReport({}, { target: 'answer', content, data: [] });
  assert.doesNotMatch(html, /class="report-lead"/);
});

test('report convenience calls require lead before any publication side effect', async () => {
  const writes = [];
  const host = { context: { sessionId: 'fixture' }, capabilities: { invoke: async (id, request) => {
    writes.push({ id, request }); return { type: 'result', value: { ref: fixed('published') } };
  } } };
  const show = capability(host, 'components_show');
  const input = { title: base.title, operation_id: 'structure', component: content.sections[0].blocks[0] };
  await assert.rejects(show(input), /lead/);
  for (const title of [undefined, ' ']) {
    await assert.rejects(show({ ...input, title, lead: base.lead }), /title/);
    const validation = await capability(host, 'components_validate')({ title, lead: base.lead, content });
    assert.equal(validation.valid, false);
    assert.equal(validation.diagnostics[0].path, '/title');
  }
  assert.equal(writes.length, 0);
  await show({ ...input, lead: base.lead, highlights: base.highlights });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].request.input.lead, base.lead);
  assert.equal(writes[0].request.input.content.sections.length, 1);
});

test('fixed input and direct provider rendering enforce the same report structure', async () => {
  const inputRef = fixed('report-input', 'resource');
  let stored = { content }, publications = 0;
  const host = { resources: { read: async (_ref, request) => request.part === 'manifest'
    ? { blobs: [{ path: 'input.json', mediaType: 'application/json' }] }
    : { content: Buffer.from(JSON.stringify(stored)).toString('base64'), total: Buffer.byteLength(JSON.stringify(stored)) } },
  capabilities: { invoke: async () => { publications++; return { type: 'result', value: { ref: fixed('published') } }; } } };
  const args = { operation_id: 'fixed', title: base.title, input_ref: { ref: inputRef, entry: 'input.json' } };
  await assert.rejects(capability(host, 'components_show')(args), /lead/);
  assert.equal(publications, 0);
  const envelope = { metadata: { title: base.title, summary: base.summary, locale: 'en', provenanceKind: 'derived' }, data: [], related: [], references: [], input: stored };
  await assert.rejects(renderReport(host, envelope), /lead/);
  stored = { ...stored, lead: base.lead, highlights: base.highlights };
  const titleless = { ...args }; delete titleless.title;
  await assert.rejects(capability(host, 'components_show')(titleless), /title/);
  assert.equal(publications, 0);
  await capability(host, 'components_show')(args);
  assert.equal(publications, 1);
  const result = await renderReport(host, { ...envelope, input: stored });
  assert.match(result.files.find(file => file.path === 'index.html').content, /class="report-lead"/);
  stored = { content, target: 'answer' };
  await capability(host, 'components_show')(titleless);
  assert.equal(publications, 2, 'an answer input_ref needs neither external title nor lead');
});

test('discoverable full-report and answer examples validate through the actual tools', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/reports/capabilities.json', import.meta.url), 'utf8'));
  const writes = [];
  const host = { context: { sessionId: 'examples' }, capabilities: { invoke: async (_id, request) => {
    writes.push(request); return { type: 'result', value: { ref: fixed('example') } };
  } } };
  for (const name of ['components_validate', 'components_show']) {
    const examples = manifest.capabilities.find(item => item.id === name).inputSchema.examples;
    for (const [index, example] of examples.entries()) {
      const result = await capability(host, name)(example, undefined, { callId: `example-${index}` });
      if (name === 'components_validate') assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    }
  }
  assert.equal(writes.length, 2);
  assert.ok(writes[0].input.lead);
  assert.equal(writes[1].input.target, 'answer');
});
