import assert from 'node:assert/strict';
import test from 'node:test';
import { createExecution } from '../execution.js';
import { createBudgets } from '../budgets.js';
import { budget, deferred, executionFixture } from './execution-fixture.js';

test('one direct operation calls only its work and completed repetition returns the fixed result', async t => {
  const f = await executionFixture(t), input = { requestId: 'compute', budget }, native = f.native(); let calls = 0;
  const work = async ctx => { calls++; assert.equal(ctx.nativeAttempt, 1); await f.journal.assertActive(ctx); return { valuesId: 'fixed' }; };
  assert.deepEqual(await f.execution.execute('compute', input, native.signal, native, work), { valuesId: 'fixed' });
  const again = f.native('native-2');
  assert.deepEqual(await createExecution(f.ports).execute('compute', input, again.signal, again, work), { valuesId: 'fixed' });
  assert.equal(calls, 1); assert.equal((await f.journal.find('compute')).status, 'completed');
  await assert.rejects(f.execution.execute('evaluate', input, again.signal, again, work), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('independent active duplicate calls reject instead of sharing or starting work', async t => {
  const f = await executionFixture(t), input = { requestId: 'active', budget }, entered = deferred(), release = deferred();
  const first = f.native(), running = f.execution.execute('compute', input, first.signal, first, async () => { entered.resolve(); await release.promise; return {}; });
  await entered.promise; const second = f.native('native-2');
  await assert.rejects(createExecution(f.ports).execute('compute', input, second.signal, second, () => assert.fail('duplicate work')), { code: 'OPERATION_ACTIVE' });
  release.resolve(); await running;
});

test('explicit same-request new-Run recovery preserves the ledger and excludes paused time', async t => {
  const f = await executionFixture(t), input = { requestId: 'recover', budget: { ...budget, maxSeconds: 3 } };
  const first = f.native('old', 1, Date.now() - 101000), entered = deferred(), release = deferred(); let context;
  // First invocation starts now; historical timestamps are installed after admission.
  f.history.set('old', []); f.addEvent('old', 'running');
  const work = f.execution.execute('compute', input, first.signal, first, async ctx => { context = ctx; await f.journal.entry(ctx.jobId, 'process', 'retained', () => ({ receipt: 'immutable' })); entered.resolve(); await release.promise; ctx.signal.throwIfAborted(); });
  const rejected = assert.rejects(work, { code: 'RUN_INTERRUPTED' }); await entered.promise;
  f.history.set('old', []); f.addEvent('old', 'running', Date.now() - 101000); f.addEvent('old', 'interrupted', Date.now() - 100000);
  first.controller.abort(Object.assign(Error('native pause'), { code: 'RUN_INTERRUPTED' })); release.resolve(); await rejected;
  const resumed = f.native('new');
  const result = await createExecution(f.ports).execute('compute', input, resumed.signal, resumed, async ctx => {
    assert.equal(ctx.jobId, context.jobId); assert.equal(ctx.nativeAttempt, 2); assert.equal(ctx.epoch, 2);
    assert.equal((await f.journal.readEntry(ctx.jobId, 'process', 'retained')).receipt, 'immutable');
    return { recovered: true };
  });
  assert.deepEqual(result, { recovered: true });
  const saved = await f.journal.find('recover'); assert.ok(saved.activeMs >= 1000 && saved.activeMs < 3000, String(saved.activeMs));
});

test('native cancellation during a result commit cannot publish a completed operation', async t => {
  const f = await executionFixture(t), native = f.native(); let operation;
  await assert.rejects(f.execution.execute('compute', { requestId: 'cancel', budget }, native.signal, native, async ctx => {
    operation = ctx.jobId;
    f.state.beforeCommit = async () => native.controller.abort(Object.assign(Error('native cancellation'), { code: 'CANCELLED' }));
    return { valuesId: 'late' };
  }), { code: 'CANCELLED' });
  assert.notEqual((await f.journal.get(operation)).status, 'completed');
});

test('byte consumption remains cumulative across explicit retries', async t => {
  const f = await executionFixture(t), limits = { ...budget, maxInputBytes: 3000 }, input = { requestId: 'budget', budget: limits }, budgets = createBudgets(f.journal), native = f.native();
  await assert.rejects(f.execution.execute('compute', input, native.signal, native, async ctx => {
    await budgets.reserve(ctx, 'first', 2000); await budgets.settle(ctx, 'first', { input: 1800, output: 100 });
    throw Object.assign(Error('worker failed'), { code: 'WORKER_FAILED' });
  }), { code: 'WORKER_FAILED' });
  f.addEvent('native-1', 'interrupted'); const next = f.native('native-2');
  await assert.rejects(f.execution.execute('compute', input, next.signal, next, async ctx => budgets.reserve(ctx, 'second', 1500)), { code: 'BUDGET_EXHAUSTED' });
  assert.equal((await f.journal.find('budget')).byteUsage.input, 1800);
});

test('safe same-Run native resume continues, but an interrupted child requires a new Run', async t => {
  for (const child of [false, true]) {
    const f = await executionFixture(t), input = { requestId: 'safe', budget }, first = f.native();
    await assert.rejects(f.execution.execute('compute', input, first.signal, first, async ctx => {
      if (child) {
        f.nativeRuns.set('process', { id: 'process', status: 'interrupted' });
        await f.journal.entry(ctx.jobId, 'process', 'child', () => ({ runId: 'process' }));
      }
      first.interrupt({ reason: 'explicit safe checkpoint' });
    }), { code: 'RUN_INTERRUPTED' });
    const resumed = f.native('native-1', 2);
    if (child) await assert.rejects(f.execution.execute('compute', input, resumed.signal, resumed, () => assert.fail('stopped child must not replay in place')), { code: 'EXPLICIT_RETRY_REQUIRED' });
    else assert.deepEqual(await f.execution.execute('compute', input, resumed.signal, resumed, async ctx => ({ attempt: ctx.nativeAttempt })), { attempt: 2 });
  }
});

test('active duration reads every event page and excludes long paused intervals', async t => {
  const f = await executionFixture(t), input = { requestId: 'history', budget: { ...budget, maxSeconds: 3 } }, first = f.native();
  await assert.rejects(f.execution.execute('compute', input, first.signal, first, async () => { throw Object.assign(Error('pause'), { code: 'RUN_INTERRUPTED' }); }));
  const now = Date.now(); f.history.set(first.run.id, []);
  f.addEvent(first.run.id, 'running', now - 100000);
  for (let i = 0; i < 205; i++) f.addEvent(first.run.id, 'running', now - 99990 + i, 'progress');
  f.addEvent(first.run.id, 'interrupted', now - 99000);
  const next = f.native('native-2');
  await f.execution.execute('compute', input, next.signal, next, async () => ({ done: true }));
  const saved = await f.journal.find(input.requestId); assert.ok(saved.activeMs >= 1000 && saved.activeMs < 3000, String(saved.activeMs));
});

test('ordinary errors and timeouts interrupt and close timing intervals once across retries', async t => {
  const f = await executionFixture(t), input = { requestId: 'failures', budget: { ...budget, maxSeconds: 4 } };
  for (let index = 0; index < 2; index++) {
    const native = f.native(`failure-${index}`);
    await assert.rejects(f.execution.execute('compute', input, native.signal, native, async () => { throw Object.assign(Error(index ? 'process timeout' : 'ordinary error'), { code: index ? 'TIMEOUT' : 'WORKER_FAILED' }); }));
    const now = Date.now(); f.history.set(native.run.id, []); f.addEvent(native.run.id, 'running', now - 101000); f.addEvent(native.run.id, 'interrupted', now - 100000);
  }
  const final = f.native('success'); await f.execution.execute('compute', input, final.signal, final, async () => ({ done: true }));
  const saved = await f.journal.find(input.requestId); assert.equal(saved.nativeAttempt, 3); assert.ok(saved.activeMs >= 2000 && saved.activeMs < 3000, String(saved.activeMs));
});

test('an already-expired first attempt is recorded and a retry cannot reset its time budget', async t => {
  const f = await executionFixture(t), input = { requestId: 'expired', budget: { ...budget, maxSeconds: 1 } }, old = f.native('expired-run', 1, Date.now() - 2000);
  await assert.rejects(f.execution.execute('compute', input, old.signal, old, () => assert.fail('expired operation must not start')), { code: 'BUDGET_EXHAUSTED' });
  f.addEvent(old.run.id, 'interrupted'); const next = f.native('retry');
  await assert.rejects(f.execution.execute('compute', input, next.signal, next, () => assert.fail('retry must retain elapsed time')), { code: 'BUDGET_EXHAUSTED' });
  assert.ok((await f.journal.find(input.requestId)).activeMs >= 2000);
});
