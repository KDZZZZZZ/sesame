/** Actual API2 installation/update over an isolated R2 transport fixture. No live service is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, cp, rm, realpath, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildLock } from '../scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
const coreSource = fileURLToPath(new URL('../', import.meta.url));
const optionalSource = fileURLToPath(new URL('../../optional-api-v1/', import.meta.url));
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

async function call(runtime, name, args) {
  const tool = runtime.plugins.definitions({ conversationId: 'conv_main' }).find(item => item.name === name);
  assert.ok(tool, name);
  return (await tool.execute(randomUUID(), args)).details;
}

function catalogForFinancialResearch() {
  const sourceCommit = 'a'.repeat(40), lock = buildLock(optionalSource), pkg = lock.packages.find(item => item.id === 'sesame/financial-research');
  assert.ok(pkg, 'financial-research exists in the API2 optional source');
  const manifest = JSON.parse(readFileSync(join(optionalSource, 'packages', pkg.directory, 'plugin.json')));
  const declaration = JSON.parse(readFileSync(join(optionalSource, 'packages', pkg.directory, manifest.capability_manifest)));
  const release = { transport: 'r2', tag: 'r2-optional-api-v1-dev.99', profile: 'optional', sourceRoot: 'plugins/optional-api-v1', sourceCommit, releaseCommit: 'f'.repeat(40),
    archive: { url: 'https://dl.sesame.bot/plugins/api-v1/releases/dev.99/optional/plugins.tar.gz', sha256: 'a'.repeat(64) },
    lock: { url: 'https://dl.sesame.bot/plugins/api-v1/releases/dev.99/optional/official-plugins.lock.json', sha256: 'b'.repeat(64) },
    review: { url: 'https://dl.sesame.bot/plugins/api-v1/releases/dev.99/review.json', sha256: 'c'.repeat(64) } };
  const entry = { id: pkg.id, name: pkg.directory, version: pkg.version, apiVersion: '2', format: 'sesame-native', engines: manifest.engines,
    distribution: 'optional', title: manifest.title, description: manifest.description, license: manifest.license,
    status: 'active', release: release.tag, source: { repository: 'https://github.com/KDZZZZZZ/sesame', commit: sourceCommit, path: 'plugins/optional-api-v1/packages/financial-research' },
    package: { treeDigest: pkg.treeDigest, files: pkg.files, baseUrl: `https://dl.sesame.bot/plugins/api-v1/packages/${pkg.treeDigest.slice(7)}` },
    capabilityManifest: manifest.capability_manifest, capabilities: declaration.capabilities,
    tools: declaration.capabilities.filter(cap => cap.consumers.includes('agent')).map(cap => cap.id),
    review: { automated: 'package-static-review', human: 'not-recorded', record: release.review } };
  const objects = new Map();
  objects.set('plugins/api-v1/catalog.json', jsonBytes({ schemaVersion: 2, apiVersion: '2', channel: 'development', releases: [release], plugins: [entry] }));
  for (const file of pkg.files) objects.set(`plugins/api-v1/packages/${pkg.treeDigest.slice(7)}/${file.path}`, readFileSync(join(optionalSource, 'packages', pkg.directory, file.path)));
  return { catalogDigest: digest(objects.get('plugins/api-v1/catalog.json')), objects, entry };
}

test('API2 plugin manager self-updates and installs financial-research through fixed R2 package bytes', { skip: !hostRoot, timeout: 90000 }, async () => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const [{ Store }, { Runtime }, { createHostContextV2 }] = await Promise.all([
    load('modules/agent/store.js'), load('modules/agent/runtime.js'), load('modules/plugins/host-v2/context.js'),
  ]);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sesame-r2-host-')));
  let runtime, store; const originalFetch = globalThis.fetch, requests = [];
  const close = async () => { await runtime?.close(); runtime = null; store?.close(); store = null; };
  const open = async () => {
    store = new Store(join(root, 'state'));
    runtime = await new Runtime(store, { piDir: join(root, 'empty-pi'), officialPluginsDirectory: join(root, 'empty-official') }).init();
    return createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
  };
  try {
    const main = await open(), work = runtime.workspaces.root('conv_main'), previous = join(work, 'manager-previous'), current = join(work, 'manager-current');
    await cp(join(coreSource, 'packages/plugin-manager'), previous, { recursive: true });
    await cp(join(coreSource, 'packages/plugin-manager'), current, { recursive: true });
    const currentManifest = JSON.parse(await readFile(join(current, 'plugin.json'), 'utf8'));
    // Only the synthetic version differs. Both sides implement the current API2 boundary.
    for (const file of ['plugin.json', 'package.json']) {
      const value = JSON.parse(await readFile(join(previous, file), 'utf8')); value.version = '2.9.9';
      await writeFile(join(previous, file), jsonBytes(value));
    }
    await main.plugins.install({ path: previous });
    await main.plugins.setEnabled('sesame/plugin-manager', true, { scope: 'session' });
    const before = await call(runtime, 'plugin_inspect', { pluginId: 'sesame/plugin-manager' });
    assert.equal(before.version, '2.9.9');
    const updated = await call(runtime, 'plugin_update', { pluginId: 'sesame/plugin-manager', path: current, expectedRevision: before.digest, operationId: 'r2-manager-self-update' });
    assert.equal(updated.plugin.version, currentManifest.version);
    assert.equal(updated.plugin.runtime_status, 'ready', JSON.stringify(updated));
    await close(); const reopened = await open();
    await reopened.plugins.setEnabled('sesame/plugin-manager', true, { scope: 'session' });
    assert.equal((await call(runtime, 'plugin_inspect', { pluginId: 'sesame/plugin-manager' })).version, currentManifest.version);
    const catalog = catalogForFinancialResearch();
    globalThis.fetch = async (url, options = {}) => {
      requests.push(String(url));
      assert.equal(options.redirect, 'error');
      assert.ok(String(url).startsWith('https://dl.sesame.bot/'), `unexpected network URL: ${url}`);
      const key = String(url).slice('https://dl.sesame.bot/'.length), bytes = catalog.objects.get(key);
      assert.ok(bytes, `missing fixture object: ${key}`);
      return new Response(bytes);
    };
    const queried = await call(runtime, 'plugin_catalog', { plugin_id: 'sesame/financial-research' });
    assert.equal(queried.apiVersion, '2'); assert.equal(queried.schemaVersion, 2);
    assert.equal(queried.catalog_digest, catalog.catalogDigest);
    assert.equal(queried.items[0].package.baseUrl, catalog.entry.package.baseUrl);
    const installed = await call(runtime, 'plugin_install_catalog', { command_id: 'r2-financial-install', plugin_id: 'sesame/financial-research', catalog_digest: queried.catalog_digest });
    assert.equal(installed.status, 'installed'); assert.equal(installed.loaded, true);
    assert.equal(installed.installed.digest, catalog.entry.package.treeDigest);
    assert.equal(installed.installed.version, catalog.entry.version);
    const activeTools = runtime.plugins.activeTools('conv_main');
    for (const name of ['financial_research_status', 'financial_research_configure', 'financial_research_query', 'financial_research_read']) assert.ok(activeTools.includes(name), name);
    assert.equal(requests.some(url => url.startsWith('https://raw.githubusercontent.com/')), false);
    assert.ok(requests.length > catalog.entry.package.files.length);
    await close(); const restored = await open();
    assert.equal((await restored.plugins.read('sesame/financial-research', { part: 'status' })).digest, catalog.entry.package.treeDigest);
  } finally {
    globalThis.fetch = originalFetch;
    await close();
    await rm(root, { recursive: true, force: true });
  }
});