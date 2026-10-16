import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { environment as ccxtEnvironment, selected as ccxtSelected } from '../packages/ccxt/environment.js';
import { environment as backtraderEnvironment, selected as backtraderSelected } from '../packages/backtrader/environment.js';
import { environment as vnpyEnvironment, configured as vnpyConfigured } from '../packages/vnpy/environment.js';
import { MT5Official } from '../packages/mt5/backend/official.js';
import { MT5ConfigImports } from '../packages/mt5/backend/config-import.js';
import { importConfiguration } from '../packages/mt5/backend/configuration.js';
import { Store, hostForStore } from '../../api-v1/tests/mt5-host.js';

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'sesame-backend-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

for (const [name, version, environment, selected] of [
  ['ccxt', '4.5.85', ccxtEnvironment, ccxtSelected],
  ['backtrader', '1.9.78.123', backtraderEnvironment, backtraderSelected],
]) test(`${name}: explicit existing interpreter discovery persists a reusable selection without installation`, async t => {
  const root = await directory(t), python = join(root, 'existing-python'), calls = [];
  // A controlled interpreter port models a real successful import. Any install,
  // download or unexpected command fails; no user environment is inspected.
  const host = { storage: { directory: root }, environment: { pythonPath: null }, workspace: { run: async (argv, options) => {
    calls.push(argv);
    assert.equal(argv[0], python);
    assert.deepEqual(argv.slice(1, 4), ['-I', '-B', '-c']);
    assert.match(argv[4], new RegExp(`import_module\\('${name}'\\)`));
    assert.equal(options.cwd, root);
    await writeFile(argv.at(-1), JSON.stringify({ python, version: [3, 13, 0], platform: process.platform, bits: 64, library: version, packages: { [name]: version } }));
    return { exitCode: 0 };
  } } };
  const found = await environment(host, { action: 'inspect', python_path: python });
  assert.equal(found.ready, true); assert.equal(found.reused, true);
  assert.equal(JSON.parse(await readFile(join(root, 'selection.json'))).python, python);
  const reopened = { ...host, storage: { directory: root } };
  assert.equal((await selected(reopened)).python, python);
  assert.equal((await environment(reopened, { action: 'prepare' })).reused, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(await readdir(root), ['selection.json']);
});

test('vn.py: inspection alone does not select an environment; prepare on the verified path saves it without installing', async t => {
  const root = await directory(t), python = join(root, 'existing-python');
  const host = { storage: { directory: root }, environment: { pythonPath: null, capabilities: { platform: process.platform } }, workspace: { root: () => root, run: async argv => {
    assert.equal(argv[0], python); assert.deepEqual(argv.slice(1, 4), ['-I', '-B', '-c']);
    assert.match(argv[4], /from vnpy_ctastrategy.backtesting import BacktestingEngine/);
    await writeFile(argv.at(-1), JSON.stringify({ python, version: [3, 13, 0], platform: process.platform, arch: process.arch, bits: 64, engineImport: 'BacktestingEngine', packages: { vnpy: '4.5.0', 'vnpy-ctastrategy': '1.4.1' } }));
    return { exitCode: 0 };
  } } };
  const found = await vnpyEnvironment(host, { action: 'inspect', python_path: python });
  assert.equal(found.ready, true); assert.equal(found.configured, false);
  await assert.rejects(vnpyConfigured(host), { code: 'ENVIRONMENT_UNAVAILABLE' });
  assert.deepEqual(await readdir(root), []);
  const saved = await vnpyEnvironment(host, { action: 'prepare', python_path: python });
  assert.equal(saved.ready, true); assert.equal(saved.reused, true); assert.equal(saved.configured, true);
  assert.equal((await vnpyConfigured({ ...host, storage: { directory: root } })).python, python);
  assert.deepEqual(await readdir(root), ['environment.json']);
});

test('MT5: pasted GUI export is imported by reference, survives reopening, and never requests a settings window', async t => {
  const root = await directory(t), store = new Store(root);
  const host = { ...hostForStore(store), scope: { kind: 'main', conversationId: 'conv_main' }, messages: { read: (id, optional) => store.get('message', id, optional) }, configuration: { exclusive: action => action() } };
  const official = await new MT5Official(host, null).init();
  t.after(() => official.close());
  const imports = new MT5ConfigImports(host), messageId = 'msg_setup_fixture';
  const parts = imports.prepare(messageId, { scope: 'main', id: 'conv_main' }, [{ type: 'text', text: JSON.stringify({ mcpServers: { terminal: { type: 'http', url: 'http://127.0.0.1:22346/mcp', headers: { Authorization: 'Bearer setup-fixture-only' } } } }) }], null, {});
  store.put('message', { id: messageId, role: 'user', conversation_id: 'conv_main', content: parts });
  const resumed = new MT5ConfigImports(host);
  assert.equal(resumed.pending()[0].source_message_id, messageId);
  assert.doesNotMatch(JSON.stringify({ parts, pending: resumed.pending() }), /setup-fixture-only/);
  const request = { command_id: 'setup_by_reference_01', source_message_id: messageId, expected_version: official.config.version };
  const receipt = await importConfiguration(host, { official }, resumed, request);
  assert.equal(receipt.status, 'applied'); assert.equal(receipt.result.servers.terminal.authenticated, true);
  assert.deepEqual(await importConfiguration(host, { official }, resumed, request), receipt);
  assert.deepEqual(resumed.pending(), []);
  assert.doesNotMatch(JSON.stringify({ receipt, events: store.events, changes: store.list('configuration_change') }), /setup-fixture-only/);
  assert.equal(store.events.some(event => event.type === 'configuration.open'), false);
  assert.deepEqual(store.list('mt5_command'), []);
});
