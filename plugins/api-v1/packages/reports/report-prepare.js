import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { renderReport } from './report-provider.js';

const MAX_BYTES = 2 * 1024 * 1024;
const check = (condition, message, code = 'INVALID_ARGUMENT') => { if (!condition) throw Object.assign(new Error(message), { code }); };
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const uniqueRefs = refs => [...new Map(refs.map(ref => [hash(ref), ref])).values()];

async function readWorkspaceBytes(host, path, signal, limit = MAX_BYTES) {
  check(host.context.workspaceRoot, '/path: an active workspace is required');
  const root = await realpath(host.context.workspaceRoot), target = await realpath(resolve(root, path));
  const part = relative(root, target);
  check(part && part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part), '/path: draft must be a file inside this workspace');
  // Trusted native plugin code has workspace file access. Read before creating
  // any resource, so a failed preflight leaves no durable import behind.
  const file = await open(target, 'r');
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.size <= limit, `/path: expected a regular file no larger than ${limit / 1024 / 1024} MiB`);
    signal?.throwIfAborted();
    const chunks = []; let bytesRead = 0;
    for (;;) {
      const bytes = Buffer.alloc(Math.min(262144, limit - bytesRead + 1));
      const page = await file.read(bytes, 0, bytes.length, bytesRead);
      if (!page.bytesRead) break;
      bytesRead += page.bytesRead;
      check(bytesRead <= limit, `/path: file exceeds ${limit / 1024 / 1024} MiB`);
      chunks.push(bytes.subarray(0, page.bytesRead));
      signal?.throwIfAborted();
    }
    return Buffer.concat(chunks);
  } finally { await file.close(); }
}

export async function prepareReport(host, args, signal) {
  const bytes = await readWorkspaceBytes(host, args.path, signal);
  let draft;
  try { draft = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) {
    const position = /position (\d+)/.exec(error.message)?.[1];
    throw Object.assign(new Error(`/path: invalid JSON${position ? ` at position ${position}` : ''}; edit the draft file and retry`), { code: 'INVALID_ARGUMENT' });
  }
  const readiness = await host.capabilities.check('host.reports.publish', draft, { signal });
  check(readiness.available, '/: report publication is unavailable', 'UNAVAILABLE');
  check(Object.hasOwn(draft, 'input') && !Object.hasOwn(draft, 'inputRef'), '/input: save the complete host_reports_publish request with inline input; an existing inputRef can be published directly');
  const describe = async () => {
    const result = await host.capabilities.invoke('host.reports.describe', {}, { signal });
    check(result.type === 'result', '/: report description must be an immediate result');
    const provider = result.value.provider;
    check(provider.pluginId === host.context.pluginId && provider.serviceId === 'report'
      && provider.version === host.context.pluginVersion && provider.revision === host.context.pluginRevision,
    '/input: report_prepare requires the selected sesame/reports provider; use the selected provider\'s authoring tools', 'SERVICE_CHANGED');
    return provider;
  };
  const provider = await describe();
  const related = draft.related ?? [], references = draft.references ?? [];
  const dependencies = uniqueRefs([...draft.data.map(item => item.ref), ...related.flatMap(item => item.artifact ? [item.artifact] : []), ...references]);
  check(dependencies.length < 256, '/: report dependencies exceed the 256-reference budget including prepared input');
  check(new Set(draft.data.map(item => item.id)).size === draft.data.length, '/data: binding IDs must be unique');
  // The actual host supplies its current locale when the draft omits it. This
  // structural preflight uses the renderer default without changing that intent.
  const metadata = { title: draft.title, summary: draft.summary, locale: draft.locale ?? 'zh-CN',
    ...(draft.space ? { space: draft.space } : {}), provenanceKind: draft.provenanceKind, features: draft.features ?? ['interactive'] };
  const envelope = { metadata, data: draft.data, related, references, input: draft.input };
  const renderReady = await host.capabilities.check({ id: `${host.context.pluginId}#report_render`, revision: provider.revision }, envelope, { signal });
  check(renderReady.available, '/input: report rendering is unavailable', 'UNAVAILABLE');
  // Reuse the actual renderer after the public schema/authority check, with a
  // read-only attachment reader: preflight must not import durable resources.
  await renderReport(host, envelope, signal, (host, path, signal) => readWorkspaceBytes(host, path, signal, 32 * 1024 * 1024));
  await describe();
  signal?.throwIfAborted();
  const key = hash([host.context.sessionId, args.operation_id]), fingerprint = hash([draft, provider]);
  const resource = await host.resources.create({ kind: 'file', name: `report-input-${key}-${fingerprint}.json`, lifetime: 'durable',
    source: { content: JSON.stringify(draft.input), encoding: 'utf8' } }, { operationId: `report-prepare:${key}:input`, signal });
  const provenance = { kind: draft.provenanceKind, references: dependencies };
  const published = await host.resources.publish(resource, { kind: 'resource', schemaVersion: '1.0.0',
    content: { type: 'report-input', path: 'input.json', provider, provenance }, dependencies,
    blobs: [{ path: 'input.json', mediaType: 'application/json' }] }, { operationId: `report-prepare:${key}:publish`, signal });
  const { input: _input, ...publication } = draft;
  return { provider, publication: { ...publication, inputRef: { ref: published.ref, entry: 'input.json' } } };
}
