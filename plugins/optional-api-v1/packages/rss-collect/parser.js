import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { invokeValue } from '@sesame/plugin-sdk/capabilities';

const ROOT = dirname(fileURLToPath(import.meta.url)), MAX_SOURCE = 2 * 1024 * 1024;
const fail = message => { throw Object.assign(new Error(message), { code: 'PARSER_INPUT_INVALID' }); };

async function boundResult(host, name, result, signal) {
  if (Buffer.byteLength(JSON.stringify(result, null, 2)) <= 24 * 1024) return result;
  const rows = JSON.stringify([result], null, 2);
  const files = [{ path: 'rows.json', mediaType: 'application/json', text: rows }];
  if (typeof result.text === 'string') files.push({ path: 'text.txt', mediaType: 'text/plain; charset=utf-8', text: result.text });
  const root = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: `parsed-${randomUUID()}` }, { signal });
  let ref;
  try {
    for (const file of files) await host.resources.create({ kind: 'blob', parent: root, name: file.path, lifetime: 'durable', source: { content: file.text, encoding: 'utf8' } }, { signal });
    const provenance = { kind: result.source_ref ? 'derived' : result.source === 'inline' ? 'user_input' : 'demo', transform: name, derived_at: new Date().toISOString(), data_hash: `sha256:${createHash('sha256').update(rows).digest('hex')}`, ...(result.source_provenance ? { source: result.source_provenance } : {}) };
    ({ ref } = await host.resources.publish(root, {
      kind: 'data', schemaVersion: '1.0.0',
      content: { format: 'json-rows', path: 'rows.json', rowCount: 1, columns: Object.keys(result).map(key => ({ key })), provenance, ...(typeof result.text === 'string' ? { text: { path: 'text.txt', encoding: 'utf-8', characters: result.text_length, bytes: Buffer.byteLength(result.text) } } : {}) },
      dependencies: result.source_ref ? [result.source_ref] : [],
      blobs: files.map(file => ({ entry: file.path, path: file.path, mediaType: file.mediaType })),
    }, { signal }));
  } finally { await host.resources.remove(root, { expectedVersion: root.version, mode: 'permanent' }); }
  const summary = {};
  for (const key of ['title', 'format', 'feed_title', 'feed_updated', 'entry_count', 'text_length', 'word_count', 'link_count', 'base', 'date', 'total_currencies', 'returned_currencies', 'version']) {
    if (typeof result[key] === 'string') summary[key] = result[key].slice(0, 512);
    else if (typeof result[key] === 'number') summary[key] = result[key];
  }
  if (Array.isArray(result.entries)) summary.returned_entries = result.entries.length;
  const bounded = { output_truncated: true, result_ref: ref, result_entries: { structured: 'rows.json', ...(typeof result.text === 'string' ? { text: 'text.txt' } : {}) }, result_bytes: Buffer.byteLength(rows), ...(result.source_ref ? { source_ref: result.source_ref } : {}) };
  const preview = { ...summary,
    ...(typeof result.text === 'string' ? { text_preview: result.text.slice(0, 4000) } : { result_preview: rows.slice(0, 4000) }),
    // Complete original provenance is retained in rows.json even for unusually long URLs.
    ...(Buffer.byteLength(JSON.stringify(result.source_provenance ?? {})) < 4096 ? { source: result.source, ...(result.source_provenance ? { source_provenance: result.source_provenance } : {}) } : {}),
  };
  for (const [key, value] of Object.entries(preview)) if (Buffer.byteLength(JSON.stringify({ ...bounded, [key]: value }, null, 2)) <= 24 * 1024) bounded[key] = value;
  return bounded;
}

async function entryBytes(host, ref, path, maxBytes, signal) {
  const chunks = []; let offset = 0, total;
  for (;;) {
    signal?.throwIfAborted();
    const part = await host.resources.read(ref, { part: 'content', entry: path, offset, length: 256 * 1024, encoding: 'base64' });
    if (!Number.isSafeInteger(part.total) || part.total > maxBytes || total !== undefined && total !== part.total) fail('Source snapshot exceeds its read limit or changed during reading');
    total = part.total;
    const bytes = Buffer.from(part.content, 'base64');
    if (part.offset !== offset || bytes.length !== part.length) fail('Source snapshot returned an invalid byte range');
    chunks.push(bytes); offset += bytes.length;
    if (offset === total) break;
    if (!bytes.length || part.nextOffset !== offset) fail('Source snapshot reading made no progress');
  }
  return Buffer.concat(chunks);
}

async function sourceInput(host, ref, signal) {
  if (ref?.kind !== 'data') fail('source_ref must be the exact data artifact returned by the fetch capability');
  const manifest = await host.resources.read(ref, { part: 'manifest' }), content = manifest.content;
  if (content?.format !== 'json-rows') fail('source_ref must contain a frozen source snapshot in json-rows format');
  let text;
  if (content.raw?.path) text = new TextDecoder(content.raw.encoding ?? 'utf-8', { fatal: true }).decode(await entryBytes(host, ref, content.raw.path, MAX_SOURCE, signal));
  else {
    // Existing snapshots retain HTML/XML in one text row, or a JSON object as one row.
    const rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await entryBytes(host, ref, content.path, 12 * MAX_SOURCE, signal)));
    if (!Array.isArray(rows) || rows.length !== 1) fail('Snapshot lacks original source bytes; expected one original text or JSON-object row');
    text = typeof rows[0]?.text === 'string' ? rows[0].text : JSON.stringify(rows[0]);
  }
  if (typeof text !== 'string' || !text.length || Buffer.byteLength(text) > 4 * MAX_SOURCE) fail('Decoded source text exceeds the 8 MiB UTF-8 limit');
  return { text, provenance: content.provenance ?? {} };
}

export async function parse(host, name, contentKey, input, signal) {
  const selected = [contentKey, 'file_path', 'source_ref'].filter(key => input[key] !== undefined);
  if (selected.length !== 1) fail(`Provide exactly one of ${contentKey}, file_path or source_ref`);
  signal?.throwIfAborted();
  const args = { ...input }; let source;
  if (input.source_ref) {
    source = await sourceInput(host, input.source_ref, signal); args[contentKey] = source.text; delete args.source_ref;
    if (name === 'extract_webpage') args._source_url = source.provenance.provider ?? '';
  }
  if (!source && args[contentKey] !== undefined && (typeof args[contentKey] !== 'string' || !args[contentKey].length || Buffer.byteLength(args[contentKey]) > MAX_SOURCE)) fail('Parser input must be nonempty UTF-8 text of at most 2 MiB');
  const directory = await mkdtemp(join(host.context.storageRoot, 'parse-'));
  if (dirname(resolve(directory)) !== resolve(host.context.storageRoot)) throw new Error('Parser temporary directory escaped its private storage');
  try {
    const request = join(directory, 'input.json'), response = join(directory, 'output.json');
    await writeFile(request, JSON.stringify(args), { mode: 0o600 });
    await invokeValue(host, 'host.process.exec', {
      argv: [host.context.pythonPath ?? (process.platform === 'win32' ? 'python' : 'python3'), '-I', '-B', join(ROOT, 'server.py'), name, request, response],
      cwd: directory, timeoutMs: 30000,
    }, { signal });
    signal?.throwIfAborted();
    if ((await stat(response)).size > 16 * MAX_SOURCE) fail('Parser result exceeds its file limit');
    const result = JSON.parse(await readFile(response, 'utf8'));
    if (result.error) throw Object.assign(new Error(result.error), { code: 'PARSE_ERROR' });
    const traced = source ? { ...result, source: source.provenance.provider || `artifact:${input.source_ref.id}`, source_ref: input.source_ref, source_provenance: source.provenance } : result;
    return await boundResult(host, name, traced, signal);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
