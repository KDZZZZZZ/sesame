import { COLLECTIONS, artifactRef, canonical, digest, ensure, identifier, keys, text, referenceIdentity, validateCandidate, validateProfile } from './contracts.js';
import { readState, commitState } from './journal.js';

export function createLibrary({ state, artifacts }) {
  const readTyped = async (ref, schema) => {
    artifactRef(ref); const manifest = await artifacts.verify(ref);
    ensure(ref.kind === 'resource' && manifest.content?.schema === schema, 'Evidence artifact has the wrong schema', 'EVIDENCE_MISMATCH');
    return artifacts.readJSON(ref);
  };
  const read = async id => { const result = await readState(state, COLLECTIONS.factors, id); ensure(result, 'Factor not found', 'NOT_FOUND'); return result.value; };
  const evaluation = async (factorId, evaluationId) => {
    text(factorId, 128); text(evaluationId, 128);
    const row = await readState(state, COLLECTIONS.evaluations, identifier('evaluation', [factorId, evaluationId]));
    ensure(row, 'Factor evaluation not found', 'NOT_FOUND'); return row.value.evaluation;
  };
  const evaluations = async (factorId, { cursor, limit = 50 } = {}) => {
    text(factorId, 128); ensure(Number.isSafeInteger(limit) && limit > 0 && limit <= 200, 'Invalid evaluation page limit');
    const page = await state.query({ collection: COLLECTIONS.evaluations, filter: { factorId }, ...(cursor ? { cursor } : {}), limit });
    ensure(!page.nextCursor || page.nextCursor !== cursor, 'Evaluation cursor did not advance', 'EVIDENCE_MISMATCH');
    return { items: page.items.map(row => row.value.evaluation), cursor: page.nextCursor ?? null };
  };
  const pool = async id => { const row = await readState(state, COLLECTIONS.pools, id); ensure(row, 'Strategy factor pool not found', 'NOT_FOUND'); return row.value; };
  const validateEvidence = async (evaluation, candidate) => {
    validateCandidate(candidate);
    const values = await readTyped(evaluation.valuesRef, 'factor-values/1');
    const snapshot = await readTyped(values.snapshotRef, 'factor-snapshot/1');
    ensure(Array.isArray(values.candidates), 'Values candidate identities are missing', 'EVIDENCE_MISMATCH');
    const computed = values.candidates.find(item => item.status === 'ok' && item.value.candidate.id === candidate.id);
    ensure(computed && canonical(computed.value.candidate.formula) === canonical(candidate.formula), 'Evaluation does not describe the computed formula', 'EVIDENCE_MISMATCH');
    const c = evaluation.context;
    keys(c, ['snapshotId', 'sourceDigest', 'layoutDigest', 'profileDigest', 'engineDigest', 'referenceDigest']);
    validateProfile(evaluation.profile, snapshot.layout);
    ensure(values.id === evaluation.valuesId && values.snapshotId === c.snapshotId && evaluation.partition === values.partition && snapshot.id === c.snapshotId && c.sourceDigest === snapshot.source.digest && c.layoutDigest === digest({ layout: snapshot.layout, calendarDigest: snapshot.calendarDigest }) && c.profileDigest === digest(evaluation.profile) && c.engineDigest === digest(values.engine), 'Evaluation evidence identity differs', 'EVIDENCE_MISMATCH');
    ensure(/^sha256:[a-f0-9]{64}$/.test(values.engine.operatorDigest), 'Missing operator identity', 'EVIDENCE_MISMATCH');
    const details = await readTyped(evaluation.details, 'factor-evidence/1');
    ensure(Array.isArray(details.referenceValues) && details.referenceValues.length <= 32, 'Missing immutable reference values', 'EVIDENCE_MISMATCH');
    const references = [];
    for (const ref of details.referenceValues) {
      const reference = await readTyped(ref, 'factor-values/1');
      ensure(reference.snapshotId === values.snapshotId && reference.partition === values.partition && canonical(reference.snapshotRef) === canonical(values.snapshotRef) && canonical(reference.engine) === canonical(values.engine), 'Reference values use different data, partition or engine', 'EVIDENCE_MISMATCH');
      references.push(reference);
    }
    ensure(c.referenceDigest === digest(referenceIdentity(references)), 'Reference evidence identity differs', 'EVIDENCE_MISMATCH');
    return { snapshot, values };
  };
  const record = async (candidates, measured, fence) => {
    fence.signal?.throwIfAborted();
    const factors = [];
    for (const evaluation of measured) {
      fence.signal?.throwIfAborted();
      const candidate = candidates.find(c => c.id === evaluation.candidateId); ensure(candidate, 'Evaluation candidate missing');
      const { values } = await validateEvidence(evaluation, candidate);
      const definitionDigest = digest({ dsl: candidate.formula.dsl, operatorDigest: values.engine.operatorDigest, tree: candidate.formula.tree }), factorId = identifier('factor', [candidate.formula.dsl, definitionDigest]);
      const evaluationKey = identifier('evaluation', [factorId, evaluation.id]);
      for (let retry = 0; retry < 12; retry++) {
        fence.signal?.throwIfAborted();
        const active = await readState(state, COLLECTIONS.jobs, fence.jobId);
        ensure(active && active.value.epoch === fence.epoch && ['running', 'pausing'].includes(active.value.status), 'Cancelled or stale research cannot commit factors', 'CANCELLED');
        const existing = await readState(state, COLLECTIONS.factors, factorId), prior = await readState(state, COLLECTIONS.evaluations, evaluationKey);
        if (prior) { ensure(canonical(prior.value.evaluation) === canonical(evaluation), 'Evaluation ID conflict', 'IDEMPOTENCY_CONFLICT'); ensure(existing, 'Evaluation points to a missing factor', 'EVIDENCE_MISMATCH'); factors.push(existing.value); break; }
        const factor = existing?.value ?? { id: factorId, formula: candidate.formula, definitionDigest, evaluationIds: [], annotations: [] };
        const next = { ...factor, evaluationIds: [...new Set([...factor.evaluationIds, evaluation.id])].slice(-32) };
        try {
          await commitState(state, [
            // CAS writes the fence in the same transaction: no read/write gap on cancellation.
            { op: 'put', key: active.key, expectedVersion: active.version, value: active.value },
            { op: 'put', key: { collection: COLLECTIONS.factors, key: factorId }, expectedVersion: existing?.version ?? 0, value: next },
            { op: 'put', key: { collection: COLLECTIONS.evaluations, key: evaluationKey }, expectedVersion: 0, value: { factorId, evaluation } },
          ], { signal: fence.signal });
          factors.push(next); break;
        } catch (e) { if (e.code !== 'VERSION_CONFLICT' || retry === 11) throw e; }
      }
    }
    return [...new Map(factors.map(f => [f.id, f])).values()];
  };
  const query = async (query = {}) => {
    keys(query, ['fields', 'kind', 'axis', 'universe', 'frequency', 'profileId', 'minCoverage', 'evidenceMatch', 'cursor', 'limit'], []);
    const limit = query.limit ?? 50; ensure(Number.isInteger(limit) && limit > 0 && limit <= 200, 'Invalid factor page limit');
    if (query.fields !== undefined) ensure(Array.isArray(query.fields) && query.fields.every(f => typeof f === 'string'), 'Fields must be a list');
    if (query.universe !== undefined) ensure(Array.isArray(query.universe) && query.universe.every(f => typeof f === 'string'), 'Universe must be a list');
    const found = []; let cursor = query.cursor, scanned = 0;
    // Scan bounded pages; cursor always points to the next unexamined factor.
    do {
      const page = await state.query({ collection: COLLECTIONS.factors, limit: 1, ...(cursor ? { cursor } : {}) });
      ensure(!page.nextCursor || page.nextCursor !== cursor, 'Factor cursor did not advance', 'EVIDENCE_MISMATCH');
      cursor = page.nextCursor;
      for (const row of page.items) {
        scanned++;
        const factor = row.value, fields = formulaFields(factor.formula.tree);
        if (query.fields && !fields.every(f => query.fields.includes(f))) continue;
        const needsEvidence = ['kind', 'axis', 'universe', 'frequency', 'profileId', 'minCoverage', 'evidenceMatch'].some(k => query[k] !== undefined);
        if (needsEvidence) {
          let matched = false;
          let evaluationCursor;
          do {
            const evidencePage = await evaluations(factor.id, { cursor: evaluationCursor, limit: 200 });
            for (const e of evidencePage.items) {
              if (e.eligibility !== 'supported' || query.kind && e.profile.kind !== query.kind || query.axis && e.profile.axis !== query.axis || query.profileId && e.profile.id !== query.profileId || query.minCoverage !== undefined && (e.coverage.value ?? -1) < query.minCoverage || query.evidenceMatch && canonical(e.context) !== canonical(query.evidenceMatch)) continue;
              if (query.frequency || query.universe) { const v = await artifacts.readJSON(e.valuesRef), s = await artifacts.readJSON(v.snapshotRef); if (query.frequency && s.layout.frequency !== query.frequency || query.universe && canonical([...s.layout.universe].sort()) !== canonical([...query.universe].sort())) continue; }
              matched = true; break;
            }
            evaluationCursor = evidencePage.cursor;
          } while (!matched && evaluationCursor);
          if (!matched) continue;
        }
        found.push(factor);
      }
      if (!page.items.length || found.length >= limit || scanned >= 200) break;
    } while (cursor);
    return { items: found, cursor: cursor ?? null };
  };
  const decide = async change => {
    keys(change, ['operationId', 'poolId', 'strategyId', 'expectedVersion', 'decision', 'factorIds', 'replaces', 'purpose', 'reason', 'strategyVersion', 'applicationEvidence']);
    ['operationId', 'poolId', 'strategyId', 'strategyVersion'].forEach(k => text(change[k], 128));
    ['purpose', 'reason'].forEach(k => text(change[k], 4000));
    ensure(['add', 'replace', 'remove'].includes(change.decision) && Number.isInteger(change.expectedVersion) && change.expectedVersion >= 0, 'Invalid pool decision');
    ensure(Array.isArray(change.factorIds) && change.factorIds.length <= 256 && Array.isArray(change.replaces) && change.replaces.length <= 256 && Array.isArray(change.applicationEvidence) && change.applicationEvidence.length <= 32, 'Pool decision exceeds bounds');
    ensure(change.factorIds.length > 0 && new Set(change.factorIds).size === change.factorIds.length && new Set(change.replaces).size === change.replaces.length, 'Pool factors must be nonempty and unique');
    [...change.factorIds, ...change.replaces].forEach(id => text(id, 128));
    ensure(change.decision === 'replace' || change.replaces.length === 0, 'Only replace decisions may name replaced members');
    const opKey = identifier('pool-operation', change.operationId), fingerprint = digest(change), previous = await readState(state, COLLECTIONS.feedback, opKey);
    if (previous) { ensure(previous.value.fingerprint === fingerprint, 'operationId was reused with a different pool decision', 'IDEMPOTENCY_CONFLICT'); return previous.value.result; }
    const current = await readState(state, COLLECTIONS.pools, change.poolId);
    ensure((current?.value.version ?? 0) === change.expectedVersion, 'Pool version changed', 'VERSION_CONFLICT');
    ensure(!current || current.value.strategyId === change.strategyId, 'Pool belongs to another strategy', 'FORBIDDEN');
    for (const id of change.factorIds) await read(id);
    for (const ref of change.applicationEvidence) { artifactRef(ref); await artifacts.verify(ref); }
    const members = new Set(current?.value.factorIds ?? []);
    if (change.decision === 'replace') { ensure(change.replaces.length > 0 && change.replaces.every(id => members.has(id)), 'Replacement must identify current pool members'); change.replaces.forEach(id => members.delete(id)); }
    if (change.decision === 'remove') change.factorIds.forEach(id => members.delete(id)); else change.factorIds.forEach(id => members.add(id));
    ensure(members.size <= 256, 'Pool exceeds 256 selected factors', 'RESOURCE_EXHAUSTED');
    const history = await artifacts.publishJSON({ previous: current?.value.history ?? null, change }, { schema: 'factor-history/1', dependencies: [...(current ? [current.value.history] : []), ...change.applicationEvidence], operationId: `${opKey}:history` });
    const result = { id: change.poolId, strategyId: change.strategyId, version: change.expectedVersion + 1, factorIds: [...members], history };
    try { await commitState(state, [
      { op: 'put', key: { collection: COLLECTIONS.pools, key: change.poolId }, expectedVersion: current?.version ?? 0, value: result },
      { op: 'put', key: { collection: COLLECTIONS.feedback, key: opKey }, expectedVersion: 0, value: { fingerprint, result } },
    ], { operationId: `${opKey}:${fingerprint}` }); }
    catch (e) {
      if (!['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(e.code)) throw e;
      const replay = await readState(state, COLLECTIONS.feedback, opKey);
      if (!replay) throw e;
      ensure(replay.value.fingerprint === fingerprint, 'Pool operation conflict', 'IDEMPOTENCY_CONFLICT'); return replay.value.result;
    }
    return result;
  };
  return {
    read, evaluation, evaluations, query, record, pool, decide,
    async annotate(factorId, note, operationId) {
      text(note, 4000); text(operationId, 256); const opKey = identifier('annotation', operationId), fingerprint = digest([factorId, note]);
      for (let retry = 0; retry < 12; retry++) {
        const prior = await readState(state, COLLECTIONS.feedback, opKey); if (prior) { ensure(prior.value.fingerprint === fingerprint, 'Annotation operation conflict', 'IDEMPOTENCY_CONFLICT'); return prior.value.result; }
        const row = await readState(state, COLLECTIONS.factors, factorId); ensure(row, 'Factor not found', 'NOT_FOUND');
        const result = { ...row.value, annotations: [...row.value.annotations, note].slice(-32) };
        try { await commitState(state, [{ op: 'put', key: row.key, expectedVersion: row.version, value: result }, { op: 'put', key: { collection: COLLECTIONS.feedback, key: opKey }, expectedVersion: 0, value: { fingerprint, result } }], { operationId: `${opKey}:${fingerprint}` }); return result; }
        catch (e) { if (!['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(e.code) || retry === 11) throw e; }
      }
    },
    async feedback(input) {
      keys(input, ['poolId', 'strategyVersion', 'poolVersion', 'applicationEvidence', 'note', 'operationId']);
      text(input.note, 8000); text(input.strategyVersion, 256); text(input.operationId, 256);
      ensure(Array.isArray(input.applicationEvidence) && input.applicationEvidence.length <= 32, 'Feedback evidence is bounded'); input.applicationEvidence.forEach(artifactRef);
      const id = identifier('application-feedback', input.operationId), fingerprint = digest(input), prior = await readState(state, COLLECTIONS.feedback, id);
      if (prior) { ensure(prior.value.fingerprint === fingerprint, 'Feedback operation conflict', 'IDEMPOTENCY_CONFLICT'); return prior.value.ref; }
      const selectedRow = await readState(state, COLLECTIONS.pools, input.poolId); ensure(selectedRow, 'Strategy factor pool not found', 'NOT_FOUND');
      const selected = selectedRow.value; ensure(input.poolVersion === selected.version, 'Feedback must identify the selected pool version', 'VERSION_CONFLICT');
      for (const evidence of input.applicationEvidence) await artifacts.verify(evidence);
      const ref = await artifacts.publishJSON(input, { schema: 'factor-history/1', dependencies: [selected.history, ...input.applicationEvidence], operationId: id });
      try { await commitState(state, [{ op: 'put', key: selectedRow.key, expectedVersion: selectedRow.version, value: selected }, { op: 'put', key: { collection: COLLECTIONS.feedback, key: id }, expectedVersion: 0, value: { fingerprint, ref, poolId: input.poolId } }], { operationId: `${id}:${fingerprint}` }); }
      catch (e) {
        if (!['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(e.code)) throw e;
        const replay = await readState(state, COLLECTIONS.feedback, id); if (!replay) throw e;
        ensure(replay.value.fingerprint === fingerprint, 'Feedback operation conflict', 'IDEMPOTENCY_CONFLICT'); return replay.value.ref;
      }
      return ref;
    },
  };
}
export function formulaFields(tree) { return tree.field ? [tree.field] : tree.args ? [...new Set(tree.args.flatMap(formulaFields))] : []; }
