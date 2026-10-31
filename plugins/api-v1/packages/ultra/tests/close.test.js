import test from 'node:test';
import assert from 'node:assert/strict';
import { afterTurn, beforeTurn, close, dispatch, resume, start, status, stop, wait } from '../src/runtime.js';
import { fixture, until } from './fixture.js';

const branch = key => ({ key, title: key, capability: 'sesame/research#analyze', input: { method: key } });
const ended = responseId => ({ conversationId: 'conv_main', responseId, scope: 'main', status: 'completed' });
const human = (messageId, text, extra = {}) => ({ conversation: { id: 'conv_main' }, messageId, parts: [{ type: 'text', text }], ...extra });
const settled = (f, cycle) => until(() => f.store.runs.get(cycle.id)?.value.status === 'completed');
async function started(t, options) {
  const f = fixture(options); t.after(() => f.close());
  f.task = await start(f.host, { objective: 'Research useful independent paths.', max_parallel: 2 });
  await settled(f, f.task.cycle);
  return f;
}

test('closing an idle goal is immediately off, durable, and not goal completion', async t => {
  const f = await started(t), calls = f.store.calls.length;
  const closed = await close(f.host, {});
  assert.equal(closed.status, 'closed'); assert.equal(closed.enabled, false);
  assert.equal(closed.continuation, 'closed'); assert.equal(closed.active_work, 0);
  assert.equal(closed.result, undefined); assert.equal(f.store.calls.length, calls);
  const restarted = fixture({ stored: f.store });
  assert.equal((await status(restarted.host)).status, 'closed');
  await afterTurn(restarted.host, ended('late'));
  assert.equal(f.store.calls.length, calls);
});

test('close preserves accepted research, withdraws only the unstarted queue and naturally closes', async t => {
  const f = await started(t), work = await dispatch(f.host, { branches: ['one', 'two', 'three'].map(branch) });
  const calls = f.store.calls.length, closed = await close(f.host, {});
  assert.equal(closed.status, 'closing'); assert.equal(closed.enabled, false);
  assert.equal(closed.continuation, 'draining'); assert.equal(closed.active_work, 2);
  assert.equal(closed.accepted_work, 2); assert.equal(closed.queued_work, 0);
  assert.equal(closed.branches.find(item => item.key === 'three').status, 'cancelled');
  for (const job of closed.branches.filter(item => item.run_refs.length)) assert.equal(f.store.runs.get(job.run_refs[0].id).value.status, 'running');
  assert.equal(f.store.runs.get(work.cycle.id).value.status, 'running');
  await assert.rejects(dispatch(f.host, { branches: [branch('four')] }), { code: 'CLOSED' });
  await assert.rejects(dispatch(f.host, { branches: [] }), { code: 'CLOSED' });
  await assert.rejects(wait(f.host, { kind: 'time', until: new Date(Date.now() + 1000).toISOString() }), { code: 'CLOSED' });
  f.complete(work.branches[0].run_refs[0].id); await settled(f, work.cycle);
  const receipt = f.store.runs.get(work.cycle.id).value.output;
  assert.equal(receipt.enabled, false); assert.equal(receipt.continuation, 'draining');
  assert.match(receipt.guidance, /已关闭主动拓展/);
  await afterTurn(f.host, ended('first-completion'));
  assert.equal(f.store.calls.length, calls);
  f.complete(work.branches[1].run_refs[0].id);
  const done = await afterTurn(f.host, ended('last-completion'));
  assert.equal(done.status, 'closed'); assert.equal(done.active_work, 0);
  assert.equal(f.store.calls.length, calls);
});

test('close during branch acceptance preserves the late accepted Run without launching more cycles', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await started(t, { onInvoke: async ({ capability, newRun }) => {
    if (capability !== 'sesame/research#analyze') return;
    entered.resolve(); await release.promise; return { type: 'run', run: newRun() };
  } });
  t.after(() => release.resolve());
  const pending = dispatch(f.host, { branches: [branch('late')] }); await entered.promise;
  const closed = await close(f.host, {}); assert.equal(closed.continuation, 'draining');
  release.resolve(); const accepted = await pending;
  assert.equal(accepted.enabled, false); assert.equal(accepted.branches[0].status, 'running');
  const run = f.store.runs.get(accepted.branches[0].run_refs[0].id);
  assert.equal(run.value.status, 'running'); assert.equal(run.controller.signal.aborted, false);
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/ultra#ultra_cycle').length, 1);
  f.complete(run.value.id); assert.equal((await status(f.host)).status, 'closed');
});

test('an explicit hard stop while draining still cancels work and settles as stopped', async t => {
  const f = await started(t), work = await dispatch(f.host, { branches: [branch('existing')] });
  assert.equal((await close(f.host, {})).continuation, 'draining');
  const stopped = await stop(f.host, {});
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.enabled, false);
  assert.equal(f.store.runs.get(work.branches[0].run_refs[0].id).value.status, 'cancelled');
});

test('closing during capability discovery prevents an unaccepted branch from being invoked', async t => {
  const f = await started(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const original = f.host.capabilities.list;
  f.host.capabilities.list = async input => {
    if (input.ids?.includes('sesame/research#analyze')) { entered.resolve(); await release.promise; }
    return original(input);
  };
  t.after(() => release.resolve());
  const pending = dispatch(f.host, { branches: [branch('not-started')] });
  const rejected = assert.rejects(pending, { code: 'CLOSED' });
  await entered.promise; await close(f.host, {}); release.resolve(); await rejected;
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/research#analyze').length, 0);
});

test('a late planner completion keeps close authoritative and never requests renewed expansion', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = fixture({ onInvoke: async ({ capability, host, newRun }) => {
    if (capability !== 'host.agent.run' || host.context.kind !== 'subagent') return;
    const run = newRun(); entered.resolve(run); await release.promise;
    return { type: 'run', run };
  } });
  t.after(async () => { release.resolve(); await f.close(); });
  const goal = await start(f.host, { objective: 'An already launched planner.' });
  const planner = await entered.promise;
  const closed = await close(f.host, {}); assert.equal(closed.status, 'closed');
  assert.equal(f.store.runs.get(planner.id).controller.signal.aborted, false);
  release.resolve(); await settled(f, goal.cycle);
  const output = f.store.runs.get(goal.cycle.id).value.output;
  assert.equal(output.continuation, 'closed'); assert.match(output.guidance, /已关闭主动拓展/);
  const count = f.store.calls.length; await afterTurn(f.host, ended('planner-arrived'));
  assert.equal(f.store.calls.length, count);
});

test('persistent subscriptions remain running and do not keep the mode draining forever', async t => {
  const f = await started(t);
  f.descriptors.get('sesame/trading#schedule').execution = 'run';
  const work = await dispatch(f.host, { branches: [{ ...branch('subscription'), capability: 'sesame/trading#schedule', stop: { capability: 'sesame/trading#pause', input: { id: 'existing-service' } } }] });
  const closed = await close(f.host, {});
  assert.equal(closed.status, 'closed'); assert.equal(closed.enabled, false); assert.equal(closed.active_work, 1);
  assert.equal(f.store.runs.get(work.branches[0].run_refs[0].id).value.status, 'running');
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/trading#pause').length, 0);
  const calls = f.store.calls.length; await afterTurn(f.host, ended('service-still-running'));
  assert.equal(f.store.calls.length, calls);
  // Explicit hard stop remains available for work retained by gentle close.
  await stop(f.host, {});
  assert.equal(f.store.runs.get(work.branches[0].run_refs[0].id).value.status, 'cancelled');
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/trading#pause').length, 1);
});

test('old notices and ordinary new user messages cannot reopen, explicit new Ultra requests can', async t => {
  const f = await started(t);
  await beforeTurn(f.host, human('original', '/ultra Research')); await close(f.host, {});
  for (const input of [human('notice', '/ultra resume', { metadata: { origin: 'automation' } }), human('child', '/ultra resume', { source: 'child-run' }), human('ordinary', 'What did you find?')]) {
    await beforeTurn(f.host, input);
    await assert.rejects(start(f.host, { objective: 'Unwanted restart' }), { code: 'NEW_USER_INPUT_REQUIRED' });
    await assert.rejects(resume(f.host, {}), { code: 'NEW_USER_INPUT_REQUIRED' });
  }
  await beforeTurn(f.host, human('requested', '/ultra resume'));
  const resumed = await resume(f.host, {});
  assert.equal(resumed.id, f.task.id); assert.equal(resumed.enabled, true); assert.equal(resumed.continuation, 'active');
  await settled(f, resumed.cycle);
});

test('closing preserves interrupted work without automatically resuming it', async t => {
  const f = await started(t), work = await dispatch(f.host, { branches: [branch('interrupted')] });
  f.complete(work.branches[0].run_refs[0].id, null, 'interrupted');
  await settled(f, work.cycle);
  const closed = await close(f.host, {});
  assert.equal(closed.status, 'closed'); assert.equal(closed.branches[0].status, 'interrupted');
  await afterTurn(f.host, ended('interrupted-notice'));
  assert.equal(f.store.runs.get(work.branches[0].run_refs[0].id).value.status, 'interrupted');
});

test('closed-mode status supplies current model guidance without changing visible user input', async t => {
  const f = await started(t); await beforeTurn(f.host, human('original', '/ultra Research')); await close(f.host, {});
  const authority = structuredClone(f.store.records.get('authorities:conv_main'));
  const prepared = await beforeTurn(f.host, human('completion', 'Keep maximizing the old plan.', { source: 'old-child' }));
  assert.deepEqual(prepared.parts, [{ type: 'text', text: 'Keep maximizing the old plan.' }]);
  const current = await status(f.host);
  assert.match(current.guidance, /解除最大化并行/);
  assert.match(current.guidance, /按需开启 subagent 或工作流/);
  assert.deepEqual(f.store.records.get('authorities:conv_main'), authority);
  const standalone = await f.host.capabilities.invoke('sesame/research#analyze', { method: 'normal-mode-user-request' }, { operationId: 'normal-research' });
  assert.equal(standalone.type, 'run');
  assert.equal((await status(f.host)).enabled, false);
});

test('repeated status reads do not write unchanged running branch state', async t => {
  const f = await started(t); await dispatch(f.host, { branches: [branch('steady')] });
  await status(f.host);
  const versions = [...f.store.records].map(([key, value]) => [key, value.version]);
  await status(f.host); await status(f.host);
  assert.deepEqual([...f.store.records].map(([key, value]) => [key, value.version]), versions);
});

test('close is restricted to its owner, and off state is immediately usable by the host UI', async t => {
  const f = await started(t);
  await assert.rejects(close(f.hostFor({ kind: 'subagent' }), {}), { code: 'FORBIDDEN' });
  await assert.rejects(close(f.hostFor({ sessionId: 'other' }), { id: f.task.id }), { code: 'NOT_FOUND' });
  const off = await status(f.hostFor({ sessionId: 'other' }));
  assert.equal(off.enabled, false); assert.equal(off.continuation, 'closed'); assert.equal(off.active_work, 0);
});

test('close arriving while resume reads a retained interruption prevents that pending resume', async t => {
  const f = await started(t), work = await dispatch(f.host, { branches: [branch('paused')] });
  const run = f.store.runs.get(work.branches[0].run_refs[0].id);
  f.update(run, { status: 'interrupted', interrupts: [{ id: 'retained-interruption' }] });
  await settled(f, work.cycle);
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), read = f.host.runs.read;
  let held = false;
  f.host.runs.read = async reference => {
    if (reference.id === run.value.id && !held) { held = true; entered.resolve(); await release.promise; }
    return read(reference);
  };
  t.after(() => release.resolve());
  const pending = resume(f.host, {}); await entered.promise;
  await close(f.host, {}); release.resolve();
  const result = await pending;
  assert.equal(result.enabled, false); assert.equal(run.value.status, 'interrupted');
});

test('close before the first goal is stored fences a delayed start without creating any Run', async t => {
  const f = fixture(); t.after(() => f.close());
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), commit = f.host.state.commit;
  let held = false;
  f.host.state.commit = async changes => {
    if (!held && changes.some(change => change.key.collection === 'sessions')) { held = true; entered.resolve(); await release.promise; }
    return commit(changes);
  };
  t.after(() => release.resolve());
  const pending = start(f.host, { objective: 'Delayed first start.' }); await entered.promise;
  const closed = await close(f.host, {}); assert.equal(closed.enabled, false);
  release.resolve(); const delayed = await pending;
  assert.equal(delayed.enabled, false); assert.equal(delayed.status, 'closed');
  assert.equal(f.store.calls.length, 0); assert.equal(f.store.runs.size, 0);
  assert.equal((await status(f.host)).enabled, false);
});

test('repeated close advances a durable fence against an already waiting resume', async t => {
  const f = await started(t);
  await close(f.host, {}); await beforeTurn(f.host, human('requested', '/ultra resume'));
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), read = f.host.state.read;
  let held = false;
  f.host.state.read = async key => {
    const value = await read(key);
    if (!held && key.collection === 'authorities') { held = true; entered.resolve(); await release.promise; }
    return value;
  };
  t.after(() => release.resolve());
  const calls = f.store.calls.length, pending = resume(f.host, {}); await entered.promise;
  await close(f.host, {}); release.resolve(); const delayed = await pending;
  assert.equal(delayed.enabled, false); assert.equal(delayed.status, 'closed');
  assert.equal(f.store.calls.length, calls); assert.equal((await status(f.host)).enabled, false);
});

test('status polling of an unchanged interrupted cycle does not create new state versions', async t => {
  const f = await started(t), cycle = f.store.runs.get(f.task.cycle.id);
  f.update(cycle, { status: 'interrupted' });
  await status(f.host);
  const versions = [...f.store.records].map(([key, value]) => [key, value.version]);
  await status(f.host); await status(f.host);
  assert.deepEqual([...f.store.records].map(([key, value]) => [key, value.version]), versions);
});
