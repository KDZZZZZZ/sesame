import {readPackageDirectory} from '../../protocol/directory.mjs';
/** Method packaging and host integration only; no live model or user workspace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLock } from '../../api-v1/scripts/plugin-lock.mjs';

const source = fileURLToPath(new URL('../packages/deep-reasoning/', import.meta.url));
const core = fileURLToPath(new URL('../../api-v1/', import.meta.url));
const read = async path => readFile(join(source, path), 'utf8');
const json = async path => JSON.parse(await read(path));

test('deep-reasoning is a standalone, closed knowledge package with readable local links', async () => {
  const manifest = readPackageDirectory(source).manifest, declaration = readPackageDirectory(source).capabilities;
  assert.deepEqual(manifest.permissions, { scopes: [], calls: [] });
  assert.deepEqual(manifest.dependencies ?? [], []);
  assert.deepEqual(declaration.capabilities, []);
  assert.deepEqual(await (await import(pathToFileURL(join(source, 'index.js')))).createCapabilities(), []);
  const published = new Set([...manifest.prompts, ...manifest.resources, ...declaration.knowledge.map(item => item.path)]);
  for (const path of published) {
    const body = await read(path);
    if (!path.endsWith('.md')) continue;
    for (const match of body.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      const link = match[1];
      if (/^[a-z]+:/i.test(link)) continue;
      const target = relative(source, resolve(source, dirname(path), link)).replaceAll('\\', '/');
      assert.ok(!isAbsolute(target) && !target.startsWith('..'), `${path}: escaping link ${link}`);
      assert.ok(published.has(target), `${path}: undeclared resource ${target}`);
      assert.ok((await read(target)).length > 0);
    }
  }
});

const hostRoot = process.env.SESAME_HOST_ROOT;
test('deep-reasoning installs, is discoverable, loads selectively and survives reopen on the actual host', { skip: !hostRoot, timeout: 90000 }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js');
  const { Runtime } = await load('modules/agent/runtime.js');
  const { ModelRuntime } = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const { validateSchemas } = await load('modules/shared/schema-service.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-deep-reasoning-')));
  const bundle = join(root, 'bundle'), originalFetch = globalThis.fetch, requests = [];
  let runtime, store;
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  try {
    const lock = buildLock(core);
    await mkdir(bundle);
    for (const pkg of lock.packages) await cp(join(core, 'packages', pkg.directory), join(bundle, pkg.directory), { recursive: true });
    await writeFile(join(bundle, 'official-plugins.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    modelRuntime.registerProvider('fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'fixture', name: 'Uncalled fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    globalThis.fetch = async url => { requests.push(String(url)); throw new Error('No network is allowed in the plugin packaging test'); };
    const open = async () => {
      store = new Store(join(root, 'state'));
      runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: bundle, modelRuntime, model: modelRuntime.getModel('fixture', 'fixture') }).init();
      await runtime.session('conv_main');
    };
    const call = async (name, input) => {
      const descriptor = runtime.capabilities.descriptors().find(item => item.localId === name);
      assert.ok(descriptor, name);
      const actor = runtime.authority.bind({ kind: 'main', sessionId: 'conv_main', pluginId: 'host' }, runtime.capabilities.hostEntry);
      const result = await runtime.capabilities.invoke(descriptor.id, input, {}, actor);
      assert.equal(result.type, 'result');
      return result.value;
    };
    await open();
    const candidate = join(runtime.workspaces.root('conv_main'), 'deep-reasoning');
    await cp(source, candidate, { recursive: true });
    await t.test('production installation accepts the package without other research plugins', async () => {
      const result = await call('plugin_install', { path: candidate, operationId: 'deep-reasoning-install-fixture-1' });
      assert.equal(result.plugin.id, 'sesame/deep-reasoning');
      assert.equal(result.plugin.version, '1.0.0');
      assert.equal(result.plugin.runtime_status, 'ready');
      assert.equal(runtime.plugins.entries.has('sesame/investment-research'), false);
      assert.equal(runtime.plugins.active('conv_main', 'sesame/deep-reasoning'), false);
    });
    await t.test('discovery, loaded prompts and every on-demand reference use actual plugin tools', async () => {
      const found = await call('plugin_discover', { query: '深度推理' });
      assert.ok(JSON.stringify(found).includes('sesame/deep-reasoning'));
      const { plugin: loaded } = await call('plugin_load', { pluginId: 'sesame/deep-reasoning' });
      assert.equal(runtime.plugins.active('conv_main', 'sesame/deep-reasoning'), true);
      assert.deepEqual(loaded.prompts.map(item => item.path), ['instructions.md']);
      assert.deepEqual(loaded.skills.map(item => item.name), ['deep-reasoning']);
      assert.equal(loaded.prompts[0].content.trim(), (await read('instructions.md')).trim());
      assert.equal(loaded.skills[0].content.trim(), (await read('skills/deep-reasoning/SKILL.md')).trim());
      for (const resource of (readPackageDirectory(source).capabilities).knowledge) {
        const response = await call('plugin_read', { pluginId: 'sesame/deep-reasoning', part: 'resource', path: resource.path });
        assert.equal(response.content.trim(), (await read(resource.path)).trim(), resource.path);
      }
    });
    await t.test('all three isolated example inputs satisfy the real host Agent schema', async () => {
      const descriptor = runtime.capabilities.descriptors().find(item => item.id === 'host.agent.run');
      assert.ok(descriptor?.inputSchema);
      const tasks = await json('examples/parallel-tasks.json'), evidence = await json('examples/evidence.json');
      assert.equal(tasks.length, 3);
      assert.equal(new Set(tasks.map(item => item.instructions)).size, 3);
      for (const task of tasks) {
        await validateSchemas([{ schema: descriptor.inputSchema, value: task }]);
        assert.deepEqual(task.input.evidence, evidence);
        assert.deepEqual(Object.keys(task.input).sort(), ['delivery', 'evidence']);
        assert.deepEqual(task.plugins, ['sesame/deep-reasoning']);
        assert.deepEqual(task.output, { type: 'none' });
        assert.deepEqual(task.allowedCalls, [{ pluginId: 'sesame/plugin-manager', capabilityId: 'plugin_read' }]);
      }
    });
    await t.test('installed identity, knowledge and session loadout survive reopening', async () => {
      const digest = runtime.plugins.entry('sesame/deep-reasoning').digest;
      await close();
      await open();
      assert.equal(runtime.plugins.entry('sesame/deep-reasoning').digest, digest);
      assert.equal(runtime.plugins.entry('sesame/deep-reasoning').runtime_status, 'ready');
      assert.equal(runtime.plugins.active('conv_main', 'sesame/deep-reasoning'), true);
      const response = await call('plugin_read', { pluginId: 'sesame/deep-reasoning', part: 'resource', path: 'references/reconciliation.md' });
      assert.equal(response.content.trim(), (await read('references/reconciliation.md')).trim());
    });
    assert.deepEqual(requests, [], 'installation and knowledge loading must not start research');
  } finally {
    await close();
    globalThis.fetch = originalFetch;
    // root is the exact directory returned by mkdtemp, never a computed user path.
    await rm(root, { recursive: true, force: true });
  }
});
