export async function savedItem(host, sourceId, input, signal) {
  const { items } = await host.data.sources({ providerId: `host#${sourceId}` });
  const source = items.find(item => item.available !== false);
  if (!source) throw Object.assign(new Error(`Saved ${sourceId} source unavailable`), { code: 'SOURCE_UNAVAILABLE' });
  const result = await host.data.query({ source: source.ref, operation: 'query', input, limit: 2 }, { signal });
  if (result.items.length !== 1 || result.nextCursor) throw Object.assign(new Error(`Exact ${sourceId} record unavailable`), { code: 'NOT_FOUND' });
  return result.items[0];
}
