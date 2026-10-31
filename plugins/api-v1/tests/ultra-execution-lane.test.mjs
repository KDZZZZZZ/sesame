import test from 'node:test';
import assert from 'node:assert/strict';
import { start, status, dispatch, afterTurn, resume, finish } from '../packages/ultra/src/runtime.js';
import { fixture, until, fail } from '../packages/ultra/tests/fixture.js';

const branch = (key, capability = 'sesame/trading#submit') => ({ key, title: key, capability, input: { key } });
const settled = (f, result) => until(() => f.store.runs.get(result.cycle.id)?.value.status === 'completed');
async function started(t) {
  const f = fixture(); t.after(() => f.close());
  f.descriptors.set('fixture/process', { id: 'fixture/process', revision: '1', effects: ['process.exec'], execution: 'run' });
  const task = await start(f.host, { objective: 'Run authorized actions without overlapping uncertain outcomes.', max_parallel: 3 });
  await settled(f, task); return f;
}

for (const capability of ['sesame/trading#submit', 'fixture/process']) {
  for (const outcome of ['unknown', 'interrupted']) {
    test(`${capability} keeps its lane across restart while ${outcome}, until its original Run is reconciled`, async t => {
      const f = await started(t);
      const initial = await dispatch(f.host, { branches: [branch('first', capability), branch('second', capability), branch('research', 'sesame/research#analyze')] });
      const original = initial.branches.find(item => item.key === 'first').run_refs[0];
      f.complete(original.id, null, outcome); await settled(f, initial);
      const restarted = fixture({ stored: f.store });
      restarted.descriptors.set('fixture/process', f.descriptors.get('fixture/process'));
      const blocked = await dispatch(restarted.host, { branches: [] });
      assert.equal(blocked.branches.find(item => item.key === 'first').status, outcome);
      assert.equal(blocked.branches.find(item => item.key === 'second').status, 'queued');
      assert.equal(blocked.branches.find(item => item.key === 'research').status, 'running');
      assert.equal(f.store.calls.filter(call => call.capability === capability).length, 1);
      f.complete(blocked.branches.find(item => item.key === 'research').run_refs[0].id); await settled(f, blocked);
      f.complete(original.id, { reconciled: true });
      const next = await dispatch(restarted.host, { branches: [] });
      assert.equal(next.branches.find(item => item.key === 'first').status, 'completed');
      assert.equal(next.branches.find(item => item.key === 'first').run_refs[0].id, original.id);
      assert.equal(next.branches.find(item => item.key === 'second').status, 'running');
      assert.equal(f.store.calls.filter(call => call.capability === capability && call.input.key === 'first').length, 1);
    });
  }
}

test('automatic continuation cannot drain queued execution past an unknown original action', async t => {
  const f = await started(t);
  const initial = await dispatch(f.host, { branches: [branch('first'), branch('second')] });
  const original = initial.branches[0].run_refs[0];
  f.complete(original.id, null, 'unknown'); await settled(f, initial);
  const observed = await afterTurn(f.host, { conversationId: 'conv_main', responseId: 'response-unknown', scope: 'main', status: 'completed' });
  assert.equal(observed.status, 'interrupted'); assert.equal(observed.error.code, 'RECONCILE_REQUIRED');
  assert.equal(observed.branches.find(item => item.key === 'second').status, 'queued');
  await assert.rejects(resume(f.host, {}), { code: 'RECONCILE_REQUIRED' });
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/trading#submit').length, 1);
  f.complete(original.id, { reconciled: true });
  const resumed = await resume(f.host, {}); await settled(f, resumed);
  const next = await dispatch(f.host, { branches: [] });
  assert.equal(next.branches.find(item => item.key === 'second').status, 'running');
});

for (const aborted of [false, true]) test(`a lost admission response (${aborted ? 'aborted' : 'transport failure'}) cannot release the lane or be replayed`, async t => {
  const controller = new AbortController();
  const f = fixture({ onInvoke: async ({ capability, newRun, options, store }) => {
    if (capability === 'sesame/trading#submit') {
      const accepted = { type: 'run', run: newRun() };
      store.operations.set(`${capability}:${options.operationId}`, accepted);
      if (aborted) controller.abort();
      throw fail('TRANSPORT_LOST');
    }
  } });
  t.after(() => f.close());
  const task = await start(f.host, { objective: 'Retain the uncertain original operation.', max_parallel: 2 });
  await settled(f, task);
  const initial = await dispatch(f.host, { branches: [branch('first'), branch('second')] }, controller.signal);
  assert.equal(initial.branches.find(item => item.key === 'first').status, 'unknown');
  assert.deepEqual(initial.branches.find(item => item.key === 'first').run_refs, []);
  await assert.rejects(resume(f.host, {}), { code: 'RECONCILE_REQUIRED' });
  const next = await dispatch(f.host, { branches: [] });
  assert.equal(next.branches.find(item => item.key === 'second').status, 'queued');
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/trading#submit').length, 1);
  assert.equal([...f.store.runs.values()].filter(run => run.capability === 'sesame/trading#submit' && run.value.status === 'running').length, 1);
});

test('an unknown action cannot be hidden by finishing a goal with other completed evidence', async t => {
  const f = await started(t);
  const initial = await dispatch(f.host, { branches: [branch('first'), branch('research', 'sesame/research#analyze')] });
  const original = initial.branches.find(item => item.key === 'first').run_refs[0];
  f.complete(original.id, null, 'unknown');
  f.complete(initial.branches.find(item => item.key === 'research').run_refs[0].id);
  await settled(f, initial);
  await assert.rejects(finish(f.host, { summary: 'Research completed.', evidence: ['research'] }), { code: 'WORK_REMAINS' });
  assert.notEqual((await status(f.host, {})).status, 'completed');
  f.complete(original.id, { reconciled: true });
  assert.equal((await finish(f.host, { summary: 'Both original actions completed.', evidence: [original.id] })).status, 'completed');
});
