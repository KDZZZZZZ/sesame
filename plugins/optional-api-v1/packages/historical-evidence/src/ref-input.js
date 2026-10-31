// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { check, clone, dataRef, digest, keys, object } from './common.js';
import { matchHistorical } from './match.js';
import { calibrateHistorical } from './calibrate.js';
import { publishHistoricalResult } from './result-publication.js';

const MAX_BYTES = 8 * 1024 * 1024, PAGE_BYTES = 256 * 1024;
const hashBytes = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
// Artifact manifests are serialized with lexical keys. JSON.stringify on a
// rebuilt object would reorder integer-like keys and is not the same contract.
export function artifactCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(artifactCanonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${artifactCanonical(value[key])}`).join(',')}}`;
  check(value === null || typeof value === 'boolean' || typeof value === 'string' || Number.isFinite(value), 'Artifact manifest must contain JSON values.');
  return JSON.stringify(value);
}

/** General Research reader. Deliberately NOT an input-only research capability. */
export async function fromFixedRef(host, input, signal) {
  keys(input, ['operation', 'input_ref', 'operation_id'], 'reference request');
  check(input.operation_id === undefined || typeof input.operation_id === 'string' && input.operation_id.trim().length > 0 && input.operation_id.length <= 200, 'operation_id must be nonempty text up to 200 characters.');
  check(['match', 'calibrate'].includes(input.operation) && dataRef(input.input_ref), 'Use match/calibrate and one complete fixed DataRef containing a one-row input envelope.');
  const ref = input.input_ref;
  signal?.throwIfAborted();
  const manifest = await host.resources.read(ref, { part: 'manifest' });
  check(object(manifest) && hashBytes(artifactCanonical(manifest)) === ref.digest, 'Fixed input manifest digest differs.');
  const metadata = await host.resources.read(ref, { part: 'metadata' });
  check(dataRef(metadata?.ref) && digest(metadata.ref) === digest(ref) && manifest.kind === 'data' && manifest.schemaVersion === ref.schemaVersion && typeof metadata.producer?.id === 'string', 'Input manifest/metadata must match the exact source revision and recorded producer.');
  const entries = Array.isArray(manifest.blobs) ? manifest.blobs.filter(blob => blob.path === manifest.content?.path) : [];
  check(manifest.content?.format === 'json-rows' && manifest.content.rowCount === 1 && typeof manifest.content.path === 'string' && manifest.content.path.length > 0
    && entries.length === 1 && entries[0].mediaType?.split(';')[0] === 'application/json', 'The fixed input must have one unambiguous JSON content entry containing one object row.');
  check(['observed', 'derived', 'user_input', 'demo'].includes(manifest.content.provenance?.kind) && Array.isArray(manifest.dependencies), 'The fixed input requires recorded provenance and dependencies.');
  const blob = entries[0];
  check(Number.isSafeInteger(blob.size) && blob.size > 0 && blob.size <= MAX_BYTES && /^sha256:[a-f0-9]{64}$/.test(blob.digest), 'The fixed input requires its content digest and size within the 8 MiB budget.');
  const chunks = []; let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    const page = await host.resources.read(ref, { part: 'content', entry: manifest.content.path, encoding: 'base64', offset, length: PAGE_BYTES });
    check(dataRef(page?.ref) && digest(page.ref) === digest(ref), 'Fixed input content page returned a different source identity.');
    check(page.encoding === 'base64' && typeof page.content === 'string', 'Fixed input content must use base64 encoding.');
    const chunk = Buffer.from(page.content, 'base64');
    check(chunk.toString('base64') === page.content, 'Fixed input content has invalid base64 bytes.');
    check(page.offset === offset && page.length === chunk.length && page.total === blob.size && chunk.length <= PAGE_BYTES && offset + chunk.length <= blob.size, 'Fixed input content byte range or total differs.');
    chunks.push(chunk); offset += chunk.length;
    if (page.nextOffset === undefined) { check(offset === blob.size, 'Fixed input content is incomplete.'); break; }
    check(chunk.length > 0 && page.nextOffset === offset && offset < blob.size, 'Resource pages must advance contiguously.');
  }
  signal?.throwIfAborted();
  const bytes = Buffer.concat(chunks);
  check(hashBytes(bytes) === blob.digest, 'Fixed input content digest differs.');
  let rows;
  try { rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { check(false, 'Input must be valid UTF-8 JSON.'); }
  check(Array.isArray(rows) && rows.length === 1, 'Input rows must match the one-row manifest.');
  const dependencies = new Set((manifest.dependencies ?? []).map(digest));
  const claimed = [rows[0].plan?.ref, ...(rows[0].source_refs ?? []), ...(rows[0].replay ? [rows[0].replay.code_ref, ...(rows[0].replay.data_refs ?? [])] : []), ...(rows[0].records ?? []).flatMap(row => [row.prediction_ref, ...(row.replay ? [row.replay.code_ref, ...(row.replay.data_refs ?? [])] : [])]), ...(rows[0].cases ?? []).flatMap(row => row.source_refs ?? [])];
  check(claimed.every(source => dataRef(source) && dependencies.has(digest(source))), 'The frozen input envelope must declare plan, source, prediction and any replay code/data refs as artifact dependencies.');
  const result = input.operation === 'match' ? matchHistorical(rows[0], signal) : calibrateHistorical(rows[0], signal);
  const complete = { ...result, data_access: 'reads one exact fixed input DataRef; general research, not holdout-isolated input-only',
    input_ref: clone(ref), input_producer: metadata.producer.id, source_provenance: clone(manifest.content.provenance ?? {}),
    input_integrity: { manifest_digest_verified: true, content_digest_verified: true, content_bytes: bytes.length, pages: chunks.length },
    source_refs: [...new Map([ref, ...result.source_refs].map(item => [digest(item), item])).values()] };
  return publishHistoricalResult(host, input, complete, manifest, signal);
}
