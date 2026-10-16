import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => { const part = relative(root, path); return part === '' || part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part); };

export async function readBytes(host, ref, entry, signal) {
  const chunks = []; let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    const page = await host.resources.read(ref, { part: 'content', ...(entry ? { entry } : {}), encoding: 'base64', offset, length: 262144 });
    check(page.total <= 32 * 1024 * 1024, 'Artifact resource exceeds 32 MiB');
    chunks.push(Buffer.from(page.content, 'base64'));
    if (page.nextOffset === undefined) return Buffer.concat(chunks);
    check(page.nextOffset > offset, 'Nonadvancing resource cursor'); offset = page.nextOffset;
  }
}

export async function readWorkspace(host, path, signal, operationId) {
  check(host.context.workspaceRoot, 'An active workspace is required');
  const root = await realpath(host.context.workspaceRoot), target = await realpath(resolve(root, path));
  check(inside(root, target), 'Strategy files must be inside this workspace');
  const ref = await host.resources.create({ kind: 'file', lifetime: 'durable', source: { path: target } }, { signal, ...(operationId ? { operationId: `strategy-import:${operationId}:${hash(target)}` } : {}) });
  return readBytes(host, ref, undefined, signal);
}

export async function writeWorkspace(host, path, content, signal) {
  const result = await host.capabilities.invoke('sesame/workspace#write', { path, content }, { signal });
  check(result.type === 'result', 'Workspace write must return an immediate result');
  return result.value;
}

export async function publishFiles(host, operationId, manifest, entries, options = {}, signal) {
  const identity = `bundle:${hash(operationId)}`;
  const root = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: identity.replace(':', '-') }, { operationId: `${identity}:root`, signal });
  const directories = new Map([['', root]]), paths = new Set();
  for (const item of entries) {
    check(typeof item.path === 'string' && !/[\\:\x00-\x1f]/.test(item.path), 'Invalid packaged resource path');
    const parts = item.path.split('/');
    check(parts.every(part => part && part !== '.' && part !== '..') && !paths.has(item.path.toLowerCase()), 'Packaged paths must be unique and relative');
    paths.add(item.path.toLowerCase());
    let parent = root, prefix = '';
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!directories.has(prefix)) directories.set(prefix, await host.resources.create({ kind: 'directory', parent, name: part, lifetime: 'durable' }, { operationId: `${identity}:dir:${prefix}`, signal }));
      parent = directories.get(prefix);
    }
    await host.resources.create({ kind: 'file', parent, name: parts.at(-1), lifetime: 'durable', source: { content: Buffer.from(item.bytes).toString('base64'), encoding: 'base64' } }, { operationId: `${identity}:file:${item.path}`, signal });
  }
  return host.resources.publish(root, { ...manifest, blobs: entries.map(({ path, mediaType }) => ({ entry: path, path, mediaType })) }, { ...options, operationId, signal });
}
