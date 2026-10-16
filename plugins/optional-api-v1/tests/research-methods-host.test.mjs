// Opt-in integration against a matching host checkout supplied by the caller.
// All state and commands are confined to new temporary test directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildLock } from '../../api-v1/scripts/plugin-lock.mjs';
import { canonical } from '../packages/factor-research/scripts/factor.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const quote = value => process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
test('formal install/load isolates two methods, executes declared CLI resources, freezes demo output and reopens', { skip: !hostRoot, timeout: 120000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { ModelRuntime } = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-research-host-'))), bundle = join(root, 'bundle');
  const core = fileURLToPath(new URL('../../api-v1/', import.meta.url)), packages = fileURLToPath(new URL('../packages/', import.meta.url));
  const originalFetch = globalThis.fetch, requests = []; let store, runtime;
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  try {
    await mkdir(bundle);
    const lock = buildLock(core); assert.equal(lock.packages.length, 9);
    for (const pkg of lock.packages) await cp(join(core, 'packages', pkg.directory), join(bundle, pkg.directory), { recursive: true });
    await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const models = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    models.registerProvider('fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'fixture', name: 'Never invoked', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    globalThis.fetch = async url => { requests.push(String(url)); throw new Error('Offline research fixture prohibits network'); };
    const open = async () => { store = new Store(join(root, 'state')); runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: bundle, modelRuntime: models, model: models.getModel('fixture', 'fixture') }).init(); };
    await open(); const main = await runtime.session('conv_main');
    const call = async (conversationId, name, args) => {
      const tool = runtime.plugins.definitions({ conversationId }).find(item => item.name === name); assert.ok(tool, name);
      const result = await tool.execute('research-fixture', args); assert.notEqual(result.isError, true, JSON.stringify(result)); return result.details;
    };
    const names = ['strategy-research', 'factor-research'];
    for (const name of names) {
      const path = join(runtime.workspaces.root('conv_main'), `draft-${name}`); await cp(join(packages, name), path, { recursive: true });
      const tested = await call('conv_main', 'plugin_test', { path }); assert.equal(tested.passed, true, JSON.stringify(tested));
      const installed = await call('conv_main', 'plugin_install', { command_id: `install_${name.replaceAll('-', '_')}`, path, digest: tested.digest });
      assert.equal(installed.runtime_status, 'ready'); assert.equal(installed.state, 'discoverable');
    }
    assert.equal(main.resourceLoader.getSkills().skills.some(skill => names.includes(skill.name)), false);
    const factorConversation = 'conv_factor_research'; runtime.createConversation('orchestrator', 'Factor fixture', null, factorConversation);
    for (const [name, conversation] of [['strategy-research', 'conv_main'], ['factor-research', factorConversation]]) {
      const session = await runtime.session(conversation);
      await call(conversation, 'plugin_load', { plugin_id: `sesame/${name}` });
      assert.deepEqual(session.resourceLoader.getSkills().skills.filter(skill => names.includes(skill.name)).map(skill => skill.name), [name]);
      const manifest = JSON.parse(await readFile(join(packages, name, 'plugin.json'), 'utf8'));
      for (const path of [`skills/${name}/SKILL.md`, ...manifest.resources]) {
        const resource = await call(conversation, 'plugin_read', { plugin_id: `sesame/${name}`, path });
        assert.equal(resource.content, await readFile(join(packages, name, path), 'utf8'));
      }
    }
    await assert.rejects(() => call('conv_main', 'plugin_read', { plugin_id: 'sesame/factor-research', path: 'scripts/factor.mjs' }), /未挂载|不可使用/);
    const copyResource = async (conversation, name, source, target) => {
      const resource = await call(conversation, 'plugin_read', { plugin_id: `sesame/${name}`, path: source });
      await call(conversation, 'write', { path: target, content: resource.content }); return resource.content;
    };
    const node = `${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)}`;
    await copyResource('conv_main', 'strategy-research', 'scripts/experiment.mjs', 'experiment.mjs');
    for (const name of ['plan', 'timing', 'trials']) await copyResource('conv_main', 'strategy-research', `examples/${name}.demo.json`, `${name}.json`);
    for (const command of ['plan plan.json', 'timing plan.json timing.json', 'ledger plan.json trials.json']) {
      const run = await call('conv_main', 'bash', { command: `${node} experiment.mjs ${command}`, timeout: 30 });
      assert.equal(run.exit_code, 0, JSON.stringify(run)); assert.deepEqual(run.snapshot_errors ?? [], []);
    }
    const packageName = 'factor-research', conversation = factorConversation;
    await copyResource(conversation, packageName, 'scripts/factor.mjs', 'factor.mjs');
    const plan = JSON.parse((await call(conversation, 'plugin_read', { plugin_id: 'sesame/factor-research', path: 'examples/plan.demo.json' })).content);
    const sources = [];
    for (const part of ['development', 'holdout']) {
      const rows = JSON.parse((await call(conversation, 'plugin_read', { plugin_id: 'sesame/factor-research', path: `examples/${part}.demo.json` })).content), id = `demo-factor-${part}`;
      store.put('dataset', { id, title: `Explicitly invented ${part}`, rows, provenance: { kind: 'demo', source_kind: 'synthetic' } });
      // The public HostContext gives data_read a canonical JSON clone. This
      // fixture knows both invented inputs; the CLI sees holdout only later.
      plan.data[`${part}Sha256`] = hash(canonical(rows)); sources.push(id);
    }
    await call(conversation, 'write', { path: 'plan.json', content: JSON.stringify(plan) });
    const exported = await call(conversation, 'data_read', { dataset_id: sources[0] });
    assert.equal(hash(await readFile(exported.path)), plan.data.developmentSha256);
    for (const args of [`screen plan.json inputs/${sources[0]}.json --out screen.json`, 'select plan.json screen.json rank_signal --out selection.json']) {
      const run = await call(conversation, 'bash', { command: `${node} factor.mjs ${args}`, timeout: 30 }); assert.equal(run.exit_code, 0, JSON.stringify(run));
    }
    const workspace = runtime.workspaces.root(conversation);
    const developmentRef = await call(conversation, 'report_data', { operation_id: 'factor-demo-development', dataset_id: sources[0] });
    await call(conversation, 'write', { path: 'seal-selection.mjs', content: "import fs from 'node:fs'; const selection=JSON.parse(fs.readFileSync('selection.json')); fs.mkdirSync('output',{recursive:true}); fs.writeFileSync('output/selection.rows.json',JSON.stringify([selection]));\n" });
    const seal = await call(conversation, 'bash', { command: `${node} seal-selection.mjs`, timeout: 30 });
    assert.equal(seal.exit_code, 0, JSON.stringify(seal)); assert.deepEqual(seal.snapshot_errors ?? [], []);
    const selectionDataset = await call(conversation, 'research_register', { execution_id: seal.execution_id, path: 'output/selection.rows.json', title: 'Fictional fixed factor selection before holdout', description: 'Declared rank_signal choice on invented development data; not evidence of untouched market data', input_ids: [sources[0]], recipe_paths: ['factor.mjs', 'plan.json', 'screen.json', 'selection.json', 'seal-selection.mjs'] });
    const selectionRef = await call(conversation, 'report_data', { operation_id: 'factor-demo-selection', dataset_id: selectionDataset.dataset_id, dependencies: [developmentRef.ref] });
    assert.equal(selectionRef.provenance.kind, 'demo');
    const selected = JSON.parse(await readFile(join(workspace, 'selection.json'), 'utf8'));
    assert.deepEqual(runtime.contractArtifacts.data(selectionRef.ref).rows, [selected]);
    await assert.rejects(readFile(join(workspace, 'inputs', `${sources[1]}.json`)), { code: 'ENOENT' });
    const exportedHoldout = await call(conversation, 'data_read', { dataset_id: sources[1] });
    assert.equal(hash(await readFile(exportedHoldout.path)), plan.data.holdoutSha256);
    const holdout = await call(conversation, 'bash', { command: `${node} factor.mjs holdout plan.json inputs/${sources[1]}.json screen.json selection.json --out holdout.json`, timeout: 30 });
    assert.equal(holdout.exit_code, 0, JSON.stringify(holdout));
    await call(conversation, 'write', { path: 'extract.mjs', content: "import fs from 'node:fs'; const result=JSON.parse(fs.readFileSync('holdout.json')); fs.mkdirSync('output',{recursive:true}); fs.writeFileSync('output/rows.json', JSON.stringify(result.selected.curve.map(row=>({...row,provenance:'demo',planDigest:result.planDigest,selectionDigest:result.selectionDigest}))));\n" });
    const run = await call(conversation, 'bash', { command: `${node} extract.mjs`, timeout: 30 });
    assert.equal(run.exit_code, 0, JSON.stringify(run)); assert.deepEqual(run.snapshot_errors ?? [], []);
    const registered = await call(conversation, 'research_register', { execution_id: run.execution_id, path: 'output/rows.json', title: 'Fictional factor holdout diagnostics', description: 'Original fixed script on invented data; not a native backtest or market performance', input_ids: sources, recipe_paths: ['factor.mjs', 'plan.json', 'screen.json', 'selection.json', 'holdout.json', 'extract.mjs'] });
    assert.equal(registered.row_count, 4);
    const holdoutRef = await call(conversation, 'report_data', { operation_id: 'factor-demo-holdout-input', dataset_id: sources[1] });
    const fixed = await call(conversation, 'report_data', { operation_id: 'factor-demo-output', dataset_id: registered.dataset_id, dependencies: [selectionRef.ref, holdoutRef.ref] });
    assert.equal(fixed.provenance.kind, 'demo'); assert.equal(runtime.contractArtifacts.data(fixed.ref).rows.length, 4);
    await close(); await open();
    assert.deepEqual((await runtime.session('conv_main')).resourceLoader.getSkills().skills.filter(skill => names.includes(skill.name)).map(skill => skill.name), ['strategy-research']);
    assert.deepEqual((await runtime.session(conversation)).resourceLoader.getSkills().skills.filter(skill => names.includes(skill.name)).map(skill => skill.name), ['factor-research']);
    assert.equal(runtime.contractArtifacts.data(fixed.ref).rows.length, 4);
    assert.deepEqual(runtime.contractArtifacts.data(selectionRef.ref).rows, [selected]); assert.deepEqual(requests, []);
    t.diagnostic(JSON.stringify({ installed: 2, isolatedSkills: true, reopened: true, realNodeCommands: 8, fixedSelectionBeforeHoldoutExport: true, selection: selectionRef.ref, frozenDemoRows: 4, data: fixed.ref, modelCalls: 0, networkCalls: 0, nativeEngineCalls: 0 }));
  } finally { await close(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
