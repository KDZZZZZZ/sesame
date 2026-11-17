import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, link, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createArtifacts, attemptDirectory, fileReceipt, ownedPath, verifiedFile } from '../artifacts.js';
import { digest, canonical } from '../contracts.js';
import { storageFixture } from './storage-fixture.js';

const context = attemptId => ({ jobId: 'job', epoch: 1, attemptId, signal: new AbortController().signal });
const write = (schema = 'factor-evidence/1', operationId = 'write', dependencies = []) => ({ schema, operationId, dependencies });

test('publishes real fixed artifact refs and independently verifies payload bytes', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), value = { message: 'Synthetic Unicode 文本', values: [1, 2, null] };
  const ref = await artifacts.publishJSON(value, write());
  assert.deepEqual(Object.keys(ref).sort(), ['digest', 'id', 'kind', 'revision', 'schemaVersion']);
  assert.notEqual(ref.digest, digest(canonical(value)));
  assert.deepEqual(await artifacts.readJSON(ref), value);
  assert.deepEqual(await artifacts.publishJSON(value, write()), ref);
  f.documents.get(ref.id).bytes[0] ^= 1;
  await assert.rejects(artifacts.readJSON(ref), e => e.code === 'EVIDENCE_MISMATCH');
});

test('manifest tampering fails before content is read', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), ref = await artifacts.publishJSON({ n: 1 }, write());
  f.documents.get(ref.id).manifest.content.schema = 'factor-values/1';
  await assert.rejects(artifacts.readJSON(ref), e => e.code === 'EVIDENCE_MISMATCH');
});

test('own factor resources reject external producers while data and application refs remain usable', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), bytes = Buffer.from(canonical({ fake: true }));
  const forged = f.artifact({ kind: 'resource', value: { fake: true }, content: { format: 'factor-json/1', path: 'payload.json', bytesDigest: digest(bytes), schema: 'factor-values/1' }, producer: 'other/plugin' });
  await assert.rejects(artifacts.readJSON(forged), e => e.code === 'FORBIDDEN');
  const source = f.artifact({ value: [{ close: 1 }] }); assert.deepEqual(await artifacts.readJSON(source), [{ close: 1 }]);
  const report = f.artifact({ kind: 'report', value: { conclusion: 'application' } });
  assert.equal((await artifacts.verify(report)).kind, 'report');
  await assert.rejects(artifacts.readJSON(report), e => e.code === 'INVALID_ARGUMENT');
});

test('chunked reads validate cursor progress and range identity', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host });
  const value = { content: 'x'.repeat(600000) }, ref = await artifacts.publishJSON(value, write());
  assert.deepEqual(await artifacts.readJSON(ref), value);
  const original = f.host.resources.read;
  f.host.resources.read = async (r, options) => { const value = await original(r, options); return options.part === 'content' ? { ...value, nextOffset: 0 } : value; };
  await assert.rejects(artifacts.readJSON(ref), e => e.code === 'EVIDENCE_MISMATCH');
});

test('recursive materialization restores provider bytes in a fresh attempt with fresh file digests', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), first = context('first'), second = context('second');
  const dir = join(attemptDirectory(f.root, first), 'output'); await mkdir(dir, { recursive: true });
  const binary = join(dir, 'feature.bin'); await writeFile(binary, Buffer.from([0, 0, 0, 0, 0, 0, 128, 63]));
  const file = await artifacts.importFile(await fileReceipt(binary), write('factor-provider-file/1', 'feature'), first);
  const calendar = await artifacts.publishJSON([{ barIndex: 0, time: '2026-01-01T00:00:00Z', qlibTime: '2026-01-01 00:00:00' }], write('factor-calendar/1', 'calendar'));
  const symbols = await artifacts.publishJSON([{ original: 'A', synthetic: 's000000' }], write('factor-symbol-map/1', 'symbols'));
  const provider = await artifacts.publishJSON({ schema: 'factor-provider/1', calendar, symbolMap: symbols, features: [{ symbol: 's000000', field: 'close', file }] }, write('factor-provider/1', 'provider', [calendar, symbols, file]));
  const a = await artifacts.materialize(provider, first), b = await artifacts.materialize(provider, second);
  assert.notEqual(a.path, b.path); assert.notEqual(a.digest, b.digest);
  const decoded = JSON.parse((await verifiedFile(f.root, b)).toString('utf8'));
  assert.deepEqual(await verifiedFile(f.root, decoded.features[0].file), Buffer.from([0, 0, 0, 0, 0, 0, 128, 63]));
  assert.ok(decoded.features[0].file.path.startsWith(attemptDirectory(f.root, second)));
  assert.ok(!JSON.stringify(decoded).includes(attemptDirectory(f.root, first).replaceAll('\\', '\\\\')));
});

test('materialization rejects undeclared executable dependencies', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host });
  const child = await artifacts.publishJSON({ value: 1 }, write('factor-matrix/1', 'child'));
  const hidden = await artifacts.publishJSON({ matrix: child }, write('factor-values/1', 'hidden'));
  await assert.rejects(artifacts.materialize(hidden, context('run')), e => e.code === 'EVIDENCE_MISMATCH');
});

test('Values preserves snapshot provenance without loading its provider or other partitions', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host });
  const snapshot = await artifacts.publishJSON({ id: 'snapshot', provider: 'provenance-only' }, write('factor-snapshot/1', 'snapshot'));
  const values = await artifacts.publishJSON({ id: 'values', snapshotRef: snapshot }, write('factor-values/1', 'values', [snapshot]));
  const receipt = await artifacts.materialize(values, context('evaluate'));
  const decoded = JSON.parse((await verifiedFile(f.root, receipt)).toString('utf8'));
  assert.deepEqual(decoded.snapshotRef, snapshot);
  assert.equal(decoded.snapshotRef.path, undefined);
});

test('worker imports stay within their attempt and reject edited bytes', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), a = context('a'), b = context('b');
  const dir = join(attemptDirectory(f.root, a), 'output'); await mkdir(dir, { recursive: true });
  const path = join(dir, 'evidence.json'); await writeFile(path, '{"evidence":true}'); const receipt = await fileReceipt(path);
  await assert.rejects(artifacts.importFile(receipt, write(), b), e => e.code === 'FORBIDDEN');
  await writeFile(path, '{"evidence":false}');
  await assert.rejects(artifacts.importFile(receipt, write(), a), e => e.code === 'EVIDENCE_MISMATCH');
  assert.throws(() => ownedPath(dir, join(f.root, 'other.json')), e => e.code === 'FORBIDDEN');
});

test('hard links and parent junctions cannot escape owned file checks', async t => {
  const f = await storageFixture(t), root = join(f.root, 'owned'), outside = join(f.root, 'elsewhere'); await mkdir(root); await mkdir(outside);
  const original = join(outside, 'secret.json'); await writeFile(original, '{}');
  const hard = join(root, 'hard.json'); await link(original, hard);
  await assert.rejects(verifiedFile(root, await fileReceipt(hard)), e => e.code === 'FORBIDDEN');
  const junction = join(root, 'junction'); await symlink(outside, junction, 'junction');
  await assert.rejects(verifiedFile(root, await fileReceipt(join(junction, 'secret.json'))), e => e.code === 'FORBIDDEN');
});

test('materialization never overwrites an existing link or altered immutable input', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), ctx = context('run');
  const ref = await artifacts.publishJSON({ safe: true }, write()), receipt = await artifacts.materialize(ref, ctx);
  await writeFile(receipt.path, '{"tampered":true}');
  await assert.rejects(artifacts.materialize(ref, ctx), e => e.code === 'EVIDENCE_MISMATCH');
});

test('importTree publishes LocalFiles recursively without persisting execution paths', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), ctx = context('run'), dir = join(attemptDirectory(f.root, ctx), 'output'); await mkdir(dir, { recursive: true });
  const shard = join(dir, 'shard.json'); await writeFile(shard, canonical({ keys: [], columns: { factor: [] } }));
  const path = join(dir, 'matrix.json'); await writeFile(path, canonical({ schema: 'factor-matrix/1', rows: 0, columns: ['factor'], shards: [await fileReceipt(shard)] }));
  const ref = await artifacts.importTree(await fileReceipt(path), ctx, 'factor-matrix/1'), value = await artifacts.readJSON(ref);
  assert.equal(typeof value.shards[0].revision, 'string'); assert.equal(value.shards[0].path, undefined);
  assert.equal(f.documents.get(ref.id).manifest.dependencies.length, 1);
});

test('source-row shards keep their source schema instead of being mislabeled matrices', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), ctx = context('source'), dir = join(attemptDirectory(f.root, ctx), 'output'); await mkdir(dir, { recursive: true });
  const shard = join(dir, 'rows.json'); await writeFile(shard, '[]');
  const path = join(dir, 'source.json'); await writeFile(path, canonical({ schema: 'factor-source-rows/1', rows: 0, shards: [await fileReceipt(shard)] }));
  const ref = await artifacts.importTree(await fileReceipt(path), ctx, 'factor-source-rows/1'), value = await artifacts.readJSON(ref);
  assert.equal((await artifacts.verify(value.shards[0])).content.schema, 'factor-source-rows/1');
});

test('malformed LocalFile objects cannot leak durable execution paths', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), ctx = context('bad'), dir = join(attemptDirectory(f.root, ctx), 'output'); await mkdir(dir, { recursive: true });
  const path = join(dir, 'bad.json'); await writeFile(path, canonical({ nested: { path: join(dir, 'child.json'), digest: digest('child'), bytes: 5, surprise: true } }));
  await assert.rejects(artifacts.importTree(await fileReceipt(path), ctx), e => e.code === 'INVALID_OUTPUT');
});

test('concurrent duplicate dependencies share a complete materialized file', async t => {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), ctx = context('parallel');
  const child = await artifacts.publishJSON({ text: 'x'.repeat(100000) }, write('factor-evidence/1', 'child'));
  const parent = await artifacts.publishJSON({ children: [child, child, child] }, write('factor-evidence/1', 'parent', [child]));
  const [a, b] = await Promise.all([artifacts.materialize(parent, ctx), artifacts.materialize(parent, ctx)]);
  assert.deepEqual(a, b);
  const materialized = JSON.parse((await verifiedFile(f.root, a)).toString('utf8'));
  assert.deepEqual(materialized.children[0], materialized.children[2]);
  await verifiedFile(f.root, materialized.children[0]);
});
