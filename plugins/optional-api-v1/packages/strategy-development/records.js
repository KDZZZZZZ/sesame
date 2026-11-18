import { canonical, digest } from '@sesame/plugin-sdk/protocol';

export const pluginId = 'sesame/strategy-development';
export function requireThat(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });
}

export function isRef(value, kind) {
  return value && typeof value.id === 'string' && value.id && typeof value.revision === 'string' && value.revision
    && typeof value.kind === 'string' && (!kind || value.kind === kind)
    && value.schemaVersion === '1.0.0' && /^sha256:[a-f0-9]{64}$/.test(value.digest);
}

export function collectRefs(value) {
  const refs = new Map();
  function visit(item) {
    if (isRef(item)) refs.set(canonical(item), item);
    else if (item && typeof item === 'object') for (const child of Object.values(item)) visit(child);
  }
  visit(value);
  return [...refs.values()];
}

export async function publishRecord(host, type, body, operationId, dependencies = []) {
  const refs = collectRefs(dependencies);
  let provenance = refs.length ? 'derived' : 'user_input';
  for (const ref of refs) {
    const manifest = await host.resources.read(ref, { part: 'manifest' });
    if ((manifest.provenance ?? manifest.content?.provenance)?.kind === 'demo') provenance = 'demo';
  }
  const content = canonical(body);
  const key = 'strategy-dev-' + digest({ type, operationId }).slice(7);
  const name = key + '-' + digest({ content, refs }).slice(7, 31);
  const root = await host.resources.create({ kind: 'directory', name, lifetime: 'durable' }, { operationId: key + '-root' });
  await host.resources.create({ kind: 'file', parent: root, name: 'record.json', lifetime: 'durable', source: { content }, policy: { readOnly: true } }, { operationId: key + '-file' });
  const { ref } = await host.resources.publish(root, {
    kind: 'resource', schemaVersion: '1.0.0', content: { type, path: 'record.json', digest: digest(content) },
    provenance: { kind: provenance, references: refs }, dependencies: refs,
    blobs: [{ path: 'record.json', entry: 'record.json', mediaType: 'application/json' }],
  }, { operationId: key });
  return ref;
}

export async function readText(host, ref, entry, maxBytes) {
  const chunks = [];
  let offset = 0;
  for (;;) {
    const page = await host.resources.read(ref, { part: 'content', ...(entry ? { entry } : {}), encoding: 'base64', offset, length: 262144 });
    const bytes = Buffer.from(page.content, 'base64');
    requireThat(page.total <= maxBytes && offset + bytes.length <= maxBytes, 'Input exceeds its documented byte limit.');
    chunks.push(bytes);
    if (page.nextOffset === undefined) return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    requireThat(bytes.length && page.nextOffset === offset + bytes.length, 'Resource page does not advance contiguously.');
    offset = page.nextOffset;
  }
}

export async function readRecord(host, ref, type) {
  requireThat(isRef(ref, 'resource'), 'Supply a fixed strategy-development resource reference.');
  const manifest = await host.resources.read(ref, { part: 'manifest' });
  const meta = await host.resources.read(ref, { part: 'metadata' });
  requireThat(meta.producer?.id === pluginId && canonical(meta.ref) === canonical(ref)
    && manifest.content?.type === type && manifest.content.path === 'record.json', 'Record producer or type does not match ' + type + '.');
  const json = await readText(host, ref, 'record.json', 32 * 1024 * 1024);
  requireThat(digest(json) === manifest.content.digest, 'Record content differs from its frozen digest.');
  return JSON.parse(json);
}
