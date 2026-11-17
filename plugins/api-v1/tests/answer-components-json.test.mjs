import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLock } from '../scripts/plugin-lock.mjs';
import { describeComponents } from '../packages/reports/component-catalog.js';

const hostRoot = process.env.SESAME_HOST_ROOT;
const packageRoot = fileURLToPath(new URL('../packages/reports/', import.meta.url));
const component = { type: 'chart', kind: 'line', rows: [{ day: 'Mon', price: 2 }, { day: 'Tue', price: 3 }], options: { x: 'day', y: 'price' } };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'component-json-test-'));
  const source = join(directory, 'source'), bundle = join(directory, 'bundle');
  await mkdir(join(source, 'packages'), { recursive: true });
  await cp(packageRoot, join(source, 'packages', 'reports'), { recursive: true });
  const lock = buildLock(source);
  await cp(join(source, 'packages', 'reports'), join(bundle, 'reports'), { recursive: true });
  await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock));
  const load = path => import(pathToFileURL(join(hostRoot, path)).href);
  const [{ Store }, { Runtime }, { createHostContextV2 }] = await Promise.all([
    load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('modules/plugins/host-v2/context.js'),
  ]);
  const store = new Store(join(directory, 'state'));
  const runtime = new Runtime(store, { officialPluginsDirectory: bundle, piDir: join(directory, 'pi') });
  t.after(async () => { await runtime.close(); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  await runtime.init();
  const entry = runtime.plugins.entry('sesame/reports');
  assert.equal(entry.runtime_status, 'ready', JSON.stringify(entry.diagnostics));
  const context = createHostContextV2(runtime, entry, 'conv_main');
  const host = { ...context, resources: { ...context.resources }, state: { ...context.state } };
  const { createCapabilities } = await import(new URL('../packages/reports/index.js', import.meta.url));
  const tools = createCapabilities(host);
  const call = (name, args, callId = crypto.randomUUID()) => {
    const tool = tools.find(item => item.name === name);
    assert.ok(tool, name + ' is available');
    return tool.execute(args, undefined, { callId });
  };
  const fixed = (kind, content, bytes, path) => runtime.contractArtifacts.publish({ id: entry.id, version: entry.version, digest: entry.digest }, { operationId: crypto.randomUUID(), manifest: {
    kind, schemaVersion: '1.0.0', content, dependencies: [], blobs: [{ ...runtime.contractArtifacts.blob(bytes), path, mediaType: 'application/json' }],
  } });
  return { runtime, store, host, call, fixed };
}

test('answer content is fixed JSON and stateless rendering never creates a report', { skip: !hostRoot, timeout: 30000 }, async t => {
  const app = await fixture(t);
  const request = { target: 'answer', component, title: 'Closing prices', provenance_kind: 'user_input' };
  const result = await app.call('components_show', request, 'answer-one');
  assert.equal(result.ref.kind, 'resource');
  assert.deepEqual(result.componentRef.ref, result.ref);
  const artifact = app.runtime.contractArtifacts.read(result.ref);
  assert.deepEqual(artifact.manifest.content, { type: 'component-json', protocol: 'sesame-components/1', path: 'component.json', title: 'Closing prices', renderer: 'sesame/reports#components_render', provenance: { kind: 'user_input' } });
  assert.deepEqual(artifact.manifest.blobs.map(blob => blob.path), ['component.json']);
  const saved = JSON.parse(app.runtime.contractArtifacts.resource(result.ref, 'component.json').bytes);
  assert.equal(saved.input.target, 'answer');
  assert.deepEqual(saved.input.content.sections[0].blocks[0].rows, component.rows);
  assert.deepEqual((await app.call('components_show', request, 'answer-one')).ref, result.ref);
  assert.notEqual((await app.call('components_show', request, 'answer-two')).ref.id, result.ref.id);
  await assert.rejects(app.call('components_show', { ...request, title: 'Changed under same call' }, 'answer-one'), { code: 'IDEMPOTENCY_CONFLICT' });
  const counts = ['contract_artifact', 'report', 'revision', 'report_library_entry'].map(kind => [kind, app.store.list(kind).length]);
  const first = await app.call('components_render', { ref: result.ref });
  const second = await app.call('components_render', { ref: result.ref });
  assert.deepEqual(first, second);
  assert.equal(first.title, request.title);
  assert.match(first.files.find(file => file.path === first.entry).content, /content-chart-1/);
  assert.deepEqual(['contract_artifact', 'report', 'revision', 'report_library_entry'].map(kind => [kind, app.store.list(kind).length]), counts);
  assert.equal(app.store.list('report').length, 0);
  assert.equal(app.store.list('revision').length, 0);
  assert.equal(app.store.list('report_library_entry').length, 0);
});

test('fixed input, data rows and graph nodes are materialized and preserve their dependencies', { skip: !hostRoot, timeout: 30000 }, async t => {
  const app = await fixture(t);
  const graph = structuredClone(describeComponents(['chart.network-force']).items[0].example);
  const data = (id, rows) => app.fixed('data', { format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: [...new Set(rows.flatMap(Object.keys))], provenance: { kind: 'user_input', title: id } }, Buffer.from(JSON.stringify(rows)), 'rows.json');
  const edges = data('Edges', graph.rows), nodes = data('Nodes', graph.nodes);
  const original = { target: 'answer', content: { kind: 'document', sections: [{ title: '', blocks: [{ ...graph, rows: undefined, nodes: undefined, data_id: 'edges', chart_data: [{ property: 'nodes', data_id: 'nodes' }] }] }] } };
  const input = app.fixed('resource', { type: 'fixture' }, Buffer.from(JSON.stringify(original)), 'input.json');
  const shown = await app.call('components_show', { input_ref: { ref: input, entry: 'input.json' }, data: [
    { id: 'edges', ref: edges, usage: 'Fixed graph edges' }, { id: 'nodes', ref: nodes, usage: 'Fixed graph nodes' },
  ] });
  const saved = JSON.parse(app.runtime.contractArtifacts.resource(shown.ref, 'component.json').bytes);
  const chart = saved.input.content.sections[0].blocks[0];
  assert.deepEqual(chart.rows, graph.rows); assert.deepEqual(chart.nodes, graph.nodes);
  assert.equal(chart.data_id, undefined); assert.equal(chart.chart_data, undefined);
  assert.deepEqual(app.runtime.contractArtifacts.read(shown.ref).manifest.dependencies, [edges, nodes, input]);
  const read = app.host.resources.read;
  app.host.resources.read = async (ref, options) => { assert.deepEqual(ref, shown.ref, 'Rendering needs only the fixed component snapshot'); return read(ref, options); };
  const view = await app.call('components_render', { ref: shown.ref });
  assert.match(view.files[0].content, /network-force/);
  assert.equal(app.store.list('report').length, 0);
});

test('demo components retain provenance when reused and cannot be relabelled observed', { skip: !hostRoot, timeout: 30000 }, async t => {
  const app = await fixture(t);
  const source = await app.call('components_show', { target: 'answer', component, provenance_kind: 'demo' });
  for (const relation of [{ references: [source.ref] }, { related: [{ role: 'source', artifact: source.ref }] }]) {
    const request = { target: 'answer', component, ...relation };
    const shown = await app.call('components_show', request);
    const saved = JSON.parse(app.runtime.contractArtifacts.resource(shown.ref, 'component.json').bytes);
    assert.equal(saved.metadata.provenanceKind, 'demo', 'A reused demo component must keep demo provenance');
    assert.equal(app.runtime.contractArtifacts.read(shown.ref).manifest.content.provenance.kind, 'demo');
    const view = await app.call('components_render', { ref: shown.ref });
    assert.match(view.files.find(file => file.path === view.entry).content, /data-sesame-provenance="demo"/);
    const before = app.store.list('contract_artifact').length;
    await assert.rejects(app.call('components_show', { ...request, provenance_kind: 'observed' }), /Fixed demo data must retain demo provenance/);
    assert.equal(app.store.list('contract_artifact').length, before, 'Relabelling is rejected before publication');
  }
  assert.equal(app.store.list('report').length, 0);
});

test('workspace attachments and saved style survive without workspace files or style state', { skip: !hostRoot, timeout: 30000 }, async t => {
  const app = await fixture(t), source = join(app.host.context.workspaceRoot, 'component-fixture.csv');
  await writeFile(source, 'label,value\nA,3\n');
  await app.call('report_style_save', { operation_id: 'style-fixture', id: 'test-style', title: 'Fixture', description: 'Testing saved style',
    style: { reason: 'Fixture style', tokens: { chart_height: 380 } } });
  const shown = await app.call('components_show', { target: 'answer', provenance_kind: 'user_input', style: { saved_id: 'test-style', saved_version: 1 },
    component: { type: 'attachments', items: [{ label: 'Supplied rows', path: 'data/counts.csv' }] }, assets: [{ path: 'data/counts.csv', media_type: 'text/plain', source_path: 'component-fixture.csv' }] });
  await rm(source);
  const saved = JSON.parse(app.runtime.contractArtifacts.resource(shown.ref, 'component.json').bytes);
  assert.deepEqual(saved.input.assets, [{ path: 'data/counts.csv', media_type: 'text/plain' }]);
  assert.equal(saved.input.style.custom.tokens.chart_height, 380);
  app.host.state.read = async () => assert.fail('Rendering must use frozen style tokens');
  const view = await app.call('components_render', { ref: shown.ref });
  assert.equal(Buffer.from(view.files.find(file => file.path === 'data/counts.csv').content, 'base64').toString(), 'label,value\nA,3\n');
  assert.deepEqual(app.runtime.contractArtifacts.read(shown.ref).manifest.blobs.map(blob => blob.path), ['component.json', 'data/counts.csv']);
  assert.equal(app.store.list('report').length, 0);
});

test('legacy answer reports render read-only while ordinary reports stay ordinary', { skip: !hostRoot, timeout: 30000 }, async t => {
  const app = await fixture(t);
  const shown = await app.call('components_show', { target: 'report', component, title: 'Ordinary report', lead: 'Closing prices rose from two to three.', highlights: [{ label: 'Change', value: '+1' }], provenance_kind: 'user_input' });
  assert.equal(shown.ref.kind, 'report');
  await assert.rejects(app.call('components_render', { ref: shown.ref }), /Expected a fixed answer component/);
  const original = { metadata: { title: 'Legacy chart', summary: '', locale: 'en', provenanceKind: 'user_input', features: ['interactive'] }, data: [], related: [], references: [],
    input: { target: 'answer', content: { kind: 'document', sections: [{ title: '', blocks: [component] }] } } };
  const legacy = (await app.host.capabilities.invoke('host.reports.publish', { operationId: 'legacy-fixture', ...original.metadata, data: [], input: original.input })).value.ref;
  const counts = ['contract_artifact', 'report', 'revision', 'report_library_entry'].map(kind => [kind, app.store.list(kind).length]);
  const rendered = await app.call('components_render', { ref: legacy });
  assert.equal(rendered.title, 'Legacy chart');
  assert.match(rendered.files[0].content, /content-chart-1/);
  assert.deepEqual(['contract_artifact', 'report', 'revision', 'report_library_entry'].map(kind => [kind, app.store.list(kind).length]), counts);
});
