import { check } from './shared.js';

export async function querySaved(host, name, input, signal) {
  const sources = await host.data.sources({ providerId: `host#${name}` });
  const source = sources.items.find(item => item.available !== false);
  check(source, 'SOURCE_UNAVAILABLE', `Saved ${name} source is unavailable`);
  const items = []; let cursor, metadata, bytes = 0;
  do {
    signal?.throwIfAborted();
    const page = await host.data.query({ source: source.ref, operation: 'query', input, limit: 200, ...(cursor ? { cursor } : {}) }, { signal });
    bytes += Buffer.byteLength(JSON.stringify(page));
    check(bytes <= 32 * 1024 * 1024, 'EVIDENCE_TOO_LARGE', 'Saved evidence exceeds 32 MiB; select narrower evidence');
    items.push(...page.items); metadata ??= page.metadata; cursor = page.nextCursor;
  } while (cursor);
  return { items, metadata };
}

export async function datasetSnapshot(host, references, signal) {
  const datasets = new Map(), visiting = new Set(), identities = new Map(); let bytes = 0, savedSource;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const key = value => JSON.stringify(value, function (name, child) {
    return object(child) ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child;
  });
  async function read(reference) {
    const ref = typeof reference === 'string' ? { datasetId: reference } : reference?.revision ? { datasetId: reference.id, artifact: reference } : reference;
    check(object(ref) && typeof ref.datasetId === 'string' && ref.datasetId.length > 0 && ref.datasetId.length <= 200, 'INVALID_EVIDENCE', 'Evidence requires a bounded datasetId');
    if (ref.artifact) {
      check(ref.source === undefined && ref.query === undefined && ref.artifact.kind === 'data' && ref.datasetId === ref.artifact.id, 'INVALID_EVIDENCE', 'Artifact evidence must name its exact data ArtifactRef identity');
      const id = ref.datasetId, identity = key(ref.artifact);
      check(!identities.has(id) || identities.get(id) === identity, 'INVALID_EVIDENCE', 'One dataset ID cannot name two artifact revisions'); identities.set(id, identity);
      check(!visiting.has(id), 'INVALID_EVIDENCE', 'Cyclic artifact evidence'); if (datasets.has(id)) return;
      check(visiting.size < 32 && identities.size <= 128, 'INVALID_EVIDENCE', 'Oversized artifact evidence chain'); visiting.add(id);
      signal?.throwIfAborted();
      const manifest = await host.resources.read(ref.artifact, { part: 'manifest' }), metadata = await host.resources.read(ref.artifact, { part: 'metadata' });
      check(manifest.kind === 'data' && manifest.schemaVersion === '1.0.0' && manifest.content?.format === 'json-rows' && typeof manifest.content.path === 'string' && Array.isArray(manifest.dependencies), 'INVALID_EVIDENCE', 'Evidence requires a json-rows data artifact');
      check(manifest.blobs.some(blob => blob.path === manifest.content.path && blob.mediaType === 'application/json'), 'INVALID_EVIDENCE', 'Data rows are not a declared JSON artifact entry');
      const parts = []; let offset = 0;
      do {
        signal?.throwIfAborted();
        const part = await host.resources.read(ref.artifact, { part: 'content', entry: manifest.content.path, offset, length: 256 * 1024, encoding: 'base64' });
        const chunk = Buffer.from(part.content, 'base64'); bytes += chunk.length;
        check(bytes <= 32 * 1024 * 1024 && (part.nextOffset === undefined || part.nextOffset > offset), 'EVIDENCE_TOO_LARGE', 'Artifact evidence exceeds its budget or does not advance');
        parts.push(chunk); offset = part.nextOffset;
      } while (offset !== undefined);
      let rows; try { rows = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { check(false, 'INVALID_EVIDENCE', 'Artifact rows are not valid JSON'); }
      check(Array.isArray(rows) && rows.every(object) && rows.length === manifest.content.rowCount, 'INVALID_EVIDENCE', 'Artifact rows do not match their declared count');
      const parents = manifest.dependencies.filter(item => item.kind === 'data');
      check(parents.length <= 16, 'INVALID_EVIDENCE', 'Too many artifact evidence sources');
      for (const parent of parents) await read(parent);
      const provenance = manifest.content.provenance ?? {}, kinds = { demo: 'synthetic', synthetic: 'synthetic', user_input: 'user_input', derived: 'derived' };
      datasets.set(id, { id, rows, artifact: structuredClone(ref.artifact), artifactDependencies: manifest.dependencies,
        input_ids: parents.map(item => item.id), producer_plugin_id: metadata.producer.id,
        provenance: { ...provenance, ...(provenance.source_kind === undefined && kinds[provenance.kind] ? { source_kind: kinds[provenance.kind] } : {}) } });
      visiting.delete(id); return;
    }
    check((ref.source === undefined) === (ref.query === undefined), 'INVALID_EVIDENCE', 'External evidence requires both SourceRef and query');
    let source = ref.source, query = ref.query;
    if (!source) {
      if (!savedSource) savedSource = (await host.data.sources({ providerId: 'host#datasets' })).items.find(item => item.available !== false)?.ref;
      check(savedSource, 'SOURCE_UNAVAILABLE', 'Saved datasets source is unavailable'); source = savedSource; query = { datasetId: ref.datasetId };
    }
    check(object(source) && object(query), 'INVALID_EVIDENCE', 'Evidence source and query must be objects');
    const id = ref.datasetId, identity = key({ source, query });
    check(!identities.has(id) || identities.get(id) === identity, 'INVALID_EVIDENCE', 'One dataset ID cannot name two source queries');
    identities.set(id, identity);
    check(!visiting.has(id), 'INVALID_EVIDENCE', 'Cyclic dataset provenance chain');
    if (datasets.has(id)) return;
    check(visiting.size < 32 && identities.size <= 128, 'INVALID_EVIDENCE', 'Oversized dataset provenance chain');
    visiting.add(id);
    const rows = []; let cursor, metadata;
    do {
      signal?.throwIfAborted();
      const page = await host.data.query({ source, operation: 'query', input: query, limit: 200, ...(cursor ? { cursor } : {}) }, { signal });
      bytes += Buffer.byteLength(JSON.stringify(page)); check(bytes <= 32 * 1024 * 1024, 'EVIDENCE_TOO_LARGE', 'Evidence exceeds 32 MiB; select narrower saved datasets');
      check(page.metadata?.id === id, 'INVALID_EVIDENCE', 'Evidence source returned another dataset');
      if (metadata) check(key(page.metadata) === key(metadata), 'INVALID_EVIDENCE', 'Evidence metadata changed during pagination');
      metadata ??= page.metadata; rows.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    const inputIds = metadata.input_ids ?? [];
    check(Array.isArray(inputIds) && inputIds.length <= 16 && new Set(inputIds).size === inputIds.length && inputIds.every(id => typeof id === 'string' && id.length > 0), 'INVALID_EVIDENCE', 'Invalid evidence ancestry');
    const external = source.providerId !== 'host#datasets';
    if (external) {
      const inputs = metadata.inputs ?? [];
      check(Array.isArray(inputs) && inputs.length === inputIds.length && new Set(inputs.map(item => item?.datasetId)).size === inputIds.length && inputs.every(item => object(item) && inputIds.includes(item.datasetId) && object(item.query)), 'INVALID_EVIDENCE', 'Source must declare one query for each saved ancestor');
      for (const input of inputs) await read({ datasetId: input.datasetId, source, query: input.query });
    } else for (const input of inputIds) await read(input);
    const producer = external ? source.providerId.slice(0, source.providerId.lastIndexOf('#')) : metadata.producer_plugin_id;
    datasets.set(id, { ...metadata, ...(producer ? { producer_plugin_id: producer } : {}), source: structuredClone(source), sourceQuery: structuredClone(query), rows });
    visiting.delete(id);
  }
  check(Array.isArray(references) && references.length <= 128, 'INVALID_EVIDENCE', 'Provide a bounded evidence reference list');
  for (const reference of references) await read(reference);
  return datasets;
}
