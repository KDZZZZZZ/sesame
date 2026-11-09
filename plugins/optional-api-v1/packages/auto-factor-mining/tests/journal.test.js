import test from 'node:test';
import assert from 'node:assert/strict';
import { createJournal, publicJob, updateState } from '../journal.js';
import { createArtifacts } from '../artifacts.js';
import { COLLECTIONS } from '../contracts.js';
import { storageFixture } from './storage-fixture.js';

const input = { requestId: 'request', budget: { maxSeconds: 60 } };
async function fixture(t) { const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host }), journal = createJournal({ state: f.state, artifacts, ownerSessionId: 'session' }); return { ...f, artifacts, journal }; }

test('same request is idempotent and altered input/type conflicts', async t => {
  const f = await fixture(t), job = await f.journal.create('measure', input);
  assert.deepEqual(await f.journal.create('measure', input), job);
  await assert.rejects(f.journal.create('research', input), e => e.code === 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(f.journal.create('measure', { ...input, budget: { maxSeconds: 61 } }), e => e.code === 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(Object.keys(publicJob(job)).sort(), ['completed', 'epoch', 'error', 'id', 'proposed', 'report', 'runId', 'status']);
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
  f.state.beforeCommit = async () => { await f.journal.update(job.id, value => ({ ...value, proposed: 4 })); };
  const value = await f.journal.update(job.id, current => ({ ...current, completed: current.completed + 1 }));
  assert.equal(value.proposed, 4); assert.equal(value.completed, 1);
});

test('journal entries accept asynchronous transforms and page stable identities', async t => {
  const f = await fixture(t), job = await f.journal.create('measure', input);
  for (let i = 0; i < 4; i++) await f.journal.entry(job.id, 'candidate', String(i), async () => ({ candidateId: `c-${i}` }));
  const a = await f.journal.page(job.id, 'candidate', undefined, 2), b = await f.journal.page(job.id, 'candidate', a.cursor, 2);
  assert.equal(a.items.length + b.items.length, 4);
  assert.ok(a.items.every(item => typeof item.candidateId === 'string'));
  assert.equal((await f.journal.all(job.id, 'candidate')).length, 4);
});

test('active fence rejects cancelled/stale/expired jobs and allows a safe pausing boundary', async t => {
  const f = await fixture(t), job = await f.journal.create('measure', input), ctx = { jobId: job.id, epoch: 1 };
  await assert.rejects(f.journal.assertActive(ctx), e => e.code === 'CANCELLED');
  await f.journal.update(job.id, value => ({ ...value, status: 'running' }));
  assert.equal((await f.journal.assertActive(ctx)).id, job.id);
  await f.journal.update(job.id, value => ({ ...value, status: 'pausing' }));
  await f.journal.assertActive(ctx); await assert.rejects(f.journal.assertActive(ctx, false), e => e.code === 'CANCELLED');
  await f.journal.update(job.id, value => ({ ...value, status: 'running', activeMs: 60000 }));
  await assert.rejects(f.journal.assertActive(ctx), e => e.code === 'BUDGET_EXHAUSTED');
  await f.journal.update(job.id, value => ({ ...value, status: 'cancelled', epoch: 2 }));
  await assert.rejects(f.journal.assertActive(ctx), e => e.code === 'CANCELLED');
});

test('oversized records and cancellation during transform cannot commit', async t => {
  const f = await fixture(t);
  await assert.rejects(updateState(f.state, COLLECTIONS.trials, 'large', () => ({ content: 'x'.repeat(256 * 1024) })), e => e.code === 'RESOURCE_EXHAUSTED');
  const controller = new AbortController();
  await assert.rejects(updateState(f.state, COLLECTIONS.trials, 'aborted', async () => { controller.abort(); return {}; }, controller.signal), e => e.name === 'AbortError');
  assert.equal(f.state.query({ collection: COLLECTIONS.trials }).items.length, 0);
});
