import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const fail = message => { throw Object.assign(new Error(message), { code: 'CHECKPOINT_TEXT_REPAIR_DENIED' }); };
export const checkpointDigest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byteDigest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

// Only loss from decoding a split UTF-8 character is repairable here. Changed
// wording, ASCII values, prices, quantities and any other field are rejected.
export function isUtf8Replacement(original, damaged) {
  if (typeof original !== 'string' || typeof damaged !== 'string' || original.includes('\ufffd') || !damaged.includes('\ufffd')) return false;
  let positions = new Set([0]);
  for (const char of original) {
    const next = new Set();
    for (const at of positions) {
      if (damaged.startsWith(char, at)) next.add(at + char.length);
      const bytes = Buffer.byteLength(char);
      if (bytes > 1) for (let count = 1; count <= bytes && damaged[at + count - 1] === '\ufffd'; count++) next.add(at + count);
    }
    positions = next;
    if (!positions.size) return false;
  }
  return positions.has(damaged.length);
}

async function originalRoleProof(root, evidence) {
  if (!/^[A-Za-z0-9_-]+$/.test(evidence?.actorRunId ?? '')) fail('Missing sealed role identity');
  const directory = resolve(root, 'runs', evidence.actorRunId);
  const manifestBytes = await readFile(resolve(directory, 'sealed.json'));
  const manifestDigest = byteDigest(manifestBytes);
  if ((await readFile(resolve(directory, 'sealed.digest'), 'utf8')).trim() !== manifestDigest) fail('Sealed role manifest digest differs');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.runId !== evidence.actorRunId) fail('Sealed role identity differs');
  const d = evidence.decision;
  const args = { run_id: d.runId, step_id: d.stepId, expected_version: d.expectedVersion, target: d.target, stop: d.stop, reason: d.reason, utterance: d.utterance };
  for (const file of manifest.files ?? []) {
    if (!file.path?.startsWith('sessions/') || !file.path.endsWith('.jsonl')) continue;
    const path = resolve(root, file.archive);
    if (!path.startsWith(directory + sep) || (await lstat(path)).isSymbolicLink()) fail('Session archive path escapes sealed role');
    const bytes = await readFile(path);
    if (bytes.length !== file.bytes || byteDigest(bytes) !== file.digest) fail('Original role session digest differs');
    for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
      const entry = JSON.parse(line), message = entry.message;
      if (message?.role !== 'assistant') continue;
      if (message.content?.some(item => item.type === 'toolCall' && item.name === 'kurumi_decide' && isDeepStrictEqual(item.arguments, args)))
        return { actorRunId: evidence.actorRunId, manifestDigest, sessionPath: file.archive, sessionDigest: file.digest, decisionId: d.id };
    }
  }
  fail('Original complete role session does not confirm the exact submitted decision');
}

export async function checkpointTextRepair(document, recordingRoot) {
  const before = document.engine, after = structuredClone(before), changes = [], proofs = [];
  if (!Array.isArray(before.nativeJournal) || before.nativeJournal.length !== before.decisions?.length) fail('Decision/journal sequence differs');
  for (let i = 0; i < before.nativeJournal.length; i++) {
    const journalDecision = before.nativeJournal[i].decision, committed = before.decisions[i].decision;
    if (isDeepStrictEqual(journalDecision, committed)) continue;
    const evidence = document.roleEvidence?.find(item => item.decision?.id === committed?.id);
    if (!evidence || !isDeepStrictEqual(evidence.decision, committed)) fail('Committed decision lacks identical original role evidence');
    const withoutText = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['reason', 'utterance'].includes(key)));
    if (!isDeepStrictEqual(withoutText(journalDecision), withoutText(committed))) fail('Non-text decision fields differ; financial repair is forbidden');
    const proof = await originalRoleProof(recordingRoot, evidence);
    for (const field of ['reason', 'utterance']) {
      if (journalDecision[field] === committed[field]) continue;
      if (!isUtf8Replacement(committed[field], journalDecision[field])) fail('Difference is not a provable UTF-8 replacement');
      changes.push({ path: `nativeJournal[${i}].decision.${field}`, index: i, field, before: journalDecision[field], after: committed[field], decisionId: committed.id });
      after.nativeJournal[i].decision[field] = committed[field];
    }
    proofs.push(proof);
  }
  if (!changes.length) fail('No provable checkpoint text corruption found');
  return { before, after, changes, proofs, beforeDigest: checkpointDigest(before), afterDigest: checkpointDigest(after) };
}
