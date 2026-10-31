import { canonical } from '@sesame/plugin-sdk/protocol';
import { check } from './shared.js';
import { checkedArtifact, dataRef } from './research-artifacts.js';
import { PACKET_TYPE, readPacket } from './investment-research-contract.js';

export async function validateResearchRefs(host, refs, signal) {
  check(Array.isArray(refs) && refs.length <= 30 && refs.every(dataRef), 'INVALID_RESEARCH_RESULT', 'Research inputs require complete fixed data ArtifactRefs.');
  const identities = new Map(), selections = [];
  for (const ref of refs) {
    signal?.throwIfAborted();
    check(!identities.has(ref.id) || identities.get(ref.id) === canonical(ref), 'INVALID_RESEARCH_RESULT', 'One research artifact ID cannot select two revisions.');
    identities.set(ref.id, canonical(ref));
    const { manifest, metadata } = await checkedArtifact(host, ref);
    check(manifest.content?.format === 'json-rows' && typeof manifest.content.path === 'string' && Number.isSafeInteger(manifest.content.rowCount) && manifest.content.rowCount > 0
      && manifest.blobs?.some(blob => blob.path === manifest.content.path && blob.mediaType?.split(';')[0] === 'application/json'), 'INVALID_RESEARCH_RESULT', 'Selected research must be an actual published json-rows artifact.');
    const producer = await host.plugins.read(metadata.producer.id, { part: 'manifest' });
    check(producer?.id === metadata.producer.id && producer.artifactSchemas?.some(schema => schema.kind === ref.kind && schema.schemaVersion === ref.schemaVersion), 'INVALID_RESEARCH_RESULT', 'Research must retain a declared data-artifact producer, not an arbitrary resource or untyped text.');
    let protocol = manifest.content.protocol ?? manifest.content.type ?? 'json-rows/1';
    if (metadata.producer.id === 'sesame/investment-research') {
      await readPacket(host, ref, { signal }); protocol = PACKET_TYPE;
    } else {
      check(protocol !== PACKET_TYPE, 'INVALID_RESEARCH_RESULT', 'Another producer cannot impersonate the investment-research result protocol.');
      // Publication validates the producer's declared artifact schema. Generic
      // research producers need not adopt IR's member/plan schema or have their
      // large content copied into the private trading ledger.
    }
    selections.push({ ref: structuredClone(ref), producer: structuredClone(metadata.producer), protocol });
  }
  return selections;
}

export function validateSnapshot(snapshot, account) {
  check(snapshot && typeof snapshot === 'object' && snapshot.account, 'SOURCE_DATA_INVALID', 'Execution snapshot requires a real account identity.');
  check(canonical(snapshot.account) === canonical(account), 'ACCOUNT_CHANGED', 'Selected execution account differs from the frozen plan.');
  for (const key of ['positions', 'orders', 'fills', 'historicalOrders', 'deployments']) check(Array.isArray(snapshot[key]), 'SOURCE_DATA_INVALID', `Execution snapshot must include ${key}; unavailable history must retain an explicit coverage status.`);
  check(Buffer.byteLength(JSON.stringify(snapshot)) <= 1024 * 1024, 'SOURCE_DATA_INVALID', 'Account snapshot exceeds 1 MiB.');
  const coverage = snapshot.historyCoverage;
  check(coverage === undefined || coverage && typeof coverage === 'object' && !Array.isArray(coverage), 'SOURCE_DATA_INVALID', 'History coverage must be an explicit object.');
  check(coverage?.complete !== true || !['orders', 'fills', 'historicalOrders'].some(key => ['unavailable', 'unknown', 'unsupported', 'partial'].includes(coverage[key]?.status)), 'SOURCE_DATA_INVALID', 'Unavailable or partial history cannot claim complete coverage.');
  return snapshot;
}
export const historyCoverage = snapshot => snapshot.historyCoverage ?? { complete: false, status: 'unknown', reason: 'coverage_not_declared' };
export function requireExecutionEvidence(snapshot, decision) {
  const trades = (decision.targets ?? []).length > 0, pauses = (decision.pause_strategies ?? []).length > 0;
  if (!trades && !pauses) return; // No blanket rejection of read-only/unchanged outcomes.
  check(snapshot, 'EXECUTION_EVIDENCE_UNAVAILABLE', 'A retained account snapshot is required before any write.');
  const required = [...(trades ? ['positions', 'orders', 'fills', 'historicalOrders'] : []), ...(pauses ? ['deployments'] : [])];
  const coverage = historyCoverage(snapshot);
  for (const field of required) {
    const status = coverage[field]?.status;
    check(Array.isArray(snapshot[field]) && !['unavailable', 'unknown', 'unsupported', 'failed'].includes(status), 'EXECUTION_EVIDENCE_UNAVAILABLE', `Required ${field} evidence is unavailable: ${coverage[field]?.reason ?? status ?? 'missing snapshot field'}. Retain the decision and reconcile the original evidence; do not execute.`);
  }
  // complete:false can honestly describe a bounded native range, not a failed
  // observation. It must not be upgraded to complete or rejected as all history.
  check(coverage.status !== 'unknown' && coverage.status !== 'unavailable', 'EXECUTION_EVIDENCE_UNAVAILABLE', 'Required history coverage is unknown or unavailable; no execution is sent.');
}
