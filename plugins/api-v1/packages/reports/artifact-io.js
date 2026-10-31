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
  check(inside(root, target), 'Report files must be inside this workspace');
  const ref = await host.resources.create({ kind: 'file', lifetime: 'durable', source: { path: target } }, { signal, ...(operationId ? { operationId: `report-import:${operationId}:${hash(target)}` } : {}) });
  return readBytes(host, ref, undefined, signal);
}

export async function writeWorkspace(host, path, content, signal) {
  const result = await host.capabilities.invoke('sesame/workspace#write', { path, content }, { signal });
  check(result.type === 'result', 'Workspace write must return an immediate result');
  return result.value;
}
