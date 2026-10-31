import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { artifactCanonical, fromFixedRef } from '../src/ref-input.js';

const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
function fixture(name = 'calibration') {
  const input = JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url)));
  const bytes = Buffer.from(JSON.stringify([input]));
  const manifest = { kind: 'data', schemaVersion: '1.0.0', dependencies: [input.plan.ref],
    content: { format: 'json-rows', path: 'rows.json', rowCount: 1, provenance: { kind: 'demo', metadata: { '10': 'ten', '2': 'two' } } },
    blobs: [{ path: 'rows.json', mediaType: 'application/json', size: bytes.length, digest: hash(bytes) }] };
  const f = { input, bytes, manifest, ref: { id: 'fixture/history', revision: '1', digest: '', kind: 'data', schemaVersion: '1.0.0' }, pageSize: 137, reads: [] };
  f.refreshManifestDigest = () => { f.ref.digest = hash(artifactCanonical(f.manifest)); };
  f.refreshManifestDigest();
  f.host = { resources: { read: async (ref, options) => {
    if (ref.id !== f.ref.id) return { content: { provenance: { kind: 'demo' } } };
    f.reads.push({ ref: structuredClone(ref), options: structuredClone(options) });
    if (options.part === 'manifest') return structuredClone(f.manifest);
    if (options.part === 'metadata') return f.metadata ?? { ref: structuredClone(f.ref), producer: { id: 'fixture/reader' } };
    const chunk = f.bytes.subarray(options.offset, options.offset + f.pageSize), next = options.offset + chunk.length;
    const page = { ref: structuredClone(f.ref), offset: options.offset, length: chunk.length, total: f.bytes.length,
      encoding: 'base64', content: chunk.toString('base64'), ...(next < f.bytes.length ? { nextOffset: next } : {}) };
    return f.alterPage ? f.alterPage(page) : page;
  }, create: async input => {
    f.created ??= []; f.created.push(structuredClone(input));
    if (input.kind === 'file') f.publishedBytes = Buffer.from(input.source.content);
    return { id: 'fixture/created-' + f.created.length, kind: input.kind };
  }, publish: async (_root, publication) => {
    f.publication = structuredClone(publication);
    return { ref: { ...f.ref, id: 'fixture/published-result', digest: hash(f.publishedBytes) } };
  } } };
  f.run = async signal => {
    f.delivery = await fromFixedRef(f.host, { operation: name.startsWith('match') ? 'match' : 'calibrate', input_ref: f.ref }, signal);
    return JSON.parse(f.publishedBytes)[0];
  };
  return f;
}

test('fixed reader verifies lexical manifest hash including integer-like keys and every byte across pages', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.current_predictions[0].calibrated_probability, .5);
  assert.equal(result.input_integrity.manifest_digest_verified, true);
  assert.equal(result.input_integrity.content_digest_verified, true);
  assert.equal(result.input_integrity.content_bytes, f.bytes.length);
  assert.ok(result.input_integrity.pages > 1);
  assert.ok(f.reads.every(read => read.ref.digest === f.ref.digest));
  assert.deepEqual(f.delivery.result_ref, { ...f.ref, id: 'fixture/published-result', digest: hash(f.publishedBytes) });
  assert.deepEqual(f.publication.dependencies, [f.ref, f.input.plan.ref]);
  assert.equal(f.publication.content.provenance.kind, 'demo');
  assert.equal(f.delivery.result_data.content_digest, hash(f.publishedBytes));
  assert.equal(f.delivery.groups, undefined, 'complete per-row data lives in the fixed result, not the compact delivery');
});

test('a changed manifest or changed prediction bytes cannot retain the original fixed reference', async () => {
  const manifest = fixture(); manifest.manifest.content.provenance.kind = 'user_input';
  await assert.rejects(manifest.run(), /manifest digest differs/);
  assert.equal(manifest.created, undefined);
  const blob = fixture(); blob.input.records[0].outcome.label = 1;
  blob.bytes = Buffer.from(JSON.stringify([blob.input]));
  await assert.rejects(blob.run(), /content digest differs/);
  assert.equal(blob.created, undefined);
});

test('metadata, ambiguous content entries and invalid blob declarations are rejected before computing', async () => {
  const metadata = fixture(); metadata.metadata = { ref: { ...metadata.ref, revision: 'other' }, producer: { id: 'fixture/reader' } };
  await assert.rejects(metadata.run(), /exact source revision/);
  const duplicate = fixture(); duplicate.manifest.blobs.push(structuredClone(duplicate.manifest.blobs[0])); duplicate.refreshManifestDigest();
  await assert.rejects(duplicate.run(), /unambiguous/);
  const size = fixture(); size.manifest.blobs[0].size = 9 * 1024 * 1024; size.refreshManifestDigest();
  await assert.rejects(size.run(), /8 MiB/);
});

test('wrong page identity, offset, total, byte length, encoding and broken cursors cannot be accepted', async () => {
  const variants = [
    page => ({ ...page, ref: { ...page.ref, revision: 'other' } }),
    page => ({ ...page, offset: page.offset + 1 }),
    page => ({ ...page, total: page.total - 1 }),
    page => ({ ...page, length: page.length - 1 }),
    page => ({ ...page, encoding: 'utf8' }),
    page => ({ ...page, content: page.content + '!' }),
    page => ({ ...page, nextOffset: 0 }),
    page => { const { nextOffset, ...rest } = page; return rest; },
  ];
  for (const alterPage of variants) {
    const f = fixture(); f.alterPage = alterPage;
    await assert.rejects(f.run(), /identity|byte range|encoding|base64|contiguously|incomplete/);
  }
});

test('declared dependencies and cancellation remain mandatory after integrity checks', async () => {
  const dependencies = fixture(); dependencies.manifest.dependencies = []; dependencies.refreshManifestDigest();
  await assert.rejects(dependencies.run(), /dependencies/);
  const canceled = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(canceled.run(controller.signal), /abort/i);
  assert.equal(canceled.reads.length, 0);
});

test('replay fixed input declares its actual code and data snapshot references as dependencies', async () => {
  const f = fixture('calibration-replay');
  assert.equal((await f.run()).prediction_origin, 'historical_replay');
  const code = { ...f.input.plan.ref, id: 'fixture/actual-replay-code' };
  f.input.records[0].replay.code_ref = code;
  f.bytes = Buffer.from(JSON.stringify([f.input])); f.manifest.blobs[0].size = f.bytes.length; f.manifest.blobs[0].digest = hash(f.bytes); f.refreshManifestDigest();
  await assert.rejects(f.run(), /replay code\/data refs/);
  f.manifest.dependencies.push(code); f.refreshManifestDigest();
  assert.equal((await f.run()).groups[0].evaluation.n, 4);
});

test('matching replay fixed input checks its top-level frozen code and every data dependency', async () => {
  const f = fixture('match-replay');
  assert.equal((await f.run()).observation_origin, 'historical_replay');
  const code = { ...f.input.plan.ref, id: 'fixture/match-code' }, data = { ...f.input.plan.ref, id: 'fixture/match-data' };
  f.input.replay.code_ref = code; f.input.replay.data_refs = [data];
  f.bytes = Buffer.from(JSON.stringify([f.input])); f.manifest.blobs[0].size = f.bytes.length; f.manifest.blobs[0].digest = hash(f.bytes); f.refreshManifestDigest();
  await assert.rejects(f.run(), /replay code\/data refs/);
  f.manifest.dependencies.push(code); f.refreshManifestDigest();
  await assert.rejects(f.run(), /replay code\/data refs/);
  f.manifest.dependencies.push(structuredClone(data)); f.refreshManifestDigest();
  const result = await f.run();
  assert.equal(result.observation_origin, 'historical_replay');
  assert.equal(result.input_integrity.content_digest_verified, true);
  assert.equal(result.forecast_probability, null);
  f.input.replay.data_refs[0].revision = 'changed'; f.bytes = Buffer.from(JSON.stringify([f.input]));
  f.manifest.blobs[0].size = f.bytes.length; f.manifest.blobs[0].digest = hash(f.bytes); f.refreshManifestDigest();
  await assert.rejects(f.run(), /replay code\/data refs/);
});
