// Deterministic source; copied into independent workflow archives.
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { check } from './workflow-mechanics.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
export const artifactRef = (ref, kind) => object(ref) && Object.keys(ref).length === 5 && ['id', 'revision', 'digest', 'kind', 'schemaVersion'].every(key => Object.hasOwn(ref, key))
  && text(ref.id) && text(ref.revision) && text(ref.kind) && (!kind || ref.kind === kind) && ref.schemaVersion === '1.0.0' && /^sha256:[a-f0-9]{64}$/.test(ref.digest);
export const dataRef = ref => artifactRef(ref, 'data');
export const uniqueRefs = refs => [...new Map(refs.map(ref => [canonical(ref), structuredClone(ref)])).values()];
export async function checkedArtifact(host, ref, kind = 'data') {
  check(artifactRef(ref, kind), 'INVALID_RESEARCH_RESULT', 'Use a complete fixed ArtifactRef with its exact kind, revision, digest and schemaVersion.');
  const manifest = await host.resources.read(ref, { part: 'manifest' });
  const metadata = await host.resources.read(ref, { part: 'metadata' });
  check(manifest.kind === ref.kind && manifest.schemaVersion === ref.schemaVersion && artifactRef(metadata?.ref, kind) && canonical(metadata.ref) === canonical(ref), 'INVALID_RESEARCH_RESULT', 'Artifact metadata and manifest must match the exact selected reference.');
  check(typeof metadata.producer?.id === 'string' && metadata.producer.id, 'INVALID_RESEARCH_RESULT', 'Research artifact requires its recorded producer identity.');
  return { manifest, metadata };
}
export async function verifyRefs(host, refs) {
  for (const ref of uniqueRefs(refs)) {
    check(dataRef(ref), 'INVALID_RESEARCH_EVIDENCE', 'Research evidence requires a complete fixed data ArtifactRef.');
    await checkedArtifact(host, ref);
  }
}
export async function readRows(host, ref, { signal, manifest: supplied, maxBytes = 32 * 1024 * 1024 } = {}) {
  check(dataRef(ref), 'INVALID_RESEARCH_RESULT', 'Use the complete data ArtifactRef returned as result_ref.');
  const manifest = supplied ?? (await checkedArtifact(host, ref)).manifest;
  check(manifest.kind === 'data' && manifest.schemaVersion === ref.schemaVersion && manifest.content?.format === 'json-rows' && typeof manifest.content.path === 'string'
    && Number.isSafeInteger(manifest.content.rowCount) && manifest.content.rowCount >= 0 && Array.isArray(manifest.blobs)
    && manifest.blobs.some(blob => blob.path === manifest.content.path && blob.mediaType?.split(';')[0] === 'application/json'), 'INVALID_RESEARCH_RESULT', 'Research result must declare its frozen json-rows entry and row count.');
  const chunks = []; let offset = 0, bytes = 0;
  for (;;) {
    signal?.throwIfAborted();
    const page = await host.resources.read(ref, { part: 'content', entry: manifest.content.path, encoding: 'base64', offset, length: 256 * 1024 });
    const chunk = Buffer.from(page.content, 'base64'); bytes += chunk.length;
    check(bytes <= maxBytes && (page.total === undefined || page.total <= maxBytes), 'RESEARCH_RESULT_TOO_LARGE', 'Research result exceeds the 32 MiB read budget; its fixed reference is retained.');
    chunks.push(chunk);
    if (page.nextOffset === undefined) break;
    check(Number.isSafeInteger(page.nextOffset) && page.nextOffset === offset + chunk.length && chunk.length > 0, 'INVALID_RESOURCE_PAGE', 'Research artifact pagination did not advance contiguously.');
    offset = page.nextOffset;
  }
  let rows;
  try { rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { check(false, 'INVALID_RESEARCH_RESULT', 'Research artifact must contain valid UTF-8 JSON.'); }
  check(Array.isArray(rows) && rows.length === manifest.content.rowCount && rows.every(object), 'INVALID_RESEARCH_RESULT', 'Research rows do not match their frozen manifest.');
  return rows;
}
export async function checkedReportReceipt(host, ref) {
  check(artifactRef(ref, 'report'), 'REPORT_UNAVAILABLE', 'A complete fixed report ArtifactRef is required.');
  const { manifest } = await checkedArtifact(host, ref, 'report');
  check(manifest.content?.runtime === 'sesame-report/1' && manifest.content.runtimeRevision === '1.0.0', 'REPORT_BINDING_MISMATCH', 'Expected the published Sesame report runtime.');
  const receipts = await host.resources.read(ref, { part: 'receipts' });
  // Ties prefer the later stored receipt. An older success cannot hide a later failure.
  const latest = receipts.items.filter(item => item.renderer?.name === 'sesame-report-inspector' && item.artifact && digest(item.artifact) === digest(ref))
    .map((receipt, index) => ({ receipt, index })).sort((a, b) => (Number(b.receipt.observedAt) || Date.parse(b.receipt.observedAt) || 0) - (Number(a.receipt.observedAt) || Date.parse(a.receipt.observedAt) || 0) || b.index - a.index)[0]?.receipt;
  check(latest?.status === 'rendered', 'REPORT_NOT_RENDERED', 'The exact published report revision needs a successful report_check rendering receipt.');
  return latest;
}
