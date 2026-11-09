import test from 'node:test';
import assert from 'node:assert/strict';
import { createJournal, updateState } from '../journal.js';
import { createArtifacts } from '../artifacts.js';
import { COLLECTIONS } from '../contracts.js';
import { storageFixture } from './storage-fixture.js';

const input = { requestId: 'request', budget: { maxSeconds: 60 } };
async function fixture(t) { const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), journal = createJournal({ state: f.state, artifacts, ownerSessionId: 'session' }); return { ...f, artifacts, journal }; }

test('same request is idempotent and altered input/type conflicts', async t => {
  const f = await fixture(t), job = await f.journal.create('compute', input);
  assert.deepEqual(await f.journal.create('compute', input), job);
  await assert.rejects(f.journal.create('evaluate', input), e => e.code === 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(f.journal.create('compute', { ...input, budget: { maxSeconds: 61 } }), e => e.code === 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(await f.journal.find(input.requestId), job);
  assert.equal(await f.journal.find('missing'), null);
  assert.equal('selection' in job || 'report' in job || 'searchCheckpoint' in job, false);
});

test('concurrent identical admission tolerates differing creation timestamps', async t => {
  const f = await fixture(t); let concurrent;
  f.state.beforeCommit = async () => { await new Promise(resolve => setTimeout(resolve, 5)); concurrent = await f.journal.create('measure', input); };
  const admitted = await f.journal.create('measure', input);
  assert.deepEqual(admitted, concurrent);
  assert.equal(f.state.query({ collection: COLLECTIONS.jobs }).items.length, 1);
});

test('state update retries after asynchronous CAS conflict and preserves other writer', async t => {
  const f = await fixture(t), job = await f.journal.create('measure', input);
  f.state.beforeCommit = async () => { await f.journal.update(job.id, value => ({ ...value, activeMs: 4 })); };
  const value = await f.journal.update(job.id, current => ({ ...current, nativeAttempt: current.nativeAttempt + 1 }));
  assert.equal(value.activeMs, 4); assert.equal(value.nativeAttempt, 1);
});

test('journal entries accept asynchronous transforms and page stable identities', async t => {
  const f = await fixture(t), job = await f.journal.create('measure', input);
  for (let i = 0; i < 4; i++) await f.journal.entry(job.id, 'candidate', String(i), async () => ({ candidateId: `c-${i}` }));
  const a = await f.journal.page(job.id, 'candidate', undefined, 2), b = await f.journal.page(job.id, 'candidate', a.cursor, 2);
  assert.equal(a.items.length + b.items.length, 4);
  assert.ok(a.items.every(item => typeof item.candidateId === 'string'));
  assert.equal((await f.journal.all(job.id, 'candidate')).length, 4);
});

test('active fence rejects cancelled, stale, stopped and expired operations', async t => {
  const f = await fixture(t), job = await f.journal.create('measure', input), ctx = { jobId: job.id, epoch: 1 };
  await assert.rejects(f.journal.assertActive(ctx), e => e.code === 'CANCELLED');
  await f.journal.update(job.id, value => ({ ...value, status: 'running' }));
  assert.equal((await f.journal.assertActive(ctx)).id, job.id);
  await assert.rejects(f.journal.assertActive({ ...ctx, epoch: 2 }), e => e.code === 'CANCELLED');
  await f.journal.update(job.id, value => ({ ...value, status: 'interrupted' }));
  await assert.rejects(f.journal.assertActive(ctx), e => e.code === 'CANCELLED');
  await f.journal.update(job.id, value => ({ ...value, status: 'running', activeMs: 60000 }));
  await assert.rejects(f.journal.assertActive(ctx), e => e.code === 'BUDGET_EXHAUSTED');
  await f.journal.update(job.id, value => ({ ...value, status: 'cancelled', epoch: 2 }));
  await assert.rejects(f.journal.assertActive(ctx), e => e.code === 'CANCELLED');
});

test('search sessions are CAS-managed separately from native operation records', async t => {
  const f = await fixture(t), initial = { pending: null, checkpoint: null, attempted: 0 };
  const first = await f.journal.createSearch({ requestId: 'search', need: 'first' }, initial);
  assert.deepEqual(await f.journal.createSearch({ requestId: 'search', need: 'first' }, initial), first);
  await assert.rejects(f.journal.createSearch({ requestId: 'search', need: 'different' }, initial), { code: 'IDEMPOTENCY_CONFLICT' });
  await f.journal.updateSearch(first.id, current => ({ ...current, attempted: 2 }));
  assert.equal((await f.journal.getSearch(first.id)).attempted, 2);
  assert.equal(f.state.query({ collection: COLLECTIONS.jobs }).items.length, 0);
});

test('oversized records and cancellation during transform cannot commit', async t => {
  const f = await fixture(t);
  await assert.rejects(updateState(f.state, COLLECTIONS.trials, 'large', () => ({ content: 'x'.repeat(256 * 1024) })), e => e.code === 'RESOURCE_EXHAUSTED');
  const controller = new AbortController();
  await assert.rejects(updateState(f.state, COLLECTIONS.trials, 'aborted', async () => { controller.abort(); return {}; }, controller.signal), e => e.name === 'AbortError');
  assert.equal(f.state.query({ collection: COLLECTIONS.trials }).items.length, 0);
});
