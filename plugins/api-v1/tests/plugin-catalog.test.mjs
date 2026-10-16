import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_URL, catalogQuery, installCatalog, treeDigest } from '../packages/plugin-manager/catalog.js';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function directory({ official = false, format = 'sesame-native' } = {}) {
  const files = { 'plugin.json': Buffer.from('{"id":"sesame/example","version":"2.0.0","apiVersion":"2"}'), LICENSE: Buffer.from('MIT fixture') };
  const index = Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes).slice(7) }));
  const tag = official ? 'plugins-api-v1-dev.12' : 'plugins-optional-api-v1-dev.4', base = `https://github.com/KDZZZZZZ/sesame/releases/download/${tag}`;
  const release = { tag, sourceRoot: `plugins/${official ? 'api-v1' : 'optional-api-v1'}`, sourceCommit: 'a'.repeat(40), releaseCommit: 'b'.repeat(40),
    archive: { url: `${base}/sesame-${official ? 'official' : 'optional'}-plugins-api-v1-${tag.split('-').at(-1)}.tar.gz`, sha256: 'c'.repeat(64) },
    lock: { url: `${base}/official-plugins.lock.json`, sha256: 'd'.repeat(64) }, review: { url: `${base}/review.json`, sha256: 'e'.repeat(64) } };
  const entry = { id: 'sesame/example', version: '2.0.0', apiVersion: '2', format, status: 'active', title: 'Example', description: 'Fixture only', release: tag,
    source: { repository: 'https://github.com/KDZZZZZZ/sesame', commit: release.sourceCommit, path: `${release.sourceRoot}/packages/example` },
    package: { files: index, treeDigest: treeDigest(index) }, review: { automated: 'package-static-review', human: 'not-recorded', record: release.review } };
  return { files, entry, catalog: { schemaVersion: 1, apiVersion: '2', channel: 'development', releases: [release], plugins: [entry] } };
}
function r2Directory({ profile = 'optional', format = 'sesame-native' } = {}) {
  const f = directory({ official: profile === 'core', format }), release = f.catalog.releases[0], revision = '17';
  release.tag = `r2-${profile}-api-v1-dev.${revision}`; release.profile = profile; release.transport = 'r2'; delete release.engines;
  release.sourceRoot = profile === 'core' ? 'plugins/api-v1' : 'plugins/optional-api-v1';
  const base = `https://dl.sesame.bot/plugins/api-v1/releases/dev.${revision}`;
  release.archive = { url: `${base}/${profile}/plugins.tar.gz`, sha256: 'c'.repeat(64) };
  release.lock = { url: `${base}/${profile}/official-plugins.lock.json`, sha256: 'd'.repeat(64) };
  release.review = { url: `${base}/review.json`, sha256: 'e'.repeat(64) };
  f.entry.release = release.tag; f.entry.distribution = profile; f.entry.engines = { sesame: '>=0.2.2' };
  f.entry.source.path = `${release.sourceRoot}/packages/example`;
  f.entry.package.baseUrl = `https://dl.sesame.bot/plugins/api-v1/packages/${f.entry.package.treeDigest.slice(7)}`;
  f.entry.review.record = release.review;
  f.catalog.schemaVersion = 2;
  return f;
}
function download(f, corrupt = false) {
  const requests = [];
  return { requests, fetcher: async (url, options) => {
    requests.push(url); assert.equal(options.redirect, 'error'); options.signal.throwIfAborted();
    if (url === CATALOG_URL) return new Response(JSON.stringify(f.catalog));
    if (f.catalog.schemaVersion === 2) assert.ok(url.startsWith(`${f.entry.package.baseUrl}/`), 'R2 package files must use the content-addressed package base URL');
    else assert.ok(url.startsWith(`https://raw.githubusercontent.com/KDZZZZZZ/sesame/${f.entry.source.commit}/${f.entry.source.path}/`));
    const file = decodeURIComponent(url.split('/').at(-1)); return new Response(corrupt ? 'changed' : f.files[file]);
  } };
}
async function hostFixture(t, f, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'catalog-fixture-')); t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = { calls: [], current: options.current ?? null, root }, records = new Map();
  const mutate = async (action, source, params) => {
    fixture.calls.push({ action, args: { ...source, ...params } });
    for (const [name, bytes] of Object.entries(f.files)) assert.deepEqual(await readFile(join(source.path, name)), bytes);
    await options.onTest?.(fixture);
    if (options.passed === false) throw Object.assign(Error('Host declared assertion failed'), { code: 'PACKAGE_TEST_FAILED' });
    if (action === 'update') { assert.equal(params.expectedRevision, fixture.current.digest, 'version_conflict'); assert.ok(f.entry.version > fixture.current.version, 'higher SemVer required'); }
    else assert.equal(fixture.current, null);
    if (options.rejectedByHost) throw Object.assign(new Error(options.rejectedByHost), { code: options.rejectedByHost });
    fixture.current = { id: f.entry.id, version: f.entry.version, digest: f.entry.package.treeDigest, state: fixture.current?.state ?? 'discoverable', runtime_status: options.status ?? 'ready', diagnostics: options.status === 'failed' ? ['activation failed'] : [] };
    if (options.lostResponse) throw new Error('response lost after host commit');
    return { plugin: { ...fixture.current }, receipt: { status: 'completed' } };
  };
  const host = { context: { kind: 'main', sessionId: 'fixture-main', workspaceRoot: root, storageRoot: root }, state: {
    read: async key => { const item=records.get(JSON.stringify(key));if(!item)throw Object.assign(Error('missing'),{code:'NOT_FOUND'});return structuredClone(item); },
    commit: async changes => ({ entries: changes.map(change => { const key=JSON.stringify(change.key),prior=records.get(key);assert.equal(prior?.version??0,change.expectedVersion);const next={value:structuredClone(change.value),version:(prior?.version??0)+1};records.set(key,next);return next; }) }),
  }, plugins: {
    read: async () => { if (!fixture.current) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' }); return { ...fixture.current }; },
    install: (source, options) => mutate('install',source,options),
    update: (_id, source, options) => mutate('update',source,options),
    setEnabled: async id => { fixture.calls.push({ action: 'load', id }); assert.notEqual(fixture.current?.state, 'disabled'); return { id, enabled: true }; },
  } };
  return { ...fixture, get current() { return fixture.current; }, set current(value) { fixture.current = value; }, host };
}
const argsFor = (f, more = {}) => ({ command_id: 'catalog-fixture-123', plugin_id: f.entry.id, catalog_digest: hash(JSON.stringify(f.catalog)), ...more });
const previous = more => ({ id: 'sesame/example', version: '1.0.0', digest: hash('previous'), state: 'mounted', runtime_status: 'ready', external: false, ...more });

test('query accepts official native and MCP identities with fixed publication/review metadata', async () => {
  for (const format of ['sesame-native', 'sesame-mcp']) {
    const f = directory({ official: true, format }), net = download(f), queried = await catalogQuery({ plugin_id: f.entry.id }, undefined, net.fetcher);
    assert.equal(queried.catalog_digest, hash(JSON.stringify(f.catalog))); assert.equal(queried.items[0].review.human, 'not-recorded'); assert.equal(queried.items[0].format, format); assert.equal(queried.items[0].package.files, 2); assert.equal(net.requests.length, 1);
    f.entry.status = 'withdrawn'; assert.deepEqual((await catalogQuery({}, undefined, net.fetcher)).items, []);
  }
});

test('R2 catalog query/install/update uses dl.sesame.bot package URLs only', async t => {
  const f = r2Directory({ profile: 'optional' }), net = download(f), queried = await catalogQuery({ plugin_id: f.entry.id }, undefined, net.fetcher);
  assert.equal(queried.catalog_url, CATALOG_URL);
  assert.equal(queried.schemaVersion, 2);
  assert.equal(queried.items[0].package.baseUrl, f.entry.package.baseUrl);
  const installFixture = await hostFixture(t, f);
  assert.equal((await installCatalog(installFixture.host, argsFor(f), undefined, net.fetcher)).status, 'installed');
  assert.ok(net.requests.every(url => !url.startsWith('https://raw.githubusercontent.com/')));
  const updateFixture = await hostFixture(t, f, { current: previous() });
  const update = await installCatalog(updateFixture.host, argsFor(f, { action: 'update', command_id: 'r2-update-fixture-1', expected_digest: updateFixture.current.digest }), undefined, download(f).fetcher);
  assert.equal(update.status, 'updated');
});

test('R2 catalogs reject mixed legacy assets, arbitrary hosts and release compatibility shims', async () => {
  const changes = [
    f => { f.catalog.releases[0].archive.url = 'https://github.com/KDZZZZZZ/sesame/releases/download/r2-optional-api-v1-dev.17/plugins.tar.gz'; },
    f => { f.catalog.releases[0].engines = { sesame: '>=0.2.2' }; },
    f => { f.entry.package.baseUrl = 'https://example.com/plugins/api-v1/packages/' + f.entry.package.treeDigest.slice(7); },
    f => { f.entry.package.baseUrl = `https://dl.sesame.bot/plugins/api-v1/packages/${'f'.repeat(64)}`; },
    f => { f.entry.engines = undefined; },
    f => { f.entry.source.path = 'plugins/api-v1/packages/example'; },
  ];
  for (const change of changes) { const f = r2Directory(); change(f); await assert.rejects(catalogQuery({}, undefined, download(f).fetcher), { code: 'CATALOG_INVALID' }); }
});

test('R2 modified package bytes clean partial downloads before host tests', async t => {
  const f = r2Directory(), fixture = await hostFixture(t, f);
  await assert.rejects(installCatalog(fixture.host, argsFor(f), undefined, download(f, true).fetcher), /byte budget|differs/);
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(await readdir(join(fixture.root, 'plugin-drafts')), []);
});

test('install verifies bytes then formally tests/installs/loads; concurrent same-command retries mutate once', async t => {
  const f = directory(), net = download(f), fixture = await hostFixture(t, f), args = argsFor(f);
  const results = await Promise.all([installCatalog(fixture.host, args, undefined, net.fetcher), installCatalog(fixture.host, { ...args }, undefined, net.fetcher)]);
  assert.ok(results.every(item => item.loaded && item.status === 'installed'));
  assert.deepEqual(fixture.calls.map(call => call.action), ['install', 'load', 'load']);
});

test('official bundled update uses formal host test/update with unchanged expected digest and refreshes', async t => {
  const f = directory({ official: true }), fixture = await hostFixture(t, f, { current: previous() });
  const result = await installCatalog(fixture.host, argsFor(f, { action: 'update', expected_digest: fixture.current.digest }), undefined, download(f).fetcher);
  assert.equal(result.status, 'updated'); assert.equal(result.loaded, true);
  assert.deepEqual(fixture.calls.map(call => call.action), ['update', 'load']);
  assert.equal(fixture.calls[0].args.expectedRevision, previous().digest);
});

test('a different installed version requires explicit update and current digest before any package download', async t => {
  const f = directory({ official: true }), fixture = await hostFixture(t, f, { current: previous() }), net = download(f);
  await assert.rejects(installCatalog(fixture.host, argsFor(f), undefined, net.fetcher), { code: 'CATALOG_UPDATE_REQUIRED' });
  await assert.rejects(installCatalog(fixture.host, argsFor(f, { action: 'update' }), undefined, net.fetcher), { code: 'CATALOG_UPDATE_REQUIRED' });
  await assert.rejects(installCatalog(fixture.host, argsFor(f, { command_id: 'catalog-stale-12345', action: 'update', expected_digest: hash('stale') }), undefined, net.fetcher), { code: 'CATALOG_INSTALLED_CHANGED' });
  assert.ok(net.requests.every(url => url === CATALOG_URL)); assert.deepEqual(fixture.calls, []);
});

test('same version and bytes returns already-installed without download/test/reinstall; altered bytes reject', async t => {
  const f = directory(), fixture = await hostFixture(t, f, { current: previous({ version: f.entry.version, digest: f.entry.package.treeDigest }) }), net = download(f);
  const result = await installCatalog(fixture.host, argsFor(f), undefined, net.fetcher);
  assert.equal(result.status, 'already-installed'); assert.equal(result.reused, true); assert.deepEqual(fixture.calls.map(call => call.action), ['load']); assert.equal(net.requests.length, 1);
  fixture.current = previous({ version: f.entry.version });
  await assert.rejects(installCatalog(fixture.host, argsFor(f, { command_id: 'changed-version-123' }), undefined, net.fetcher), { code: 'CATALOG_VERSION_CONFLICT' });
});

test('disabled identical packages and explicit updates preserve policy without loading', async t => {
  const f = directory();
  for (const identical of [false, true]) {
    const fixture = await hostFixture(t, f, { current: previous({ state: 'disabled', ...(identical ? { version: f.entry.version, digest: f.entry.package.treeDigest } : {}) }) });
    const result = await installCatalog(fixture.host, argsFor(f, identical ? {} : { action: 'update', expected_digest: fixture.current.digest }), undefined, download(f).fetcher);
    assert.equal(result.loaded, false); assert.equal(result.installed.state, 'disabled'); assert.ok(!fixture.calls.some(call => call.action === 'load'));
  }
});

test('digest changes between test and update, higher-version rules and protected builtins remain host decisions', async t => {
  const f = directory({ official: true });
  for (const mode of ['changed', 'downgrade', 'plugin_builtin_managed']) {
    const fixture = await hostFixture(t, f, { current: previous({ version: mode === 'downgrade' ? '3.0.0' : '1.0.0' }), onTest: mode === 'changed' ? state => { state.current = previous({ digest: hash('concurrent') }); } : null, rejectedByHost: mode === 'plugin_builtin_managed' ? mode : null });
    await assert.rejects(installCatalog(fixture.host, argsFor(f, { action: 'update', expected_digest: fixture.current.digest }), undefined, download(f).fetcher), /version_conflict|SemVer|plugin_builtin_managed/);
    assert.deepEqual(fixture.calls.map(call => call.action), ['update']); assert.notEqual(fixture.current.version, f.entry.version);
  }
});

test('MCP packages run host tests and cannot install after a declared assertion failure', async t => {
  const f = directory({ official: true, format: 'sesame-mcp' });
  const fixture = await hostFixture(t, f, { passed: false });
  await assert.rejects(installCatalog(fixture.host, argsFor(f), undefined, download(f).fetcher), { code: 'PACKAGE_TEST_FAILED' }); assert.deepEqual(fixture.calls.map(call => call.action), ['install']);
  const ready = await hostFixture(t, f); assert.equal((await installCatalog(ready.host, argsFor(f), undefined, download(f).fetcher)).status, 'installed');
});

test('unknown post-commit response recovers from current exact package without a second mutation', async t => {
  const f = directory(), fixture = await hostFixture(t, f, { current: previous(), lostResponse: true }), args = argsFor(f, { action: 'update', expected_digest: previous().digest });
  await assert.rejects(installCatalog(fixture.host, args, undefined, download(f).fetcher), /response lost/);
  const result = await installCatalog(fixture.host, args, undefined, download(f).fetcher);
  assert.equal(result.status, 'already-installed'); assert.deepEqual(fixture.calls.map(call => call.action), ['update', 'load']);
});

test('replayed receipts never load a subsequently changed installation or accept changed operation arguments', async t => {
  const f = directory(), fixture = await hostFixture(t, f), args = argsFor(f), net = download(f);
  await installCatalog(fixture.host, args, undefined, net.fetcher);
  fixture.current = previous({ version: '3.0.0' });
  await assert.rejects(installCatalog(fixture.host, args, undefined, net.fetcher), { code: 'CATALOG_INSTALLED_CHANGED' });
  await assert.rejects(installCatalog(fixture.host, { ...args, action: 'update', expected_digest: fixture.current.digest }, undefined, net.fetcher), /Operation ID was reused/);
  assert.deepEqual(fixture.calls.map(call => call.action), ['install', 'load']);
});

test('modified files clean partial downloads, and moving/withdrawn catalogs never execute packages', async t => {
  const f = directory(), fixture = await hostFixture(t, f), args = argsFor(f);
  await assert.rejects(installCatalog(fixture.host, args, undefined, download(f, true).fetcher), /byte budget|differs/); assert.deepEqual(fixture.calls, []);
  assert.deepEqual(await readdir(join(fixture.root, 'plugin-drafts')), []);
  await assert.rejects(installCatalog(fixture.host, { ...args, command_id: 'catalog-changed-12345', catalog_digest: hash('different') }, undefined, download(f).fetcher), { code: 'CATALOG_CHANGED' });
  f.entry.status = 'withdrawn'; await assert.rejects(installCatalog(fixture.host, argsFor(f, {command_id:'catalog-withdrawn-123'}), undefined, download(f).fetcher), { code: 'CATALOG_UNAVAILABLE' });
});

test('floating commits, unrelated release paths/assets, fake approval and unsafe/colliding file names reject', async () => {
  const changes = [f => { f.entry.source.commit = 'main'; }, f => { f.entry.source.path = 'plugins/packages/example'; }, f => { f.catalog.releases[0].archive.url = 'https://example.com/latest'; }, f => { f.entry.review.human = 'approved'; }, f => { f.entry.package.files[0].path = '../plugin.json'; }, f => { f.entry.package.files.push({ ...f.entry.package.files[0], path: 'PLUGIN.JSON' }); }];
  for (const change of changes) { const f = directory(); change(f); await assert.rejects(catalogQuery({}, undefined, download(f).fetcher), { code: 'CATALOG_INVALID' }); }
});

test('activation failure is returned honestly, and resource-only stopped packages can still load prompts', async t => {
  for (const status of ['failed', 'stopped']) {
    const f = directory(), fixture = await hostFixture(t, f, { status });
    const result = await installCatalog(fixture.host, argsFor(f), undefined, download(f).fetcher);
    assert.equal(result.loaded, status === 'stopped');
    if (status === 'failed') assert.deepEqual(result.installed.diagnostics, ['activation failed']);
  }
});

test('subagents and invalid update arguments cannot fetch or mutate anything', async t => {
  const f = directory(), fixture = await hostFixture(t, f), net = download(f); fixture.host.context.kind = 'subagent';
  await assert.rejects(installCatalog(fixture.host, argsFor(f), undefined, net.fetcher), { code: 'FORBIDDEN' });
  fixture.host.context.kind = 'main';
  await assert.rejects(installCatalog(fixture.host, argsFor(f, { expected_digest: hash('extra') }), undefined, net.fetcher), { code: 'CATALOG_UPDATE_REQUIRED' });
  assert.deepEqual(net.requests, []); assert.deepEqual(fixture.calls, []);
});
