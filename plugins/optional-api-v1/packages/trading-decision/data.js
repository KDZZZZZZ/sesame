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

export { datasetSnapshot } from './dataset-snapshot.js';
