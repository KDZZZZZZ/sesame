import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_URL, catalogQuery, installCatalog, treeDigest } from '../packages/plugin-manager/catalog.js';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function directory() {
  const files = { 'plugin.json': Buffer.from('{"id":"sesame/example","version":"1.0.0","apiVersion":"1"}'), LICENSE: Buffer.from('MIT fixture') };
  const index = Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes).slice(7) }));
  const entry = { id: 'sesame/example', version: '1.0.0', apiVersion: '1', status: 'active', title: 'Example', description: 'Fixture only', source: { repository: 'https://github.com/KDZZZZZZ/sesame', commit: 'a'.repeat(40), path: 'plugins/optional-api-v1/packages/example' }, package: { files: index, treeDigest: treeDigest(index) }, review: { automated: 'package-static-review', human: 'not-recorded' } };
  return { files, entry, catalog: { schemaVersion: 1, apiVersion: '1', channel: 'development', plugins: [entry] } };
}
function download(f, corrupt = false) {
  const requests = [];
  return { requests, fetcher: async (url, options) => {
    requests.push(url); assert.equal(options.redirect, 'error');
    if (url === CATALOG_URL) return new Response(JSON.stringify(f.catalog));
    assert.ok(url.startsWith(`https://raw.githubusercontent.com/KDZZZZZZ/sesame/${f.entry.source.commit}/${f.entry.source.path}/`));
    const file = decodeURIComponent(url.split('/').at(-1)); return new Response(corrupt ? 'changed' : f.files[file]);
  } };
}
async function hostFixture(t, f, status = 'ready') {
  const root = await mkdtemp(join(tmpdir(), 'catalog-fixture-')); t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [], operations = new Map();
  const host = { scope: { kind: 'main' }, workspace: { path: name => join(root, name) }, storage: { idempotentAsync: async (id, fingerprint, action) => {
    if (operations.has(id)) { assert.equal(operations.get(id).fingerprint, fingerprint); return operations.get(id).value; }
    const value = await action(); operations.set(id, { fingerprint, value }); return value;
  } }, plugins: { discover: () => ({ items: [] }), manage: async (action, args) => {
    calls.push({ action, args });
    if (action === 'test') { for (const [name, bytes] of Object.entries(f.files)) assert.deepEqual(await readFile(join(args.path, name)), bytes); return { passed: true, id: f.entry.id, version: f.entry.version, digest: f.entry.package.treeDigest, results: [{ scope: 'static fixture' }] }; }
    assert.equal(action, 'install'); return { id: f.entry.id, runtime_status: status, diagnostics: status === 'ready' ? [] : ['activation failed'] };
  }, load: async id => { calls.push({ action: 'load', id }); return { id, loaded: true }; } } };
  return { host, calls };
}

test('catalog query returns a fixed digest, precise active identity and honest review metadata', async () => {
  const f = directory(), net = download(f), queried = await catalogQuery({ plugin_id: f.entry.id }, undefined, net.fetcher);
  assert.equal(queried.catalog_digest, hash(JSON.stringify(f.catalog))); assert.equal(queried.items[0].review.human, 'not-recorded'); assert.equal(queried.items[0].package.files, 2); assert.equal(net.requests.length, 1);
  f.entry.status = 'withdrawn'; assert.deepEqual((await catalogQuery({}, undefined, net.fetcher)).items, []);
});

test('catalog install verifies bytes then tests, installs and refreshes tools; retries do not install twice', async t => {
  const f = directory(), net = download(f), fixture = await hostFixture(t, f), args = { command_id: 'install-fixture-123', plugin_id: f.entry.id, catalog_digest: hash(JSON.stringify(f.catalog)) };
  const result = await installCatalog(fixture.host, args, undefined, net.fetcher); assert.equal(result.loaded, true);
  await installCatalog(fixture.host, { catalog_digest: args.catalog_digest, plugin_id: args.plugin_id, command_id: args.command_id }, undefined, net.fetcher);
  assert.deepEqual(fixture.calls.map(call => call.action), ['test', 'install', 'load', 'load']);
});

test('modified files, moving catalogs and unsafe source paths cannot reach package execution', async t => {
  const f = directory(), fixture = await hostFixture(t, f), args = { command_id: 'reject-fixture-123', plugin_id: f.entry.id, catalog_digest: hash(JSON.stringify(f.catalog)) };
  await assert.rejects(installCatalog(fixture.host, args, undefined, download(f, true).fetcher), /byte budget|differs/); assert.deepEqual(fixture.calls, []);
  await assert.rejects(installCatalog(fixture.host, { ...args, catalog_digest: hash('different') }, undefined, download(f).fetcher), { code: 'CATALOG_CHANGED' });
  f.entry.source.commit = 'main'; await assert.rejects(catalogQuery({}, undefined, download(f).fetcher), /pin/);
});

test('native activation diagnostics are returned without claiming loaded or triggering dependency setup', async t => {
  const f = directory(), fixture = await hostFixture(t, f, 'failed');
  const result = await installCatalog(fixture.host, { command_id: 'failed-fixture-123', plugin_id: f.entry.id, catalog_digest: hash(JSON.stringify(f.catalog)) }, undefined, download(f).fetcher);
  assert.equal(result.loaded, false); assert.deepEqual(result.installed.diagnostics, ['activation failed']); assert.deepEqual(fixture.calls.map(call => call.action), ['test', 'install']);
});
