import { now, digest, requireValue } from './support.js';
export function provenance(datasetId, sourceKind, provider, bytes) {
  return { kind: sourceKind === 'derived' ? 'derived' : sourceKind === 'external' ? 'observed' : sourceKind === 'synthetic' ? 'demo' : 'user_input', dataset_id: datasetId, source_kind: sourceKind, provider, as_of: now(), data_hash: digest(bytes), engine_version: 'pi-0.99.1', time_range: null };
}

export function parseRows(text, filename = 'data.json') {
  let rows;
  if (/\.csv$/i.test(filename)) {
    const records = []; let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
        else if (c === '"') quoted = false;
        else value += c;
      } else if (c === '"' && value === '') quoted = true;
      else if (c === ',') { row.push(value); value = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(value); if (row.some(cell => cell !== '')) records.push(row); row = []; value = '';
      } else value += c;
    }
    requireValue(!quoted, 'CSV 引号未闭合');
    if (value || row.length) { row.push(value); records.push(row); }
    const header = records.shift()?.map(cell => cell.replace(/^\uFEFF/, '').trim());
    requireValue(header?.length && new Set(header).size === header.length && header.every(Boolean), 'CSV 需要唯一列名');
    rows = records.map(cells => {
      requireValue(cells.length === header.length, 'CSV 列数不一致');
      return Object.fromEntries(header.map((key, i) => [key, cells[i]]));
    });
  } else {
    try { rows = JSON.parse(text); } catch { requireValue(false, '需要 JSON 对象数组或 CSV 文件'); }
  }
  requireValue(Array.isArray(rows) && rows.length <= 100000 && rows.every(row => row && typeof row === 'object' && !Array.isArray(row)), '数据须为最多 100000 行的对象数组');
  requireValue(Buffer.byteLength(JSON.stringify(rows)) <= 8 * 1024 * 1024, '数据超过 8 MiB');
  return rows;
}

export function rowSchema(rows) {
  const properties = Object.fromEntries([...new Set(rows.flatMap(Object.keys))].map(key => [key, {}]));
  return { type: 'object', properties, additionalProperties: false };
}
