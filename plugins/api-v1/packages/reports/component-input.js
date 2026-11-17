import { readBytes } from './artifact-io.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, path, message) => { if (!condition) throw new Error(`${path}: ${message}`); };
export const isSafeComponentEntry = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\\:\x00-\x1f]/.test(value)
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));

export async function readComponentResource(host, ref, request, path) {
  try { return await host.resources.read(ref, request); }
  catch (error) { throw Object.assign(new Error(`${path}: Could not read the fixed resource: ${error.message}`), { validationIncomplete: true }); }
}

export async function readComponentJson(host, ref, entry, signal, path, limit) {
  check(isSafeComponentEntry(entry), path, 'Fixed JSON source needs a safe packaged entry');
  let bytes;
  try { bytes = await readBytes(host, ref, entry, signal); }
  catch (error) { signal?.throwIfAborted(); throw Object.assign(new Error(`${path}: Could not read all fixed resource bytes: ${error.message}`), { validationIncomplete: true }); }
  check(bytes.length <= limit, path, `Fixed JSON source exceeds ${limit / 1024 / 1024} MiB`);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${path}: Fixed source must contain valid UTF-8 JSON`); }
}

function rowColumns(rows, path) {
  check(Array.isArray(rows) && rows.length > 0 && rows.length <= 2500 && rows.every(object), path, 'Chart data must contain 1–2500 fixed object rows');
  return [...new Set(rows.flatMap(Object.keys))];
}

// Derive only structural columns. Titles, conclusions, source notes and values
// belong to the supplied content and are never generated or rewritten here.
export async function normalizeComponentContent(host, content, data = [], signal) {
  const result = structuredClone(content), fixedColumns = new Map();
  const columnsFor = async (id, path) => {
    const binding = data.find(item => item.id === id);
    check(binding, path, 'Chart data binding is missing');
    if (!fixedColumns.has(id)) {
      const manifest = await readComponentResource(host, binding.ref, { part: 'manifest' }, path);
      check(manifest.content?.format === 'json-rows' && isSafeComponentEntry(manifest.content.path), path, 'Fixed chart data must use the supported json-rows format');
      check(manifest.content.available_for_analysis !== false && manifest.content.provenance?.available_for_analysis !== false, path, 'Fixed chart data is not available for analysis');
      const columns = manifest.content.columns;
      fixedColumns.set(id, columns === undefined || Array.isArray(columns) && columns.length === 0
        ? rowColumns(await readComponentJson(host, binding.ref, manifest.content.path, signal, path, 32 * 1024 * 1024), path)
        : structuredClone(columns));
    }
    return fixedColumns.get(id);
  };
  const visit = async (block, path) => {
    signal?.throwIfAborted();
    if (!object(block)) return;
    if (block.type === 'chart' && block.columns === undefined) {
      const columns = block.data_id !== undefined ? await columnsFor(block.data_id, `${path}/data_id`)
        : block.rows !== undefined ? rowColumns(block.rows, `${path}/rows`) : undefined;
      if (columns !== undefined) {
        check(Array.isArray(columns) && columns.length > 0 && columns.length <= 32 && columns.every(value => typeof value === 'string' && value.trim() && value.length <= 20000), `${path}/columns`, 'Chart source columns must contain 1–32 nonempty names');
        block.columns = [...columns];
      }
    }
    if (['group', 'details'].includes(block.type) && Array.isArray(block.blocks)) {
      for (const [index, child] of block.blocks.entries()) await visit(child, `${path}/blocks/${index}`);
    }
  };
  if (object(result) && result.kind === 'document') {
    if (Array.isArray(result.sections)) for (const [index, section] of result.sections.entries()) {
      if (Array.isArray(section?.blocks)) for (const [blockIndex, block] of section.blocks.entries()) await visit(block, `/content/sections/${index}/blocks/${blockIndex}`);
    }
  }
  return result;
}
