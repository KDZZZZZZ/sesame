import { createHash } from 'node:crypto';

export const check = (condition, message, code = 'INVALID_DATA') => { if (!condition) throw Object.assign(new Error(message), { code }); };
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => `sha256:${createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex')}`;
export const systemSource = name => ({ providerId: `host#${name}`, revision: 'host:2' });
export const publicSource = ({ providerId, revision }) => ({ providerId, revision });
const pending = new Map(), MAX_BYTES = 16 * 1024 * 1024;

export async function readBytes(host, ref, entry, signal) {
  const chunks = []; let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    const part = await host.resources.read(ref, { part: 'content', ...(entry ? { entry } : {}), offset, length: 262144, encoding: 'base64' });
    check(part.total <= MAX_BYTES, 'Resource exceeds the 16 MiB analysis budget', 'RESOURCE_EXHAUSTED');
    chunks.push(Buffer.from(part.content, 'base64'));
    if (part.nextOffset === undefined) return Buffer.concat(chunks);
    check(part.nextOffset > offset, 'Resource returned a nonadvancing byte cursor'); offset = part.nextOffset;
  }
}

export async function collect(host, request, { maxRows = 100000, signal } = {}) {
  const controller = new AbortController(), combined = AbortSignal.any([controller.signal, signal].filter(Boolean));
  const rows = [], pages = []; let cursor, bytes = 0;
  const limit = Math.min(200, maxRows);
  try {
    do {
      combined.throwIfAborted();
      const result = await host.data.query({ ...request, limit, ...(cursor ? { cursor } : {}) }, { signal: combined });
      check(Array.isArray(result.items), 'Source did not return an actual data page');
      rows.push(...result.items); bytes += Buffer.byteLength(JSON.stringify(result));
      check(rows.length <= maxRows && bytes <= MAX_BYTES && pages.length < 1000, 'Snapshot exceeds its row, byte or page budget; request a smaller range', 'RESOURCE_EXHAUSTED');
      const { items, nextCursor, ...metadata } = result; pages.push(metadata); cursor = nextCursor;
      check(!cursor || rows.length < maxRows, 'More rows exist beyond maxRows; no truncated snapshot was published', 'RESOURCE_EXHAUSTED');
    } while (cursor);
    return { rows, pages };
  } finally { controller.abort(); }
}

/** Keep completed capture bytes pinned before publication so retries never refetch them. */
export function snapshotOperation(host, operationId, input, capture, signal) {
  const key = digest([host.context.sessionId, operationId]), fingerprint = digest(input), queue = `${host.context.storageRoot}:${key}`;
  const run = async () => {
    const address = { collection: 'captures', key }; let stored;
    try { stored = await host.state.read(address); } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
    check(!stored || stored.value.fingerprint === fingerprint, 'operationId already describes another snapshot', 'IDEMPOTENCY_CONFLICT');
    if (stored?.value.result) return stored.value.result;
    let captured = stored?.value.capture;
    if (!captured) {
      const value = await capture(); signal?.throwIfAborted();
      const rows = JSON.stringify(value.rows), evidence = JSON.stringify(value.evidence);
      check(Buffer.byteLength(rows) <= MAX_BYTES && Buffer.byteLength(evidence) <= MAX_BYTES, 'Snapshot byte budget exceeded', 'RESOURCE_EXHAUSTED');
      const rowResource = await host.resources.create({ kind: 'file', name: `${key.slice(7)}-rows.json`, lifetime: 'durable', source: { content: rows } }, { operationId: `${key}:rows`, signal });
      const evidenceResource = await host.resources.create({ kind: 'file', name: `${key.slice(7)}-evidence.json`, lifetime: 'durable', source: { content: evidence } }, { operationId: `${key}:evidence`, signal });
      const columns = [...new Set(value.rows.flatMap(Object.keys))];
      check(columns.length <= 256, 'Dataset exceeds 256 columns');
      const sample = [];
      for (const row of value.rows.slice(0, 5)) { if (Buffer.byteLength(JSON.stringify([...sample, row])) > 32768) break; sample.push(row); }
      check(Buffer.byteLength(JSON.stringify(value.summary)) <= 128 * 1024, 'Snapshot metadata exceeds 128 KiB', 'RESOURCE_EXHAUSTED');
      captured = { rowResource, evidenceResource, columns, rowCount: value.rows.length, sample, summary: value.summary, dependencies: value.dependencies ?? [] };
      const saved = await host.state.commit([{ op: 'put', key: address, expectedVersion: 0, value: { fingerprint, capture: captured } }], { operationId: `${key}:capture`, signal });
      stored = saved.entries[0];
    }
    signal?.throwIfAborted();
    const origin = captured.summary.origin;
    check(['observed', 'derived', 'user_input', 'demo'].includes(origin), 'Snapshot requires explicit source provenance');
    const evidenceProvenance = { kind: origin, references: captured.dependencies };
    const evidence = await host.resources.publish(captured.evidenceResource, { kind: 'resource', schemaVersion: '1.0.0', content: { type: 'captured-data-evidence', path: 'evidence.json', ...captured.summary, provenance: evidenceProvenance }, dependencies: captured.dependencies, blobs: [{ path: 'evidence.json', mediaType: 'application/json' }], provenance: evidenceProvenance }, { operationId: `${key}:publish-evidence`, signal });
    const provenance = { kind: origin === 'demo' ? 'demo' : 'derived', references: [evidence.ref], ...captured.summary };
    const published = await host.resources.publish(captured.rowResource, { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', columns: captured.columns, rowCount: captured.rowCount, provenance }, dependencies: [evidence.ref], blobs: [{ path: 'rows.json', mediaType: 'application/json' }], provenance }, { operationId: `${key}:publish-data`, signal });
    const result = { ref: published.ref, evidence: evidence.ref, rowCount: captured.rowCount, columns: captured.columns, sample: captured.sample, provenance, receipt: published.receipt };
    await host.state.commit([{ op: 'put', key: address, expectedVersion: stored.version, value: { fingerprint, capture: captured, result } }], { operationId: `${key}:complete`, signal });
    return result;
  };
  const task = (pending.get(queue) ?? Promise.resolve()).catch(() => {}).then(run), tail = task.catch(() => {});
  pending.set(queue, tail); void tail.finally(() => { if (pending.get(queue) === tail) pending.delete(queue); }); return task;
}

export async function sourceSnapshot(host, args, signal) {
  return snapshotOperation(host, args.operationId, args, async () => {
    const captured = await collect(host, { source: args.source, operation: args.operation ?? 'query', input: args.input }, { maxRows: args.maxRows ?? 100000, signal });
    check(captured.rows.every(row => row && typeof row === 'object' && !Array.isArray(row)), 'Snapshot rows must be JSON objects');
    const metadata = captured.pages[0]?.metadata ?? {};
    const registered = metadata.provenance;
    const recorded = registered?.kind ?? registered?.origin ?? metadata.meta?.origin;
    check(!recorded || !args.provenanceKind || recorded === args.provenanceKind, 'Provenance differs from the recorded source');
    const origin = recorded ?? args.provenanceKind;
    check(['observed', 'derived', 'user_input', 'demo'].includes(origin), 'Source lacks provenance; declare observed/derived/user_input/demo explicitly');
    const dependencies = [...new Map([...(registered?.references ?? []), ...(args.dependencies ?? [])].map(ref => [digest(ref), ref])).values()];
    check(dependencies.length <= 64, 'Snapshot has too many dependencies');
    for (const ref of dependencies) {
      const manifest = await host.resources.read(ref, { part: 'manifest' });
      check(manifest.content.provenance?.kind !== 'demo' || origin === 'demo', 'Demo inputs must remain labelled demo');
    }
    const summary = { title: args.title, source: publicSource(args.source), operation: args.operation ?? 'query', query: args.input, origin, registration: metadata, paginationComplete: true };
    return { rows: captured.rows, evidence: { ...summary, pages: captured.pages }, summary, dependencies };
  }, signal);
}
