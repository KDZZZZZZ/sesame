import assert from 'node:assert/strict';
import test from 'node:test';
import { createSearchSessions } from '../search-session.js';
import { COLLECTIONS, OPERATOR_DIGEST, clone, digest, referenceIdentity } from '../contracts.js';
import { createBudgets } from '../budgets.js';
import { createJournal } from '../journal.js';
import { budget, deferred, executionFixture } from './execution-fixture.js';

const profile = { id: 'alpha', version: 1, kind: 'alpha', axis: 'time_series', minPairs: 3, minCoverage: .5, stabilityWindows: 2, maxReferenceCorrelation: .9, score: 'abs_rank_ic', diagnostics: [] };
const formula = { dsl: 'qlib-expr/1', tree: { field: 'close' } };
const candidate = { id: 'candidate-1', formula, hypothesis: 'Synthetic fixture', origin: { method: 'seed', parents: [], parameters: {} } };
async function fixture(t, hook) {
  const f = await executionFixture(t), source = f.artifact(), layout = { universe: ['A'], frequency: '1h', timezone: 'UTC', availableAt: 'bar_close', development: ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'], holdout: ['2026-01-03T00:00:00Z', '2026-01-04T00:00:00Z'], target: { kind: 'forward_return', field: 'close', horizonBars: 1 } };
  const snapshot = { id: 'snapshot', source, layout, fields: ['close'], calendarDigest: digest('calendar') };
  const snapshotRef = await f.artifacts.publishJSON(snapshot, { schema: 'factor-snapshot/1', dependencies: [source], operationId: 'snapshot' });
  const { maxWorkers, ...searchBudget } = budget;
  const open = { action: 'open', requestId: 'open', snapshotRef, need: 'A new synthetic factor', space: { fields: ['close'], operators: ['Mean'], windows: [2], lags: [1], constants: [], maxNodes: 8, maxDepth: 4, maxLookbackBars: 8, seeds: [], templates: [] }, profile, references: [], budget: searchBudget };
  const feedback = [], calls = [], evaluations = new Map(), factors = new Map([['factor-1', { id: 'factor-1', formula }]]);
  const search = { async propose(request, checkpoint, values, limit, ctx) {
    calls.push({ request, checkpoint, values, limit, ctx }); feedback.push(...values); await hook?.(ctx);
    const previous = checkpoint ? await f.artifacts.readJSON(checkpoint) : { attempts: [], budget: { used: 0 } };
    const candidates = limit && !previous.attempts.length ? [candidate] : [];
    const state = { attempts: [...previous.attempts, ...candidates.map(value => ({ candidateId: value.id, formula: value.formula, status: 'proposed' }))], budget: { used: previous.budget.used + candidates.length } };
    const next = await f.artifacts.publishJSON(state, { schema: 'factor-search-state/1', dependencies: [], operationId: `state:${calls.length}` }, ctx);
    return { candidates, checkpoint: next, exhausted: state.budget.used >= budget.maxCandidates };
  } };
  const library = { async read(id) { assert.ok(factors.has(id)); return clone(factors.get(id)); }, async evaluation(factorId, evaluationId) { const value = evaluations.get(`${factorId}:${evaluationId}`); assert.ok(value); return clone(value); } };
  const sessions = createSearchSessions({ ...f.ports, execution: f.execution, search, library });
  const invoke = async input => { const native = f.native(`call-${f.nativeRuns.size}`); return sessions.handle(input, native.signal, native); };
  const addEvaluation = async ({ id = 'evaluation-1', partition = 'development', selectedProfile = profile, snapshotHandle = snapshotRef, candidateId = candidate.id, referenceFormulas = [] } = {}) => {
    const engine = { name: 'qlib', version: '0.9.7', environmentDigest: digest('environment'), operatorDigest: OPERATOR_DIGEST };
    const values = { id: 'values', snapshotId: snapshot.id, snapshotRef: snapshotHandle, partition, engine, candidates: [{ id: candidateId, status: 'ok', value: { candidate: { ...candidate, id: candidateId }, computeKey: 'compute' } }] };
    const valuesRef = await f.artifacts.publishJSON(values, { schema: 'factor-values/1', dependencies: [snapshotHandle], operationId: `values:${id}` });
    const references = [], referenceValues = [];
    if (referenceFormulas.length) {
      const reference = { ...values, id: `reference:${id}`, candidates: referenceFormulas.map((formula, index) => ({ id: `reference-${index}`, status: 'ok', value: { candidate: { ...candidate, id: `reference-${index}`, formula }, computeKey: digest({ formula: digest({ dsl: formula.dsl, operatorDigest: OPERATOR_DIGEST, tree: formula.tree }), snapshotId: snapshot.id, calendarDigest: snapshot.calendarDigest, layout, partition, engine }) } })) };
      references.push(reference);
      referenceValues.push(await f.artifacts.publishJSON(reference, { schema: 'factor-values/1', dependencies: [snapshotHandle], operationId: `reference:${id}` }));
    }
    const details = await f.artifacts.publishJSON({ referenceValues }, { schema: 'factor-evidence/1', dependencies: referenceValues, operationId: `details:${id}` });
    const value = { id, candidateId, valuesId: 'values', valuesRef, partition, profile: selectedProfile, context: { snapshotId: snapshot.id, sourceDigest: source.digest, layoutDigest: digest({ layout, calendarDigest: snapshot.calendarDigest }), profileDigest: digest(selectedProfile), engineDigest: digest(engine), referenceDigest: digest(referenceIdentity(references)) }, eligibility: 'supported', score: { status: 'computed', value: .25 }, reasons: [], details };
    evaluations.set(`factor-1:${id}`, value); return { factorId: 'factor-1', evaluationId: id };
  };
  return { ...f, open, sessions, invoke, calls, feedback, addEvaluation, snapshot, snapshotRef, factors };
}

test('open/read never propose and a propose call performs exactly one bounded batch', async t => {
  const f = await fixture(t), opened = await f.invoke(f.open);
  assert.deepEqual(opened.candidates, []); assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.invoke({ action: 'read', searchId: opened.searchId }), opened); assert.equal(f.calls.length, 0);
  const input = { action: 'propose', requestId: 'batch-1', searchId: opened.searchId, limit: 1, feedback: [] };
  const result = await f.invoke(input); assert.equal(f.calls.length, 1); assert.equal(result.attempted, 1); assert.deepEqual(result.candidates, [candidate]);
  assert.equal('holdout' in f.calls[0].request.development.layout, false); assert.equal('provider' in f.calls[0].request.development, false);
  assert.deepEqual(await f.invoke(input), result); assert.equal(f.calls.length, 1);
});

test('feedback comes only from the exact library development evaluation and cannot be self-scored', async t => {
  const f = await fixture(t), opened = await f.invoke(f.open);
  await f.invoke({ action: 'propose', requestId: 'first', searchId: opened.searchId, limit: 1, feedback: [] });
  const valid = await f.addEvaluation();
  await f.invoke({ action: 'propose', requestId: 'feedback', searchId: opened.searchId, limit: 0, feedback: [valid] });
  assert.deepEqual(f.feedback, [{ candidateId: candidate.id, evaluationId: valid.evaluationId, developmentScore: .25, status: 'valid', reasons: [] }]);
  const held = await f.addEvaluation({ id: 'holdout', partition: 'holdout' });
  await assert.rejects(f.invoke({ action: 'propose', requestId: 'held', searchId: opened.searchId, limit: 0, feedback: [held] }), { code: 'EVIDENCE_MISMATCH' });
  const changed = await f.addEvaluation({ id: 'changed', selectedProfile: { ...profile, minCoverage: .8 } });
  await assert.rejects(f.invoke({ action: 'propose', requestId: 'changed', searchId: opened.searchId, limit: 0, feedback: [changed] }), { code: 'EVIDENCE_MISMATCH' });
  await assert.rejects(f.invoke({ action: 'propose', requestId: 'invented', searchId: opened.searchId, limit: 0, feedback: [{ ...valid, developmentScore: 1 }] }));
  const foreign = await f.addEvaluation({ id: 'foreign-candidate', candidateId: 'never-proposed' });
  await assert.rejects(f.invoke({ action: 'propose', requestId: 'foreign', searchId: opened.searchId, limit: 0, feedback: [foreign] }), { code: 'EVIDENCE_MISMATCH' });
  const otherSnapshot = await f.artifacts.publishJSON({ ...f.snapshot, id: 'other' }, { schema: 'factor-snapshot/1', dependencies: [f.snapshot.source], operationId: 'other-snapshot' });
  const wrongSnapshot = await f.addEvaluation({ id: 'foreign-snapshot', snapshotHandle: otherSnapshot });
  await assert.rejects(f.invoke({ action: 'propose', requestId: 'wrong-snapshot', searchId: opened.searchId, limit: 0, feedback: [wrongSnapshot] }), { code: 'EVIDENCE_MISMATCH' });
});

test('feedback must include the exact reference definitions frozen when opening the search', async t => {
  const f = await fixture(t); f.factors.set('reference', { id: 'reference', formula: { dsl: 'qlib-expr/1', tree: { call: 'Mean', args: [{ field: 'close' }, { constant: 2 }] } } });
  const opened = await f.invoke({ ...f.open, references: ['reference'] });
  await f.invoke({ action: 'propose', requestId: 'first', searchId: opened.searchId, limit: 1, feedback: [] });
  const noReference = await f.addEvaluation();
  await assert.rejects(f.invoke({ action: 'propose', requestId: 'feedback', searchId: opened.searchId, limit: 0, feedback: [noReference] }), { code: 'EVIDENCE_MISMATCH' });
  assert.equal(f.calls.length, 1);
  const matching = await f.addEvaluation({ id: 'with-reference', referenceFormulas: [f.factors.get('reference').formula] });
  await f.invoke({ action: 'propose', requestId: 'valid-reference', searchId: opened.searchId, limit: 0, feedback: [matching] });
  assert.equal(f.calls.length, 2); assert.equal(f.feedback.at(-1).evaluationId, matching.evaluationId);
});

test('session bytes persist across proposal IDs and one call respects the frozen batch size', async t => {
  let budgets;
  const f = await fixture(t, async ctx => { budgets ??= createBudgets(f.journal); await budgets.reserve(ctx, `bytes:${ctx.jobId}`, 2000); await budgets.settle(ctx, `bytes:${ctx.jobId}`, { input: 1800, output: 100 }); });
  const opened = await f.invoke({ ...f.open, budget: { ...f.open.budget, maxInputBytes: 3000 } });
  await f.invoke({ action: 'propose', requestId: 'one', searchId: opened.searchId, limit: 64, feedback: [] });
  assert.equal(f.calls[0].limit, f.open.budget.batchSize);
  const session = await f.journal.getSearch(opened.searchId); assert.equal(session.resources.input, 1800);
  await assert.rejects(f.invoke({ action: 'propose', requestId: 'two', searchId: opened.searchId, limit: 1, feedback: [] }), { code: 'BUDGET_EXHAUSTED' });
  assert.equal((await f.journal.find('two')).byteUsage.input, 1800);
});

test('a pending proposal blocks another request and explicit repetition recovers only that proposal', async t => {
  let fail = true; const entered = deferred(), release = deferred();
  const f = await fixture(t, async () => { if (fail) { entered.resolve(); await release.promise; throw Object.assign(Error('Interrupted search'), { code: 'WORKER_FAILED' }); } });
  const opened = await f.invoke(f.open), input = { action: 'propose', requestId: 'pending', searchId: opened.searchId, limit: 1, feedback: [] };
  const first = f.invoke(input), rejected = assert.rejects(first, { code: 'WORKER_FAILED' }); await entered.promise;
  await assert.rejects(f.invoke({ ...input, requestId: 'other' }), { code: 'SEARCH_PENDING' });
  release.resolve(); await rejected;
  const job = await f.journal.find('pending'); f.addEvent(job.runId, 'interrupted'); fail = false;
  assert.equal((await f.invoke(input)).attempted, 1); assert.equal(f.calls.length, 2);
  assert.equal((await f.invoke({ action: 'read', searchId: opened.searchId })).attempted, 1); assert.equal(f.calls.length, 2);
});

test('a retained completed proposal commits its pending session after interruption without another search', async t => {
  const f = await fixture(t), opened = await f.invoke(f.open), native = f.native('proposal');
  const input = { action: 'propose', requestId: 'retained', searchId: opened.searchId, limit: 1, feedback: [] };
  const intercept = async changes => {
    if (changes.some(change => change.key.collection === COLLECTIONS.searches && change.value.checkpoint && change.value.pending === null)) {
      native.controller.abort(Object.assign(Error('interrupted after operation result'), { code: 'RUN_INTERRUPTED' }));
    } else f.state.beforeCommit = intercept;
  };
  f.state.beforeCommit = intercept;
  await assert.rejects(f.sessions.handle(input, native.signal, native), { code: 'RUN_INTERRUPTED' });
  const pending = await f.journal.getSearch(opened.searchId), completed = await f.journal.find(input.requestId);
  assert.equal(pending.pending.requestId, input.requestId); assert.equal(completed.status, 'completed'); assert.ok(completed.outputRef);
  f.addEvent(native.run.id, 'interrupted');
  const recovered = await f.invoke(input); assert.equal(recovered.attempted, 1); assert.equal(f.calls.length, 1);
  const saved = await f.journal.getSearch(opened.searchId); assert.equal(saved.pending, null); assert.deepEqual(saved.resources.activeMs, completed.activeMs);
  assert.deepEqual(await f.invoke(input), recovered); assert.equal(f.calls.length, 1);
});

test('session ownership and proposal request identity cannot switch to another search', async t => {
  const f = await fixture(t), first = await f.invoke(f.open), second = await f.invoke({ ...f.open, requestId: 'other-open', need: 'Another request' });
  const input = { action: 'propose', requestId: 'one-proposal', searchId: first.searchId, limit: 1, feedback: [] };
  await f.invoke(input);
  await assert.rejects(f.invoke({ ...input, searchId: second.searchId }), { code: 'IDEMPOTENCY_CONFLICT' });
  const otherOwner = createJournal({ state: f.state, artifacts: f.artifacts, ownerSessionId: 'another-agent-owner' });
  await assert.rejects(otherOwner.getSearch(first.searchId), { code: 'FORBIDDEN' });
  assert.equal((await f.invoke({ action: 'read', searchId: second.searchId })).attempted, 0);
});

test('pending retries debit the cumulative resource baseline exactly once', async t => {
  let first = true;
  const f = await fixture(t, async ctx => {
    const budgets = createBudgets(f.journal), token = `attempt:${ctx.nativeAttempt}`;
    await budgets.reserve(ctx, token, 2000); await budgets.settle(ctx, token, { input: 1800, output: 100 });
    if (first) { first = false; throw Object.assign(Error('failed after consuming resources'), { code: 'WORKER_FAILED' }); }
  });
  const opened = await f.invoke({ ...f.open, budget: { ...f.open.budget, maxInputBytes: 5000 } });
  const input = { action: 'propose', requestId: 'retry-budget', searchId: opened.searchId, limit: 1, feedback: [] };
  await assert.rejects(f.invoke(input), { code: 'WORKER_FAILED' });
  const failed = await f.journal.find(input.requestId); f.addEvent(failed.runId, 'interrupted');
  await f.invoke(input);
  assert.equal((await f.journal.getSearch(opened.searchId)).resources.input, 3600);
  assert.equal((await f.journal.find(input.requestId)).budgetBaseline.input, 0);
  await assert.rejects(f.invoke({ ...input, requestId: 'next-budget' }), { code: 'BUDGET_EXHAUSTED' });
});
