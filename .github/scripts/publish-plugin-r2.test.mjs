import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_KEY, putImmutable, publishObjects, r2Store, reviewBytes } from './publish-plugin-r2.mjs';

function memoryStore() {
  const data = new Map(), calls = []; let revision = 0;
  return { data, calls,
    async get(key) { return data.get(key) ?? null; },
    async put(key, bytes, options) {
      calls.push({ key, options });
      const present = data.get(key);
      if (options.absent ? present : !present || present.etag !== options.etag) throw new Error('412 PreconditionFailed');
      data.set(key, { bytes: Buffer.from(bytes), etag: `"${++revision}"` });
    },
  };
}
function publication(n = 1) {
  return { catalog: { schemaVersion: 2, apiVersion: '2', channel: 'development', releases: ['core', 'optional'].map(profile => ({ tag: `r2-${profile}-api-v1-dev.${n}` })), plugins: [{ id: 'sesame/example' }] },
    objects: new Map([[`plugins/api-v1/releases/dev.${n}/core/plugins.tar.gz`, Buffer.from('archive')], [`plugins/api-v1/releases/dev.${n}/review.json`, Buffer.from('review')]]) };
}
test('immutable uploads preserve existing bytes and reject changed retries', async () => {
  const store = memoryStore(), key = 'plugins/api-v1/packages/abc/plugin.json';
  await putImmutable(store, key, Buffer.from('one'));
  await putImmutable(store, key, Buffer.from('one'));
  await assert.rejects(putImmutable(store, key, Buffer.from('two')), /differs/);
  assert.equal(store.data.get(key).bytes.toString(), 'one');
  assert.ok(store.calls.every(call => call.options.absent));
  await assert.rejects(putImmutable(store, CATALOG_KEY, Buffer.from('bad')), /Unexpected/);
  await assert.rejects(putImmutable(store, 'v0.2.2/application.exe', Buffer.from('bad')), /Unexpected/);
});
test('catalog promotion waits for verified objects and public delivery, with no-store metadata', async () => {
  const store = memoryStore(), release = publication(); let verified = false, guarded = false;
  const result = await publishObjects(store, release, { verifyPublic: async () => { assert.equal(store.data.has(CATALOG_KEY), false); assert.equal(store.data.size, 2); verified = true; }, beforePromote: async () => { assert.ok(verified); guarded = true; } });
  assert.ok(guarded); assert.equal(result.packages, 1);
  assert.equal(store.calls.at(-1).key, CATALOG_KEY);
  assert.equal(store.calls.at(-1).options.cacheControl, 'no-store, max-age=0');
  assert.ok(store.calls.slice(0, -1).every(call => call.options.cacheControl.includes('immutable')));
  const writes = store.calls.filter(call => call.key === CATALOG_KEY).length;
  await publishObjects(store, release);
  assert.equal(store.calls.filter(call => call.key === CATALOG_KEY).length, writes);
});
test('a partial upload, corrupted origin read, public failure or stale main never promotes the catalog', async () => {
  for (const mode of ['upload', 'read', 'public', 'main']) {
    const store = memoryStore(), release = publication();
    if (mode === 'upload') { const put = store.put; store.put = async (...args) => { if (args[0].endsWith('review.json')) throw new Error('upload failed'); return put(...args); }; }
    if (mode === 'read') { const get = store.get; store.get = async key => key.endsWith('review.json') ? { bytes: Buffer.from('corrupt') } : get(key); }
    await assert.rejects(publishObjects(store, release, { verifyPublic: async () => { if (mode === 'public') throw new Error('public delivery failed'); }, beforePromote: async () => { if (mode === 'main') throw new Error('main moved'); } }));
    assert.equal(store.data.has(CATALOG_KEY), false, mode);
  }
});
test('catalog revisions cannot go backwards or replace same revision bytes', async () => {
  const store = memoryStore(); await publishObjects(store, publication(2));
  await assert.rejects(publishObjects(store, publication(1)), /roll back/);
  const altered = publication(2); altered.catalog.plugins.push({ id: 'sesame/changed' });
  await assert.rejects(publishObjects(store, altered), /cannot change/);
  await publishObjects(store, publication(3));
  assert.equal(JSON.parse(store.data.get(CATALOG_KEY).bytes).releases[0].tag, 'r2-core-api-v1-dev.3');
});

test('API 2 promotes after API 1 without rewriting historical objects or allowing a new API 1 publication', async () => {
  const store = memoryStore(), historical = publication(3);
  historical.catalog.apiVersion = '1';
  for (const [key, bytes] of historical.objects) store.data.set(key, { bytes: Buffer.from(bytes), etag: 'historical' });
  store.data.set(CATALOG_KEY, { bytes: Buffer.from(JSON.stringify(historical.catalog, null, 2) + '\n'), etag: 'legacy-catalog' });
  await assert.rejects(publishObjects(store, historical), /require API 2/);
  assert.equal(store.calls.length, 0);
  await publishObjects(store, publication(4));
  assert.equal(JSON.parse(store.data.get(CATALOG_KEY).bytes).apiVersion, '2');
  for (const [key, bytes] of historical.objects) assert.deepEqual(store.data.get(key).bytes, bytes);
  assert.ok(store.calls.every(call => !historical.objects.has(call.key)));
});
test('a concurrent catalog change rejects compare-and-swap without overwriting it', async () => {
  const store = memoryStore(); await publishObjects(store, publication(1));
  await assert.rejects(publishObjects(store, publication(2), { beforePromote: async () => { store.data.set(CATALOG_KEY, { bytes: Buffer.from('concurrent'), etag: 'different' }); } }), /PreconditionFailed/);
  assert.equal(store.data.get(CATALOG_KEY).bytes.toString(), 'concurrent');
});
test('R2 credentials cannot be sent to an arbitrary endpoint', () => {
  for (const endpoint of ['https://example.com', 'http://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com', 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com/extra']) assert.throws(() => r2Store(endpoint), /configured Cloudflare/);
});
test('publication retries preserve recorded reviews after informational comments but reject changed authority', () => {
  const evidence = { id: 'dev.1', sourceCommit: 'a'.repeat(40), human: { status: 'not-recorded' }, reviews: [], semantic: { headSha: 'b'.repeat(40) }, gate: { runId: 10 }, publication: { commit: 'c'.repeat(40) } };
  const recorded = reviewBytes(evidence);
  const later = { ...evidence, reviews: [{ state: 'COMMENTED', author: 'informational-bot' }] };
  assert.equal(reviewBytes(later, recorded), recorded);
  assert.throws(() => reviewBytes({ ...later, semantic: { headSha: 'd'.repeat(40) } }, recorded), /differs/);
  assert.throws(() => reviewBytes({ ...later, human: { status: 'approved' } }, recorded), /differs/);
});
