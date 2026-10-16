// Isolated managed-resource port. Production resource I/O is covered by mt5-v2-host.test.mjs.
import assert from 'node:assert/strict';
import { digest, canonical } from '@sesame/plugin-sdk/protocol';

const copy = value => structuredClone(value);
const conflict = () => Object.assign(new Error('Idempotency conflict'), { code: 'IDEMPOTENCY_CONFLICT' });
export function resourceFixture(host) {
  const managed = new Map(), artifacts = new Map(), blobs = new Map(), requests = new Map();
  const once = (key, input, action) => {
    if (!key) return action();
    const old = requests.get(key), hash = digest(input);
    if (old) { if (old.hash !== hash) throw conflict(); return copy(old.result); }
    const result = action(); requests.set(key, { hash, result: copy(result) }); return result;
  };
  const find = (parent, path) => {
    let current = managed.get(parent.id);
    for (const name of path.split('/')) current = [...managed.values()].find(row => row.parent?.id === current?.ref.id && row.name === name);
    assert.ok(current, `Missing managed entry ${path}`); return current;
  };
  const resources = {
    async create(input, options = {}) {
      return once(options.operationId && `create:${host.context.pluginId}:${options.operationId}`, input, () => {
        const ref = { id: `managed-${managed.size}`, kind: input.kind, version: 1 };
        const bytes = input.source ? Buffer.from(input.source.content, input.source.encoding ?? 'utf8') : Buffer.alloc(0);
        managed.set(ref.id, { ...copy(input), ref, bytes }); return ref;
      });
    },
    async publish(ref, input, options = {}) {
      return once(options.operationId && `publish:${host.context.pluginId}:${options.operationId}`, { ref, input }, () => {
        const manifest = { ...copy(input), blobs: input.blobs.map(blob => {
          const bytes = find(ref, blob.entry ?? blob.path).bytes, sha = digest(bytes); blobs.set(sha, Buffer.from(bytes));
          return { path: blob.path, mediaType: blob.mediaType, digest: sha, size: bytes.length };
        }) };
        const artifactRef = { id: `artifact-${artifacts.size}`, revision: '1', kind: manifest.kind, schemaVersion: manifest.schemaVersion, digest: digest(manifest) };
        artifacts.set(artifactRef.id, { ref: artifactRef, producer: { id: host.context.pluginId, version: host.context.pluginVersion, digest: host.context.pluginRevision }, manifest });
        return { ref: artifactRef, receipt: { status: 'published' } };
      });
    },
    async read(ref, options) {
      const record = artifacts.get(ref.id); assert.ok(record, `Missing artifact ${ref.id}`); assert.equal(canonical(record.ref), canonical(ref));
      if (options.part === 'metadata') { const { manifest, ...metadata } = record; return copy(metadata); }
      if (options.part === 'manifest') return copy(record.manifest);
      assert.equal(options.part, 'content');
      const entry = record.manifest.blobs.find(blob => blob.path === options.entry); assert.ok(entry, `Missing artifact entry ${options.entry}`);
      const bytes = blobs.get(entry.digest); assert.ok(bytes); assert.equal(bytes.length, entry.size); assert.equal(digest(bytes), entry.digest);
      const offset = options.offset ?? 0, end = Math.min(bytes.length, offset + (options.length ?? bytes.length));
      return { content: bytes.subarray(offset, end).toString(options.encoding ?? 'utf8'), total: bytes.length, ...(end < bytes.length ? { nextOffset: end } : {}) };
    },
  };
  host.resources = resources; return { resources, managed, artifacts, blobs, requests };
}
