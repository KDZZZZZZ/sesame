import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const clone = structuredClone, hash = value => 'sha256:' + createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function resourceHost(context = {}) {
  const files = new Map(), artifacts = new Map(), records = new Map(), operations = new Map(), publications = [], calls = [];
  let sequence = 0;
  const replay = (id, input, create) => {
    if (!id) return create();
    const fingerprint = hash(input), previous = operations.get(id);
    if (previous) { assert.equal(previous.fingerprint, fingerprint, 'operation content changed'); return clone(previous.value); }
    const value = create(); operations.set(id, { fingerprint, value: clone(value) }); return value;
  };
  const get = ref => {
    if (ref.digest) { const artifact = artifacts.get(ref.id); assert.deepEqual(artifact.ref, ref); return artifact; }
    const file = files.get(ref.id); assert.equal(file.ref.version, ref.version); return file;
  };
  const host = {
    context: { sessionId: 'main', storageRoot: 'fixture-' + Math.random(), ...context },
    state: {
      async read(key) { const entry = records.get(JSON.stringify(key)); if (!entry) throw Object.assign(Error('missing'), { code: 'NOT_FOUND' }); return clone(entry); },
      async commit(changes) {
        const entries = changes.map(change => { const key = JSON.stringify(change.key), previous = records.get(key); assert.equal(previous?.version ?? 0, change.expectedVersion); return { key: change.key, value: clone(change.value), version: (previous?.version ?? 0) + 1 }; });
        for (const item of entries) records.set(JSON.stringify(item.key), item);
        return { entries: clone(entries), receipt: {} };
      },
    },
    resources: {
      async create(input, options = {}) {
        options.signal?.throwIfAborted();
        const bytes = input.source?.path ? await readFile(input.source.path) : Buffer.from(input.source?.content ?? '', input.source?.encoding ?? 'utf8');
        return replay(options.operationId, { input, hash: hash(bytes) }, () => {
          const ref = { id: 'resource-' + (++sequence), kind: input.kind, version: 1 };
          files.set(ref.id, { ref, bytes, parent: input.parent, name: input.name }); return ref;
        });
      },
      async read(ref, options = {}) {
        const value = get(ref);
        if (options.part === 'manifest') return clone(value.manifest);
        if (options.part === 'metadata') return { ref: clone(ref), title: value.manifest?.content.title };
        if (options.part === 'receipts') return { items: [] };
        const bytes = ref.digest ? value.bytes.get(options.entry ?? value.manifest.content.path) : value.bytes;
        assert.ok(bytes, 'actual bytes exist');
        const offset = options.offset ?? 0, end = Math.min(bytes.length, offset + (options.length ?? bytes.length));
        return { content: bytes.subarray(offset, end).toString(options.encoding ?? 'utf8'), total: bytes.length, ...(end < bytes.length ? { nextOffset: end } : {}) };
      },
      async publish(ref, manifest, options = {}) {
        options.signal?.throwIfAborted();
        if (host.failPublication?.(manifest)) throw Error('Publication interrupted');
        const bytes = new Map();
        for (const blob of manifest.blobs) {
          let current = get(ref);
          if (current.ref.kind === 'directory') for (const part of blob.entry.split('/')) { current = [...files.values()].find(item => item.parent?.id === current.ref.id && item.name === part); assert.ok(current); }
          bytes.set(blob.path, Buffer.from(current.bytes));
        }
        return replay(options.operationId, { ref, manifest, artifactId: options.artifactId, expectedRevision: options.expectedRevision }, () => {
          for (const dependency of manifest.dependencies ?? []) get(dependency);
          const artifactRef = { id: options.artifactId ?? 'artifact-' + (++sequence), revision: 'revision-' + sequence, digest: hash(manifest), kind: manifest.kind, schemaVersion: manifest.schemaVersion };
          artifacts.set(artifactRef.id, { ref: artifactRef, manifest: { ...clone(manifest), blobs: manifest.blobs.map(blob => ({ path: blob.path, mediaType: blob.mediaType, size: bytes.get(blob.path).length, digest: hash(bytes.get(blob.path)) })) }, bytes });publications.push(clone(manifest));calls.push(['publish', options]);
          return { ref: artifactRef, receipt: { status: 'completed' } };
        });
      },
    },
  };
  return { host, files, artifacts, records, publications, calls, rows: ref => JSON.parse(get(ref).bytes.get(get(ref).manifest.content.path)) };
}
