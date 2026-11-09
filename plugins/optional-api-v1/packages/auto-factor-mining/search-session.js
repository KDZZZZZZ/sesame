import { OPERATOR_DIGEST, canonical, digest, ensure, referenceIdentity, validateProfile, validateSearchInput } from './contracts.js';

const same = (a, b) => canonical(a) === canonical(b);
const definitionDigest = formula => digest({ dsl: formula.dsl, operatorDigest: OPERATOR_DIGEST, tree: formula.tree });
const view = (session, candidates = []) => ({ searchId: session.id, snapshotRef: session.snapshotRef, checkpoint: session.checkpoint, attempted: session.attempted, exhausted: session.exhausted, candidates });
const resources = job => ({ activeMs: job.activeMs, input: job.byteUsage?.input ?? 0, output: job.byteUsage?.output ?? 0 });

/** Persistent proposal history only. Research ordering belongs to the caller. */
export function createSearchSessions({ search, library, journal, artifacts, runs, execution }) {
  async function typed(ref, schema, ctx) {
    const manifest = await artifacts.verify(ref, ctx);
    ensure(manifest.content?.schema === schema, 'Search evidence has the wrong schema', 'EVIDENCE_MISMATCH');
    return artifacts.readJSON(ref, ctx);
  }
  async function open(input, signal, native) {
    const operationInput = { ...input, budget: { ...input.budget, maxWorkers: 1 } };
    const result = await execution.execute('search-open', operationInput, signal, native, async ctx => {
      const snapshot = await typed(input.snapshotRef, 'factor-snapshot/1', ctx);
      validateProfile(input.profile, snapshot.layout);
      ensure(input.space.fields.every(field => snapshot.fields.includes(field)), 'Search fields are not present in the frozen snapshot', 'EVIDENCE_MISMATCH');
      ensure(snapshot.layout.target.kind !== 'provided' || !input.space.fields.includes(snapshot.layout.target.field), 'A target label cannot be a search feature');
      const referenceFactors = await Promise.all([...new Set(input.references)].map(id => library.read(id)));
      const { holdout: _holdout, ...layout } = snapshot.layout;
      const request = { requestId: input.requestId, need: input.need, development: { snapshotId: snapshot.id, source: snapshot.source, layout, fields: snapshot.fields, calendarDigest: snapshot.calendarDigest }, space: input.space, profile: input.profile, references: input.references, budget: operationInput.budget };
      const contextRef = await artifacts.publishJSON({ request, referenceFactors }, { schema: 'factor-evidence/1', dependencies: [input.snapshotRef, snapshot.source], operationId: `${ctx.jobId}:search-context` }, ctx);
      const session = await journal.createSearch(input, { snapshotRef: input.snapshotRef, contextRef, budget: operationInput.budget, checkpoint: null, attempted: 0, exhausted: false, pending: null, resources: { activeMs: 0, input: 0, output: 0 }, openingOperation: ctx.jobId, openingAccounted: false }, ctx.signal);
      return view(session);
    });
    const opened = await journal.getSearch(result.searchId), job = await journal.get(opened.openingOperation);
    await journal.updateSearch(opened.id, current => current.openingAccounted ? current : { ...current, resources: resources(job), openingAccounted: true }, signal);
    return result;
  }
  async function feedbackFor(items, session, context, checkpoint) {
    const snapshot = await typed(session.snapshotRef, 'factor-snapshot/1'), feedback = [];
    const attempts = checkpoint?.attempts ?? [];
    for (const item of items) {
      const factor = await library.read(item.factorId), evaluation = await library.evaluation(item.factorId, item.evaluationId);
      ensure(evaluation.id === item.evaluationId && evaluation.partition === 'development' && same(evaluation.profile, context.request.profile), 'Feedback must use the session development profile', 'EVIDENCE_MISMATCH');
      const attempted = attempts.find(attempt => attempt.status === 'proposed' && attempt.candidateId === evaluation.candidateId);
      ensure(attempted && definitionDigest(attempted.formula) === definitionDigest(factor.formula), 'Feedback is not for a candidate proposed in this search', 'EVIDENCE_MISMATCH');
      const values = await typed(evaluation.valuesRef, 'factor-values/1');
      ensure(values.id === evaluation.valuesId && same(values.snapshotRef, session.snapshotRef) && values.snapshotId === snapshot.id && values.partition === 'development' && values.engine.operatorDigest === OPERATOR_DIGEST, 'Feedback values use a different snapshot, partition or operator version', 'EVIDENCE_MISMATCH');
      ensure(values.candidates.some(value => value.status === 'ok' && value.value.candidate.id === evaluation.candidateId && definitionDigest(value.value.candidate.formula) === definitionDigest(factor.formula)), 'Feedback values do not contain the proposed candidate', 'EVIDENCE_MISMATCH');
      const details = await typed(evaluation.details, 'factor-evidence/1');
      ensure(Array.isArray(details.referenceValues) && details.referenceValues.length <= 32, 'Feedback reference evidence is missing', 'EVIDENCE_MISMATCH');
      const references = await Promise.all(details.referenceValues.map(ref => typed(ref, 'factor-values/1'))), definitions = [];
      for (const reference of references) {
        ensure(same(reference.snapshotRef, session.snapshotRef) && reference.snapshotId === snapshot.id && reference.partition === 'development' && same(reference.engine, values.engine), 'Feedback references use another snapshot or engine', 'EVIDENCE_MISMATCH');
        for (const result of reference.candidates) {
          ensure(result.status === 'ok', 'Feedback references contain failed computations', 'EVIDENCE_MISMATCH');
          const formula = result.value.candidate.formula, compiled = definitionDigest(formula);
          ensure(result.value.computeKey === digest({ formula: compiled, snapshotId: snapshot.id, calendarDigest: snapshot.calendarDigest, layout: snapshot.layout, partition: 'development', engine: values.engine }), 'Feedback reference computation identity differs', 'EVIDENCE_MISMATCH');
          definitions.push(compiled);
        }
      }
      ensure(same(definitions.sort(), context.referenceFactors.map(factor => definitionDigest(factor.formula)).sort()), 'Feedback uses different declared reference definitions', 'EVIDENCE_MISMATCH');
      const expected = { snapshotId: snapshot.id, sourceDigest: snapshot.source.digest, layoutDigest: digest({ layout: snapshot.layout, calendarDigest: snapshot.calendarDigest }), profileDigest: digest(context.request.profile), engineDigest: digest(values.engine), referenceDigest: digest(referenceIdentity(references)) };
      ensure(same(evaluation.context, expected), 'Feedback evidence context differs', 'EVIDENCE_MISMATCH');
      const valid = evaluation.eligibility !== 'invalid' && evaluation.score?.status === 'computed' && Number.isFinite(evaluation.score.value);
      feedback.push({ candidateId: evaluation.candidateId, evaluationId: evaluation.id, developmentScore: valid ? evaluation.score.value : null, status: valid ? 'valid' : 'invalid', reasons: evaluation.reasons });
    }
    return feedback;
  }
  async function propose(input, signal, native) {
    let session = await journal.getSearch(input.searchId);
    const operationInput = { ...input, budget: session.budget }, existing = await journal.find(input.requestId);
    if (existing) {
      ensure(existing.type === 'search-propose' && existing.inputDigest === digest(operationInput), 'Proposal requestId changed', 'IDEMPOTENCY_CONFLICT');
      if (existing.status === 'completed' && session.pending?.requestId !== input.requestId) return artifacts.readJSON(existing.outputRef, { signal });
    }
    ensure(!session.pending || session.pending.requestId === input.requestId, 'Recover the pending proposal with its original requestId before another batch', 'SEARCH_PENDING');
    ensure(!session.pending || session.pending.inputDigest === digest(operationInput), 'Pending proposal input changed', 'IDEMPOTENCY_CONFLICT');
    const context = await artifacts.readJSON(session.contextRef), checkpointRef = session.pending?.checkpoint ?? session.checkpoint;
    const checkpoint = checkpointRef ? await artifacts.readJSON(checkpointRef) : null;
    const feedback = await feedbackFor(input.feedback, session, context, checkpoint);
    session = await journal.updateSearch(session.id, current => {
      ensure(!current.pending || current.pending.requestId === input.requestId && current.pending.inputDigest === digest(operationInput), 'Another proposal already owns this search checkpoint', 'SEARCH_PENDING');
      ensure(same(current.checkpoint, session.checkpoint), 'Search checkpoint changed while preparing feedback', 'SEARCH_PENDING');
      return current.pending ? current : { ...current, pending: { requestId: input.requestId, inputDigest: digest(operationInput), checkpoint: checkpointRef, operationId: journal.idFor(input.requestId) } };
    }, signal);
    let operation = await journal.create('search-propose', operationInput, signal);
    if (!operation.nativeAttempt) operation = await journal.update(operation.id, current => current.nativeAttempt || current.budgetBaseline ? current : {
      ...current, budgetBaseline: session.resources, activeMs: session.resources.activeMs, byteUsage: { input: session.resources.input, output: session.resources.output, active: {} },
    }, signal);
    const result = await execution.execute('search-propose', operationInput, signal, native, async ctx => {
      const proposed = await search.propose(context.request, checkpointRef, feedback, Math.min(input.limit, session.budget.batchSize), ctx);
      const state = await typed(proposed.checkpoint, 'factor-search-state/1', ctx);
      ensure(Number.isSafeInteger(state.budget?.used) && state.budget.used >= session.attempted && state.budget.used <= session.budget.maxCandidates, 'Search candidate budget is inconsistent', 'EVIDENCE_MISMATCH');
      ensure(Array.isArray(proposed.candidates) && proposed.candidates.length <= input.limit && typeof proposed.exhausted === 'boolean', 'Search returned an invalid batch', 'EVIDENCE_MISMATCH');
      return { searchId: session.id, snapshotRef: session.snapshotRef, checkpoint: proposed.checkpoint, attempted: state.budget.used, exhausted: proposed.exhausted, candidates: proposed.candidates };
    });
    operation = await journal.get(operation.id);
    await journal.updateSearch(session.id, current => {
      if (!current.pending && same(current.checkpoint, result.checkpoint)) return current;
      ensure(current.pending?.operationId === operation.id, 'Search pending operation changed', 'EVIDENCE_MISMATCH');
      return { ...current, checkpoint: result.checkpoint, attempted: result.attempted, exhausted: result.exhausted, resources: resources(operation), pending: null };
    }, signal);
    return result;
  }
  return { async handle(input, signal, nativeExecution) {
    validateSearchInput(input); signal?.throwIfAborted();
    if (input.action === 'open') return open(input, signal, nativeExecution);
    if (input.action === 'read') return view(await journal.getSearch(input.searchId));
    return propose(input, signal, nativeExecution);
  } };
}
