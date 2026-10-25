import test from 'node:test';
import assert from 'node:assert/strict';
import { afterTurn, beforeTurn, start, status, dispatch, stop, wait, finish } from '../src/runtime.js';
import { fixture, until } from './fixture.js';

const ended = (responseId = 'response-1', extra = {}) => ({ conversationId: 'conv_main', responseId, scope: 'main', status: 'completed', ...extra });
const work = key => ({ key, title: key, capability: 'sesame/research#analyze', input: { method: key } });
async function started(t) {
  const f = fixture(); t.after(() => f.close());
  f.task = await start(f.host, { objective: 'Validate useful alternatives until the goal is met.', max_parallel: 2 });
  await settled(f, f.task);
  return f;
}
const settled = (f, task) => until(() => f.store.runs.get(task.cycle.id)?.value.status === 'completed');
const planners = f => f.store.calls.filter(call => call.capability === 'host.agent.run');

test('a completed main turn with a pending goal launches a real new exploration using prior outcomes', async t => {
  const f = await started(t);
  const branch = await dispatch(f.host, { branches: [work('initial-data')] });
  f.complete(branch.branches[0].run_refs[0].id, { text: 'Observed a market regime; validate a second source.' });
  await settled(f, branch);
  const next = await afterTurn(f.host, ended());
  assert.notEqual(next.cycle.id, branch.cycle.id);
  await settled(f, next);
  const request = planners(f).at(-1).input;
  assert.equal(request.input.progress.branches[0].key, 'initial-data');
  assert.match(JSON.stringify(request.input.progress), /Observed a market regime/);
  assert.match(request.instructions, /新路径|新方法/);
  assert.equal(planners(f).length, 2);
});

test('completed turns fill executable queued branches before planning again', async t => {
  const f = await started(t);
  const running = await dispatch(f.host, { branches: [work('one'), work('two'), work('three')] });
  f.complete(running.branches[0].run_refs[0].id);
  await settled(f, running);
  const next = await afterTurn(f.host, ended());
  assert.equal(next.branches.find(branch => branch.key === 'three').status, 'running');
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/research#analyze').length, 3);
  assert.equal(planners(f).length, 1);
  assert.equal(f.store.runs.get(next.cycle.id).value.status, 'running');
});

test('an after-turn hook admits only one immediate batch before registering a real continuation', async t => {
  const f = await started(t);
  const running = await dispatch(f.host, { branches: [work('one'), work('two'), work('three'), work('four'), work('five')] });
  for (const branch of running.branches.filter(item => item.status === 'running')) f.complete(branch.run_refs[0].id);
  await settled(f, running);
  f.descriptors.get('sesame/research#analyze').execution = 'immediate';
  const next = await afterTurn(f.host, ended()); await settled(f, next);
  assert.equal(next.branches.filter(branch => branch.status === 'queued').length, 1);
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/research#analyze').length, 4);
  assert.equal(planners(f).length, 2);
});

test('an already active cycle is not duplicated by repeated completed main turns', async t => {
  const f = await started(t);
  const waiting = await wait(f.host, { kind: 'time', until: new Date(Date.now() + 60000).toISOString() });
  const calls = f.store.calls.length;
  await Promise.all([afterTurn(f.host, ended()), afterTurn(f.host, ended('response-2'))]);
  assert.equal(f.store.calls.length, calls);
  assert.equal((await status(f.host, {})).cycle.id, waiting.cycle.id);
});

test('queued notifications and active replies suppress fallback until the real main queue is idle', async t => {
  const f = await started(t), calls = f.store.calls.length;
  for (const current of [{ status: 'queued', activeResponseId: 'queued-completion' }, { status: 'working', activeResponseId: 'streaming-response' }, { status: 'idle', activeResponseId: 'pending-response' }]) {
    f.store.sessionStatus = current;
    await afterTurn(f.host, ended(`prior-steered-${current.status}-${current.activeResponseId}`));
    assert.equal(f.store.calls.length, calls);
  }
  f.store.sessionStatus = { status: 'idle', activeResponseId: null };
  const next = await afterTurn(f.host, ended('actual-final-response')); await settled(f, next);
  assert.equal(planners(f).length, 2);
});

test('explicit missing-input waits and canceled/interrupted or foreign turns never auto-continue', async t => {
  const f = await started(t), calls = f.store.calls.length;
  for (const input of [ended('child', { scope: 'subagent' }), ended('other', { conversationId: 'conv_other' }), ended('cancel', { status: 'canceled' }), ended('interrupt', { status: 'interrupted' })]) await afterTurn(f.host, input);
  await afterTurn(f.hostFor({ kind: 'subagent' }), ended());
  assert.equal(f.store.calls.length, calls);
  await wait(f.host, { kind: 'input', reason: 'A specific private dataset remains unavailable after trying all configured sources.' });
  await afterTurn(f.host, ended('waiting'));
  assert.equal(f.store.calls.length, calls);
  assert.equal((await status(f.host, {})).status, 'waiting-input');
});

test('stopped and verified completed goals stay ended after main callbacks', async t => {
  const f = await started(t);
  await stop(f.host, {});
  const calls = f.store.calls.length;
  await afterTurn(f.host, ended());
  assert.equal(f.store.calls.length, calls);
  await beforeTurn(f.host, { conversation: { id: 'conv_main' }, messageId: 'new-user', parts: [] });
  const fresh = await start(f.host, { objective: 'A new separately authorized goal.' }); await settled(f, fresh);
  const branch = await dispatch(f.host, { branches: [work('done')] });
  f.complete(branch.branches[0].run_refs[0].id); await settled(f, branch);
  await finish(f.host, { summary: 'Verified actual result meets the objective.', evidence: ['actual result'] });
  const finishedCalls = f.store.calls.length;
  await afterTurn(f.host, ended('completed'));
  assert.equal(f.store.calls.length, finishedCalls);
  assert.equal((await status(f.host, {})).status, 'completed');
});

test('an unchanged plan cannot create an empty planning loop across responses or runtime instances', async t => {
  const f = await started(t), continued = await afterTurn(f.host, ended());
  await settled(f, continued);
  const calls = f.store.calls.length;
  await afterTurn(f.host, ended()); // Duplicate lifecycle callback, not another failure.
  assert.equal((await status(f.host, {})).status, 'ready');
  const restarted = fixture({ stored: f.store });
  await afterTurn(restarted.host, ended('response-2'));
  const current = await status(f.host, {});
  assert.equal(current.status, 'interrupted');
  assert.equal(current.error.code, 'CONTINUATION_STALLED');
  await afterTurn(restarted.host, ended('response-3'));
  assert.equal(f.store.calls.length, calls);
});

test('new executable methods recover a stalled scheduler and useful exploration has no fixed round limit', async t => {
  const f = await started(t);
  const continued = await afterTurn(f.host, ended()); await settled(f, continued);
  await afterTurn(f.host, ended('omitted-plan'));
  for (let round = 0; round < 4; round++) {
    const branch = await dispatch(f.host, { branches: [work(`method-${round}`)] });
    f.complete(branch.branches.at(-1).run_refs[0].id, { text: `New validation evidence ${round}` }); await settled(f, branch);
    const next = await afterTurn(f.host, ended(`validated-${round}`)); await settled(f, next);
    assert.equal((await status(f.host, {})).status, 'ready');
  }
  assert.equal(planners(f).length, 6);
});

test('a changed capability dependency permits a fresh exploration without repeating the old failure', async t => {
  const f = await started(t), continued = await afterTurn(f.host, ended()); await settled(f, continued);
  await afterTurn(f.host, ended('omitted-plan'));
  f.descriptors.get('sesame/research#analyze').revision = 'fixture:2';
  const next = await afterTurn(f.host, ended('dependency-changed')); await settled(f, next);
  assert.equal(planners(f).length, 3);
  assert.equal((await status(f.host, {})).status, 'ready');
});

test('a real new observation permits exploration while an interrupted workflow is retained', async t => {
  const f = await started(t), continued = await afterTurn(f.host, ended()); await settled(f, continued);
  await afterTurn(f.host, ended('omitted-plan'));
  const observation = await wait(f.host, { kind: 'event', source: { providerId: 'fixture#quotes', revision: '1' }, operation: 'subscribe', input: { symbol: 'TEST' } });
  await settled(f, observation);
  const next = await afterTurn(f.host, ended('new-data')); await settled(f, next);
  assert.equal(planners(f).length, 3);
  assert.equal(planners(f).at(-1).input.input.observation.event.price, 2);
  const calls = f.store.calls.length;
  f.update(f.store.runs.get(next.cycle.id), { status: 'interrupted' });
  await afterTurn(f.host, ended('dependency-interrupted'));
  assert.equal(f.store.calls.length, calls);
  assert.equal((await status(f.host, {})).error.code, 'RUN_INTERRUPTED');
});
