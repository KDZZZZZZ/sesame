/** Real matching Runtime/SDK, all state temporary; no model, market, auth or account calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildLock } from '../../api-v1/scripts/plugin-lock.mjs';

const names = ['ict', 'price-action', 'elliott-wave', 'wyckoff', 'dow-theory', 'behavioral-finance', 'institutional-analysis', 'narrative-analysis'];
const hostRoot = process.env.SESAME_HOST_ROOT;
test('checked API 2 installation isolates eight skills; workspace scripts register fixed demo data and reports, then reopen', { skip: !hostRoot, timeout: 120000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { ModelRuntime } = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-method-host-'))), bundle = join(root, 'bundle');
  const core = fileURLToPath(new URL('../../api-v1/', import.meta.url));
  const packages = fileURLToPath(new URL('../packages/', import.meta.url));
  let store, runtime; const fetch = globalThis.fetch, requests = [], installed = [], results = [];
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  try {
    await mkdir(bundle);
    const lock = buildLock(core); assert.equal(lock.packages.length, 9);
    for (const pkg of lock.packages) await cp(join(core, 'packages', pkg.directory), join(bundle, pkg.directory), { recursive: true });
    await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const models = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    models.registerProvider('fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'fixture', name: 'Never invoked', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    globalThis.fetch = async url => { requests.push(String(url)); throw new Error('No network permitted by this offline method fixture'); };
    const open = async () => { store = new Store(join(root, 'state')); runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: bundle, modelRuntime: models, model: models.getModel('fixture', 'fixture') }).init(); };
    await open();
    const main = await runtime.session('conv_main');
    const call = async (conversationId, name, args) => {
      const descriptor = runtime.capabilities.descriptors().find(item => item.localId === name); assert.ok(descriptor, name);
      const result = await runtime.capabilities.invoke(descriptor.id, args, {}, { kind: 'main', sessionId: conversationId, pluginId: 'host' });
      assert.equal(result.type, 'result', JSON.stringify(result)); return result.value;
    };
    for (const name of names) {
      const draft = join(runtime.workspaces.root('conv_main'), `draft-${name}`);
      await cp(join(packages, name), draft, { recursive: true });
      const outcome = await call('conv_main', 'plugin_install', { operationId: `install_method_${name.replaceAll('-', '_')}`, path: draft });
      const pkg = outcome.plugin;
      assert.equal(outcome.receipt.status, 'completed', JSON.stringify(outcome));
      assert.equal(pkg.runtime_status, 'ready', JSON.stringify(pkg)); assert.equal(pkg.state, 'discoverable'); installed.push(pkg.id);
    }
    assert.equal(main.resourceLoader.getSkills().skills.some(s => names.includes(s.name)), false);
    // The main conversation loads ICT alone. Other method metadata can remain discoverable,
    // but its skills and method prompts must not enter this session.
    for (const name of names) {
      const conversationId = name === 'ict' ? 'conv_main' : `conv_method_${name.replaceAll('-', '_')}`;
      if (conversationId !== 'conv_main') runtime.createConversation('orchestrator', `Isolated ${name}`, null, conversationId);
      const session = await runtime.session(conversationId);
      const loaded = await call(conversationId, 'plugin_load', { pluginId: `sesame/${name}` });
      const expectedPrompt = (await readFile(join(packages, name, 'prompt.md'), 'utf8')).trim();
      assert.ok(loaded.plugin.prompts.some(p => p.content.includes(expectedPrompt)));
      assert.deepEqual(session.resourceLoader.getSkills().skills.filter(s => names.includes(s.name)).map(s => s.name), [name]);
      const prompt = session.resourceLoader.getSystemPrompt();
      assert.ok(prompt.includes(expectedPrompt), `${name} prompt was not loaded`);
      for (const other of names.filter(n => n !== name)) assert.ok(!prompt.includes((await readFile(join(packages, other, 'prompt.md'), 'utf8')).trim()), `${other} leaked into ${name}`);
      const manifest = JSON.parse(await readFile(join(packages, name, 'plugin.json'), 'utf8'));
      for (const path of [`skills/${name}/SKILL.md`, ...manifest.resources]) {
        const resource = await call(conversationId, 'plugin_read', { pluginId: `sesame/${name}`, part: 'resource', path });
        assert.equal(resource.content, await readFile(join(packages, name, path), 'utf8'));
      }
      const other = name === 'ict' ? 'price-action' : 'ict';
      // API 2 allows reading declared resources before loading a plugin. Reading
      // another method must not activate its skill or inject its prompt.
      const reference = await call(conversationId, 'plugin_read', { pluginId: `sesame/${other}`, part: 'resource', path: `skills/${other}/SKILL.md` });
      assert.equal(reference.content, await readFile(join(packages, other, `skills/${other}/SKILL.md`), 'utf8'));
      assert.deepEqual(session.resourceLoader.getSkills().skills.filter(s => names.includes(s.name)).map(s => s.name), [name]);
      await assert.rejects(() => call(conversationId, 'plugin_read', { pluginId: `sesame/${name}`, part: 'resource', path: 'undeclared-file.txt' }), { code: 'NOT_FOUND' });
      if (!['ict', 'price-action'].includes(name)) continue;
      const rows = JSON.parse((await call(conversationId, 'plugin_read', { pluginId: `sesame/${name}`, part: 'resource', path: 'examples/bars.json' })).content);
      const source = JSON.parse((await call(conversationId, 'plugin_read', { pluginId: `sesame/${name}`, part: 'resource', path: 'examples/source.json' })).content);
      const dataset = `demo-${name}`;
      store.put('dataset', { id: dataset, title: `${name} invented bars`, rows, provenance: { kind: 'demo', source_kind: 'synthetic' } });
      const fixed = await call(conversationId, 'report_data', { operation_id: `input-${name}`, dataset_id: dataset });
      source.ref = fixed.ref;
      const input = await call(conversationId, 'data_read', { ref: fixed.ref });
      for (const filename of ['bar_input.py', 'observe.py']) {
        const resource = await call(conversationId, 'plugin_read', { pluginId: `sesame/${name}`, part: 'resource', path: `scripts/${filename}` });
        await call(conversationId, 'write', { path: filename, content: resource.content });
      }
      await call(conversationId, 'write', { path: 'source.json', content: JSON.stringify(source) });
      const python = process.platform === 'win32' ? 'python' : 'python3';
      const run = await call(conversationId, 'host_files_run', { argv: [python, '-B', 'observe.py', '--input', input.path, '--source', 'source.json', '--output', 'output/observations.json'], cwd: runtime.workspaces.root(conversationId), timeout: 30 });
      assert.equal(run.exitCode, 0, JSON.stringify(run)); assert.deepEqual(run.snapshotErrors ?? [], []);
      const output = await call(conversationId, 'research_register', { operationId: `observations-${name}`, executionId: run.executionId, path: 'output/observations.json', title: `${name} demo observations`, description: 'Finite closed-bar observations from invented data; no economic validation', inputRefs: [fixed.ref], recipePaths: ['bar_input.py', 'observe.py', 'source.json'] });
      assert.equal(output.rowCount, name === 'ict' ? 5 : 6);
      assert.ok(runtime.contractArtifacts.read(output.evidence).manifest.dependencies.some(ref => ref.digest === fixed.ref.digest), 'Frozen execution evidence retains the exact fixed input');
      assert.equal(output.provenance.kind, 'demo');
      const fixedRows = runtime.contractArtifacts.data(output.ref).rows;
      assert.deepEqual(fixedRows[0].source_ref, fixed.ref); assert.match(fixedRows[0].availability, /unknown/);
      await call(conversationId, 'report_template', { output_path: 'observations.html', title: `${name} demo`, summary: 'Finite observational fixture; not a strategy', data_id: 'observations', chart_title: 'Confirmed demo observations', takeaway: 'Confirmation occurs after required source bars close', source_note: 'Invented OHLC, no real market/volume or trade results', kind: 'bar', x: 'id', y: name === 'ict' ? 'lower' : 'level', unit: 'fictional price', columns: ['kind', name === 'ict' ? 'lower' : 'level'], demo: true });
      const report = await call(conversationId, 'report_publish', { operation_id: `report-${name}`, title: `${name} demo`, summary: 'Finite observation fixture', html_path: 'observations.html', provenance_kind: 'demo', data: [{ id: 'observations', ref: output.ref, usage: 'Exact script output from fictional prices' }] });
      assert.equal(runtime.contractArtifacts.read(report.ref).manifest.content.provenance.kind, 'demo');
      results.push({ name, executionId: run.executionId, rows: output.rowCount, data: output.ref, report: report.ref });
    }
    assert.deepEqual(main.resourceLoader.getSkills().skills.filter(s => names.includes(s.name)).map(s => s.name), ['ict']);
    assert.deepEqual(requests, []);
    await close(); await open();
    const reopened = await runtime.session('conv_main');
    assert.deepEqual(reopened.resourceLoader.getSkills().skills.filter(s => names.includes(s.name)).map(s => s.name), ['ict']);
    for (const id of installed) assert.equal(runtime.plugins.entry(id).runtime_status, 'ready');
    for (const result of results) assert.equal(runtime.contractArtifacts.data(result.data).rows.length, result.rows);
    assert.deepEqual(requests, []);
    t.diagnostic(JSON.stringify({ installed: installed.length, isolatedLoadouts: names.length, reopenedIctOnly: true, results, modelCalls: 0, networkCalls: requests.length, rendered: false, nativeCalls: 0 }));
  } finally { await close(); globalThis.fetch = fetch; await rm(root, { recursive: true, force: true }); }
});
