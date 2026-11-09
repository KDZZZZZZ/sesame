import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary } from '../library.js';
import { createArtifacts } from '../artifacts.js';
import { COLLECTIONS, digest, referenceIdentity, OPERATOR_DIGEST } from '../contracts.js';
import { storageFixture } from './storage-fixture.js';

const candidate = (id = 'candidate', field = 'close') => ({ id, formula: { dsl: 'qlib-expr/1', tree: { field } }, hypothesis: 'Synthetic test', origin: { method: 'seed', parents: [], parameters: {} } });
const profile = { id: 'test', version: 1, kind: 'alpha', axis: 'time_series', minPairs: 3, minCoverage: 0.8, stabilityWindows: 2, maxReferenceCorrelation: 0.95, score: 'abs_rank_ic', diagnostics: [] };
const layout = { universe: ['A'], frequency: '1h', timezone: 'UTC', availableAt: 'bar_close', development: ['2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'], holdout: ['2026-01-04T00:00:00Z', '2026-01-05T00:00:00Z'], target: { kind: 'forward_return', field: 'close', horizonBars: 1 } };
const computed = value => ({ value, status: 'computed' });
async function fixture(t) {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host });
  let serial = 0;
  const publish = (value, schema, dependencies = []) => artifacts.publishJSON(value, { schema, dependencies, operationId: `fixture-${++serial}` });
  const source = f.artifact(), snapshot = { id: 'snapshot', source, layout, calendarDigest: digest('calendar') }, snapshotRef = await publish(snapshot, 'factor-snapshot/1', [source]);
  const job = { id: 'job', epoch: 1, status: 'running' }; f.seed(COLLECTIONS.jobs, 'job', job);
  const makeEvidence = async ({ c = candidate(), id = `evaluation-${++serial}`, engine = { name: 'qlib', version: '0.9.7', environmentDigest: digest('environment'), operatorDigest: OPERATOR_DIGEST }, references = [], context = {} } = {}) => {
    const values = { id: `values-${serial}`, snapshotId: snapshot.id, snapshotRef, partition: 'development', candidates: [{ id: c.id, status: 'ok', value: { candidate: c, column: c.id, computeKey: digest([c.formula, engine]) } }], engine };
    const valuesRef = await publish(values, 'factor-values/1', [snapshotRef]);
    const details = await publish({ referenceValues: references.map(v => v.manifest) }, 'factor-evidence/1', [valuesRef, ...references.map(v => v.manifest)]);
    const evidenceContext = { snapshotId: snapshot.id, sourceDigest: source.digest, layoutDigest: digest({ layout, calendarDigest: snapshot.calendarDigest }), profileDigest: digest(profile), engineDigest: digest(engine), referenceDigest: digest(referenceIdentity(references)), ...context };
    const evaluation = { id, candidateId: c.id, valuesId: values.id, valuesRef, context: evidenceContext, profile, partition: 'development', pairs: 20, coverage: computed(1), ic: computed(0.5), rankIC: computed(0.5), stability: computed(0), maxReferenceCorrelation: { value: null, status: 'unavailable', reason: 'no_references' }, complement: { value: null, status: 'unavailable', reason: 'no_references' }, score: computed(0.5), diagnostics: [], eligibility: 'supported', reasons: [], details };
    return { candidate: c, evaluation, values: { ...values, manifest: valuesRef } };
  };
  const library = createLibrary({ state: f.state, artifacts });
  return { ...f, artifacts, library, publish, makeEvidence, snapshot, snapshotRef };
}
const fence = { jobId: 'job', epoch: 1 };
const record = (f, e) => f.library.record([e.candidate], [e.evaluation], fence);
const change = (factorId, extras = {}) => ({ operationId: 'select', poolId: 'pool', strategyId: 'strategy', expectedVersion: 0, decision: 'add', factorIds: [factorId], replaces: [], purpose: 'Synthetic test', reason: 'Explicit selection', strategyVersion: 'v1', applicationEvidence: [], ...extras });

test('formula identity includes operator version and matches compiler identity', async t => {
  const f = await fixture(t), a = await f.makeEvidence(), [first] = await record(f, a);
  assert.equal(first.definitionDigest, digest({ dsl: a.candidate.formula.dsl, operatorDigest: OPERATOR_DIGEST, tree: a.candidate.formula.tree }));
  const b = await f.makeEvidence({ engine: { ...a.values.engine, operatorDigest: digest('changed operators') } }), [second] = await record(f, b);
  assert.notEqual(first.id, second.id);
});

test('atomic job fence prevents cancellation during async commit validation', async t => {
  const f = await fixture(t), e = await f.makeEvidence();
  f.state.beforeCommit = async changes => {
    assert.ok(changes.some(change => change.key.collection === COLLECTIONS.jobs));
    const row = f.state.read({ collection: COLLECTIONS.jobs, key: 'job' });
    await f.state.commit([{ op: 'put', key: row.key, expectedVersion: row.version, value: { ...row.value, status: 'cancelled', epoch: 2 } }]);
  };
  await assert.rejects(record(f, e), error => error.code === 'CANCELLED');
  assert.equal(f.state.query({ collection: COLLECTIONS.factors }).items.length, 0);
  assert.equal(f.state.query({ collection: COLLECTIONS.evaluations }).items.length, 0);
});

test('record retries unrelated CAS changes without dropping evaluation evidence', async t => {
  const f = await fixture(t), e = await f.makeEvidence();
  f.state.beforeCommit = async () => { const row = f.state.read({ collection: COLLECTIONS.jobs, key: 'job' }); await f.state.commit([{ op: 'put', key: row.key, expectedVersion: row.version, value: { ...row.value, progress: 1 } }]); };
  const [factor] = await record(f, e);
  assert.deepEqual((await f.library.evaluations(factor.id)).items, [e.evaluation]);
  assert.deepEqual(await record(f, e), [factor]);
  await assert.rejects(record(f, { ...e, evaluation: { ...e.evaluation, pairs: 21 } }), error => error.code === 'IDEMPOTENCY_CONFLICT');
});

test('evaluation reference digest is recomputed from actual immutable references', async t => {
  const f = await fixture(t), e = await f.makeEvidence({ context: { referenceDigest: digest('invented reference identity') } });
  await assert.rejects(record(f, e), error => error.code === 'EVIDENCE_MISMATCH');
  const reference = await f.makeEvidence({ c: candidate('reference', 'high') });
  const actual = await f.makeEvidence({ references: [reference.values] });
  assert.equal((await record(f, actual)).length, 1);
  const wrong = await f.makeEvidence({ references: [{ ...reference.values, engine: { ...reference.values.engine, version: 'changed' } }] });
  await assert.rejects(record(f, wrong), error => error.code === 'EVIDENCE_MISMATCH');
});

test('changed source/layout/profile/engine identity cannot enter library', async t => {
  const f = await fixture(t);
  for (const field of ['sourceDigest', 'layoutDigest', 'profileDigest', 'engineDigest']) {
    const e = await f.makeEvidence({ context: { [field]: digest(`different ${field}`) } });
    await assert.rejects(record(f, e), error => error.code === 'EVIDENCE_MISMATCH');
  }
});

test('reference values must share the evaluated snapshot partition and engine', async t => {
  const f = await fixture(t), reference = await f.makeEvidence({ c: candidate('reference', 'high') });
  for (const changes of [{ partition: 'holdout' }, { snapshotId: 'other-snapshot' }, { engine: { ...reference.values.engine, version: 'other' } }]) {
    const { manifest, ...old } = reference.values, value = { ...old, ...changes };
    const foreignRef = await f.publish(value, 'factor-values/1', [value.snapshotRef]);
    const e = await f.makeEvidence({ references: [{ ...value, manifest: foreignRef }] });
    await assert.rejects(record(f, e), error => error.code === 'EVIDENCE_MISMATCH');
  }
});

test('evaluation Values must be published under the specific values schema', async t => {
  const f = await fixture(t), e = await f.makeEvidence();
  const { manifest, ...value } = e.values;
  e.evaluation.valuesRef = await f.publish(value, 'factor-evidence/1', [value.snapshotRef]);
  await assert.rejects(record(f, e), error => error.code === 'EVIDENCE_MISMATCH');
});

test('queries require exact supported evidence and paginate filtered factors', async t => {
  const f = await fixture(t), fixtures = [];
  for (const field of ['close', 'high', 'low']) { const e = await f.makeEvidence({ c: candidate(field, field) }); await record(f, e); fixtures.push(e); }
  const all = [], first = await f.library.query({ kind: 'alpha', evidenceMatch: fixtures[0].evaluation.context, limit: 1 });
  all.push(...first.items); let cursor = first.cursor;
  while (cursor) { const page = await f.library.query({ kind: 'alpha', evidenceMatch: fixtures[0].evaluation.context, limit: 1, cursor }); all.push(...page.items); cursor = page.cursor; }
  assert.equal(all.length, 3); assert.equal(new Set(all.map(f => f.id)).size, 3);
  assert.equal((await f.library.query({ evidenceMatch: { ...fixtures[0].evaluation.context, referenceDigest: digest('changed') } })).items.length, 0);
  assert.equal((await f.library.query({ fields: ['close'] })).items.length, 1);
  assert.equal((await f.library.query({ kind: 'risk' })).items.length, 0);
});

test('full evaluation history pages beyond the bounded factor preview', async t => {
  const f = await fixture(t); let factor;
  for (let i = 0; i < 35; i++) [factor] = await record(f, await f.makeEvidence());
  assert.equal(factor.evaluationIds.length, 32);
  const one = await f.library.evaluations(factor.id, { limit: 20 }), two = await f.library.evaluations(factor.id, { limit: 20, cursor: one.cursor });
  assert.equal(one.items.length + two.items.length, 35); assert.equal(two.cursor, null);
  await assert.rejects(f.library.evaluations(factor.id, { limit: 201 }), /limit/i);
});

test('annotation CAS retries preserve both independent notes', async t => {
  const f = await fixture(t), [factor] = await record(f, await f.makeEvidence());
  f.state.beforeCommit = async () => { await f.library.annotate(factor.id, 'Other note', 'other'); };
  const annotated = await f.library.annotate(factor.id, 'My note', 'mine');
  assert.deepEqual(annotated.annotations, ['Other note', 'My note']);
  assert.deepEqual(await f.library.annotate(factor.id, 'My note', 'mine'), annotated);
  await assert.rejects(f.library.annotate(factor.id, 'Changed', 'mine'), error => error.code === 'IDEMPOTENCY_CONFLICT');
});

test('explicit pool decisions enforce ownership, version, immutable history and operation identity', async t => {
  const f = await fixture(t), [factor] = await record(f, await f.makeEvidence());
  const added = await f.library.decide(change(factor.id));
  assert.equal(added.version, 1); assert.deepEqual(await f.library.decide(change(factor.id)), added);
  await assert.rejects(f.library.decide(change(factor.id, { reason: 'Changed' })), error => error.code === 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(f.library.decide(change(factor.id, { operationId: 'wrong-owner', strategyId: 'other', expectedVersion: 1 })), error => error.code === 'FORBIDDEN');
  await assert.rejects(f.library.decide(change(factor.id, { operationId: 'stale' })), error => error.code === 'VERSION_CONFLICT');
  const removed = await f.library.decide(change(factor.id, { operationId: 'remove', expectedVersion: 1, decision: 'remove' }));
  assert.deepEqual(removed.factorIds, []);
  assert.deepEqual((await f.artifacts.readJSON(removed.history)).previous, added.history);
});

test('replacement removes named members and concurrent pool writers cannot both win', async t => {
  const f = await fixture(t), [a] = await record(f, await f.makeEvidence()), [b] = await record(f, await f.makeEvidence({ c: candidate('high', 'high') }));
  await f.library.decide(change(a.id));
  const replacement = change(b.id, { operationId: 'replace', expectedVersion: 1, decision: 'replace', replaces: [a.id] });
  f.state.beforeCommit = async () => { await f.library.decide(change(a.id, { operationId: 'concurrent-remove', expectedVersion: 1, decision: 'remove' })); };
  await assert.rejects(f.library.decide(replacement), error => error.code === 'VERSION_CONFLICT');
  assert.deepEqual((await f.library.pool('pool')).factorIds, []);
  const added = await f.library.decide(change(a.id, { operationId: 'add-again', expectedVersion: 2 }));
  const replaced = await f.library.decide({ ...replacement, operationId: 'replace-again', expectedVersion: added.version });
  assert.deepEqual(replaced.factorIds, [b.id]);
});

test('feedback verifies application evidence and never modifies factor evaluation', async t => {
  const f = await fixture(t), e = await f.makeEvidence(), [factor] = await record(f, e);
  const selected = await f.library.decide(change(factor.id)), app = f.artifact({ kind: 'report', value: { conclusion: 'external strategy evidence' } });
  const input = { poolId: selected.id, poolVersion: selected.version, strategyVersion: 'v1', applicationEvidence: [app], note: 'Application result', operationId: 'feedback' };
  const ref = await f.library.feedback(input);
  await f.library.decide(change(factor.id, { operationId: 'remove', expectedVersion: 1, decision: 'remove' }));
  assert.deepEqual(await f.library.feedback(input), ref, 'Identical retry must survive a later pool version');
  assert.deepEqual((await f.library.evaluations(factor.id)).items, [e.evaluation]);
  await assert.rejects(f.library.feedback({ ...input, operationId: 'missing', poolVersion: 2, applicationEvidence: [{ ...app, id: 'nonexistent' }] }), error => error.code === 'NOT_FOUND');
});
