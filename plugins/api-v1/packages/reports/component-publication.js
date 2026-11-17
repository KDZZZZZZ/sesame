import { createHash } from 'node:crypto';
import { COMPONENT_PROTOCOL } from './component-catalog.js';
import { readComponentJson } from './component-input.js';
import { renderReport } from './report-provider.js';
import { resolveReportStyle } from './report-styles.js';

const JSON_PATH = 'component.json';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const RENDERER = 'sesame/reports#components_render';
const check = (condition, message) => { if (!condition) throw Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uniqueRefs = refs => [...new Map(refs.map(ref => [JSON.stringify([ref.id, ref.revision, ref.digest, ref.kind, ref.schemaVersion]), ref])).values()];

// Persist only component input and copied attachments. HTML is a temporary view,
// never a report, report file, or input to the report publication service.
export async function publishAnswerComponent(host, publication, envelope, rendered, signal) {
  const saved = structuredClone(envelope);
  if (saved.input.style?.saved_id) {
    const style = await resolveReportStyle(host, saved.input.style);
    saved.input.style = { custom: { reason: `Saved style ${saved.input.style.saved_id} version ${saved.input.style.saved_version}`, tokens: style.tokens } };
  }
  const dependencies = uniqueRefs([
    ...saved.data.map(item => item.ref), ...saved.related.flatMap(item => item.artifact ? [item.artifact] : []), ...saved.references,
    ...(publication.input_ref ? [publication.input_ref.ref] : []), ...(saved.input.assets ?? []).flatMap(item => item.ref ? [item.ref] : []),
  ]);
  check(dependencies.length <= 256, '/: Component dependencies exceed the 256-reference budget');
  const attachments = rendered.files.filter(file => file.path !== rendered.entry);
  check(attachments.every(file => file.path.toLowerCase() !== JSON_PATH), '/assets: component.json is reserved for component input');
  if (saved.input.assets) saved.input.assets = saved.input.assets.map(({ path, media_type }) => ({ path, media_type }));
  const json = JSON.stringify(saved);
  check(Buffer.byteLength(json) <= MAX_JSON_BYTES, '/: Component JSON exceeds 2 MiB');
  const files = [{ path: JSON_PATH, mediaType: 'application/json', content: json, encoding: 'utf8' }, ...attachments];
  check(files.length <= 256 && files.reduce((size, file) => size + Buffer.byteLength(file.content, file.encoding), 0) <= 32 * 1024 * 1024,
    '/: Component JSON and attachments exceed the resource budget');
  const key = hash([host.context.sessionId, publication.operation_id]), fingerprint = hash([saved, attachments]);
  const options = suffix => ({ operationId: `component-json:${key}:${suffix}`, signal });
  const root = await host.resources.create({ kind: 'directory', name: `component-${key}-${fingerprint}`, lifetime: 'durable' }, options('root'));
  const directories = new Map([['', root]]);
  for (const file of files) {
    const parts = file.path.split('/');
    let parentPath = '';
    for (const part of parts.slice(0, -1)) {
      const path = parentPath ? `${parentPath}/${part}` : part;
      if (!directories.has(path)) directories.set(path, await host.resources.create({ kind: 'directory', parent: directories.get(parentPath), name: part, lifetime: 'durable' }, options(`directory:${hash(path)}`)));
      parentPath = path;
    }
    await host.resources.create({ kind: 'file', parent: directories.get(parentPath), name: parts.at(-1), lifetime: 'durable',
      source: { content: file.content, encoding: file.encoding } }, options(`file:${hash(file.path)}`));
  }
  const result = await host.resources.publish(root, { kind: 'resource', schemaVersion: '1.0.0',
    content: { type: 'component-json', protocol: COMPONENT_PROTOCOL, path: JSON_PATH, title: saved.metadata.title, renderer: RENDERER },
    dependencies, blobs: files.map(file => ({ entry: file.path, path: file.path, mediaType: file.mediaType })) },
  { ...options('publish'), ...(publication.artifact_id ? { artifactId: publication.artifact_id, expectedRevision: publication.expected_revision ?? null } : {}) });
  check(result.ref?.kind === 'resource', '/: Component publication must return a fixed resource reference');
  return { ref: result.ref, title: saved.metadata.title, protocol: COMPONENT_PROTOCOL,
    componentRef: { ref: result.ref, protocol: COMPONENT_PROTOCOL, kind: 'document' } };
}

export async function renderAnswerComponent(host, ref, signal, prepare) {
  signal?.throwIfAborted();
  const manifest = await host.resources.read(ref, { part: 'manifest' });
  const content = manifest.content;
  const legacy = ref.kind === 'report' && content?.rendering?.presentation?.metadata?.surface === 'answer'
    && content.rendering.presentation.metadata.protocol === COMPONENT_PROTOCOL;
  check(legacy || ref.kind === 'resource' && content?.type === 'component-json' && content.protocol === COMPONENT_PROTOCOL
    && content.path === JSON_PATH && content.renderer === RENDERER, '/ref: Expected a fixed answer component');
  const entry = legacy ? content.rendering.inputEntry : JSON_PATH;
  check(typeof entry === 'string' && manifest.blobs?.some(blob => blob.path === entry && /^application\/json(?:;|$)/i.test(blob.mediaType)),
    '/ref: Component input must be a fixed application/json entry');
  const saved = await readComponentJson(host, ref, entry, signal, '/ref', MAX_JSON_BYTES);
  check(saved?.input?.target === 'answer' && saved.input.content?.kind === 'document', '/ref: Component input must target the answer surface');
  // Old answer-report input already contains the complete original envelope.
  // Its copied attachments are still read from that exact immutable artifact.
  const assets = (saved.input.assets ?? []).map(asset => {
    check(legacy || Object.keys(asset).every(key => ['path', 'media_type'].includes(key)), '/ref: Component attachments must use packaged bytes');
    return { path: asset.path, media_type: asset.media_type, ref, entry: asset.path };
  });
  const envelope = { ...saved, input: { ...saved.input, ...(saved.input.assets ? { assets } : {}) },
    references: uniqueRefs([...(saved.references ?? []), ...(assets.length ? [ref] : [])]) };
  await prepare(envelope, legacy);
  const rendered = await renderReport(host, envelope, signal, async () => { throw new Error('Component views cannot read workspace files'); });
  return { title: saved.metadata.title, locale: saved.metadata.locale, ...rendered };
}
