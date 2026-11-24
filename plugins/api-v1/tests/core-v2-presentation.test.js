import {readPackageDirectory} from '../../protocol/directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCapabilities as reports } from '../packages/reports/index.js';
import { createCapabilities as canvas } from '../packages/canvas-control/index.js';
import { resourceHost } from './core-v2-fixture.mjs';
const table = capabilities => new Map(capabilities.map(item => [item.name, item.execute]));

test('core tool factories exactly implement declared API 2 names without legacy factories', async () => {
  for (const name of ['plugin-manager', 'workspace', 'data-access', 'reports', 'research', 'canvas-control']) {
    const root = new URL(`../packages/${name}/`, import.meta.url), declared = readPackageDirectory(new URL('.', root)).capabilities, implementation = await import(new URL('index.js', root));
    assert.equal(implementation.createTools, undefined);
    const capabilities = implementation.createCapabilities({ context: { filePolicy: { protectedRoots: [], readRoots: [], writeRoots: [] } } });
    assert.deepEqual(capabilities.map(item => item.name).sort(), declared.capabilities.map(item => item.binding.name).sort());
    assert.ok(capabilities.every(item => typeof item.execute === 'function'));
  }
});

test('canvas fixes source and actual connection revisions and routes CAS without legacy host ports', async () => {
  const source = { providerId: 'fixture/market#market', revision: 'fixed', binding: { configuration: { region: 'x' } } }, connection = { id: 'real', revision: '7' }, instrument = { sourceId: 'real', instrumentId: 'A' }, calls = [];
  const host = { data: {
    sources: () => ({ items: [{ ref: { providerId: source.providerId, revision: 'fixed' }, available: true, operations: { queryBars: 'history' }, configSchema: { properties: { connection: {} } } }] }),
    query: async input => { calls.push(input);return { items: [{ ref: instrument, symbol: 'A', features: { timeframes: ['1h'], priceBases: ['last'], adjustments: ['none'], sessions: ['regular'] } }], metadata: { connection } }; },
  }, views: { apply: input => { calls.push(input); if (input.expectedVersion === 1) throw Object.assign(Error('changed'), { code: 'VERSION_CONFLICT' }); return { version: 3, render_status: 'pending' }; } } };
  const tools = table(canvas(host));
  const value = await tools.get('canvas_binding')({ source, instrument, timeframe: '1h' });
  assert.deepEqual(value.binding.source, { ...source, binding: { ...source.binding, connection } });assert.equal(value.binding.provider, undefined);assert.equal(value.validation.rendered, false);
  assert.equal(value.binding.spec.calendarRevision.status, 'unknown');
  await assert.rejects(tools.get('canvas_binding')({ source: { ...source, revision: 'stale' }, instrument, timeframe: '1h' }), { code: 'STALE_REVISION' });
  await assert.rejects(tools.get('canvas_apply')({ command_id: 'same', expected_version: 1, operations: [] }), { code: 'VERSION_CONFLICT' });
  const applied = await tools.get('canvas_apply')({ command_id: 'same', expected_version: 2, operations: [{ op: 'add', chart: value.chart }] });
  assert.equal(applied.render_status, 'pending');assert.equal(calls.at(-1).commandId, 'same');assert.equal(calls.at(-1).expectedVersion, 2);
});

test('indicator publication packages actual code and refuses absent entry/dependency', async () => {
  const f = resourceHost(), root = new URL('../packages/canvas-control/resources/', import.meta.url);
  const definition = JSON.parse(await readFile(new URL('close-line.json', root), 'utf8')), code = await readFile(new URL('close-line.js', root), 'utf8'), publish = table(canvas(f.host)).get('indicator_publish');
  await assert.rejects(publish({ operation_id: 'missing', definition, files: {} }), /entry file/);
  const result = await publish({ operation_id: 'actual', definition, files: { 'close-line.js': code } });
  assert.equal(f.artifacts.get(result.ref.id).bytes.get('close-line.js').toString(), code);
  assert.equal(result.ref.kind, 'indicator');
  const bad = structuredClone(definition);bad.implementation.entry = '../escape.js';
  await assert.rejects(publish({ operation_id: 'escape', definition: bad, files: { '../escape.js': code } }), /relative/);
});

test('Report provider preserves evidence and delegates provenance/CAS to host publication, then inspects separately', async t => {
  const root = await mkdtemp(join(tmpdir(), 'v2-report-'));t.after(() => rm(root, { recursive: true, force: true }));
  const f = resourceHost({ workspaceRoot: root }), checks = [];
  f.host.views = { inspect: (input, options) => { checks.push([input, options]);return { valid: true, inspected: input.ref }; } };
  await writeFile(join(root, 'report.html'), '<!doctype html><html><body><main>Demo source</main></body></html>');
  const originalEvidence = JSON.stringify({ observed: '1.010000000000000001', quotedText: '<script>literal evidence only</script>' });
  await writeFile(join(root, 'evidence.json'), originalEvidence);
  const raw = await f.host.resources.create({ kind: 'file', source: { content: '[{"value":"1.01"}]' } });
  const data = (await f.host.resources.publish(raw, { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', provenance: { kind: 'demo' } }, blobs: [{ path: 'rows.json' }] })).ref;
  const tools = table(reports(f.host)), input = { operation_id: 'report', title: 'Supplied content', summary: 'Fixture',
    content: { kind: 'document', sections: [{ title: '合成判断', blocks: [{ type: 'paragraph', text: 'Demo source <script>literal only</script>' }] }] },
    provenance_kind: 'demo', data: [{ id: 'data', ref: data, usage: 'fixed evidence' }],
    assets: [{ path: 'evidence.json', source_path: 'evidence.json', media_type: 'application/json' }], artifact_id: 'updated-report', expected_revision: 'older' };
  await assert.rejects(tools.get('components_show')({ ...input, html_path: 'report.html' }), /html_path|HTML|Unsupported/i);
  await assert.rejects(tools.get('components_show')({ ...input, body_html: '<h1>Custom markup</h1>' }), /body_html|HTML|Unsupported/i);
  let delegated;const expected={ref:{id:'updated-report',revision:'new',digest:'sha256:'+'f'.repeat(64),kind:'report',schemaVersion:'1.0.0'},renderStatus:'not_checked'};
  f.host.capabilities={invoke:async(id,args)=>{assert.equal(id,'host.reports.publish');delegated=args;return {type:'result',value:expected};}};
  const result = await tools.get('components_show')(input);
  assert.equal(result.ref.id, 'updated-report');assert.equal(result.renderStatus, 'not_checked');assert.equal(checks.length, 0);
  assert.equal(delegated.artifactId,'updated-report');assert.equal(delegated.expectedRevision,'older');assert.equal(delegated.provenanceKind,'demo');assert.deepEqual(delegated.data,input.data);
  const packaged=await tools.get('report_render')({metadata:{title:input.title,summary:input.summary,locale:'en',provenanceKind:'demo',features:['interactive']},data:input.data,related:[],references:[],input:delegated.input});
  const html=packaged.files.find(file=>file.path==='index.html').content;
  assert.match(html, /data-sesame-provenance="demo"/);
  assert.match(html, /Demo source &lt;script&gt;literal only&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>literal only/);
  const evidence=packaged.files.find(file=>file.path==='evidence.json');
  assert.equal(Buffer.from(evidence.content,evidence.encoding).toString(),originalEvidence);
  assert.equal(f.publications.filter(item=>item.kind==='report').length,0,'only the host publication service owns report artifacts');
  const controller = new AbortController(), inspected = await tools.get('report_check')({ ref: result.ref }, controller.signal);
  assert.deepEqual(inspected.inspected, result.ref);assert.equal(checks[0][0].surface, 'artifact');assert.equal(checks[0][1].signal, controller.signal);
});

test('Report consumes prepared content without interpreting strategy sources or executing research', async () => {
  const f = resourceHost();
  const raw = await f.host.resources.create({ kind: 'file', source: { content: 'Opaque producer-owned strategy bytes' } });
  const ref = (await f.host.resources.publish(raw, { kind: 'strategy.source', schemaVersion: '1.0.0', content: { sourcePath: 'source.json' }, blobs: [{ path: 'source.json' }] })).ref;
  const reads = [], read = f.host.resources.read;
  f.host.resources.read = async (reference, request) => { reads.push(request); return read(reference, request); };
  f.host.capabilities = { invoke: () => assert.fail('Rendering cannot start a research or strategy capability') };
  const rendered = await table(reports(f.host)).get('report_render')({
    metadata: { title: 'Supplied strategy result', summary: '', locale: 'en', provenanceKind: 'demo', features: [] },
    data: [], related: [], references: [ref], input: { content: { kind: 'document', sections: [{ title: '', blocks: [{ type: 'paragraph', text: 'The producer supplied this result.' }] }] } },
  });
  assert.match(rendered.files.find(file => file.path === 'index.html').content, /The producer supplied this result/);
  assert.ok(reads.every(request => request.part === 'manifest'), 'Report must not parse producer-owned strategy source bytes');
});
