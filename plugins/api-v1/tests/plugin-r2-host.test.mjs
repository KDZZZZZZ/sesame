/** Real host bootstrap check for the R2 catalog path with temporary state only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, realpath, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildLock } from '../scripts/plugin-lock.mjs';
import { materializeSource } from '../../../.github/scripts/release-plugins.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
const oldSourceCommit = '22e07a4a78df17fa2c03180cb1f6d2c505f64c89';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const coreSource = fileURLToPath(new URL('../', import.meta.url));
const optionalSource = fileURLToPath(new URL('../../optional-api-v1/', import.meta.url));
const managerDraftPath = process.env.SESAME_R2_MANAGER_PATH ?? join(coreSource, 'packages/plugin-manager');
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

async function call(runtime, name, args) {
  const tool = runtime.plugins.definitions({ conversationId: 'conv_main' }).find(item => item.name === name);
  assert.ok(tool, name);
  return (await tool.execute('r2-host-fixture', args)).details;
}

function catalogForFinancialResearch(sourceCommit) {
  const lock = buildLock(optionalSource), locked = lock.packages.find(item => item.id === 'sesame/financial-research');
  assert.ok(locked, 'financial-research exists in optional lock');
  const manifest = JSON.parse(readFileSync(join(optionalSource, 'packages', locked.directory, 'plugin.json')));
  const tools = JSON.parse(readFileSync(join(optionalSource, 'packages', locked.directory, manifest.tool_definitions))).map(item => item.name);
  const release = { transport: 'r2', tag: 'r2-optional-api-v1-dev.99', profile: 'optional', sourceRoot: 'plugins/optional-api-v1', sourceCommit, releaseCommit: 'f'.repeat(40),
    archive: { url: 'https://dl.sesame.bot/plugins/api-v1/releases/dev.99/optional/plugins.tar.gz', sha256: 'a'.repeat(64) },
    lock: { url: 'https://dl.sesame.bot/plugins/api-v1/releases/dev.99/optional/official-plugins.lock.json', sha256: 'b'.repeat(64) },
    review: { url: 'https://dl.sesame.bot/plugins/api-v1/releases/dev.99/review.json', sha256: 'c'.repeat(64) } };
  const pkg = locked;
  const entry = { id: pkg.id, name: pkg.directory, version: pkg.version, apiVersion: '1', format: 'sesame-native', engines: manifest.engines,
    distribution: 'optional', title: manifest.title, description: manifest.description, license: manifest.license, author: manifest.author ?? { name: 'Sesame contributors', url: 'https://github.com/KDZZZZZZ/sesame' },
    status: 'active', release: release.tag, source: { repository: 'https://github.com/KDZZZZZZ/sesame', commit: sourceCommit, path: 'plugins/optional-api-v1/packages/financial-research' },
    package: { treeDigest: pkg.treeDigest, files: pkg.files, baseUrl: `https://dl.sesame.bot/plugins/api-v1/packages/${pkg.treeDigest.slice(7)}` },
    tools, review: { automated: 'package-static-review', human: 'not-recorded', record: release.review } };
  const objects = new Map();
  objects.set('plugins/api-v1/catalog.json', jsonBytes({ schemaVersion: 2, apiVersion: '1', channel: 'development', releases: [release], plugins: [entry] }));
  for (const file of pkg.files) objects.set(`plugins/api-v1/packages/${pkg.treeDigest.slice(7)}/${file.path}`, readFileSync(join(optionalSource, 'packages', pkg.directory, file.path)));
  return { catalog: JSON.parse(objects.get('plugins/api-v1/catalog.json')), catalogDigest: digest(objects.get('plugins/api-v1/catalog.json')), objects, entry };
}

test('old plugin manager self-updates then installs financial-research from an R2 catalog fixture', { skip: !hostRoot, timeout: 90000 }, async () => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { ModelRuntime } = await load('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-r2-host-'))), bundle = join(root, 'bundle');
  let runtime, store, modelRuntime; const originalFetch = globalThis.fetch, requests = [];
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  const open = async () => {
    store = new Store(join(root, 'state'));
    runtime = await new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: bundle, modelRuntime, model: modelRuntime.getModel('fixture', 'fixture') }).init();
    await runtime.session('conv_main');
  };
  try {
    await mkdir(bundle, { recursive: true });
    materializeSource(repository, { sourceCommit: oldSourceCommit, sourceRoot: 'plugins/api-v1' }, bundle);
    for (const name of await readdir(join(bundle, 'packages'))) await rename(join(bundle, 'packages', name), join(bundle, name));
    await rm(join(bundle, 'packages'), { recursive: true, force: true });
    await rm(join(bundle, 'bundle-profile.json'), { force: true });
    modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), refreshOnCreate: false });
    modelRuntime.registerProvider('fixture', { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'fixture', name: 'Uncalled fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
    await modelRuntime.setRuntimeApiKey('fixture', 'fixture-only');
    const live = process.env.SESAME_R2_LIVE === '1';
    const catalog = live ? null : catalogForFinancialResearch(await gitHead());
    globalThis.fetch = async (url, options = {}) => {
      requests.push(String(url));
      assert.equal(options.redirect, 'error');
      assert.ok(String(url).startsWith('https://dl.sesame.bot/'), `unexpected network URL: ${url}`);
      if (live) return originalFetch(url, options);
      const key = String(url).slice('https://dl.sesame.bot/'.length);
      const bytes = catalog.objects.get(key);
      assert.ok(bytes, `missing fixture object: ${key}`);
      return new Response(bytes);
    };
    await open();
    const before = await call(runtime, 'plugin_inspect', { plugin_id: 'sesame/plugin-manager' });
    assert.equal(before.version, '2.2.0');
    const checked = await call(runtime, 'plugin_test', { path: managerDraftPath });
    assert.equal(checked.passed, true, JSON.stringify(checked.results));
    const updated = await call(runtime, 'plugin_update', { command_id: 'r2-manager-self-update', path: managerDraftPath, digest: checked.digest, expected_digest: before.digest });
    assert.equal(updated.version, '2.3.0');
    assert.equal(updated.runtime_status, 'ready', JSON.stringify(updated));
    await close(); await open();
    runtime.plugins.activate('conv_main', 'sesame/plugin-manager');
    assert.equal((await call(runtime, 'plugin_inspect', { plugin_id: 'sesame/plugin-manager' })).version, '2.3.0');
    await call(runtime, 'plugin_load', { plugin_id: 'sesame/plugin-manager' });
    assert.equal(modelRuntime.hasConfiguredAuth('fixture'), true);
    const queried = await call(runtime, 'plugin_catalog', { plugin_id: 'sesame/financial-research' });
    assert.equal(queried.items[0].id, 'sesame/financial-research');
    if (!live) {
      assert.equal(queried.catalog_digest, catalog.catalogDigest);
      assert.equal(queried.items[0].package.baseUrl, catalog.entry.package.baseUrl);
    }
    const installed = await call(runtime, 'plugin_install_catalog', { command_id: 'r2-financial-install', plugin_id: 'sesame/financial-research', catalog_digest: queried.catalog_digest });
    assert.equal(installed.status, 'installed');
    assert.equal(installed.loaded, true);
    assert.equal(installed.installed.version, '1.0.0');
    const activeTools = (await runtime.session('conv_main')).getActiveToolNames();
    for (const name of ['financial_research_status', 'financial_research_configure', 'financial_research_query', 'financial_research_read']) assert.ok(activeTools.includes(name), name);
    assert.equal(requests.some(url => url.startsWith('https://raw.githubusercontent.com/')), false);
  } finally {
    await close();
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

async function gitHead() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: repository });
  return stdout.trim();
}
