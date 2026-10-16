import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRunObserver } from '../../optional-api-v1/packages/mt5/backend/run-observer.js';
import { digest } from '@sesame/plugin-sdk/protocol';
import { fixtureHost } from './mt5-conformance-fixture.js';

const bytes = Buffer.from('frozen EX5 fixture');
const translation = { id: 'translation', revision: '1', kind: 'strategy.translation', schemaVersion: '1.0.0', digest: digest('translation') };
const build = { id: 'build-fixed', status: 'succeeded', conversation_id: 'child', owner_run_id: 'child-run', ex5_sha256: digest(bytes), manifest_digest: digest('manifest'), translation };
const manifest = { compiler_sha256: digest('compiler'), files: {} };
async function fixture(t) {
  const f = await fixtureHost(t);
  return { ...f, observer: () => new NativeRunObserver(f.host, f.mt5) };
}
const freeze = (f, value = build) => f.observer().frozenBuild(value, manifest, translation, bytes);

test('repeated runs and plugin upgrade reuse one frozen content reference', async t => {
  const f = await fixture(t), first = await freeze(f);
  assert.deepEqual(await freeze(f), first);
  f.host.context = { ...f.host.context, pluginVersion: 'upgraded', pluginRevision: digest('upgrade') };
  assert.deepEqual(await freeze(f), first);
  assert.equal(f.artifacts.size, 1);
  assert.equal(f.store.list('native_build_inputs').length, 1);
});

test('archive metadata and main-session reuse preserve the frozen index and original producer', async t => {
  const f = await fixture(t), first = await freeze(f), producer = structuredClone(f.artifacts.get(first.id).producer);
  f.host.context = { ...f.host.context, sessionId: 'main', runId: null, pluginVersion: 'upgraded', pluginRevision: digest('upgrade') };
  const archived = { ...build, archived_artifact: { id: 'child-archive' }, intermediate_files_removed: true };
  assert.deepEqual(await freeze(f, archived), first);
  assert.deepEqual(await freeze(f, { ...archived, archived_manifest: 'retained' }), first);
  assert.deepEqual(f.artifacts.get(first.id).producer, producer);
  assert.equal(f.artifacts.size, 1);
});

test('changed immutable build, manifest, translation or EX5 cannot reuse or publish another reference', async t => {
  for (const changed of [
    [{ ...build, source_digest: 'changed' }, manifest, translation, bytes],
    [build, { ...manifest, compiler_sha256: digest('different') }, translation, bytes],
    [build, manifest, { ...translation, revision: '2' }, bytes],
    [build, manifest, translation, Buffer.from('different EX5')],
  ]) {
    const f = await fixture(t); await freeze(f);
    await assert.rejects(f.observer().frozenBuild(...changed), /冻结构建/);
    assert.equal(f.artifacts.size, 1);
  }
});

test('indexed build rejects missing or corrupted EX5, changed manifest and translation dependency', async t => {
  for (const mutate of [
    (record) => { record.manifest.blobs = []; },
    (record) => { record.manifest.dependencies = [{ ...translation, revision: 'different' }]; },
    (record) => { record.manifest.content.manifest.compiler_sha256 = digest('different'); },
    (record, f) => { const blob = record.manifest.blobs.find(row => row.path === 'Strategy.ex5'); f.blobs.set(blob.digest, Buffer.from('corrupt EX5 bytes')); },
  ]) {
    const f = await fixture(t), ref = await freeze(f); mutate(f.artifacts.get(ref.id), f);
    await assert.rejects(freeze(f));
    assert.equal(f.artifacts.size, 1);
  }
});

test('indexed foreign producer reference is rejected before any new publication', async t => {
  const f = await fixture(t), ref = await freeze(f);
  f.artifacts.get(ref.id).producer.id = 'foreign/plugin';
  await assert.rejects(freeze(f), /引用身份/);
  assert.equal(f.artifacts.size, 1);
});

test('foreign producer with the same build ID is never adopted as MT5 evidence', async t => {
  const f = await fixture(t), ours = f.host.context;
  f.host.context = { ...ours, pluginId: 'foreign/plugin' };
  const foreign = await f.observer().artifact('native-build-' + build.id, 'resource', { format: 'sesame.mt5.build/1', build, manifest }, [translation], { 'Strategy.ex5': bytes });
  f.host.context = ours;
  const actual = await freeze(f);
  assert.notEqual(actual.id, foreign.id);
  assert.equal(f.artifacts.get(actual.id).producer.id, 'sesame/mt5');
});

test('persistent build indices read only their exact references without scanning unrelated resources', async t => {
  const f = await fixture(t); let reads = 0;
  const read = f.host.resources.read;
  f.host.resources.read = (...args) => { reads++; return read(...args); };
  f.host.resources.list = () => { assert.fail('Frozen build lookup must not scan workspace artifacts'); };
  for (let i = 0; i < 25; i++) await f.observer().artifact('unrelated-' + i, 'resource', { format: 'other' }, [], {});
  const first = await freeze(f); assert.equal(reads, 0);
  assert.deepEqual(await freeze(f), first); assert.equal(reads, 3);
  for (let i = 0; i < 20; i++) await freeze(f, { ...build, id: 'new-' + i });
  assert.equal(reads, 3);
  assert.equal(f.store.list('native_build_inputs').length, 21);
});

test('interrupted reference reads retry without publication and index-write failure cannot duplicate effects', async t => {
  const f = await fixture(t), first = await freeze(f), read = f.host.resources.read;
  f.host.resources.read = async () => { throw Error('read interrupted'); };
  await assert.rejects(freeze(f), /interrupted/);
  assert.deepEqual(f.store.get('native_build_inputs', build.id).ref, first);
  f.host.resources.read = read; assert.deepEqual(await freeze(f), first);
  const next = { ...build, id: 'new-write-failure' }, put = f.store.put; let fail = true;
  f.store.put = (kind, row) => { if (kind === 'native_build_inputs' && fail) { fail = false; throw Error('index interrupted'); } return put(kind, row); };
  await assert.rejects(freeze(f, next), /index interrupted/);
  const count = f.artifacts.size, published = [...f.artifacts.values()].find(row => row.manifest.content.build?.id === next.id).ref;
  assert.deepEqual(await freeze(f, next), published);
  assert.equal(f.artifacts.size, count);
  assert.deepEqual(f.store.get('native_build_inputs', next.id).ref, published);
});
