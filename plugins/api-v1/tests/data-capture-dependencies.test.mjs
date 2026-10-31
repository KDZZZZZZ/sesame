import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest, snapshotOperation } from '../packages/data-access/capture.js';
import { resourceHost } from './core-v2-fixture.mjs';

test('the runtime extension proves the complete old source by reversing only exact reviewed edits', () => {
  const read = path => readFileSync(new URL(path, import.meta.url));
  const review = JSON.parse(read('./fixtures/data-capture-dependency-extension.json'));
  assert.equal(review.schemaVersion, 1); assert.equal(review.status, 'approved'); assert.equal(review.decision, 'approved');
  assert.ok(review.reason.length >= 20);
  assert.equal(digest(read('./fixtures/plugin-boundaries-baseline.json')), review.baselineSha256);
  assert.equal(digest(read('../packages/data-access/capabilities.json')), review.declarationSha256Unchanged, 'schemas, effects, permissions and state declarations are not relaxed');
  const manifest = JSON.parse(read('../packages/data-access/plugin.json'));
  assert.equal(manifest.version, review.after.version); assert.equal(review.before.version, '3.0.3');
  assert.equal(digest(manifest), review.after.manifestDigest);
  assert.equal(digest({ ...manifest, version: review.before.version }), review.before.manifestDigest);
  let source = read('../packages/data-access/capture.js').toString('utf8');
  assert.equal(digest(source), review.after.sha256);
  assert.ok(review.approvedSourceEdits.length > 0);
  for (const edit of [...review.approvedSourceEdits].reverse()) {
    assert.notEqual(edit.before, edit.after);
    assert.equal(source.split(edit.after).length, 2, 'each exact reviewed edit must have one source location');
    source = source.replace(edit.after, edit.before);
  }
  assert.equal(digest(source), review.before.sha256, 'all unreviewed original source bytes are preserved');
});

async function fixture() {
  const f = resourceHost();
  const file = await f.host.resources.create({ kind: 'file', source: { content: '[{"fixture":true}]' } });
  const input = (await f.host.resources.publish(file, { kind: 'data', schemaVersion: '1.0.0', content: { path: 'rows.json', provenance: { kind: 'demo' } }, dependencies: [], blobs: [{ path: 'rows.json' }] })).ref;
  const output = { rows: [{ fixture: 'result' }], evidence: { fixed: 'original bytes', input }, summary: { origin: 'demo', title: 'Synthetic dependency fixture' }, dependencies: [input] };
  return { ...f, input, output, run: capture => snapshotOperation(f.host, 'fixed-operation', { request: 'unchanged' }, capture ?? (async () => structuredClone(output))) };
}

test('completed data publication with a lost completion receipt resumes the exact new dependency graph', async () => {
  const f = await fixture(), commit = f.host.state.commit; let interrupted = false;
  f.host.state.commit = async changes => {
    if (!interrupted && changes[0].value.result) { interrupted = true; throw Error('Completion response lost'); }
    return commit(changes);
  };
  await assert.rejects(f.run(), /Completion response lost/);
  const prior = [...f.artifacts.values()].find(item => item.ref.kind === 'data' && item.manifest.dependencies?.length === 2);
  assert.ok(prior);
  const result = await f.run(async () => { throw Error('Captured inputs must not run again'); });
  assert.deepEqual(result.ref, prior.ref);
  assert.deepEqual(prior.manifest.dependencies, [result.evidence, f.input]);
  assert.deepEqual(f.rows(result.evidence), f.output.evidence);
  const again = await f.run(async () => { throw Error('Completed operation must not recapture'); });
  assert.deepEqual(again, result);
});

test('legacy capture without a mode recovers an already-published old manifest and never rewrites its bytes', async () => {
  const f = await fixture(), publish = f.host.resources.publish; let attempt;
  f.host.resources.publish = async (ref, manifest, options) => {
    if (manifest.kind === 'data') { attempt = { ref, manifest: structuredClone(manifest), options }; throw Error('Legacy publication outcome unknown'); }
    return publish(ref, manifest, options);
  };
  await assert.rejects(f.run(), /outcome unknown/);
  const stored = [...f.records.values()][0]; delete stored.value.capture.publicationDependencyMode;
  // Simulate a 3.0.3 publication committed before its completion receipt was saved.
  attempt.manifest.dependencies = attempt.manifest.dependencies.slice(0, 1);
  const legacy = await publish(attempt.ref, attempt.manifest, attempt.options);
  f.host.resources.publish = publish;
  const result = await f.run(async () => { throw Error('Legacy bytes must not be refetched'); });
  assert.deepEqual(result.ref, legacy.ref);
  assert.deepEqual(f.artifacts.get(result.ref.id).manifest.dependencies, [result.evidence]);
  assert.deepEqual(f.rows(result.evidence), f.output.evidence);
  assert.equal([...f.records.values()][0].value.capture.publicationDependencyMode, undefined);
  assert.deepEqual(await f.run(), result, 'completed legacy result remains immutable');
});

test('reference budget reserves the evidence edge and fails before any resource is created', async () => {
  const f = resourceHost();
  const dependencies = Array.from({ length: 256 }, (_, i) => ({ id: 'fixed-' + i, revision: '1', digest: 'sha256:' + 'a'.repeat(64), kind: 'data', schemaVersion: '1.0.0' }));
  await assert.rejects(snapshotOperation(f.host, 'oversize', {}, async () => ({ rows: [], evidence: {}, summary: { origin: 'demo' }, dependencies })), { code: 'RESOURCE_EXHAUSTED' });
  assert.equal(f.files.size, 0); assert.equal(f.publications.length, 0); assert.equal(f.records.size, 0);
});

test('unknown stored publication modes fail closed instead of guessing a different manifest', async () => {
  const f = await fixture(); f.host.failPublication = manifest => manifest.kind === 'data';
  await assert.rejects(f.run(), /Publication interrupted/); f.host.failPublication = undefined;
  [...f.records.values()][0].value.capture.publicationDependencyMode = 'unknown-mode';
  const count = f.publications.length;
  await assert.rejects(f.run(), /Unknown frozen publication dependency mode/);
  assert.equal(f.publications.length, count);
});
