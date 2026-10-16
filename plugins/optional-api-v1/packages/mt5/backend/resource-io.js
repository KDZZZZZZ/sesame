import { createHash } from 'node:crypto';
import { requireValue } from './support.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export async function readBytes(host, ref, entry, signal) {
  const chunks = []; let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    const page = await host.resources.read(ref, { part: 'content', ...(entry ? { entry } : {}), encoding: 'base64', offset, length: 262144 });
    requireValue(page.total <= 32 * 1024 * 1024, 'MT5 artifact exceeds 32 MiB');
    chunks.push(Buffer.from(page.content, 'base64'));
    if (page.nextOffset === undefined) return Buffer.concat(chunks);
    requireValue(page.nextOffset > offset, 'MT5 resource cursor did not advance'); offset = page.nextOffset;
  }
}
export async function readArtifact(host, ref) {
  const [metadata, manifest] = await Promise.all([host.resources.read(ref, { part: 'metadata' }), host.resources.read(ref, { part: 'manifest' })]);
  return { ...metadata, manifest };
}
export async function publishArtifact(host, operationId, kind, content, dependencies = [], files = {}) {
  const identity = hash(operationId), root = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: `mt5-${identity}` }, { operationId: `mt5-bundle:${identity}` });
  const entries = Object.entries(files).length ? Object.entries(files) : [['content.json', JSON.stringify(content)]];
  const folders = new Map([['', root]]), blobs = [];
  for (const [path, value] of entries) {
    requireValue(typeof path === 'string' && !/[\\:\x00-\x1f]/.test(path), 'Invalid MT5 artifact path');
    const parts = path.split('/'); requireValue(parts.every(part => part && part !== '.' && part !== '..'), 'Artifact path must be relative');
    let parent = root, prefix = '';
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!folders.has(prefix)) folders.set(prefix, await host.resources.create({ kind: 'directory', parent, name: part, lifetime: 'durable' }, { operationId: `mt5-folder:${identity}:${prefix}` }));
      parent = folders.get(prefix);
    }
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    await host.resources.create({ kind: 'file', parent, name: parts.at(-1), lifetime: 'durable', source: { content: bytes.toString('base64'), encoding: 'base64' }, policy: { readOnly: true } }, { operationId: `mt5-file:${identity}:${path}` });
    blobs.push({ entry: path, path, mediaType: path.endsWith('.json') ? 'application/json' : path.endsWith('.ex5') ? 'application/octet-stream' : 'text/plain' });
  }
  return (await host.resources.publish(root, { kind, schemaVersion: '1.0.0', content, dependencies, blobs }, { operationId })).ref;
}
