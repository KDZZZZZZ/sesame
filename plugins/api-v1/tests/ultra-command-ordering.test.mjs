// Real host message admission plus Ultra's real goal state and human-input hook.
// Only the capability transport and child workflow are held by this fixture;
// no model, market, account, or running Sesame workspace is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture as ultraFixture } from '../packages/ultra/tests/fixture.js';
import { beforeTurn, start, status, stop } from '../packages/ultra/src/runtime.js';

const hostRoot = process.env.SESAME_HOST_ROOT;
const options = { skip: !hostRoot, timeout: 60000 };
const parts = text => [{ type: 'text', text }];

async function fixture(t) {
  const { fixture: hostFixture } = await import(pathToFileURL(join(hostRoot, 'tests/fixture-provider.js')));
  // Keep real Ultra in planning without starting its model-backed planner.
  const ultra = ultraFixture({ onInvoke: ({ capability, host, store }) => {
    if (capability !== 'sesame/ultra#ultra_cycle') return;
    const value = { id: `run_${++store.sequence}`, kind: 'workflow', revision: 1, status: 'running',
      sessionId: host.context.sessionId, parentRunId: null };
    store.runs.set(value.id, { value, controller: new AbortController() });
    return { type: 'run', run: { id: value.id, kind: value.kind, revision: value.revision } };
  } });
  const app = await hostFixture();
  const runtime = app.runtime, inputs = [], controls = [], gates = [], pending = [], events = [];
  t.after(async () => {
    for (const gate of gates) gate.release();
    await Promise.allSettled(pending);
    await ultra.close();
    await app.dispose();
  });
  // Keep the registered core plugin and its lifecycle identity. Plugin functions
  // below are imported from the actual package, not replaced with success responses.
  assert.equal(runtime.plugins.entry('sesame/ultra').runtime_status, 'ready');
  runtime.pump = () => Promise.resolve();
  const authority = () => ultra.store.records.get('authorities:conv_main')?.value.counter ?? 0;
  const session = id => ultra.store.records.get(`sessions:${id}`)?.value;
  const prepare = runtime.plugins.beforeAgentTurn.bind(runtime.plugins);
  runtime.plugins.beforeAgentTurn = async (input, execution) => {
    inputs.push(input);
    const prepared = await prepare(input, execution);
    const result = await beforeTurn(ultra.host, { ...input, parts: prepared.parts });
    events.push(`input:${input.parts[0].text}`);
    return result;
  };
  const invoke = runtime.capabilities.invoke.bind(runtime.capabilities);
  let stopCount = 0;
  runtime.capabilities.invoke = async (capability, input, invocation, context) => {
    if (!['sesame/ultra#ultra_stop', 'sesame/ultra#ultra_status'].includes(capability)) return invoke(capability, input, invocation, context);
    runtime.authority.assert(context);
    assert.equal(runtime.authority.identity(context).host, true, 'Native controls must carry a verified host principal.');
    assert.equal(context.kind, 'main');
    assert.equal(context.sessionId, 'conv_main');
    controls.push({ capability, context });
    const host = ultra.hostFor({ kind: context.kind, sessionId: context.sessionId });
    if (capability.endsWith('ultra_status')) return { type: 'result', value: await status(host, input) };
    const number = ++stopCount, gate = gates[number - 1];
    events.push(`stop:${number}:entered`);
    gate?.entered.resolve();
    if (gate) await gate.pending.promise;
    const value = await stop(host, input);
    events.push(`stop:${number}:finished`);
    if (gate?.error) throw gate.error;
    return { type: 'result', value };
  };
  const send = (text, sessionId = 'conv_main') => {
    const result = runtime.send(sessionId, { content: parts(text) });
    pending.push(result);
    result.catch(() => {}); // Cleanup observes rejections even if an assertion fails.
    return result;
  };
  const begin = async objective => {
    const accepted = await send(`/ultra ${objective}`);
    assert.equal(accepted.response.status, 'queued');
    // Stand in for the main agent choosing ultra_start after message admission.
    const goal = await start(ultra.host, { objective });
    return { accepted, goal };
  };
  const holdStop = error => {
    const entered = Promise.withResolvers(), pending = Promise.withResolvers();
    const gate = { entered, pending, error, release: () => pending.resolve() };
    gates.push(gate);
    return { entered: entered.promise, release: gate.release };
  };
  return { app, runtime, ultra, inputs, controls, events, authority, session, send, begin, holdStop };
}

test('a newer Ultra goal waits for the older stop before receiving fresh human authority', options, async t => {
  const h = await fixture(t);
  const old = await h.begin('Original research goal');
  assert.equal(old.goal.status, 'planning');
  assert.equal(h.authority(), 1);
  const gate = h.holdStop();
  const stopping = h.send('/ultra stop');
  await gate.entered;
  const nextText = '/ultra New independent research goal';
  const newer = h.begin('New independent research goal');
  // Ordinary messages and read-only status must remain usable during shutdown.
  const ordinary = await h.send('Keep this ordinary question');
  const queried = await h.send('/ultra status');
  assert.equal(ordinary.response.status, 'queued');
  assert.equal(queried.response.status, 'completed');
  assert.equal(h.inputs.some(input => input.parts[0].text === nextText), false,
    'The new human-input hook must not run while the old stop can consume its authority.');
  assert.equal(h.authority(), 2);
  assert.equal(h.session(old.goal.id).status, 'planning');

  gate.release();
  const stopped = await stopping;
  const fresh = await newer;
  assert.equal(stopped.response.status, 'completed');
  assert.equal(h.session(old.goal.id).status, 'stopped');
  assert.equal(h.session(old.goal.id).stopAuthority, 2);
  assert.equal(h.authority(), 3, 'The new start contributes authority after the old stop.');
  assert.notEqual(fresh.goal.id, old.goal.id);
  assert.equal(fresh.goal.status, 'planning');
  assert.equal((await status(h.ultra.host)).id, fresh.goal.id);
  assert.equal((await status(h.ultra.host)).status, 'planning');
  assert.equal(h.app.store.get('message', fresh.accepted.response.id).status, 'queued');
  assert.equal(h.app.store.get('message', ordinary.response.id).status, 'queued');
  assert.equal(h.app.store.get('message', old.accepted.response.id).cancellation_reason, 'queue_withdrawn');
  assert.ok(h.events.indexOf('stop:1:finished') < h.events.indexOf(`input:${nextText}`));
  const child = h.runtime.createConversation('fixture', 'Child cannot control main Ultra', 'conv_main');
  const count = h.controls.length;
  assert.throws(() => h.runtime.send(child.id, { content: parts('/ultra stop') }), { code: 'command_scope' });
  assert.equal(h.controls.length, count, 'A subagent command must be rejected before constructing host authority.');
  assert.equal(h.app.requests.length, 0);
});

test('multiple pending stops settle in intake order before admitting a newer Ultra goal', options, async t => {
  const h = await fixture(t);
  const old = await h.begin('Goal before two stops');
  const firstGate = h.holdStop(), secondGate = h.holdStop();
  const first = h.send('/ultra stop first');
  await firstGate.entered;
  const second = h.send('/ultra stop second');
  const newer = h.begin('Goal after both stops');
  assert.equal(h.controls.length, 1);
  assert.equal(h.inputs.length, 1);
  firstGate.release();
  await first;
  await secondGate.entered;
  assert.equal(h.inputs.length, 1, 'Resolving the first stop must not release a start waiting on the second.');
  assert.equal(h.authority(), 1);
  secondGate.release();
  await second;
  const fresh = await newer;
  assert.equal(h.session(old.goal.id).stopAuthority, 1);
  assert.equal(h.authority(), 2);
  assert.equal(fresh.goal.status, 'planning');
  assert.notEqual(fresh.goal.id, old.goal.id);
  assert.deepEqual(h.events.filter(event => event.startsWith('stop:')), [
    'stop:1:entered', 'stop:1:finished', 'stop:2:entered', 'stop:2:finished',
  ]);
  assert.ok(h.events.indexOf('stop:2:finished') < h.events.indexOf('input:/ultra Goal after both stops'));
  assert.equal(h.app.requests.length, 0);
});

test('a failed stop receipt releases the barrier without consuming a later start instruction', options, async t => {
  const h = await fixture(t);
  const old = await h.begin('Goal before transport failure');
  const gate = h.holdStop(Object.assign(new Error('Fixture lost the stop response'), { code: 'FIXTURE_RESPONSE_LOST' }));
  const stopping = h.send('/ultra stop');
  const rejected = assert.rejects(stopping, { code: 'FIXTURE_RESPONSE_LOST' });
  await gate.entered;
  const newer = h.begin('Goal after failed stop receipt');
  assert.equal(h.inputs.length, 1);
  assert.equal(h.authority(), 1);
  gate.release();
  await rejected;
  const fresh = await newer;
  assert.equal(h.session(old.goal.id).status, 'stopped');
  assert.equal(h.session(old.goal.id).stopAuthority, 1);
  assert.equal(h.authority(), 2);
  assert.equal(fresh.goal.status, 'planning');
  assert.notEqual(fresh.goal.id, old.goal.id);
  assert.equal(h.app.store.get('message', fresh.accepted.response.id).status, 'queued');
  assert.equal((await status(h.ultra.host)).id, fresh.goal.id);
  assert.equal(h.app.requests.length, 0);
});
