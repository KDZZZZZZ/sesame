import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogPackage } from '../scripts/catalog.mjs';
import { packageFiles, treeDigest } from '../scripts/plugin-lock.mjs';
import { readCatalog, catalogQuery } from '../packages/plugin-manager/catalog.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
// Local shape fixtures only. These identities are never written to the release
// sources, published catalog, reviewed plans or application lock.
function candidate(name, optional = false) {
  const sourceRoot = `plugins/${optional ? 'optional-api-v1' : 'api-v1'}`, path = `${sourceRoot}/packages/${name}`;
  const manifest = JSON.parse(readFileSync(join(root, path, 'plugin.json')));
  const declaration = JSON.parse(readFileSync(join(root, path, manifest.capability_manifest)));
  const files = packageFiles(join(root, path));
  const pkg = { id: manifest.id, directory: name, version: manifest.version, files, treeDigest: treeDigest(files) };
  const tag = `plugins-${optional ? 'optional-' : ''}api-v1-dev.999999`, base = `https://github.com/KDZZZZZZ/sesame/releases/download/${tag}`;
  const release = { tag, sourceRoot, sourceCommit: 'a'.repeat(40), releaseCommit: 'b'.repeat(40),
    archive: { url: `${base}/sesame-${optional ? 'optional' : 'official'}-plugins-api-v1-dev.999999.tar.gz`, sha256: 'c'.repeat(64) },
    lock: { url: `${base}/official-plugins.lock.json`, sha256: 'd'.repeat(64) }, review: { url: `${base}/review.json`, sha256: 'e'.repeat(64) } };
  return { pkg, manifest, declaration, release, entry: catalogPackage(pkg, manifest, declaration, release) };
}

test('catalog API 2 projects only explicit capabilities for native, MCP and knowledge-only packages', () => {
  for (const [name, optional] of [['workspace', false], ['investment-research', true], ['trading-decision', true], ['market-data-parser', true], ['behavioral-finance', true]]) {
    const f = candidate(name, optional);
    assert.equal(f.entry.apiVersion, '2'); assert.equal(f.entry.capabilityManifest, f.manifest.capability_manifest);
    assert.deepEqual(f.entry.tools, f.declaration.capabilities.filter(cap => cap.consumers.includes('agent')).map(cap => cap.id));
    assert.deepEqual(f.entry.capabilities.map(cap => cap.id), f.declaration.capabilities.map(cap => cap.id));
    assert.deepEqual(f.entry.capabilities.map(cap => cap.binding), f.declaration.capabilities.map(cap => cap.binding));
    assert.deepEqual(f.entry.engines, f.manifest.engines);
    assert.deepEqual(f.entry.package, { treeDigest: f.pkg.treeDigest, files: f.pkg.files });
    assert.equal(f.entry.format, f.manifest.execution === 'mcp' ? 'sesame-mcp' : 'sesame-native');
    assert.ok(f.entry.requirements.includes('API 2'));
    assert.equal(f.entry.review.human, 'not-recorded');
  }
});

test('API 1 manifests, mismatched declarations and undeclared capability files cannot be projected as API 2', () => {
  const f = candidate('workspace');
  for (const [manifest, declaration] of [
    [{ ...f.manifest, apiVersion: '1' }, f.declaration],
    [f.manifest, { ...f.declaration, apiVersion: '1' }],
    [{ ...f.manifest, capability_manifest: '../outside.json' }, f.declaration],
    [{ ...f.manifest, capability_manifest: 'missing.json' }, f.declaration],
  ]) assert.throws(() => catalogPackage(f.pkg, manifest, declaration, f.release), /API 2|capability manifest/);
});

test('optional catalog labels preserve legacy bytes and never replace package authority', () => {
  const f = candidate('workspace'), baseline = JSON.stringify(f.entry);
  const project = classification => catalogPackage(f.pkg, f.manifest, f.declaration, f.release, { classification });
  for (const classification of [undefined, {}, { category: 'workspace', title: { en: 'Historical', zh: '历史' } }]) {
    assert.equal(JSON.stringify(project(classification)), baseline);
  }
  const classified = project({ functionalCategory: 'platform', implementationKinds: ['service', 'function'],
    id: 'invented', version: '0.0.0', package: {}, source: {}, capabilities: [], engines: {}, status: 'withdrawn' });
  assert.equal(classified.functionalCategory, 'platform');
  assert.deepEqual(classified.implementationKinds, ['service', 'function']);
  const { functionalCategory, implementationKinds, ...unchanged } = classified;
  assert.equal(JSON.stringify(unchanged), baseline);
  assert.equal(project({ functionalCategory: 'platform' }).implementationKinds, undefined);
  assert.equal(project({ implementationKinds: ['knowledge'] }).functionalCategory, undefined);
  for (const classification of [{ functionalCategory: 'unknown' }, { functionalCategory: null },
    { implementationKinds: [] }, { implementationKinds: ['adapter', 'adapter'] },
    { implementationKinds: ['script'] }, { implementationKinds: 'service' }]) {
    assert.throws(() => project(classification), /Catalog policy/);
  }
});

test('the current reader consumes generated API 2 summaries and rejects an API 1 directory or entry', async () => {
  const f = candidate('workspace'), catalog = { schemaVersion: 1, apiVersion: '2', channel: 'development', releases: [f.release], plugins: [f.entry] };
  const fetcher = value => async () => new Response(JSON.stringify(value));
  const result = await catalogQuery({ plugin_id: f.entry.id }, undefined, fetcher(catalog));
  assert.equal(result.apiVersion, '2'); assert.deepEqual(result.items[0].capabilities, f.entry.capabilities);
  for (const broken of [{ ...catalog, apiVersion: '1' }, { ...catalog, plugins: [{ ...f.entry, apiVersion: '1' }] }]) {
    await assert.rejects(readCatalog(undefined, fetcher(broken)), { code: 'CATALOG_INVALID' });
  }
});

test('search classification reaches the catalog reader and keyword discovery without changing package authority', async () => {
  const f = candidate('web-sources', true);
  const entry = catalogPackage(f.pkg, f.manifest, f.declaration, f.release, { classification: { functionalCategory: 'search', implementationKinds: ['adapter'] } });
  const catalog = { schemaVersion: 1, apiVersion: '2', channel: 'development', releases: [f.release], plugins: [entry] };
  const fetcher = async () => new Response(JSON.stringify(catalog));
  for (const query of ['search', '搜索与来源']) {
    const result = await catalogQuery({ query }, undefined, fetcher);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, f.entry.id);
    assert.equal(result.items[0].functionalCategory, 'search');
    assert.deepEqual(result.items[0].capabilities, f.entry.capabilities);
    assert.deepEqual(result.items[0].source, f.entry.source);
    assert.equal(result.items[0].package.treeDigest, f.entry.package.treeDigest);
  }
  assert.equal((await catalogQuery({ query: '平台管理' }, undefined, fetcher)).items.length, 0);
});

const hostRoot = process.env.SESAME_HOST_ROOT;
test('real package admission enforces the declared host minimum for current API 2 source', { skip: !hostRoot }, async () => {
  const { inspectPackage } = await import(pathToFileURL(join(hostRoot, 'modules/agent/plugin-system/package.js')));
  const f = candidate('trading-decision', true);
  const files = Object.fromEntries(f.pkg.files.map(file => [file.path, readFileSync(join(root, f.entry.source.path, file.path))]));
  assert.throws(() => inspectPackage(files, { applicationVersion: '0.2.0' }), { code: 'plugin_host_incompatible' });
  assert.throws(() => inspectPackage(files, { applicationVersion: '0.2.2' }), { code: 'plugin_host_incompatible' });
  assert.throws(() => inspectPackage(files, { applicationVersion: '0.2.3' }), { code: 'plugin_host_incompatible' });
  assert.throws(() => inspectPackage(files, { applicationVersion: '0.2.4' }), { code: 'plugin_host_incompatible' });
  const inspected = inspectPackage(files, { applicationVersion: '0.3.0-dev.1' });
  assert.equal(inspected.apiVersion, '2'); assert.equal(inspected.id, f.pkg.id); assert.equal(inspected.digest, f.pkg.treeDigest);
  assert.deepEqual(inspected.engines, f.manifest.engines);
});
