import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { canonical, clone, digest, error } from '../contracts.js';

/** Host-shaped in-memory ports. Validation yields before atomic CAS is rechecked. */
export async function storageFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'factor-storage-'));
  t.after(async () => {
    const rel = relative(resolve(tmpdir()), resolve(root));
    assert.ok(!rel.startsWith('..') && !isAbsolute(rel) && basename(root).startsWith('factor-storage-'));
    await rm(root, { recursive: true, force: true });
  });
  const records = new Map(), operations = new Map(), resources = new Map(), documents = new Map(), calls = [];
  let sequence = 0;
  const address = key => canonical(key);
  const operation = (kind, id, input) => {
    const key = `${kind}:${id}`, fingerprint = digest(input), previous = operations.get(key);
    if (previous && previous.fingerprint !== fingerprint) throw error('IDEMPOTENCY_CONFLICT', 'Operation changed');
    return { previous: previous?.result, save: result => { operations.set(key, { fingerprint, result: clone(result) }); return clone(result); } };
  };
  const state = {
    beforeCommit: null,
    read(key) { const row = records.get(address(key)); if (!row) throw error('NOT_FOUND', 'Missing state'); return clone(row); },
    query({ collection, filter = {}, cursor, limit = 100, ...unknown }) {
      assert.deepEqual(unknown, {}); assert.ok(Number.isInteger(limit) && limit > 0 && limit <= 200);
      const offset = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : 0;
      assert.ok(Number.isSafeInteger(offset) && offset >= 0);
      const rows = [...records.values()].filter(row => row.key.collection === collection && Object.entries(filter).every(([key, value]) => Object.hasOwn(row.value, key) && canonical(row.value[key]) === canonical(value))).sort((a, b) => a.key.key.localeCompare(b.key.key));
      return { items: clone(rows.slice(offset, offset + limit)), ...(offset + limit < rows.length ? { nextCursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}) };
    },
    async commit(changes, options = {}) {
      options.signal?.throwIfAborted();
      assert.ok(changes.length && changes.length <= 64);
      if (Buffer.byteLength(canonical(changes)) > 512 * 1024) throw error('RESOURCE_EXHAUSTED', 'Transaction too large');
      const operationId = options.operationId ?? `auto-${++sequence}`, replay = operation('state', operationId, changes);
      if (replay.previous) return clone(replay.previous);
      const validate = () => {
        const seen = new Set();
        for (const change of changes) {
          assert.deepEqual(Object.keys(change).sort(), ['expectedVersion', 'key', 'op', 'value']);
          assert.equal(change.op, 'put');
          const key = address(change.key);
          assert.ok(!seen.has(key)); seen.add(key);
          if ((records.get(key)?.version ?? 0) !== change.expectedVersion) throw error('VERSION_CONFLICT', 'Concurrent state update');
          if (Buffer.byteLength(canonical(change.value)) > 256 * 1024) throw error('RESOURCE_EXHAUSTED', 'Record too large');
        }
      };
      validate();
      const hook = state.beforeCommit; state.beforeCommit = null;
      await hook?.(clone(changes));
      options.signal?.throwIfAborted();
      const afterValidation = operation('state', operationId, changes);
      if (afterValidation.previous) return clone(afterValidation.previous);
      validate();
      const entries = changes.map(change => ({ key: clone(change.key), value: clone(change.value), version: change.expectedVersion + 1, updatedAt: new Date().toISOString() }));
      for (const row of entries) records.set(address(row.key), row);
      calls.push({ kind: 'commit', changes: clone(changes) });
      return replay.save({ transactionId: `transaction-${++sequence}`, entries });
    },
  };
  const host = { context: { pluginId: 'sesame/auto-factor-mining', storageRoot: root }, state, resources: {
    async create(input, options) {
      options.signal?.throwIfAborted();
      assert.deepEqual(Object.keys(input).sort(), ['kind', 'lifetime', 'name', 'policy', 'source']);
      assert.equal(input.kind, 'blob'); assert.equal(input.lifetime, 'durable'); assert.equal(input.source.encoding, 'base64'); assert.equal(input.policy.readOnly, true);
      const replay = operation('resource-create', options.operationId, input);
      if (replay.previous) return clone(replay.previous);
      const ref = { id: `resource-${++sequence}`, kind: 'blob', version: 1 };
      resources.set(ref.id, { ref, bytes: Buffer.from(input.source.content, 'base64') });
      calls.push({ kind: 'create', input: clone(input) });
      return replay.save(ref);
    },
    async publish(ref, input, options) {
      options.signal?.throwIfAborted();
      assert.deepEqual(Object.keys(ref).sort(), ['id', 'kind', 'version']);
      const resource = resources.get(ref.id); assert.ok(resource); assert.equal(ref.version, resource.ref.version);
      const replay = operation('resource-publish', options.operationId, [ref, input]);
      if (replay.previous) return clone(replay.previous);
      assert.ok(input.blobs.length > 0);
      const blobs = input.blobs.map(mapping => { assert.deepEqual(Object.keys(mapping).sort(), ['entry', 'mediaType', 'path']); assert.equal(mapping.entry, 'content'); return { path: mapping.path, mediaType: mapping.mediaType, size: resource.bytes.length, digest: digest(resource.bytes) }; });
      for (const dependency of input.dependencies ?? []) assert.ok(documents.has(dependency.id), 'Published dependency must exist');
      const manifest = { ...clone(input), blobs }, artifact = { id: `artifact-${++sequence}`, revision: '1', kind: input.kind, schemaVersion: input.schemaVersion, digest: digest(manifest) };
      documents.set(artifact.id, { ref: artifact, manifest, bytes: Buffer.from(resource.bytes), producer: { id: host.context.pluginId } });
      calls.push({ kind: 'publish', ref: clone(artifact), manifest: clone(manifest) });
      return replay.save({ ref: artifact, receipt: { status: 'published' } });
    },
    async read(ref, options) {
      const value = documents.get(ref.id); if (!value) throw error('NOT_FOUND', 'Missing artifact');
      if (canonical(value.ref) !== canonical(ref)) throw error('EVIDENCE_MISMATCH', 'Artifact identity changed');
      if (options.part === 'manifest') return clone(value.manifest);
      if (options.part === 'metadata') return { ref: clone(ref), producer: clone(value.producer), immutable: true };
      assert.equal(options.part, 'content'); assert.equal(options.encoding, 'base64'); assert.equal(options.entry, value.manifest.content.path);
      const offset = options.offset ?? 0, end = Math.min(value.bytes.length, offset + options.length), content = value.bytes.subarray(offset, end);
      return { ref: clone(ref), content: content.toString('base64'), encoding: 'base64', offset, length: content.length, total: value.bytes.length, ...(end < value.bytes.length ? { nextOffset: end } : {}) };
    },
  } };
  const seed = (collection, key, value) => { const addressKey = { collection, key }; const previous = records.get(address(addressKey)); const row = { key: addressKey, version: (previous?.version ?? 0) + 1, value: clone(value) }; records.set(address(addressKey), row); return clone(row); };
  const artifact = ({ kind = 'data', content = { format: 'json-rows', path: 'payload.json', rowCount: 0 }, value = [], producer = 'host', dependencies = [] } = {}) => {
    const bytes = Buffer.from(canonical(value)), manifest = { kind, schemaVersion: '1.0.0', content, dependencies, blobs: [{ path: content.path ?? 'payload.json', size: bytes.length, digest: digest(bytes), mediaType: 'application/json' }] };
    const ref = { id: `external-${++sequence}`, revision: '1', digest: digest(manifest), kind, schemaVersion: '1.0.0' };
    documents.set(ref.id, { ref, manifest, bytes, producer: { id: producer } }); return ref;
  };
  return { root, host, state, records, documents, resources, calls, seed, artifact };
}
