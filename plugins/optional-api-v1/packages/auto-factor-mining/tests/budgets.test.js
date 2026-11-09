import test from 'node:test';
import assert from 'node:assert/strict';
import { storageFixture } from './storage-fixture.js';
import { createArtifacts } from '../artifacts.js';
import { createJournal } from '../journal.js';
import { createBudgets } from '../budgets.js';

async function fixture(t) {
  const f = await storageFixture(t), journal = createJournal({ state: f.state, artifacts: createArtifacts({ host: f.host }), ownerSessionId: 'budget' });
  const job = await journal.create('research', { requestId: 'bounded', budget: { maxInputBytes: 5000, maxOutputBytes: 6000, maxWorkers: 2, maxSeconds: 180 } });
  await journal.update(job.id, value => ({ ...value, status: 'running' }));
  return { journal, budgets: createBudgets(journal), ctx: { jobId: job.id, epoch: 1 } };
}

test('parallel worker reservations cannot each claim the complete job byte budget', async t => {
  const { budgets, journal, ctx } = await fixture(t);
  const result = await Promise.allSettled([budgets.reserve(ctx, 'a', 3000), budgets.reserve(ctx, 'b', 3000)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.code, 'BUDGET_EXHAUSTED');
  const usage = (await journal.get(ctx.jobId)).byteUsage; assert.equal(Object.keys(usage.active).length, 1);
  const token = Object.keys(usage.active)[0];
  await budgets.settle(ctx, token, { input: 2800, output: 1700 });
  assert.deepEqual(await budgets.available(ctx.jobId), { maxInputBytes: 2200, maxOutputBytes: 4300 });
  await assert.rejects(budgets.reserve(ctx, 'next', 2500), { code: 'BUDGET_EXHAUSTED' });
});

test('completed reservation settlement is idempotent and unused bytes return to the job', async t => {
  const { budgets, journal, ctx } = await fixture(t);
  assert.deepEqual(await budgets.reserve(ctx, 'a', 1800), { input: 1800, output: 3000 });
  assert.deepEqual(await budgets.reserve(ctx, 'a', 1800), { input: 1800, output: 3000 });
  await budgets.settle(ctx, 'a', { input: 1500, output: 200 });
  await budgets.settle(ctx, 'a', { input: 1500, output: 200 });
  assert.deepEqual((await journal.get(ctx.jobId)).byteUsage, { input: 1500, output: 200, active: {} });
});

test('oversized worker receipts consume their observed bytes and stop the job budget', async t => {
  const { budgets, journal, ctx } = await fixture(t);
  await budgets.reserve(ctx, 'a', 2000);
  await assert.rejects(budgets.settle(ctx, 'a', { input: 2000, output: 7000 }), { code: 'BUDGET_EXHAUSTED' });
  assert.equal((await journal.get(ctx.jobId)).byteUsage.output, 7000);
  await assert.rejects(budgets.reserve(ctx, 'b', 100), { code: 'BUDGET_EXHAUSTED' });
});

test('cancelled epochs cannot reserve any additional process', async t => {
  const { budgets, journal, ctx } = await fixture(t);
  await journal.update(ctx.jobId, job => ({ ...job, status: 'cancelled', epoch: 2 }));
  await assert.rejects(budgets.reserve(ctx, 'a', 100), { code: 'CANCELLED' });
});
