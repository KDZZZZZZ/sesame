/** Opt-in integration with the matching public HostContext implementation.
 * All state/model configuration is temporary. No model or terminal is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildLock } from '../scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
test('default plugins provide methods and backend-free authoring/reports; MT5 and judgments install privately and reopen', { skip: !hostRoot, timeout: 90000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { createHostContextV2 } = await load('modules/plugins/host-v2/context.js');
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
    let callNumber = 0;
    const session = await runtime.session('conv_main'), call = async (name, args) => {
      const tool = runtime.plugins.definitions({ conversationId: 'conv_main' }).find(item => item.name === name); assert.ok(tool, name);
      return (await tool.execute(`offline-core-${++callNumber}`, args)).details;
    };
    for (const name of ['host_files_read', 'research_register', 'components_show', 'research_methods', 'research_read', 'strategy_validate']) assert.ok(session.getActiveToolNames().includes(name), name);
    for (const name of ['report_publish', 'report_data', 'report_template', 'report_backtest_template', 'report_structure', 'report_compose']) assert.equal(session.getActiveToolNames().includes(name), false, `${name} is retired`);
    assert.equal(session.getActiveToolNames().some(name => /^(mt5_|qmt_|akshare_|vnpy_)/.test(name)), false);
    const methods = await call('research_methods', { query: '财报前瞻', limit: 3 });
    assert.ok(methods.items.some(item => item.id === 'earnings-preview'));
    const method = await call('research_read', { ids: ['earnings-preview', 'earnings-review'] });
    assert.equal(method.items.length, 2);
    assert.notEqual(method.items[0].content, method.items[1].content);
    const work = runtime.workspaces.root('conv_main');
    let strategySource;
    for (const name of ['close-threshold', 'crossover']) {
      for (const suffix of ['svl', 'replay']) await cp(join(source, 'packages/strategy-authoring/examples', `${name}.${suffix}.json`), join(work, `${name}.${suffix}.json`));
      const checked = await call('strategy_validate', { source_path: `${name}.svl.json` }); assert.deepEqual(checked.diagnostics, []);
      const published = await call('strategy_publish', { operation_id: `core-${name}`, source_path: `${name}.svl.json`, title: `Demo ${name}`, change_summary: 'Offline reference fixture' });
      strategySource = published.ref;
      const graph = await call('strategy_graph', { source: published.ref }); assert.equal(graph.sourceDigest, checked.sourceDigest);
      const replay = await call('strategy_replay', { source: published.ref, fixture_path: `${name}.replay.json`, output_path: `${name}-result.json`, operation_id: `replay-${name}` });
      assert.equal(replay.status, 'completed'); assert.equal(replay.nativeEngineExecuted, false);
    }
    store.put('dataset', { id: 'core-demo', rows: [{ label: 'A', value: '1.25' }, { label: 'B', value: '2.50' }], provenance: { kind: 'demo' } });
    const snapshot = (operationId, datasetId) => call('data_snapshot', { operationId, source: { providerId: 'host#datasets', revision: 'host:2' }, input: { datasetId }, title: datasetId });
    const data = await snapshot('core-demo-data', 'core-demo');
    const report = await call('components_show', {
      operation_id: 'core-demo-report', target: 'report', title: 'Offline demo report', provenance_kind: 'demo',
      data: [{ id: 'demo', ref: data.ref, usage: 'Fictional chart input' }],
      components: [
        { type: 'paragraph', text: 'B is twice A in this synthetic fixture.' },
        { type: 'chart', kind: 'bar', title: 'Demo comparison', data_id: 'demo', columns: ['label', 'value'], options: { x: 'label', y: 'value', unit: 'demo units' } },
      ],
    });
    assert.equal(runtime.contractArtifacts.read(report.ref).manifest.content.provenance.kind, 'demo');
    if (process.env.SESAME_REPORT_INSPECT === '1') {
      const receipt = await call('report_check', { ref: report.ref }); assert.equal(receipt.status, 'rendered', JSON.stringify(receipt));
      t.diagnostic(JSON.stringify({ renderReceipt: receipt }));
    }
    const trials = [{ trial_id: 'fixture-trial', symbol: 'TEST', timeframe: 'H1', sample: 'fixture-only', status: 'completed', selected: true, parameters: { lookback: '20' }, sharpe: null, max_drawdown_pct: '3.25', net_profit: '-4.50' }];
    store.put('dataset', { id: 'core-demo-trials', rows: trials, provenance: { kind: 'demo' } });
    const trialData = await snapshot('core-trial-data', 'core-demo-trials');
    const strategyReport = await call('components_show', {
      operation_id: 'core-demo-strategy', target: 'report', title: 'Demo Strategy', space: 'strategy', provenance_kind: 'demo',
      references: [strategySource], data: [{ id: 'trials', ref: trialData.ref, usage: 'All fixture trials' }],
      components: [
        { type: 'paragraph', text: 'Only the supplied synthetic trial is shown; no native strategy was executed.' },
        { type: 'table', columns: ['trial_id', 'symbol', 'timeframe', 'net_profit', 'max_drawdown_pct'],
          rows: trials.map(row => [row.trial_id, row.symbol, row.timeframe, row.net_profit, row.max_drawdown_pct]) },
      ],
    });
    const strategyContent = runtime.contractArtifacts.read(strategyReport.ref).manifest;
    assert.ok(runtime.contractArtifacts.resource(strategyReport.ref, 'index.html').bytes.toString().includes('data-sesame-provenance="demo"'));
    assert.ok(strategyContent.content.provenance.references.some(ref=>ref.digest===strategySource.digest));
    assert.ok(strategyContent.dependencies.some(ref => ref.digest === strategySource.digest));
    assert.equal(store.get('report', strategyReport.ref.id).kind, 'strategy', 'The producer explicitly selects the Strategy delivery location');
    assert.deepEqual(runtime.contractArtifacts.reportData(strategyReport.ref, 'trials').rows, trials);
    if (process.env.SESAME_REPORT_INSPECT === '1') {
      const receipt = await call('report_check', { ref: strategyReport.ref }); assert.equal(receipt.status, 'rendered', JSON.stringify(receipt));
      t.diagnostic(JSON.stringify({ strategyRenderReceipt: receipt }));
    }
    store.put('mt5_project', { id: 'legacy-fixture', title: 'Must remain outside plugin private storage' });
    await writeFile(join(store.directory, 'judgments.sqlite'), 'old synthetic bytes; not a database');
    const privateEvidence = new Map();
    for (const name of ['mt5', 'judgment-evolution']) {
      const draft = join(work, `draft-${name}`); await cp(join(optional, name), draft, { recursive: true });
      const checked = await runtime.plugins.manager.test('conv_main', { path: draft }); assert.equal(checked.passed, true, JSON.stringify(checked));
      const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
      assert.equal(installed.runtime_status, 'ready'); assert.equal(installed.state, 'discoverable');
      const entry = runtime.plugins.entry(installed.id); assert.equal(entry.migration, undefined);
      const host = createHostContextV2(runtime, entry, 'conv_main');
      assert.equal(host.storage, undefined, 'API2 does not expose legacy application storage');
      assert.throws(() => host.state.read({ collection: 'mt5_project', key: 'legacy-fixture' }), /undeclared|forbidden/i);
      const bytes = JSON.stringify({ plugin: installed.id, preserved: true });
      const resource = await host.resources.create({ kind: 'file', name: 'reopen.json', lifetime: 'durable', source: { content: bytes, encoding: 'utf8' } });
      const path = name === 'judgment-evolution' ? 'CRITERIA.md' : 'reopen.json';
      const metadata = name === 'judgment-evolution'
        ? { type: 'judgment-criteria', title: 'Offline persistence fixture', path, contentDigest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }
        : { format: 'json-object', title: 'Offline persistence fixture' };
      const evidence = await host.resources.publish(resource, { kind: 'resource', schemaVersion: '1.0.0', content: metadata, dependencies: [], blobs: [{ entry: 'reopen.json', path, mediaType: 'application/json' }] }, { operationId: `reopen-${name}` });
      privateEvidence.set(installed.id, { ref: evidence.ref, path });
      assert.equal(store.get('plugin_installation', installed.id).bundled_origin, undefined);
    }
    assert.deepEqual(requests, []); await close(); await open();
    for (const id of ['sesame/mt5', 'sesame/judgment-evolution']) {
      const entry = runtime.plugins.entry(id); assert.equal(entry.runtime_status, 'ready');
      const evidence = privateEvidence.get(id);
      const stored = await createHostContextV2(runtime, entry, 'conv_main').resources.read(evidence.ref, { part: 'content', entry: evidence.path });
      assert.equal(JSON.parse(stored.encoding === 'base64' ? Buffer.from(stored.content, 'base64').toString() : stored.content).preserved, true);
    }
    assert.equal(store.get('mt5_project', 'legacy-fixture').title, 'Must remain outside plugin private storage');
    assert.equal(await readFile(join(store.directory, 'judgments.sqlite'), 'utf8'), 'old synthetic bytes; not a database');
    assert.deepEqual(runtime.contractArtifacts.data(data.ref).rows, [{ label: 'A', value: '1.25' }, { label: 'B', value: '2.50' }]);
    assert.equal(runtime.contractArtifacts.read(report.ref).manifest.content.provenance.kind, 'demo');
    assert.deepEqual(requests, []);
  } finally { await close(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
