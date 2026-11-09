import { mkdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { ARTIFACT_SCHEMAS, MAX_SHARD_BYTES, artifactRef, canonical, digest, ensure, identifier, object, keys, text } from './contracts.js';

export const isRef = value => object(value) && typeof value.revision === 'string' && typeof value.digest === 'string' && typeof value.id === 'string';
export const isFile = value => object(value) && Object.keys(value).length === 3 && typeof value.path === 'string' && isAbsolute(value.path) && /^sha256:[a-f0-9]{64}$/.test(value.digest) && Number.isSafeInteger(value.bytes);
export function ownedPath(root, path) {
  const target = resolve(path), rel = relative(resolve(root), target);
  ensure(rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel), 'File is outside the owned execution directory', 'FORBIDDEN');
  return target;
}
export async function fileReceipt(path) { const bytes = await readFile(path); return { path: resolve(path), digest: digest(bytes), bytes: bytes.length }; }
export async function verifiedFile(root, file, maxBytes = MAX_SHARD_BYTES) {
  ensure(isFile(file) && file.bytes >= 0 && file.bytes <= maxBytes, 'Invalid or oversized worker file', 'RESOURCE_EXHAUSTED');
  const path = ownedPath(root, file.path), actual = await realpath(path), actualRoot = await realpath(root); ownedPath(actualRoot, actual);
  const stat = await lstat(path); ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Worker files must be ordinary owned files', 'FORBIDDEN');
  ensure(stat.size === file.bytes && stat.size <= maxBytes, 'Worker file size differs', 'EVIDENCE_MISMATCH');
  const bytes = await readFile(path); ensure(bytes.length === file.bytes && digest(bytes) === file.digest, 'Worker file digest differs', 'EVIDENCE_MISMATCH'); return bytes;
}
export function attemptDirectory(root, ctx) { text(ctx?.jobId, 256); text(ctx?.attemptId, 256); return join(root, 'jobs', identifier('j', ctx.jobId), 'attempts', identifier('a', ctx.attemptId)); }

async function ownedDirectory(root, directory) {
  const target = ownedPath(root, directory); await mkdir(root, { recursive: true });
  const actualRoot = await realpath(root); let current = resolve(root);
  for (const part of relative(resolve(root), target).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try { await mkdir(current); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const stat = await lstat(current);
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'Materialization directories must be ordinary owned directories', 'FORBIDDEN');
    ownedPath(actualRoot, await realpath(current));
  }
}

async function writeImmutable(root, path, bytes) {
  await ownedDirectory(root, dirname(path));
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  const receipt = { path: resolve(path), digest: digest(bytes), bytes: bytes.length };
  await verifiedFile(root, receipt, Math.max(MAX_SHARD_BYTES, bytes.length));
  return receipt;
}

export function createArtifacts({ host, rootDir = host.context.storageRoot }) {
  const materializing = new Map();
  const checked = async (ref, ctx) => {
    ctx?.signal?.throwIfAborted(); artifactRef(ref);
    const manifest = await host.resources.read(ref, { part: 'manifest' });
    ensure(digest(manifest) === ref.digest && manifest.kind === ref.kind && manifest.schemaVersion === ref.schemaVersion, 'Published manifest identity differs', 'EVIDENCE_MISMATCH');
    return manifest;
  };
  const readBytes = async (ref, ctx) => {
    ensure(['data', 'resource'].includes(ref?.kind), 'Only factor resources and fixed data sources have readable payloads');
    const manifest = await checked(ref, ctx), content = manifest.content;
    ensure(object(content) && typeof content.path === 'string', 'Artifact is missing its payload declaration', 'EVIDENCE_MISMATCH');
    if (ref.kind === 'resource') {
      keys(content, ['format', 'path', 'bytesDigest', 'schema']);
      const binary = content.schema === 'factor-provider-file/1';
      ensure(ARTIFACT_SCHEMAS.includes(content.schema) && content.format === (binary ? 'factor-binary/1' : 'factor-json/1') && content.path === (binary ? 'payload.bin' : 'payload.json'), 'Unknown factor artifact format or schema', 'EVIDENCE_MISMATCH');
      const metadata = await host.resources.read(ref, { part: 'metadata' });
      ensure(metadata?.producer?.id === host.context.pluginId, 'Factor evidence must be produced by this plugin', 'FORBIDDEN');
    } else ensure(content.format === 'json-rows', 'Fixed data input must be json-rows');
    const blob = manifest.blobs?.find(item => item.path === content.path);
    ensure(blob && Number.isSafeInteger(blob.size) && blob.size >= 0 && blob.size <= (ref.kind === 'data' ? 32 * 1024 * 1024 : MAX_SHARD_BYTES), 'Artifact needs a bounded payload', 'RESOURCE_EXHAUSTED');
    const chunks = []; let offset = 0;
    do {
      ctx?.signal?.throwIfAborted();
      const page = await host.resources.read(ref, { part: 'content', entry: content.path, offset, length: 262144, encoding: 'base64' });
      const chunk = Buffer.from(page.content, 'base64');
      ensure(page.encoding === 'base64' && page.offset === offset && page.length === chunk.length && chunk.length <= 262144 && offset + chunk.length <= blob.size && page.total === blob.size && canonical(page.ref) === canonical(ref), 'Artifact read range differs', 'EVIDENCE_MISMATCH');
      chunks.push(chunk); offset += chunk.length;
      if (page.nextOffset === undefined) break;
      ensure(chunk.length > 0 && page.nextOffset === offset && offset < blob.size, 'Artifact cursor did not advance', 'EVIDENCE_MISMATCH');
    } while (true);
    const bytes = Buffer.concat(chunks); ensure(bytes.length === blob.size && digest(bytes) === blob.digest, 'Artifact payload digest differs', 'EVIDENCE_MISMATCH');
    if (ref.kind === 'resource') ensure(ARTIFACT_SCHEMAS.includes(content.schema) && content.bytesDigest === digest(bytes), 'Unknown factor artifact or payload digest', 'EVIDENCE_MISMATCH');
    return { bytes, manifest };
  };
  const publish = async (bytes, schema, write, ctx, data) => {
    ctx?.signal?.throwIfAborted(); text(write.operationId, 512);
    ensure(bytes.length <= MAX_SHARD_BYTES, 'Artifact exceeds its 16 MiB shard budget', 'RESOURCE_EXHAUSTED');
    ensure(ARTIFACT_SCHEMAS.includes(schema), 'Unknown factor artifact schema');
    const dependencies = [...new Map((write.dependencies ?? []).map(ref => [canonical(artifactRef(ref)), ref])).values()];
    ensure(dependencies.length <= 256, 'Artifact dependency page is too large', 'RESOURCE_EXHAUSTED');
    const binary = schema === 'factor-provider-file/1', path = binary ? 'payload.bin' : 'payload.json';
    const operationId = `${write.operationId}:${digest(bytes)}`;
    const resource = await host.resources.create({ kind: 'blob', name: `${identifier('factor', operationId)}.${binary ? 'bin' : 'json'}`, lifetime: 'durable', policy: { readOnly: true }, source: { content: bytes.toString('base64'), encoding: 'base64' } }, { operationId: `${operationId}:create`, signal: ctx?.signal });
    const manifest = { kind: data ? 'data' : 'resource', schemaVersion: '1.0.0', content: data ?? { format: binary ? 'factor-binary/1' : 'factor-json/1', path, bytesDigest: digest(bytes), schema }, dependencies, blobs: [{ entry: 'content', path, mediaType: binary ? 'application/octet-stream' : 'application/json' }] };
    const published = await host.resources.publish(resource.ref ?? resource, manifest, { operationId: `${operationId}:publish`, signal: ctx?.signal });
    return artifactRef(published.ref);
  };
  const publishJSON = (value, write, ctx) => publish(Buffer.from(canonical(value)), write.schema, write, ctx);
  const readJSON = async (ref, ctx) => { const { bytes } = await readBytes(ref, ctx); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); };
  const importFile = async (file, write, ctx) => publish(await verifiedFile(attemptDirectory(rootDir, ctx), file), write.schema, write, ctx);
  const materialize = async (ref, ctx, stack = new Set()) => {
    const key = canonical(ref); ensure(!stack.has(key), 'Artifact dependency cycle', 'EVIDENCE_MISMATCH');
    artifactRef(ref); const attempt = attemptDirectory(rootDir, ctx), cacheKey = `${attempt}:${ref.digest}`;
    if (materializing.has(cacheKey)) return materializing.get(cacheKey);
    const work = (async () => {
      const { bytes, manifest } = await readBytes(ref, ctx), dir = join(attempt, 'input', ref.digest.slice(7));
      const path = join(dir, manifest.content.format === 'factor-binary/1' ? 'payload.bin' : 'payload.json');
      let output = bytes;
      if (manifest.content.format !== 'factor-binary/1' && ref.kind !== 'data') {
        const next = new Set([...stack, key]), dependencies = new Set((manifest.dependencies ?? []).map(canonical));
        const transform = async (value, field) => {
          if (isRef(value)) {
            artifactRef(value); ensure(dependencies.has(canonical(value)), 'Artifact references an undeclared dependency', 'EVIDENCE_MISMATCH');
            // These immutable provenance handles are not executable inputs.
            return ['source', 'sourceRef', 'snapshotRef', 'usageLedgerRef', 'valuesRef'].includes(field) ? value : materialize(value, ctx, next);
          }
          if (Array.isArray(value)) return Promise.all(value.map(item => transform(item, field)));
          if (object(value)) return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([name, item]) => [name, await transform(item, name)])));
          return value;
        };
        output = Buffer.from(canonical(await transform(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))));
      }
      ctx?.signal?.throwIfAborted();
      return writeImmutable(rootDir, path, output);
    })();
    materializing.set(cacheKey, work);
    try { return await work; } finally { materializing.delete(cacheKey); }
  };
  const importTree = async (file, ctx, defaultSchema = 'factor-evidence/1', operation = 'output') => {
    const bytes = await verifiedFile(attemptDirectory(rootDir, ctx), file);
    if (/\.bin$/i.test(file.path)) return importFile(file, { schema: 'factor-provider-file/1', dependencies: [], operationId: `${ctx.jobId}:${operation}:${file.digest}` }, ctx);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), dependencies = [];
    const schema = ARTIFACT_SCHEMAS.includes(value?.schema) ? value.schema : defaultSchema;
    const walk = async (item, key) => {
      if (isFile(item)) { const ref = await importTree(item, ctx, key === 'shards' ? schema : inferSchema(key, null), operation); dependencies.push(ref); return ref; }
      ensure(!(object(item) && 'path' in item && 'digest' in item && 'bytes' in item), 'Malformed worker file handle', 'INVALID_OUTPUT');
      if (isRef(item)) { artifactRef(item); dependencies.push(item); return item; }
      if (Array.isArray(item)) return Promise.all(item.map(entry => walk(entry, key)));
      if (object(item)) return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([name, entry]) => [name, await walk(entry, name)])));
      return item;
    };
    const result = await walk(value);
    return publishJSON(result, { schema, dependencies, operationId: `${ctx.jobId}:${operation}:${file.digest}` }, ctx);
  };
  const publishRows = async (rows, provenance, dependencies, ctx, operationId) => {
    const bytes = Buffer.from(canonical(rows));
    return publish(bytes, 'factor-source-rows/1', { dependencies, operationId }, ctx, { format: 'json-rows', path: 'payload.json', rowCount: rows.length, columns: ['time', 'symbol', 'availableAt', 'fields'], provenance });
  };
  return { readJSON, publishJSON, importFile, materialize, importTree, publishRows, readBytes, verify: checked };
}

function inferSchema(key, value) {
  if (ARTIFACT_SCHEMAS.includes(value?.schema)) return value.schema;
  return ({ calendar: 'factor-calendar/1', symbolMap: 'factor-symbol-map/1', provider: 'factor-provider/1', checkpoint: 'factor-search-state/1', matrix: 'factor-matrix/1', labels: 'factor-matrix/1', manifest: 'factor-matrix/1', shards: 'factor-matrix/1', development: 'factor-matrix/1', holdout: 'factor-matrix/1', usageLedger: 'factor-usage/1' })[key] ?? 'factor-evidence/1';
}
