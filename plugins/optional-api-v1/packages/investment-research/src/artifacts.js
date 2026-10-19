import { digest } from '@sesame/plugin-sdk/protocol';
import { check } from './composition.js';

export const PACKET_TYPE = 'sesame.investment-research.result';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const dataRef = ref => object(ref) && ref.kind === 'data' && ref.schemaVersion === '1.0.0' && typeof ref.id === 'string' && typeof ref.revision === 'string' && /^sha256:[a-f0-9]{64}$/.test(ref.digest);
export const uniqueRefs = refs => [...new Map(refs.map(ref => [`${ref.id}:${ref.revision}:${ref.digest}`, structuredClone(ref)])).values()];
export async function verifyRefs(host, refs) {
  for (const ref of refs) {
    check(dataRef(ref), 'INVALID_RESEARCH_EVIDENCE', 'Research evidence requires a complete fixed data ArtifactRef.');
    const manifest = await host.resources.read(ref, { part: 'manifest' });
    check(manifest.kind === 'data', 'INVALID_RESEARCH_EVIDENCE', `Evidence ${ref.id} is not a data artifact.`);
  }
}
export async function readRows(host, ref) {
  check(dataRef(ref), 'INVALID_RESEARCH_RESULT', 'Use the complete data ArtifactRef returned as result_ref.');
  const manifest = await host.resources.read(ref, { part: 'manifest' });
  check(manifest.kind === 'data' && manifest.content?.format === 'json-rows' && typeof manifest.content.path === 'string', 'INVALID_RESEARCH_RESULT', 'Research result must be a json-rows data artifact.');
  const chunks = []; let offset = 0;
  do {
    const page = await host.resources.read(ref, { part: 'content', entry: manifest.content.path, encoding: 'base64', offset, length: 256 * 1024 });
    chunks.push(Buffer.from(page.content, 'base64'));
    check(page.nextOffset === undefined || page.nextOffset > offset, 'INVALID_RESOURCE_PAGE', 'Research artifact pagination did not advance.');
    offset = page.nextOffset;
  } while (offset !== undefined);
  const rows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  check(Array.isArray(rows) && rows.length === manifest.content.rowCount, 'INVALID_RESEARCH_RESULT', 'Research row count does not match its frozen manifest.');
  return rows;
}
export async function readPacket(host, ref) {
  const rows = await readRows(host, ref), packet = rows[0];
  check(rows.length === 1 && packet?.type === PACKET_TYPE && packet.schemaVersion === '1.0.0' && packet.status === 'complete'
    && typeof packet.title === 'string' && typeof packet.question === 'string' && Array.isArray(packet.subjects)
    && Array.isArray(packet.members) && packet.members.every(member => typeof member.role === 'string' && typeof member.markdown === 'string' && typeof member.run_ref?.id === 'string')
    && typeof packet.summary === 'string' && Array.isArray(packet.source_refs) && packet.source_refs.every(dataRef),
  'INVALID_RESEARCH_RESULT', 'Expected one complete sesame.investment-research.result row with original member Markdown, RunRefs, summary and fixed source_refs.');
  return packet;
}
export async function publishPacket(host, packet, operationId, refs = packet.source_refs ?? []) {
  const dependencies = uniqueRefs(refs), json = JSON.stringify([packet]), hash = digest(json);
  let kind = 'derived';
  for (const ref of dependencies) {
    const manifest = await host.resources.read(ref, { part: 'manifest' });
    if ((manifest.provenance ?? manifest.content.provenance)?.kind === 'demo') kind = 'demo';
  }
  const root = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: `research-${digest({ operationId, hash }).slice(7)}` }, { operationId: `${operationId}:${hash}:root` });
  await host.resources.create({ kind: 'file', lifetime: 'durable', parent: root, name: 'rows.json', source: { content: json }, policy: { readOnly: true } }, { operationId: `${operationId}:${hash}:rows` });
  // Pin the actual Agent records as their own source. Even knowledge-only research
  // has an observed execution record; its prose is not an unreferenced market fact.
  const { ref: record } = await host.resources.publish(root, { kind: 'resource', schemaVersion: '1.0.0', content: {
    type: 'investment-research-run-record', path: 'rows.json', sourceKind: 'agent-run-output',
    provenance: { kind, references: dependencies },
  }, dependencies, blobs: [{ entry: 'rows.json', path: 'rows.json', mediaType: 'application/json' }] }, { operationId: `${operationId}:${hash}:record` });
  const pinned = [record, ...dependencies], provenance = { kind, references: pinned };
  const { ref } = await host.resources.publish(root, { kind: 'data', schemaVersion: '1.0.0', content: {
    format: 'json-rows', path: 'rows.json', rowCount: 1, columns: Object.keys(packet), provenance,
  }, dependencies: pinned, provenance, blobs: [{ entry: 'rows.json', path: 'rows.json', mediaType: 'application/json' }] }, { operationId: `${operationId}:${hash}:publish` });
  return ref;
}
// The host records exact published/returned data identities in the owning
// Agent's resource history, independent of the wording of its final answer.
export async function recordedRefs(host, runRef) {
  const refs = []; let cursor;
  do {
    const { history } = await host.runs.read(runRef, { include: ['resources'], limit: 200, ...(cursor ? { cursor } : {}) });
    for (const item of history.items) if (item.data?.ref?.kind === 'data') refs.push(item.data.ref);
    check(!history.nextCursor || history.nextCursor !== cursor, 'INVALID_RUN_HISTORY', 'Research resource history pagination did not advance.');
    cursor = history.nextCursor;
  } while (cursor);
  const unique = uniqueRefs(refs); await verifyRefs(host, unique); return unique;
}
export async function checkedReport(host, managerRef, workflowRef) {
  const { run: manager } = await host.runs.read(managerRef), { run: workflow } = await host.runs.read(workflowRef);
  check(manager.parentRunId === workflow.id && manager.task?.output?.target === 'parent' && workflow.task?.output?.type === 'report',
    'REPORT_BINDING_MISMATCH', 'The report author must be this workflow\'s direct manager with parent report output.');
  const report = workflow.report, ref = report?.ref;
  check(ref?.kind === 'report', 'REPORT_UNAVAILABLE', 'Publish the manager summary into this workflow\'s existing report binding, then resume this same Run.');
  check(!manager.report || manager.report.id === report.id, 'REPORT_BINDING_MISMATCH', 'The manager and workflow must retain one report binding.');
  // The completed manager retains its original revision. A repair updates the
  // still-interrupted parent; observe that exact current revision on resume.
  const receipts = await host.resources.read(ref, { part: 'receipts' });
  const latest = receipts.items.filter(item => item.renderer?.name === 'sesame-report-inspector' && digest(item.artifact) === digest(ref))
    .sort((a, b) => b.observedAt - a.observedAt)[0];
  check(latest?.status === 'rendered', 'REPORT_NOT_RENDERED', 'The exact manager report revision needs a successful report_check rendering receipt.');
  return ref;
}
