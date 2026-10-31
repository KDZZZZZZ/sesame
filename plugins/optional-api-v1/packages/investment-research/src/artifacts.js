import { digest } from '@sesame/plugin-sdk/protocol';
import { check } from './composition.js';
import { uniqueRefs, verifyRefs, checkedReportReceipt } from './research-artifacts.js';
import { PACKET_TYPE, validatePacket } from './investment-research-contract.js';
export { PACKET_TYPE, readPacket } from './investment-research-contract.js';
export { dataRef, uniqueRefs, verifyRefs, readRows } from './research-artifacts.js';

export async function publishPacket(host, packet, operationId, refs = packet.source_refs ?? []) {
  check(packet?.type === PACKET_TYPE && packet.schemaVersion === '1.0.0' && ['complete', 'in-progress'].includes(packet.status), 'INVALID_RESEARCH_RESULT', 'Publish the actual investment-research packet protocol, not arbitrary data.');
  if (packet.status === 'complete') validatePacket(packet);
  const dependencies = uniqueRefs([...refs, ...(packet.report_ref ? [packet.report_ref] : [])]), json = JSON.stringify([packet]), hash = digest(json);
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
  check(manager.id === managerRef.id && workflow.id === workflowRef.id && manager.status === 'completed'
    && manager.parentRunId === workflow.id && manager.task?.output?.type === 'report' && manager.task.output.target === 'parent' && workflow.task?.output?.type === 'report',
    'REPORT_BINDING_MISMATCH', 'The report author must be this workflow\'s direct manager with parent report output.');
  const report = workflow.report, ref = report?.ref;
  check(ref?.kind === 'report', 'REPORT_UNAVAILABLE', 'Publish the manager summary into this workflow\'s existing report binding, then resume this same Run.');
  check(!manager.report || manager.report.id === report.id, 'REPORT_BINDING_MISMATCH', 'The manager and workflow must retain one report binding.');
  // The completed manager retains its original revision. A repair updates the
  // still-interrupted parent; observe that exact current revision on resume.
  await checkedReportReceipt(host, ref);
  return ref;
}
