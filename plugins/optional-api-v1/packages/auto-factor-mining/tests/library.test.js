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
const source = { url: 'https://example.org/factors/formula.py', revision: 'revision-1', license: 'MIT' };
const registration = (extras = {}) => ({ operationId: 'register', formula: candidate().formula, name: 'User Momentum', hypothesis: 'Price continuation over a chosen horizon', sources: [source], changes: 'Adapted to supported qlib operators', ...extras });

test('registration stores a private definition without fabricated evidence or resource side effects', async t => {
  const f = await storageFixture(t), library = createLibrary({ state: f.state, artifacts: {} });
  const input = registration(), factor = await library.register(input);
  assert.deepEqual(factor.registrations, [{ name: input.name, hypothesis: input.hypothesis, sources: input.sources, changes: input.changes }]);
  assert.deepEqual(factor.evaluationIds, []); assert.deepEqual(factor.annotations, []);
  assert.deepEqual(await library.read(factor.id), factor);
  assert.equal(f.state.query({ collection: COLLECTIONS.evaluations }).items.length, 0);
  assert.deepEqual(f.calls.map(call => call.kind), ['commit']);
});

test('registration and actual evidence merge under the same operator-based factor identity', async t => {
  const f = await fixture(t), input = registration(), registered = await f.library.register(input);
  const e = await f.makeEvidence(), [measured] = await record(f, e);
  assert.equal(measured.id, registered.id);
  assert.equal(measured.definitionDigest, registered.definitionDigest);
  assert.deepEqual(measured.registrations, registered.registrations);
  assert.deepEqual(measured.evaluationIds, [e.evaluation.id]);
  assert.deepEqual((await f.library.evaluations(registered.id)).items, [e.evaluation]);
  const replay = await f.library.register(input);
  assert.deepEqual(replay, registered, 'Idempotent replay returns the original result, not a later evaluation snapshot');
  assert.deepEqual(await f.library.read(registered.id), measured);
});

test('registration queries distinguish unevaluated definitions from actual supported evidence', async t => {
  const f = await fixture(t), definition = await f.library.register(registration());
  assert.deepEqual((await f.library.query({ evaluated: false, text: 'mOmEnTuM' })).items, [definition]);
  assert.deepEqual((await f.library.query({ text: 'CONTINUATION' })).items, [definition]);
  assert.deepEqual((await f.library.query({ text: 'missing' })).items, []);
  assert.deepEqual((await f.library.query({ evaluated: true })).items, []);
  assert.deepEqual((await f.library.query({ kind: 'alpha' })).items, []);
  assert.deepEqual((await f.library.query({ minCoverage: 0 })).items, []);
  const e = await f.makeEvidence(), [measured] = await record(f, e);
  assert.deepEqual((await f.library.query({ evaluated: true, text: 'Momentum', kind: 'alpha' })).items, [measured]);
  assert.deepEqual((await f.library.query({ evaluated: false })).items, []);
});

test('registration receipt rejects changed inputs and replays its fixed result after other registrations', async t => {
  const f = await fixture(t), input = registration(), first = await f.library.register(input);
  const second = await f.library.register(registration({ operationId: 'alias', name: 'Another name' }));
  assert.equal(second.id, first.id); assert.equal(second.registrations.length, 2);
  assert.deepEqual(await f.library.register(input), first);
  for (const extras of [{ name: 'Changed name' }, { formula: candidate('other', 'high').formula }, { changes: 'Changed adaptation' }]) {
    await assert.rejects(f.library.register({ ...input, ...extras }), { code: 'IDEMPOTENCY_CONFLICT' });
  }
  assert.deepEqual(await f.library.read(first.id), second);
});

test('registration normalizes duplicate sources and retains at most eight unique metadata entries', async t => {
  const f = await fixture(t), another = { ...source, revision: 'revision-2' };
  const first = await f.library.register(registration({ sources: [source, another, source] }));
  assert.equal(first.registrations[0].sources.length, 2);
  const duplicate = await f.library.register(registration({ operationId: 'same-metadata', sources: [another, source] }));
  assert.deepEqual(duplicate, first, 'Source order does not create another alias');
  let latest = first;
  for (let i = 1; i < 8; i++) latest = await f.library.register(registration({ operationId: `alias-${i}`, name: `Alias ${i}`, sources: [source, another] }));
  assert.equal(latest.registrations.length, 8);
  assert.deepEqual(await f.library.register(registration({ operationId: 'dedup-at-limit', sources: [source, another] })), latest);
  await assert.rejects(f.library.register(registration({ operationId: 'overflow', name: 'Ninth alias' })), { code: 'RESOURCE_EXHAUSTED' });
  assert.deepEqual(await f.library.read(first.id), latest);
});

test('concurrent independent registrations merge through factor CAS', async t => {
  const f = await fixture(t), input = registration();
  f.state.beforeCommit = async () => { await f.library.register(registration({ operationId: 'concurrent', name: 'Concurrent alias' })); };
  const factor = await f.library.register(input);
  assert.deepEqual(factor.registrations.map(item => item.name), ['Concurrent alias', input.name]);
  assert.deepEqual(await f.library.read(factor.id), factor);
});

test('concurrent identical registration receipts replay once and conflicting receipts fail', async t => {
  const f = await fixture(t), input = registration(); let concurrent;
  const before = f.calls.filter(call => call.kind === 'commit').length;
  f.state.beforeCommit = async () => { concurrent = await f.library.register(input); };
  assert.deepEqual(await f.library.register(input), concurrent);
  assert.equal(f.calls.filter(call => call.kind === 'commit').length - before, 1);
  const changed = registration({ operationId: 'conflicting', name: 'Winning input' });
  f.state.beforeCommit = async () => { await f.library.register(changed); };
  await assert.rejects(f.library.register({ ...changed, name: 'Losing input' }), { code: 'IDEMPOTENCY_CONFLICT' });
  const current = await f.library.read(concurrent.id);
  assert.deepEqual(current.registrations.map(item => item.name), [input.name, changed.name]);
});

test('registration and recording concurrently preserve both metadata and actual evaluations', async t => {
  const f = await fixture(t), e = await f.makeEvidence();
  f.state.beforeCommit = async () => { await record(f, e); };
  const first = await f.library.register(registration());
  assert.deepEqual(first.evaluationIds, [e.evaluation.id]);
  assert.equal(first.registrations.length, 1);
  const other = await f.makeEvidence({ c: candidate('other', 'high') });
  f.state.beforeCommit = async () => { await f.library.register(registration({ operationId: 'other', formula: other.candidate.formula })); };
  const [second] = await record(f, other);
  assert.deepEqual(second.evaluationIds, [other.evaluation.id]);
  assert.equal(second.registrations.length, 1);
  assert.deepEqual((await f.library.evaluations(first.id)).items, [e.evaluation]);
  assert.deepEqual((await f.library.evaluations(second.id)).items, [other.evaluation]);
});

test('registration cancellation before or during commit leaves no factor or receipt', async t => {
  const f = await fixture(t), controller = new AbortController();
  f.state.beforeCommit = async () => controller.abort(Object.assign(new Error('Stopped'), { code: 'CANCELLED' }));
  await assert.rejects(f.library.register(registration(), controller.signal), { code: 'CANCELLED' });
  assert.equal(f.state.query({ collection: COLLECTIONS.factors }).items.length, 0);
  assert.equal(f.state.query({ collection: COLLECTIONS.feedback }).items.length, 0);
  await assert.rejects(f.library.register(registration(), controller.signal), { code: 'CANCELLED' });
  assert.equal(f.state.query({ collection: COLLECTIONS.feedback }).items.length, 0);
});

test('registration rejects invalid provenance, out-of-bounds metadata and invented metrics', async t => {
  const f = await fixture(t), invalidSources = [
    { ...source, url: 'http://example.org/factor' }, { ...source, url: 'not-a-url' },
    { ...source, url: 'https://user:password@example.org/factor' }, { ...source, url: 'https://user@example.org/factor' },
    { ...source, url: 'javascript:alert(1)' }, { ...source, url: `https://example.org/${'x'.repeat(2048)}` },
    { ...source, revision: '' }, { ...source, revision: 'r'.repeat(129) }, { ...source, license: 'l'.repeat(129) },
    { ...source, license: ' ' }, { ...source, metrics: { ic: 1 } },
  ];
  const invalid = [
    { operationId: '' }, { operationId: 'o'.repeat(129) }, { name: '' }, { name: 'n'.repeat(129) },
    { hypothesis: ' ' }, { hypothesis: 'h'.repeat(4001) }, { changes: '' }, { changes: 'c'.repeat(4001) },
    { sources: null }, { sources: Array(5).fill(source) }, ...invalidSources.map(item => ({ sources: [item] })),
    { metrics: { rankIC: 1 } }, { evaluationIds: ['invented'] }, { action: 'register' },
    { formula: { dsl: 'qlib-expr/1', tree: { call: 'Exec', args: [] } } },
    { formula: { dsl: 'qlib-expr/1', tree: { constant: 1 } } },
  ];
  for (const extras of invalid) await assert.rejects(f.library.register(registration(extras)), { code: 'INVALID_ARGUMENT' });
  assert.equal(f.state.query({ collection: COLLECTIONS.factors }).items.length, 0);
  assert.equal(f.state.query({ collection: COLLECTIONS.feedback }).items.length, 0);
});

test('registration accepts exact metadata bounds and original factors with no external source', async t => {
  const f = await fixture(t), prefix = 'https://example.org/';
  const sources = Array.from({ length: 4 }, (_, i) => ({ url: `${prefix}${'u'.repeat(2048 - prefix.length - 1)}${i}`, revision: 'r'.repeat(128), license: 'l'.repeat(128) }));
  const factor = await f.library.register(registration({ operationId: 'o'.repeat(128), name: 'n'.repeat(128), hypothesis: 'h'.repeat(4000), changes: 'c'.repeat(4000), sources }));
  assert.equal(factor.registrations[0].sources.length, 4);
  assert.equal(factor.registrations[0].name.length, 128);
  const original = await f.library.register(registration({ operationId: 'original', formula: candidate('volume', 'volume').formula, sources: [] }));
  assert.deepEqual(original.registrations[0].sources, []);
});

test('new query filters validate their bounds and retain all original evidence requirements', async t => {
  const f = await fixture(t), e = await f.makeEvidence();
  await f.library.register(registration());
  for (const input of [{ text: '' }, { text: ' ' }, { text: 'x'.repeat(257) }, { text: 1 }, { evaluated: 1 }, { evaluated: 'false' }]) {
    await assert.rejects(f.library.query(input), { code: 'INVALID_ARGUMENT' });
  }
  for (const input of [{ kind: 'alpha' }, { axis: 'time_series' }, { universe: ['A'] }, { frequency: '1h' }, { profileId: profile.id }, { minCoverage: 0 }, { evidenceMatch: e.evaluation.context }]) {
    assert.deepEqual((await f.library.query({ ...input, evaluated: false })).items, []);
  }
  assert.deepEqual((await f.library.query({ text: 'x'.repeat(256) })).items, []);
  const [measured] = await record(f, await f.makeEvidence({ c: candidate('high', 'high') }));
  assert.equal((await f.library.query({ evaluated: true })).items[0].id, measured.id);
  assert.deepEqual((await f.library.query({ evaluated: true, text: 'high' })).items, [], 'An unregistered formula has no registration name or hypothesis');
});

test('exact feedback lookup cannot read an evaluation under another factor', async t => {
  const f = await fixture(t), first = await f.makeEvidence(), second = await f.makeEvidence({ c: candidate('b', 'volume') });
  const [a] = await record(f, first), [b] = await record(f, second);
  assert.deepEqual(await f.library.evaluation(a.id, first.evaluation.id), first.evaluation);
  await assert.rejects(f.library.evaluation(b.id, first.evaluation.id), { code: 'NOT_FOUND' });
});

test('native attempt cancellation is forwarded to the state transaction', async t => {
  const f = await fixture(t), e = await f.makeEvidence(), controller = new AbortController();
  f.state.beforeCommit = async () => controller.abort(Object.assign(new Error('Stopped'), { code: 'CANCELLED' }));
  await assert.rejects(f.library.record([e.candidate], [e.evaluation], { ...fence, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(f.state.query({ collection: COLLECTIONS.factors }).items.length, 0);
});

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
