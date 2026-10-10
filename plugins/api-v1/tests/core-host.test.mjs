/** Opt-in integration with the matching public HostContext implementation.
 * All state/model configuration is temporary. No model or terminal is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildLock } from '../scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
test('nine defaults provide backend-free authoring/reports; MT5 and judgments install privately and reopen without legacy grants', { skip: !hostRoot, timeout: 90000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { createHostContext } = await load('modules/plugins/context.js');
  const { ModelRuntime } = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-core-host-'))), bundle = join(root, 'bundle');
  const source = fileURLToPath(new URL('../', import.meta.url)), optional = fileURLToPath(new URL('../../optional-api-v1/packages/', import.meta.url));
  let runtime, store, modelRuntime; const originalFetch = globalThis.fetch, requests = [];
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  try {
    const lock = buildLock(source); await mkdir(bundle);
    for (const pkg of lock.packages) await cp(join(source, 'packages', pkg.directory), join(bundle, pkg.directory), { recursive: true });
    await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    modelRuntime.registerProvider('fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'fixture', name: 'Uncalled fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    globalThis.fetch = async url => { requests.push(String(url)); throw new Error('Unexpected network request in offline core install test'); };
    const open = async () => {
      store = new Store(join(root, 'state'));
      // Empty explicit discovery path: this test cannot read any real terminal configuration.
      runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: bundle, modelRuntime, model: modelRuntime.getModel('fixture', 'fixture'), plugins: { 'sesame/mt5': { directory: join(root, 'no-terminal') } } }).init();
    };
    await open();
    assert.deepEqual([...runtime.plugins.entries.values()].map(entry => entry.id).sort(), lock.packages.map(pkg => pkg.id).sort());
    for (const entry of runtime.plugins.entries.values()) assert.notEqual(entry.runtime_status, 'failed', `${entry.id}: ${JSON.stringify(entry.diagnostics)}`);
    assert.deepEqual(runtime.providers.list('sesame.market'), []); assert.deepEqual(runtime.providers.list('sesame.account'), []);
    const session = await runtime.session('conv_main'), call = async (name, args) => {
      const tool = runtime.plugins.definitions({ conversationId: 'conv_main' }).find(item => item.name === name); assert.ok(tool, name);
      return (await tool.execute('offline-core', args)).details;
    };
    for (const name of ['host_files_read', 'research_register', 'report_publish', 'strategy_validate']) assert.ok(session.getActiveToolNames().includes(name), name);
    assert.equal(session.getActiveToolNames().some(name => /^(mt5_|qmt_|akshare_|vnpy_)/.test(name)), false);
    const work = runtime.workspaces.root('conv_main');
    for (const name of ['close-threshold', 'crossover']) {
      for (const suffix of ['svl', 'replay']) await cp(join(source, 'packages/strategy-authoring/examples', `${name}.${suffix}.json`), join(work, `${name}.${suffix}.json`));
      const checked = await call('strategy_validate', { source_path: `${name}.svl.json` }); assert.deepEqual(checked.diagnostics, []);
      const published = await call('strategy_publish', { operation_id: `core-${name}`, source_path: `${name}.svl.json`, title: `Demo ${name}`, change_summary: 'Offline reference fixture' });
      const graph = await call('strategy_graph', { source: published.ref }); assert.equal(graph.sourceDigest, checked.sourceDigest);
      const replay = await call('strategy_replay', { source: published.ref, fixture_path: `${name}.replay.json`, output_path: `${name}-result.json`, operation_id: `replay-${name}` });
      assert.equal(replay.status, 'completed'); assert.equal(replay.nativeEngineExecuted, false);
    }
    store.put('dataset', { id: 'core-demo', rows: [{ label: 'A', value: '1.25' }, { label: 'B', value: '2.50' }], provenance: { kind: 'demo' } });
    const data = await call('report_data', { operation_id: 'core-demo-data', dataset_id: 'core-demo' });
    await call('report_template', { output_path: 'demo.html', title: 'Offline demo report', summary: 'Fictional reference values', data_id: 'demo', chart_title: 'Demo comparison', takeaway: 'B is twice A in this fixture', source_note: 'Fictional demo values; no market observations', kind: 'bar', x: 'label', y: 'value', unit: 'demo units', columns: ['label', 'value'], demo: true });
    const report = await call('report_publish', { operation_id: 'core-demo-report', title: 'Offline demo report', summary: 'Fictional reference values', html_path: 'demo.html', provenance_kind: 'demo', data: [{ id: 'demo', ref: data.ref, usage: 'Fictional chart input' }] });
    assert.equal(runtime.contractArtifacts.read(report.ref).manifest.content.provenance.kind, 'demo');
    if (process.env.SESAME_REPORT_INSPECT === '1') {
      const receipt = await call('report_check', { ref: report.ref }); assert.equal(receipt.status, 'rendered', JSON.stringify(receipt));
      t.diagnostic(JSON.stringify({ renderReceipt: receipt }));
    }
    store.put('mt5_project', { id: 'legacy-fixture', title: 'Must remain outside plugin private storage' });
    await writeFile(join(store.directory, 'judgments.sqlite'), 'old synthetic bytes; not a database');
    for (const name of ['mt5', 'judgment-evolution']) {
      const draft = join(work, `draft-${name}`); await cp(join(optional, name), draft, { recursive: true });
      const checked = await runtime.plugins.manager.test('conv_main', { path: draft }); assert.equal(checked.passed, true, JSON.stringify(checked));
      const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
      assert.equal(installed.runtime_status, 'ready'); assert.equal(installed.state, 'discoverable');
      const entry = runtime.plugins.entry(installed.id); assert.equal(entry.migration, undefined);
      const host = createHostContext(runtime, entry, 'conv_main');
      assert.throws(() => host.storage.legacy.list('mt5_project'), { code: 'FORBIDDEN' });
      assert.deepEqual(host.storage.list('mt5_project'), []); host.storage.put('reopen_fixture', { id: 'own', preserved: true });
      assert.equal(store.get('plugin_installation', installed.id).bundled_origin, undefined);
    }
    assert.deepEqual(requests, []); await close(); await open();
    for (const id of ['sesame/mt5', 'sesame/judgment-evolution']) {
      const entry = runtime.plugins.entry(id); assert.equal(entry.runtime_status, 'ready');
      assert.equal(createHostContext(runtime, entry, 'conv_main').storage.get('reopen_fixture', 'own').preserved, true);
    }
    assert.equal(store.get('mt5_project', 'legacy-fixture').title, 'Must remain outside plugin private storage');
    assert.equal(await readFile(join(store.directory, 'judgments.sqlite'), 'utf8'), 'old synthetic bytes; not a database');
    assert.deepEqual(runtime.contractArtifacts.data(data.ref).rows, [{ label: 'A', value: '1.25' }, { label: 'B', value: '2.50' }]);
    assert.equal(runtime.contractArtifacts.read(report.ref).manifest.content.provenance.kind, 'demo');
    assert.deepEqual(requests, []);
  } finally { await close(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
