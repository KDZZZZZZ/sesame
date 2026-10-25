import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetSnapshot as tradingSnapshot } from '../packages/trading-decision/data.js';
import { datasetSnapshot as judgmentSnapshot } from '../packages/judgment-evolution/evidence.js';
import * as financialFiles from '../packages/financial-research/resource-files.js';
import * as webFiles from '../packages/web-sources/resource-files.js';

const saved = { providerId: 'host#datasets', revision: '1' };
const external = { providerId: 'fixture/evidence#saved', revision: '9', binding: { id: 'exact', revision: '2' } };
const ref = id => ({ id, revision: '1', digest: `sha256:${id}`, kind: 'data', schemaVersion: '1.0.0' });
for (const [name, snapshot] of [['trading', tradingSnapshot], ['judgment', judgmentSnapshot]]) {
  test(`${name}: saved evidence paginates once, reads ancestors and preserves original producer`, async () => {
    const calls = [], signal = new AbortController().signal;
    const host = { data: {
      async sources(input) { calls.push(['sources', input]); return { items: [{ available: false }, { ref: saved }] }; },
      async query(input, options) {
        assert.equal(options.signal, signal); calls.push(['query', structuredClone(input)]);
        const id = input.input.datasetId;
        return { items: [{ value: id === 'A' ? input.cursor ? 2 : 1 : 3 }], metadata: { id, input_ids: id === 'A' ? ['B'] : [], producer_plugin_id: 'original/source' }, nextCursor: id === 'A' && !input.cursor ? 'second' : null };
      },
    } };
    const result = await snapshot(host, ['A', 'A', 'B'], signal);
    assert.deepEqual([...result.keys()], ['B', 'A']);
    assert.deepEqual(result.get('A').rows, [{ value: 1 }, { value: 2 }]);
    assert.equal(result.get('A').producer_plugin_id, 'original/source');
    assert.deepEqual(calls.map(([kind, input]) => kind === 'sources' ? kind : `${input.input.datasetId}:${input.cursor ?? ''}`), ['sources', 'A:', 'A:second', 'B:']);
    assert.deepEqual(result.get('A').source, saved); assert.notEqual(result.get('A').source, saved);
  });

  test(`${name}: external identities, pagination metadata and cyclic ancestry are checked`, async () => {
    let mode = 'valid', queries = 0;
    const host = { data: { async query(input) {
      queries++;
      const id = input.input.id;
      return { items: [], metadata: { id: mode === 'wrong' ? 'other' : id, input_ids: mode === 'cycle' ? [id] : [], inputs: mode === 'cycle' ? [{ datasetId: id, query: { id } }] : [], version: mode === 'changed' && input.cursor ? 2 : 1 }, nextCursor: mode === 'changed' && !input.cursor ? 'next' : null };
    } } };
    const reference = { datasetId: 'A', source: external, query: { id: 'A' } };
    const value = await snapshot(host, [reference]);
    assert.equal(value.get('A').producer_plugin_id, 'fixture/evidence');
    assert.deepEqual(value.get('A').sourceQuery, { id: 'A' });
    for (mode of ['wrong', 'cycle', 'changed']) await assert.rejects(snapshot(host, [reference]), { code: 'INVALID_EVIDENCE' });
    mode = 'valid'; queries = 0;
    await assert.rejects(snapshot(host, [reference, { ...reference, query: { id: 'A', changed: true } }]), { code: 'INVALID_EVIDENCE' });
    assert.equal(queries, 1, 'conflicting identity must not issue a second read');
  });

  test(`${name}: pinned artifacts retain dependencies and reject identity changes or nonadvancing reads`, async () => {
    const reads = [], source = new Map([['A', Buffer.from('[{"x":1},{"x":2}]')], ['B', Buffer.from('[{"x":3}]')]]);
    let stalled = false;
    const host = { resources: { async read(artifact, options) {
      reads.push([artifact.id, options.part, options.offset]);
      const bytes = source.get(artifact.id);
      if (options.part === 'manifest') return { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: artifact.id === 'A' ? 2 : 1, provenance: { kind: 'demo' } }, blobs: [{ path: 'rows.json', mediaType: 'application/json' }], dependencies: artifact.id === 'A' ? [ref('B')] : [] };
      if (options.part === 'metadata') return { producer: { id: 'actual/producer' } };
      const end = Math.min(bytes.length, options.offset + 6);
      return { content: bytes.subarray(options.offset, end).toString('base64'), ...(stalled ? { nextOffset: options.offset } : end < bytes.length ? { nextOffset: end } : {}) };
    } } };
    const value = await snapshot(host, [ref('A'), ref('B')]);
    assert.deepEqual([...value.keys()], ['B', 'A']);
    assert.equal(value.get('A').provenance.source_kind, 'synthetic');
    assert.equal(value.get('A').producer_plugin_id, 'actual/producer');
    assert.deepEqual(value.get('A').artifactDependencies, [ref('B')]);
    assert.equal(reads.filter(([id, part]) => id === 'B' && part === 'manifest').length, 1);
    await assert.rejects(snapshot(host, [ref('A'), { ...ref('A'), revision: '2' }]), { code: 'INVALID_EVIDENCE' });
    stalled = true;
    await assert.rejects(snapshot(host, [ref('A')]), { code: 'EVIDENCE_TOO_LARGE' });
  });

  test(`${name}: aggregate artifact byte budget and pre-read cancellation remain bounded`, async () => {
    const limit = 32 * 1024 * 1024;
    let length = limit, contentReads = 0;
    const host = { resources: { async read(_artifact, options) {
      if (options.part === 'manifest') return { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: 0 }, blobs: [{ path: 'rows.json', mediaType: 'application/json' }], dependencies: [] };
      if (options.part === 'metadata') return { producer: { id: 'actual/producer' } };
      contentReads++;
      const end = Math.min(length, options.offset + options.length), part = Buffer.alloc(end - options.offset, ' ');
      if (!options.offset) part.write('[]');
      return { content: part.toString('base64'), ...(end < length ? { nextOffset: end } : {}) };
    } } };
    assert.deepEqual((await snapshot(host, [ref('A')])).get('A').rows, []);
    length = limit + 1;
    await assert.rejects(snapshot(host, [ref('A')]), { code: 'EVIDENCE_TOO_LARGE' });
    const before = contentReads, controller = new AbortController(); controller.abort(new Error('cancelled fixture'));
    await assert.rejects(snapshot(host, [ref('A')], controller.signal), /cancelled fixture/);
    assert.equal(contentReads, before);
  });
}

function resourceHost({ failPublish = false } = {}) {
  const calls = [], root = { id: 'owned-root', version: 7 }, artifact = ref('published');
  const host = { resources: {
    async create(input, options) { calls.push(['create', structuredClone(input), options]); return input.kind === 'directory' ? root : { id: input.name, version: 1 }; },
    async publish(handle, manifest, options) { calls.push(['publish', handle, structuredClone(manifest), options]); if (failPublish) throw Object.assign(new Error('conflict'), { code: 'ARTIFACT_CONFLICT' }); return { ref: artifact }; },
    async remove(handle, options) { calls.push(['remove', handle, options]); },
    async read(artifact, options) { calls.push(['read', artifact, options]); if (options.part === 'manifest') return { kind: 'data' }; const bytes = Buffer.from('a\u0000字b'); const end = Math.min(bytes.length, options.offset + 2); return { content: bytes.subarray(options.offset, end).toString('base64'), length: end - options.offset, total: bytes.length, ...(end < bytes.length ? { nextOffset: end } : {}) }; },
  } };
  return { host, calls, root, artifact };
}
for (const [name, files] of [['financial', financialFiles], ['web', webFiles]]) {
  test(`${name}: resource bytes, pinned publication options and cleanup keep original host ownership`, async () => {
    const f = resourceHost(), signal = new AbortController().signal;
    assert.deepEqual(await files.readArtifact(f.host, ref('A')), { ref: ref('A'), manifest: { kind: 'data' } });
    assert.deepEqual(await files.readEntry(f.host, ref('A'), 'binary'), Buffer.from('a\u0000字b'));
    await assert.rejects(files.readEntry(f.host, ref('A'), 'binary', 1), /budget/);
    const output = await files.publishFiles(f.host, { operationId: 'same-operation', artifactId: 'existing', expectedRevision: 'old', kind: 'data', content: { fixed: true }, files: { 'rows.json': Buffer.from('[1]'), 'script.py': { bytes: 'print(1)', mediaType: 'text/x-python' } }, dependencies: [ref('A')], provenance: { original: true } }, signal);
    assert.deepEqual(output, f.artifact);
    const publish = f.calls.find(call => call[0] === 'publish');
    assert.equal(publish[1], f.root); assert.deepEqual(publish[2].dependencies, [ref('A')]);
    assert.deepEqual(publish[2].blobs, [{ entry: 'entry-0', path: 'rows.json', mediaType: 'application/json' }, { entry: 'entry-1', path: 'script.py', mediaType: 'text/x-python' }]);
    assert.deepEqual(publish[3], { operationId: 'same-operation', artifactId: 'existing', expectedRevision: 'old', signal });
    assert.deepEqual(f.calls.filter(call => call[0] === 'create' && call[1].kind === 'blob').map(call => Buffer.from(call[1].source.content, 'base64').toString()), ['[1]', 'print(1)']);
    assert.deepEqual(f.calls.at(-1), ['remove', f.root, { expectedVersion: 7, mode: 'permanent' }]);
    const failure = resourceHost({ failPublish: true });
    await assert.rejects(files.publishFiles(failure.host, { kind: 'data', content: { keep: true } }, signal), { code: 'ARTIFACT_CONFLICT' });
    assert.deepEqual(failure.calls.at(-1), ['remove', failure.root, { expectedVersion: 7, mode: 'permanent' }]);
  });
}

test('financial and web row adapters preserve their different raw-source contracts', async () => {
  const data = { title: 'Evidence', rows: [{ value: 3 }], provenance: { producer: 'source' }, source: { bytes: Buffer.from('raw source'), content_type: 'text/plain', encoding: 'utf8' } };
  const financial = resourceHost(), web = resourceHost();
  await financialFiles.publishRows(financial.host, data, [ref('parent')]);
  await webFiles.publishRows(web.host, data, [ref('parent')]);
  const first = financial.calls.find(call => call[0] === 'publish')[2], second = web.calls.find(call => call[0] === 'publish')[2];
  assert.equal(first.content.raw, undefined); assert.equal(first.blobs.length, 1);
  assert.deepEqual(second.content.raw, { path: 'source.txt', mediaType: 'text/plain', encoding: 'utf8' });
  assert.deepEqual(second.blobs.map(blob => blob.path), ['rows.json', 'source.txt']);
  assert.equal(first.content.rowCount, second.content.rowCount); assert.deepEqual(first.dependencies, second.dependencies);
});
