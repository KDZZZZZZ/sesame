import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };

export async function publishIndicator(host, operationId, manifest, files, signal) {
  const identity = `indicator:${hash(operationId)}`, root = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: identity.replace(':', '-') }, { operationId: `${identity}:root`, signal });
  const directories = new Map([['', root]]), paths = new Set();
  let bytes = 0;
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    check(!/[\\:\x00-\x1f]/.test(path) && parts.every(part => part && part !== '.' && part !== '..') && !paths.has(path.toLowerCase()), 'Indicator paths must be unique and relative');
    paths.add(path.toLowerCase()); bytes += Buffer.byteLength(content);
    check(bytes <= 1024 * 1024, 'Indicator files exceed 1 MiB');
    let parent = root, prefix = '';
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!directories.has(prefix)) directories.set(prefix, await host.resources.create({ kind: 'directory', parent, name: part, lifetime: 'durable' }, { operationId: `${identity}:dir:${prefix}`, signal }));
      parent = directories.get(prefix);
    }
    await host.resources.create({ kind: 'file', parent, name: parts.at(-1), lifetime: 'durable', source: { content } }, { operationId: `${identity}:file:${path}`, signal });
  }
  return host.resources.publish(root, { ...manifest, blobs: Object.keys(files).map(path => ({ entry: path, path, mediaType: path.endsWith('.json') ? 'application/json' : 'text/javascript' })) }, { operationId, signal });
}
