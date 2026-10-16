import { basename } from 'node:path';
import { FileAccess, digest } from './file-access.js';
import { executeProcess } from './tools.js';

export function createCapabilities(host) {
  const files = new FileAccess(host.context);
  return [
    ...['list', 'search', 'read', 'write', 'mkdir', 'move', 'remove'].map(method => ({ name: `host_files_${method}`, execute: (input, signal) => files[method](input, signal) })),
    { name: 'host_files_import', execute: async ({ path }, signal) => {
      const original = await files.bytes(path, { whole: true, signal });
      const ref = await host.resources.create({ kind: 'file', name: basename(original.path), lifetime: 'durable', source: { content: original.bytes.toString('base64'), encoding: 'base64' } }, { signal });
      const metadata = await host.resources.read(ref, { part: 'metadata' });
      return { ref, path: metadata.path, provenance: { sourcePath: original.path, modifiedAt: original.modified_at, sha256: digest(original.bytes), bytes: original.size } };
    } },
    { name: 'host_files_run', execute: ({ timeout, ...input }, signal) => executeProcess(host, files, { ...input, timeoutMs: (timeout ?? 60) * 1000 }, signal) },
  ];
}
