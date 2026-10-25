import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { start, status, dispatch, wait, stop, resume, finish, beforeTurn } from '../src/runtime.js';
import { fixture, until, fail } from './fixture.js';

const research = (key, extra = {}) => ({ key, title: key, capability: 'sesame/research#analyze', input: { hypothesis: key }, ...extra });
async function started(t, options) {
  const f = fixture(options); t.after(() => f.close());
  const task = await start(f.host, { objective: 'Find and validate useful independent factor hypotheses.', max_parallel: 3 });
  await until(() => f.store.runs.get(task.cycle.id)?.value.status === 'completed');
  return { ...f, task };
}

test('start persists a goal before starting a real planner; repeats keep the original goal', async t => {
  const { host, store, task } = await started(t);
  const again = await start(host, { objective: 'This accidental second start must not replace it.' });
  assert.equal(again.id, task.id); assert.equal(again.existing, true);
  assert.equal(store.calls.filter(call => call.capability === 'host.agent.run').length, 1);
  assert.equal(store.calls.find(call => call.capability === 'host.agent.run').context.kind, 'subagent');
  assert.ok(store.checkpoints.get(task.cycle.id).planner);
});

test('independent branches launch concurrently in the main context and actual completion wakes a cycle', async t => {
  const f = await started(t), result = await dispatch(f.host, { branches: [research('momentum'), research('value')] });
  assert.equal(result.branches.filter(job => job.status === 'running').length, 2);
  const calls = f.store.calls.filter(call => call.capability === 'sesame/research#analyze');
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.context.kind === 'main'));
  await until(() => [...f.store.listeners.values()].some(set => set.size > 0));
  f.complete(result.branches[0].run_refs[0].id, { text: 'Verified first hypothesis.' });
  await until(() => f.store.runs.get(result.cycle.id).value.status === 'completed');
  const current = await status(f.host, {});
  assert.equal(current.branches.find(job => job.key === 'momentum').status, 'completed');
  assert.equal(current.branches.find(job => job.key === 'value').status, 'running');
  assert.equal(f.store.runs.get(result.cycle.id).value.output.continuation, 'active');
  assert.match(f.store.runs.get(result.cycle.id).value.output.guidance, /Ultra/);
});

test('stable branch keys and identical-work fingerprints prevent repeated dispatch', async t => {
  const f = await started(t), first = await dispatch(f.host, { branches: [research('one')] });
  const second = await dispatch(f.host, { branches: [research('one')] });
  assert.equal(first.branches[0].run_refs[0].id, second.branches[0].run_refs[0].id);
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/research#analyze').length, 1);
  await assert.rejects(dispatch(f.host, { branches: [research('one', { input: { hypothesis: 'different' } })] }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(dispatch(f.host, { branches: [research('copy', { input: { hypothesis: 'one' } })] }), { code: 'DUPLICATE_BRANCH' });
});

test('the execution lane is serialized while independent research uses other slots', async t => {
  const f = await started(t);
  const result = await dispatch(f.host, { branches: [research('trade-a', { capability: 'sesame/trading#submit' }), research('trade-b', { capability: 'sesame/trading#submit' }), research('analysis')] });
  assert.equal(result.branches.find(job => job.key === 'trade-a').status, 'running');
  assert.equal(result.branches.find(job => job.key === 'trade-b').status, 'queued');
  assert.equal(result.branches.find(job => job.key === 'analysis').status, 'running');
  f.complete(result.branches.find(job => job.key === 'trade-a').run_refs[0].id);
  await until(() => f.store.runs.get(result.cycle.id).value.status === 'completed');
  const next = await dispatch(f.host, { branches: [] });
  assert.equal(next.branches.find(job => job.key === 'trade-b').status, 'running');
});

test('agent tools are classified and generic nested invocation cannot hide execution', async t => {
  const f = await started(t);
  const request = { title: 'executor', instructions: 'Use authorized execution.', objective: 'Execute', input: {}, allowedCalls: [{ pluginId: 'sesame/trading', capabilityId: 'submit' }] };
  const result = await dispatch(f.host, { branches: [research('executor', { capability: 'host.agent.run', input: request })] });
  assert.equal(result.branches[0].exclusive, true);
  await assert.rejects(dispatch(f.host, { branches: [research('bypass', { capability: 'host.agent.run', input: { ...request, allowedCalls: [{ pluginId: 'host', capabilityId: 'capabilities.invoke' }] } })] }), { code: 'UNBOUNDED_DELEGATION' });
});

test('existing main-only immediate workflow launchers retain and observe their real workflow refs', async t => {
  const f = await started(t);
  const result = await dispatch(f.host, { branches: [research('factor', { capability: 'sesame/auto-factor-mining#auto_factor_start' })] });
  assert.equal(result.branches[0].status, 'running'); assert.equal(result.branches[0].run_refs.length, 1);
  assert.equal(f.store.calls.find(call => call.capability.includes('auto_factor_start')).context.kind, 'main');
});

test('stop cancels the real supervisor, all registered branch trees and queued work', async t => {
  const f = await started(t), result = await dispatch(f.host, { branches: ['a', 'b', 'c', 'd'].map(key => research(key)) });
  const stopped = await stop(f.host, { reason: 'User stopped.' });
  assert.equal(stopped.status, 'stopped');
  assert.ok(stopped.branches.every(job => job.status === 'cancelled'));
  assert.equal(f.store.runs.get(result.cycle.id).value.status, 'cancelled');
  await assert.rejects(dispatch(f.host, { branches: [research('later')] }), { code: 'STOPPED' });
  await assert.rejects(resume(f.host, {}), { code: 'STOPPED' });
});

test('persistent services require and execute an idempotent domain stop', async t => {
  const f = await started(t);
  await assert.rejects(dispatch(f.host, { branches: [research('schedule', { capability: 'sesame/trading#schedule' })] }), { code: 'STOP_ACTION_REQUIRED' });
  await dispatch(f.host, { branches: [research('schedule', { capability: 'sesame/trading#schedule', stop: { capability: 'sesame/trading#pause', input: { id: 'plan1' } } })] });
  await stop(f.host, {}); await stop(f.host, {});
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/trading#pause').length, 1);
});

test('a stopped goal cannot restart from old automatic input; a new human instruction permits a new goal', async t => {
  const f = await started(t), input = { messageId: 'human-1', conversation: { id: 'conv_main' }, parts: [{ type: 'text', text: '/ultra' }] };
  await beforeTurn(f.host, input); await stop(f.host, {});
  await beforeTurn(f.host, { ...input, messageId: 'notification-1', metadata: { origin: 'automation' } });
  await assert.rejects(start(f.host, { objective: 'Old notification tries restarting.' }), { code: 'NEW_USER_INPUT_REQUIRED' });
  await beforeTurn(f.host, input);
  await assert.rejects(start(f.host, { objective: 'Repeated old user input.' }), { code: 'NEW_USER_INPUT_REQUIRED' });
  await beforeTurn(f.host, { ...input, messageId: 'human-2' });
  const next = await start(f.host, { objective: 'New user-authorized objective.' }); assert.notEqual(next.id, f.task.id);
});

test('a delegated source conversation cannot advance human authority or restart a stopped goal', async t => {
  const f = await started(t), input = { messageId: 'human-1', conversation: { id: 'conv_main' }, parts: [{ type: 'text', text: '/ultra' }] };
  await beforeTurn(f.host, input); await stop(f.host, {});
  const authority = structuredClone(f.store.records.get('authorities:conv_main'));
  const delegated = { ...input, messageId: 'child-completion-1', source: 'conv_child_research_123', parts: [{ type: 'text', text: 'Research completed. Continue Ultra.' }] };
  assert.deepEqual(await beforeTurn(f.host, delegated), { parts: delegated.parts });
  assert.deepEqual(f.store.records.get('authorities:conv_main'), authority);
  await assert.rejects(start(f.host, { objective: 'Child completion tries restarting.' }), { code: 'NEW_USER_INPUT_REQUIRED' });
  assert.equal((await status(f.host, {})).status, 'stopped');
});

test('a concrete future timestamp persists before timer waiting and yields a real completion', async t => {
  const f = await started(t), deadline = new Date(Date.now() + 70).toISOString();
  const waiting = await wait(f.host, { kind: 'time', until: deadline });
  await until(() => f.store.checkpoints.has(waiting.cycle.id));
  assert.equal(f.store.checkpoints.get(waiting.cycle.id).until, deadline);
  assert.equal(f.store.runs.get(waiting.cycle.id).value.status, 'running');
  await until(() => f.store.runs.get(waiting.cycle.id).value.status === 'completed');
  assert.equal((await status(f.host, {})).status, 'ready');
});

test('subscription waiting ignores the initial snapshot and closes on a new event', async t => {
  const f = await started(t), waiting = await wait(f.host, { kind: 'event', source: { providerId: 'fixture#market', revision: '1' }, operation: 'bars', input: { symbol: 'TEST' } });
  await until(() => f.store.runs.get(waiting.cycle.id).value.status === 'completed');
  assert.equal(f.store.runs.get(waiting.cycle.id).value.output.event.type, 'delta');
});

test('resume keeps the same timer cycle and absolute deadline without creating another planner', async t => {
  const f = await started(t), deadline = new Date(Date.now() + 140).toISOString();
  const waiting = await wait(f.host, { kind: 'time', until: deadline });
  await until(() => f.store.checkpoints.has(waiting.cycle.id));
  const job = f.store.runs.get(waiting.cycle.id);
  f.update(job, { status: 'interrupted', interrupts: [{ id: 'pause-one' }] });
  job.controller.abort(fail('RUN_INTERRUPTED'));
  await job.running;
  const resumed = await resume(f.host, { response: { user: 'continue' } });
  assert.equal(resumed.cycle.id, waiting.cycle.id);
  assert.equal(f.store.checkpoints.get(waiting.cycle.id).until, deadline);
  await until(() => f.store.runs.get(waiting.cycle.id).value.status === 'completed');
  assert.equal(f.store.calls.filter(call => call.capability === 'host.agent.run').length, 1);
});

test('an admission response lost after acceptance reattaches the original cycle operation', async t => {
  let lost = false;
  const f = fixture({ onInvoke: async ({ capability, options, store, newRun }) => {
    if (capability !== 'sesame/ultra#ultra_cycle' || lost) return;
    lost = true;
    const accepted = { type: 'run', run: newRun() };
    store.operations.set(`${capability}:${options.operationId}`, accepted);
    throw fail('TRANSPORT_LOST', 'Accepted response was not received.');
  } });
  t.after(() => f.close());
  await assert.rejects(start(f.host, { objective: 'Resume the same accepted planner.' }), { code: 'TRANSPORT_LOST' });
  await until(() => [...f.store.runs.values()].some(job => job.capability === 'sesame/ultra#ultra_cycle' && job.value.status === 'completed'));
  const retained = [...f.store.runs.values()].find(job => job.capability === 'sesame/ultra#ultra_cycle').value.id;
  const restored = await resume(f.host, {});
  assert.equal(restored.cycle.id, retained);
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/ultra#ultra_cycle').length, 1);
  assert.equal(f.store.calls.filter(call => call.capability === 'host.agent.run').length, 1);
});

test('stopping while a branch is being admitted cancels its eventual accepted Run', async t => {
  let release, entered;
  const admission = new Promise(resolve => { entered = resolve; });
  const f = await started(t, { onInvoke: async ({ capability, newRun }) => {
    if (capability !== 'sesame/research#analyze') return;
    entered(); await new Promise(resolve => { release = resolve; });
    return { type: 'run', run: newRun() };
  } });
  const work = dispatch(f.host, { branches: [research('late')] });
  await admission; const stopping = await stop(f.host, {}); assert.equal(stopping.status, 'stopping');
  release(); await work;
  const stopped = await status(f.host, {}); assert.equal(stopped.status, 'stopped');
  assert.ok(stopped.branches.every(job => job.status === 'cancelled'));
});

test('completion of an existing branch does not erase an explicit missing-input wait', async t => {
  const f = await started(t), result = await dispatch(f.host, { branches: [research('independent')] });
  await wait(f.host, { kind: 'input', reason: 'The remaining private dataset is missing.' });
  f.complete(result.branches[0].run_refs[0].id);
  await until(() => f.store.runs.get(result.cycle.id).value.status === 'completed');
  assert.equal((await status(f.host, {})).status, 'waiting-input');
});

test('an asynchronous domain stop remains pending until its real Run finishes', async t => {
  const f = await started(t); f.descriptors.get('sesame/trading#pause').execution = 'run';
  await dispatch(f.host, { branches: [research('schedule', { capability: 'sesame/trading#schedule', stop: { capability: 'sesame/trading#pause', input: { id: 'plan2' } } })] });
  const stopping = await stop(f.host, {}); assert.equal(stopping.status, 'stopping');
  assert.equal(stopping.branches[0].stop_pending, true);
  f.complete(stopping.branches[0].stop_refs[0].id);
  assert.equal((await status(f.host, {})).status, 'stopped');
});

test('missing input is explicit waiting and does not create a busy retry loop', async t => {
  const f = await started(t), before = f.store.calls.length;
  const waiting = await wait(f.host, { kind: 'input', reason: 'The requested private data is missing after checking the configured sources.' });
  assert.equal(waiting.status, 'waiting-input'); assert.equal(f.store.calls.length, before);
});

test('main owner isolation and retained state survive a new runtime instance', async t => {
  const f = await started(t), restarted = fixture({ stored: f.store });
  assert.equal((await status(restarted.host, {})).id, f.task.id);
  await assert.rejects(stop(f.hostFor({ sessionId: 'another' }), { id: f.task.id }), { code: 'NOT_FOUND' });
  await assert.rejects(status(f.hostFor({ kind: 'subagent' }), {}), { code: 'FORBIDDEN' });
});

test('a failed branch is retained and not automatically resubmitted', async t => {
  const f = await started(t, { onInvoke: async ({ capability }) => { if (capability === 'sesame/research#analyze') throw fail('BAD_INPUT', 'Read the exact schema.'); } });
  const result = await dispatch(f.host, { branches: [research('failed')] }); assert.equal(result.branches[0].status, 'failed');
  await dispatch(f.host, { branches: [research('failed')] });
  assert.equal(f.store.calls.filter(call => call.capability === 'sesame/research#analyze').length, 1);
});

test('completion requires actual finished work and no unfinished branches', async t => {
  const f = await started(t);
  await assert.rejects(finish(f.host, { summary: 'Plan is not evidence.', evidence: ['plan'] }), { code: 'NO_EVIDENCE' });
  const result = await dispatch(f.host, { branches: [research('evidence')] });
  await assert.rejects(finish(f.host, { summary: 'Not done.', evidence: ['pending'] }), { code: 'WORK_REMAINS' });
  f.complete(result.branches[0].run_refs[0].id);
  await until(() => f.store.runs.get(result.cycle.id).value.status === 'completed');
  const done = await finish(f.host, { summary: 'The user criteria are met by the verified results.', evidence: [result.branches[0].run_refs[0].id] });
  assert.equal(done.status, 'completed');
});

test('all tools expose object schemas and no identity/credential ingress is requested', async () => {
  const capabilities = JSON.parse(await readFile(new URL('../capabilities.json', import.meta.url), 'utf8'));
  const plugin = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));
  const npm = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(npm.license, plugin.license); assert.equal(plugin.license, 'MIT');
  assert.match(await readFile(new URL('../LICENSE', import.meta.url), 'utf8'), /Copyright \(c\) 2026 Sesame contributors/);
  assert.match(await readFile(new URL('../PROVENANCE.md', import.meta.url), 'utf8'), /LangGraph Persistence/);
  assert.ok(capabilities.capabilities.every(capability => capability.inputSchema.type === 'object'));
  assert.equal(capabilities.capabilities.find(capability => capability.id === 'ultra_cycle').resumable, true);
  assert.ok(!plugin.permissions.scopes.some(scope => scope.startsWith('messages.ingress.')));
  assert.equal(capabilities.stateCollections.length, 5);
});
