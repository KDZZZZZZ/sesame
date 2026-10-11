/** Real loader/install/tool checks with temporary application state, never the user's app. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildLock } from '../scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT, run = promisify(execFile);
test('internal and external authoring install, load, execute and reopen on the matching host', { skip: !hostRoot, timeout: 90000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { ModelRuntime } = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-authoring-host-'))), bundle = join(root, 'bundle');
  const source = fileURLToPath(new URL('../', import.meta.url));
  let runtime, store; const originalFetch = globalThis.fetch, requests = [];
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  try {
    const lock = buildLock(source); await mkdir(bundle);
    for (const pkg of lock.packages) await cp(join(source, 'packages', pkg.directory), join(bundle, pkg.directory), { recursive: true });
    await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    modelRuntime.registerProvider('fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'fixture', name: 'Uncalled fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    globalThis.fetch = async url => { requests.push(String(url)); throw new Error('Unexpected network request in authoring host test'); };
    const open = async () => {
      store = new Store(join(root, 'state'));
      runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: bundle, modelRuntime, model: modelRuntime.getModel('fixture', 'fixture') }).init();
      await runtime.session('conv_main');
    };
    await open();
    assert.equal(runtime.plugins.entry('sesame/plugin-manager').runtime_status, 'ready');
    const call = async (name, args) => {
      const tool = runtime.plugins.definitions({ conversationId: 'conv_main' }).find(item => item.name === name); assert.ok(tool, name);
      return (await tool.execute('authoring-host', args)).details;
    };
    await t.test('the installed skill, API reference and portable CLI are readable by the Agent', async () => {
      for (const path of ['skills/develop-plugins/SKILL.md', 'skills/develop-plugins/references/host-api.md', 'skills/develop-plugins/references/authoring.md', 'scripts/create-plugin.mjs']) {
        const resource = await call('plugin_read', { plugin_id: 'sesame/plugin-manager', path });
        assert.ok(resource.content.length > 100, path);
      }
    });
    const args = { command_id: 'native-authoring-create-0001', name: 'internal-note', publisher: 'fixture', description: 'Offline authoring fixture', template: 'native', min_host: '0.2.2' };
    let internal;
    await t.test('internal native creation is idempotent and preserves edits', async () => {
      const drafts = await Promise.all([call('plugin_create', args), call('plugin_create', args)]);
      assert.deepEqual(drafts[0], drafts[1]); internal = drafts[0];
      assert.ok(internal.path.startsWith(runtime.workspaces.root('conv_main')));
      await writeFile(join(internal.path, 'README.md'), '# Author-edited draft\n');
      assert.deepEqual(await call('plugin_create', args), internal);
      assert.equal(await readFile(join(internal.path, 'README.md'), 'utf8'), '# Author-edited draft\n');
      await assert.rejects(call('plugin_create', { ...args, description: 'Changed request' }), { code: 'idempotency_conflict' });
    });
    const installed = [];
    const install = async path => {
      const validated = await call('plugin_validate', { path }); assert.equal(validated.valid, true, JSON.stringify(validated));
      const checked = await call('plugin_test', { path }); assert.equal(checked.passed, true, JSON.stringify(checked));
      const result = await call('plugin_install', { command_id: `install-authoring-${installed.length}-0001`, path, digest: checked.digest });
      assert.equal(result.runtime_status, 'ready', JSON.stringify(result));
      assert.equal(result.state, 'discoverable');
      await call('plugin_load', { plugin_id: result.id });
      const manifest = JSON.parse(await readFile(join(path, 'plugin.json'), 'utf8'));
      for (const name of manifest.tool_names) {
        assert.ok((await runtime.session('conv_main')).getActiveToolNames().includes(name));
        assert.deepEqual(await call(name, { text: 'Installed through the real host' }), { text: 'Installed through the real host' });
      }
      installed.push({ id: result.id, tools: manifest.tool_names });
    };
    await t.test('internally authored native package validates, installs and executes in the same session', () => install(internal.path));
    await t.test('external CLI native and skill packages use the same actual installation path', async () => {
      for (const template of ['native', 'skill']) {
        const path = join(root, `external-${template}`), cli = join(source, 'packages/plugin-manager/scripts/create-plugin.mjs');
        await run(process.execPath, [cli, '--name', `external-${template}`, '--publisher', 'fixture', '--description', 'External authoring fixture', '--template', template, '--output', path], { env: { ...process.env, NODE_OPTIONS: '' } });
        await install(path);
        const resource = await call('plugin_read', { plugin_id: `fixture/external-${template}`, path: `skills/external-${template}/SKILL.md` });
        assert.ok(resource.content.includes('starter'));
      }
    });
    await t.test('existing skill and MCP scaffolds remain usable', async () => {
      for (const template of ['skill', 'mcp-python']) {
        const draft = await call('plugin_create', { command_id: `old-template-${template}-0001`, name: `old-${template}`, description: 'Existing template fixture', template });
        const result = await call('plugin_validate', { path: draft.path }); assert.equal(result.valid, true, JSON.stringify(result));
      }
    });
    await t.test('changed files cannot be installed with a stale test digest', async () => {
      const checked = await call('plugin_test', { path: internal.path });
      await writeFile(join(internal.path, 'README.md'), '# Changed after test\n');
      await assert.rejects(call('plugin_install', { command_id: 'stale-authoring-install-0001', path: internal.path, digest: checked.digest }), { code: 'plugin_digest_changed' });
    });
    await t.test('installed plugins and native creation receipts survive application restart', async () => {
      await close(); await open();
      assert.deepEqual(await call('plugin_create', args), internal);
      assert.equal(await readFile(join(internal.path, 'README.md'), 'utf8'), '# Changed after test\n');
      for (const item of installed) {
        assert.equal(runtime.plugins.entry(item.id).runtime_status, 'ready');
        await call('plugin_load', { plugin_id: item.id });
        for (const name of item.tools) assert.deepEqual(await call(name, { text: 'After restart' }), { text: 'After restart' });
      }
    });
    assert.deepEqual(requests, []);
  } finally { await close(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
