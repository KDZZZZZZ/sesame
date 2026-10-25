import { capability } from '@sesame/plugin-sdk/capabilities';
import { fetchSource, unavailableSource } from './fetch.js';
import { ApiError, digest, now } from './support.js';
import { parseRows } from './data.js';
import { publishRows } from './resource-files.js';
async function query(url, signal) {
  const source = await fetchSource(url, signal);
  if (source.status === 'unavailable') return source;
  let rows;
  try {
    rows = /json|csv/.test(source.content_type) || /\.(json|csv)(?:$|\?)/i.test(source.url)
      ? parseRows(source.text, /csv/.test(source.content_type) || /\.csv(?:$|\?)/i.test(source.url) ? 'data.csv' : 'data.json')
      : [{ url: source.url, text: source.text }];
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'invalid_request') throw error;
    return unavailableSource(source.url, 'source_content_error', `来源无法规范为数据行：${error.message}`);
  }
  return { source, rows, provenance: { kind: 'observed', source_kind: 'external', provider: source.url, as_of: now(), data_hash: digest(source.bytes), content_type: source.content_type, encoding: source.encoding } };
}

export function createCapabilities(host) {
  return [
    capability('sources_fetch', async ({ url }, signal) => {
      const value = await query(url, signal);
      if (value.status === 'unavailable') return value;
      const ref = await publishRows(host, { title: value.source.url, rows: value.rows, source: value.source, provenance: value.provenance }, [], signal);
      return { status: 'available', ref, text: value.source.text.slice(0, 20000), rowCount: value.rows.length, provenance: value.provenance };
    }),
    capability('http_query', async ({ query: input }, signal) => {
      const value = await query(input.url, signal);
      if (value.status === 'unavailable') return { items: [], metadata: value };
      return { items: value.rows, metadata: { status: 'available', provenance: value.provenance } };
    }),
  ];
}
