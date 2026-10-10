export { createTools } from './tools.js';
import { fetchSource } from './fetch.js';
import { digest, now } from './support.js';
import { parseRows } from './data.js';
export function activate(host) {
  const dispose = host.datasets.registerSource('http', 'HTTP/HTTPS 文本、JSON 对象数组或 CSV；arguments.url 指定来源地址', async (input, signal) => {
    const source = await fetchSource(input.url, signal);
    const data = /json|csv/.test(source.content_type) || /\.(json|csv)(?:$|\?)/i.test(source.url)
      ? parseRows(source.text, /csv/.test(source.content_type) || /\.csv(?:$|\?)/i.test(source.url) ? 'data.csv' : 'data.json')
      : [{ url: source.url, text: source.text }];
    return { rows: data, provenance: { kind: 'observed', source_kind: 'external', provider: source.url, as_of: now(), data_hash: digest(source.text), content_type: source.content_type } };
  });
  return { dispose };
}
