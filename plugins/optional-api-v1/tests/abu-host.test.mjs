// Real matching host, isolated temporary state; no vendor, model or broker calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildLock } from '../../api-v1/scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
test('18 ABU plugins formally install, isolate skills, compute and persist identical user evidence across restart', { skip: !hostRoot, timeout: 180000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { ModelRuntime } = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-abu-host-'))), bundle = join(root, 'bundle');
  const source = new URL('../', import.meta.url), core = fileURLToPath(new URL('../../api-v1/', import.meta.url));
  const catalog = JSON.parse(await readFile(new URL('abu-plugins.json', source)));
  const names = catalog.map(p => p.directory), frozen = [], outputs = [], requests = [];
  const originalFetch = globalThis.fetch; let store, runtime;
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  try {
    await mkdir(bundle); const lock = buildLock(core);
    assert.equal(lock.packages.length, 9);
    for (const pkg of lock.packages) await cp(join(core, 'packages', pkg.directory), join(bundle, pkg.directory), { recursive: true });
    await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const models = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    models.registerProvider('fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'fixture', name: 'Not invoked', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    globalThis.fetch = async url => { requests.push(String(url)); throw new Error('Offline baseline verification prohibits network'); };
    const open = async () => { store = new Store(join(root, 'state')); runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: bundle, modelRuntime: models, model: models.getModel('fixture', 'fixture') }).init(); };
    await open(); await runtime.session('conv_main');
    const call = async (conversation, name, args) => {
      const tool = runtime.plugins.definitions({ conversationId: conversation }).find(item => item.name === name); assert.ok(tool, name);
      const result = await tool.execute('abu-host-fixture', args); assert.notEqual(result.isError, true, JSON.stringify(result)); return result.details;
    };
    for (const item of catalog) {
      const sourcePath = fileURLToPath(new URL(`packages/${item.directory}/`, source)), draft = join(runtime.workspaces.root('conv_main'), `draft-${item.directory}`);
      await cp(sourcePath, draft, { recursive: true });
      const tested = await call('conv_main', 'plugin_test', { path: draft }); assert.equal(tested.passed, true, JSON.stringify(tested));
      const installed = await call('conv_main', 'plugin_install', { command_id: `install_${item.directory.replaceAll('-', '_')}`, path: draft, digest: tested.digest });
      assert.equal(installed.runtime_status, 'ready'); assert.equal(installed.state, 'discoverable');
    }
    assert.equal((await runtime.session('conv_main')).resourceLoader.getSkills().skills.some(skill => names.includes(skill.name)), false);
    for (const [i, item] of catalog.entries()) {
      const conversation = `conv_abu_${i}`; runtime.createConversation('orchestrator', item.title, null, conversation);
      const session = await runtime.session(conversation);
      await call(conversation, 'plugin_load', { plugin_id: item.id });
      assert.deepEqual(session.resourceLoader.getSkills().skills.filter(skill => names.includes(skill.name)).map(skill => skill.name), [item.directory]);
      const manifest = JSON.parse(await readFile(new URL(`packages/${item.directory}/plugin.json`, source)));
      for (const path of [`skills/${item.directory}/SKILL.md`, ...manifest.resources]) {
        const resource = await call(conversation, 'plugin_read', { plugin_id: item.id, path });
        assert.equal(resource.content, await readFile(new URL(`packages/${item.directory}/${path}`, source), 'utf8'));
      }
      const other = catalog[(i + 1) % catalog.length];
      await assert.rejects(() => call(conversation, 'plugin_read', { plugin_id: other.id, path: 'README.md' }), /未挂载|不可使用/);
      const input = JSON.parse((await call(conversation, 'plugin_read', { plugin_id: item.id, path: 'examples/input.json' })).content);
      const result = await call(conversation, item.tool, { input });
      assert.equal(result.baseline, true); outputs.push(result);
      assert.deepEqual(store.get('dataset', result.dataset_id).rows, [result]);
      assert.deepEqual(store.get('dataset', result.input_dataset_id).rows, [{ input }]);
      const fixedInput = await call(conversation, 'report_data', { operation_id: `abu_input_${i}`, dataset_id: result.input_dataset_id });
      const fixed = await call(conversation, 'report_data', { operation_id: `abu_output_${i}`, dataset_id: result.dataset_id, dependencies: [fixedInput.ref] });
      assert.equal(fixed.provenance.kind, 'demo');
      assert.deepEqual(runtime.contractArtifacts.data(fixed.ref).rows, [result]); frozen.push(fixed.ref);
    }
    await close(); await open();
    for (const [i, item] of catalog.entries()) {
      assert.deepEqual((await runtime.session(`conv_abu_${i}`)).resourceLoader.getSkills().skills.filter(skill => names.includes(skill.name)).map(skill => skill.name), [item.directory]);
      assert.deepEqual(runtime.contractArtifacts.data(frozen[i]).rows, [outputs[i]]);
    }
    assert.deepEqual(requests, []);
    t.diagnostic(JSON.stringify({ installed: catalog.length, isolatedSkills: catalog.length, nativeComputations: outputs.length, frozenResults: frozen.length, reopened: true, modelCalls: 0, vendorCalls: 0, brokerCalls: 0 }));
  } finally { await close(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
