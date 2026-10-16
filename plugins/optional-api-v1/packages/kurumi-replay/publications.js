import { createHash } from 'node:crypto';

// A publication is a frozen set of actual files; content bytes never masquerade
// as host BlobRefs. The host owns storage, versioning and publication receipts.
export const publicationFile = content => {const text=Buffer.isBuffer(content)?content.toString('utf8'):String(content);return {content:text,size:Buffer.byteLength(text)};};
export async function publishFiles(host, { operationId, manifest }) {
  const key = createHash('sha256').update(String(operationId)).digest('hex');
  const root = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: `publication-${key}` }, { operationId: `${key}:directory` });
  const directories = new Map([['', root]]), blobs = [];
  for (const file of manifest.blobs) {
    const parts = file.path.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw Object.assign(new Error('Unsafe publication entry'), { code: 'INVALID_PATH' });
    let prefix = '', parent = root;
    for (const name of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${name}` : name;
      if (!directories.has(prefix)) directories.set(prefix, await host.resources.create({ kind: 'directory', lifetime: 'durable', parent, name }, { operationId: `${key}:dir:${prefix}` }));
      parent = directories.get(prefix);
    }
    await host.resources.create({ kind: 'file', lifetime: 'durable', parent, name: parts.at(-1), source: { content: file.content } }, { operationId: `${key}:file:${file.path}` });
    blobs.push({ entry: file.path, path: file.path, mediaType: file.mediaType });
  }
  return (await host.resources.publish(root, { ...manifest, blobs }, { operationId: `${key}:publish` })).ref;
}
