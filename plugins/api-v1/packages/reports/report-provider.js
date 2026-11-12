import { readFileSync } from 'node:fs';
import { renderStructuredReport } from './report-content.js';
import { readBytes, readWorkspace } from './artifact-io.js';
import { assertCompositionBindings } from './report-compose.js';

const { id, version } = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const refKey = ref => JSON.stringify(['id', 'revision', 'digest', 'kind', 'schemaVersion'].map(key => ref?.[key]));
const uniqueRefs = refs => [...new Map(refs.map(ref => [refKey(ref), ref])).values()];
const safePath = path => typeof path === 'string' && path.length <= 256 && !/^[\/]|[\\:\x00-\x1f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
const inputKeys = ['content', 'style', 'assets', 'strategy_source', 'strategy_evidence'];
const attachmentExtensions = { 'application/json': ['json'], 'text/plain': ['txt', 'csv', 'tsv', 'md', 'log'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/webp': ['webp'] };

function validateAssets(assets, refs) {
  const paths = new Set(['index.html', 'sesame-report-input.json']);
  for (const [index, asset] of assets.entries()) {
    const path = `/input/assets/${index}`;
    check(object(asset) && Object.keys(asset).every(key => ['path', 'media_type', 'source_path', 'ref', 'entry'].includes(key)), `${path}: Unsupported attachment property`);
    check(safePath(asset.path) && !paths.has(asset.path.toLowerCase()), `${path}/path: Asset paths must be unique, safe and relative`);
    paths.add(asset.path.toLowerCase());
    const media = String(asset.media_type).split(';')[0].toLowerCase(), suffix = asset.path.split('.').at(-1).toLowerCase();
    check(attachmentExtensions[media], `${path}/media_type: Attachment extension and media type must match inert data, text or raster image formats; allowed MIME types: ${Object.keys(attachmentExtensions).join(', ')}. Executable scripts are not packaged attachments`);
    check(attachmentExtensions[media].includes(suffix), `${path}/path: Attachment extension and media type must match; allowed extensions for this media_type: ${attachmentExtensions[media].join(', ')}. Changing media_type alone does not change the packaged path extension`);
    check(Boolean(asset.source_path) !== Boolean(asset.ref), `${path}: Choose a workspace attachment or one fixed attachment reference`);
    if (asset.ref) {
      check(safePath(asset.entry), `${path}/entry: Fixed attachment must name a safe entry`);
      check(refs.some(ref => refKey(ref) === refKey(asset.ref)), `${path}/ref: Fixed attachment must be declared in report references`);
    } else check(asset.entry === undefined, `${path}/entry: Workspace attachments do not accept an entry`);
  }
}

function assertPackaged(text) {
  // The host independently enforces package integrity, CSP and read-only refs.
  check(!/<(?:base|iframe|object|embed|form)\b/i.test(text), 'Embedded frames, forms and base URLs are unsupported');
  check(!/<(?:script|img|source|video|audio)\b[^>]*\bsrc\s*=\s*["']?(?:https?:|\/\/)/i.test(text), 'Package remote resources before publishing');
  check(!/<link\b[^>]*\bhref\s*=\s*["']?(?:https?:|\/\/)/i.test(text), 'Package styles and fonts before publishing');
  check(!/(?:@import\s*|url\(\s*)["']?(?:https?:|\/\/)/i.test(text), 'CSS resources must be packaged');
}

// This function returns a package only. Provider selection, idempotency, artifact
// creation and immutable publication belong exclusively to host.reports.publish.
export async function renderReport(host, envelope, signal, readWorkspaceAttachment = readWorkspace) {
  const { metadata, data, related, references, input } = envelope;
  check(object(input) && Object.keys(input).every(key => inputKeys.includes(key)), 'Unsupported Report input; HTML, CSS and script uploads are disabled');
  check(object(input.content), 'Report content is required');
  const refs = uniqueRefs([...data.map(binding => binding.ref), ...related.flatMap(item => item.artifact ? [item.artifact] : []), ...references]);
  if (input.strategy_source) check(refs.some(ref => refKey(ref) === refKey(input.strategy_source)), 'Strategy source must be declared in report references');
  validateAssets(input.assets ?? [], refs);
  const args = { ...input, ...metadata, provenance_kind: metadata.provenanceKind, data, related, references };
  let html = await renderStructuredReport(host, args, signal);
  assertPackaged(html);
  assertCompositionBindings(html, data, refs, metadata.provenanceKind);
  if (metadata.provenanceKind === 'demo') {
    const badge = '<aside data-sesame-provenance="demo" role="note" style="display:block!important;visibility:visible!important;opacity:1!important;padding:8px 0;font:600 12px/1.5 system-ui;color:var(--report-muted,#626262)">DEMO · 演示数据</aside>';
    html = html.replace(/<body\b[^>]*>/i, value => value + badge);
  }
  let total = Buffer.byteLength(html);
  check(total > 0 && total <= 1024 * 1024, 'Rendered report exceeds 1 MiB');
  const files = [{ path: 'index.html', mediaType: 'text/html', content: html, encoding: 'utf8' }];
  for (const [index, asset] of (input.assets ?? []).entries()) {
    const path = `/input/assets/${index}`, media = String(asset.media_type).split(';')[0].toLowerCase();
    let bytes;
    if (asset.ref) {
      const manifest = await host.resources.read(asset.ref, { part: 'manifest' });
      const blob = manifest.blobs?.find(blob => blob.path === asset.entry);
      check(blob, `${path}/entry: Fixed attachment entry must exist in its manifest`);
      check(blob.mediaType.split(';')[0].toLowerCase() === media, `${path}/media_type: Fixed attachment media type must match its manifest`);
      bytes = await readBytes(host, asset.ref, asset.entry, signal);
    } else {
      try { bytes = await readWorkspaceAttachment(host, asset.source_path, signal); }
      catch (error) { error.message = `${path}/source_path: ${error.message}`; throw error; }
    }
    total += bytes.length;
    check(total <= 16 * 1024 * 1024, `${path}: Report assets exceed 16 MiB`);
    files.push({ path: asset.path, mediaType: asset.media_type, content: bytes.toString('base64'), encoding: 'base64' });
  }
  signal?.throwIfAborted();
  return { entry: 'index.html', files, presentation: { id, version, metadata: { layout: 'unified' } } };
}

// Optional agent convenience facade. It cannot select a provider or publish HTML.
export async function publishReport(host, args, signal) {
  const allowed = ['operation_id', 'title', 'summary', 'locale', 'space', 'provenance_kind', 'data', 'related', 'references', 'features', 'artifact_id', 'expected_revision', 'input_ref', ...inputKeys];
  check(object(args) && Object.keys(args).every(key => allowed.includes(key)), 'Unsupported publication property; custom HTML uploads and provider overrides are disabled');
  check(Boolean(args.input_ref) !== Boolean(args.content), 'Supply content or input_ref, never both');
  if (args.input_ref) check(inputKeys.every(key => !Object.hasOwn(args, key)), 'input_ref contains the complete provider input; do not supply additional content or style');
  const input = Object.fromEntries(inputKeys.filter(key => Object.hasOwn(args, key)).map(key => [key, args[key]]));
  // Explicit evidence refs remain fixed dependencies even through this facade.
  const references = uniqueRefs([...(args.references ?? []), ...(args.strategy_source ? [args.strategy_source] : []), ...(args.strategy_evidence?.references ?? [])]);
  const request = { operationId: args.operation_id, title: args.title, summary: args.summary, data: args.data,
    provenanceKind: args.provenance_kind, references, ...(args.input_ref ? { inputRef: args.input_ref } : { input }) };
  for (const [from, to] of [['locale', 'locale'], ['space', 'space'], ['related', 'related'], ['features', 'features'], ['artifact_id', 'artifactId'], ['expected_revision', 'expectedRevision']]) if (Object.hasOwn(args, from)) request[to] = args[from];
  const result = await host.capabilities.invoke('host.reports.publish', request, { signal });
  check(result.type === 'result', 'Host report publication must return an immediate result');
  return result.value;
}
