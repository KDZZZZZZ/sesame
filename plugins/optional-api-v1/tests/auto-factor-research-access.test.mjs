import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCapabilities } from '../packages/abu-parameter-search/index.js';
import { evaluate } from '../packages/factor-evaluator/evaluator.js';
import { fixture, input, finished, poll, iso, rows } from '../packages/auto-factor-mining/tests/host-fixture.js';

const packageUrl = name => new URL(`../packages/${name}/`, import.meta.url);
const load = (name, file) => JSON.parse(fs.readFileSync(new URL(file, packageUrl(name)), 'utf8'));
function installMethods(f) {
  for (const name of ['ict', 'abu-parameter-search']) {
    const plugin = load(name, 'plugin.json'), manifest = load(name, 'capabilities.json');
    f.manifests.set(plugin.id, { ...manifest, id: plugin.id, version: plugin.version, revision: `fixture:${name}:${plugin.version}` });
  }
}
function artifactHost() {
  const created = new Map(), published = new Map(), removed = [], calls = [];
  const resources = {
    async create(spec) {
      calls.push('create'); assert.equal(spec.kind, 'blob'); assert.equal(typeof spec.source.content, 'string');
      const ref = { id: `own_blob_${created.size}`, kind: 'blob', version: 1 };
      created.set(ref.id, { ref, spec: structuredClone(spec) }); return ref;
    },
    async publish(ref, manifest) {
      calls.push('publish'); assert.deepEqual(ref, created.get(ref.id)?.ref, 'Only this invocation\'s own blob can be published');
      assert.ok((manifest.dependencies ?? []).every(item => published.has(item.id)), 'Only own evidence may become a dependency');
      const artifact = { id: `own_artifact_${published.size}`, revision: '1', kind: 'data', schemaVersion: '1.0.0', digest: `sha256:${'a'.repeat(64)}` };
      published.set(artifact.id, { source: ref.id, rows: JSON.parse(created.get(ref.id).spec.source.content), manifest });
      return { ref: artifact };
    },
    async remove(ref, options) {
      calls.push('remove'); assert.deepEqual(ref, created.get(ref.id)?.ref, 'Cannot delete pre-existing resources');
      assert.ok([...published.values()].some(item => item.source === ref.id), 'Remove only after publishing');
      assert.deepEqual(options, { mode: 'permanent', expectedVersion: 1 }); removed.push(ref.id);
    },
  };
  const denied = (target, name) => { if (Object.hasOwn(target, name)) return target[name]; assert.fail(`Unexpected host access: ${String(name)}`); };
  return { host: new Proxy({ resources: new Proxy(resources, { get: denied }) }, { get: denied }), created, published, removed, calls };
}
const own = (t, f) => { t.after(() => f.runtime.dispose()); return f; };

test('real independent knowledge plus real parameter calculation retains holdout and completes the native workflow', async t => {
  const accesses = [], artifacts = artifactHost(); let calculations = 0;
  const f = own(t, await fixture({ evaluator: evaluate, onEvaluate: args => { if (args.action === 'prepare') accesses.push(args.access); },
    onTask: async ({ request, child, execution, runtime }) => {
      const context = runtime.context(child, request.input.runId, 'data', 0, 200, execution);
      assert.equal(context.config.evaluator.arguments, undefined);
      for (const name of ['inputRefs', 'sourceId', 'provenance', 'dependencies']) assert.equal(context.data[name], undefined);
      assert.ok(context.rows.items.every(row => row.time <= iso(9)));
      if (request.input.mode !== 'hypothesis') return;
      assert.ok(request.allowedCalls.some(call => call.pluginId === 'sesame/abu-parameter-search' && call.capabilityId === 'abu_parameter_search_analyze'));
      const calculation = { schema_version: 1, source: { id: 'frozen-development-rows', kind: 'synthetic' }, as_of: iso(9),
        grid: { direction: [1, -1] }, trials: [1, -1].map(direction => ({ split: 'development', available_at: iso(9), parameters: { direction },
          metrics: { score: direction * context.rows.items.reduce((sum, row) => sum + row.fields.signal, 0) / context.rows.items.length } })) };
      const result = await createCapabilities(artifacts.host)[0].execute({ input: calculation });
      assert.equal(result.observations.development_rank.length, 2); calculations++;
    } }));
  installMethods(f); const args = input(); args.config.research = { plugins: ['sesame/ict', 'sesame/abu-parameter-search'] };
  const run = await f.runtime.create(f.main, args), done = await finished(f, run.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error)); assert.deepEqual(accesses, ['restricted']);
  assert.equal(done.data.holdoutMode, 'workflow-isolated'); assert.equal(done.finalEvaluation.holdoutStatus, 'evaluated');
  assert.equal(Object.keys(done.holdout).length, 1); assert.equal(done.report.ref.kind, 'report'); assert.equal(calculations, 1);
  assert.ok(f.requests.every(request => request.plugins.includes('sesame/ict')));
  assert.deepEqual(artifacts.calls, ['create', 'publish', 'remove', 'create', 'publish', 'remove']);
});

test('external reference readers and undeclared empty-effects tools still require development-only data', async t => {
  for (const declared of [false, true]) {
    const accesses = [], f = own(t, await fixture({ evaluator: evaluate, onEvaluate: args => { if (args.action === 'prepare') accesses.push(args.access); } }));
    const capability = { id: 'read', consumers: ['agent', 'host'], kind: 'function', execution: 'immediate', binding: { type: 'native', name: 'read' },
      effects: declared ? ['resources.read'] : [], inputSchema: { type: 'object', properties: { ref: { type: 'object' } } },
      ...(declared ? { researchDataAccess: { schemaVersion: 1, reads: 'input-only', writes: 'none' } } : {}) };
    f.manifests.set('test/source', { id: 'test/source', version: '1', revision: 'fixed', capabilities: [capability] });
    const args = input(); args.config.research = { plugins: ['test/source'] };
    await assert.rejects(f.runtime.create(f.main, args), /Development-only input contains a row after validationEnd/);
    assert.equal(f.requests.length, 0); assert.deepEqual(accesses, ['development-only']);
    f.datasets.get('data').rows = rows.filter(row => row.time <= iso(9)); args.request_id = 'development-only';
    const run = await f.runtime.create(f.main, args), done = await finished(f, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(done.error)); assert.equal(done.data.holdoutMode, 'none');
    assert.equal(done.finalEvaluation.holdoutStatus, 'not-requested'); assert.deepEqual(done.holdout, {});
  }
});

test('changed method declarations or implementation revisions refuse resume without replay or holdout promotion', async t => {
  for (const declaration of [true, false]) {
    const f = own(t, await fixture({ evaluator: evaluate, onTask: () => 'hold' })); installMethods(f);
    const args = input(); args.config.research = { plugins: ['sesame/ict', 'sesame/abu-parameter-search'] };
    const run = await f.runtime.create(f.main, args); await poll(() => f.requests.length > 0);
    await f.runtime.control(f.main, run.id, 'pause'); const before = structuredClone(f.runtime.get(run.id)), calls = f.requests.length;
    const manifest = f.manifests.get('sesame/abu-parameter-search'); manifest.revision = 'sha256:changed';
    if (declaration) manifest.capabilities[0].researchDataAccess.reads = 'external-data';
    const readiness = f.runtime.dependencies(f.main, run.id);
    assert.equal(readiness.available, false); assert.equal(readiness.details.cause.code, 'RESEARCH_PLUGIN_CHANGED');
    const observed = await f.runtime.observed(f.main, run.id);
    await f.runtime.control(f.main, run.id, 'resume', { interrupt_ids: observed.interrupts.map(item => item.id) });
    const after = f.runtime.get(run.id); assert.equal(after.status, 'interrupted'); assert.equal(f.requests.length, calls);
    assert.deepEqual(after.data, before.data); assert.deepEqual(after.evaluation, before.evaluation);
    assert.equal(after.workflow.id, before.workflow.id);
  }
});

test('input-only composition still rejects rows outside the actual configured holdout boundary', async t => {
  const f = own(t, await fixture({ evaluator: evaluate })); installMethods(f);
  const args = input(); args.config.research = { plugins: ['sesame/ict', 'sesame/abu-parameter-search'] };
  args.config.evaluator.arguments.dataset.holdoutEnd = iso(12);
  await assert.rejects(f.runtime.create(f.main, args), /after holdoutEnd/);
  assert.equal(f.requests.length, 0);
});

test('the actual public knowledge reader keeps restricted access despite its unused installation-operation state', async t => {
  const f = own(t, await fixture({ evaluator: evaluate }));
  const manifest = JSON.parse(fs.readFileSync(new URL('../../api-v1/packages/plugin-manager/capabilities.json', import.meta.url), 'utf8'));
  assert.ok(manifest.stateCollections.length > 0);
  f.manifests.set('sesame/plugin-manager', { ...f.manifests.get('sesame/plugin-manager'), ...manifest });
  const args = input(); args.config.research = { plugins: ['sesame/plugin-manager'], tools: ['sesame/plugin-manager#plugin_read'] };
  const run = await f.runtime.create(f.main, args), done = await finished(f, run.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error)); assert.equal(done.data.holdoutMode, 'workflow-isolated');
  assert.equal(done.finalEvaluation.holdoutStatus, 'evaluated');
});

test('the real parameter tool reads only fixed implementation bytes and publishes its own supplied evidence', async () => {
  const artifacts = artifactHost(), input = load('abu-parameter-search', 'examples/development.json');
  input.source.path = 'private/held-out-data.json'; input.source.ref = { id: 'artifact_hidden', revision: 'hidden' };
  const expectedPaths = ['scripts/baseline.mjs', 'scripts/runtime.mjs'].map(path => fileURLToPath(new URL(path, packageUrl('abu-parameter-search'))));
  const readPaths = [], originalRead = fs.readFileSync, originalFetch = globalThis.fetch;
  try {
    fs.readFileSync = function(path, ...args) {
      const actual = path instanceof URL ? fileURLToPath(path) : path; readPaths.push(actual);
      assert.ok(expectedPaths.includes(actual), `Cannot read data or caller paths: ${actual}`);
      return originalRead.call(this, path, ...args);
    };
    syncBuiltinESMExports(); globalThis.fetch = () => assert.fail('No network access');
    const result = await createCapabilities(artifacts.host)[0].execute({ input });
    assert.deepEqual(readPaths, expectedPaths); assert.deepEqual(artifacts.published.get(result.input_artifact.id).rows, [{ input }]);
    assert.deepEqual(artifacts.published.get(result.result_artifact.id).manifest.dependencies, [result.input_artifact]);
    assert.equal(artifacts.removed.length, 2); assert.equal(artifacts.published.size, 2);
    assert.match(result.implementation_sha256, /^sha256:[a-f0-9]{64}$/);
  } finally { fs.readFileSync = originalRead; syncBuiltinESMExports(); globalThis.fetch = originalFetch; }
});
