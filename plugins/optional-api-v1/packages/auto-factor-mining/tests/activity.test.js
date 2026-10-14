import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { MiningRuntime } from '../runtime.js';
import { activitySnapshot, appendActivity, publicOutput } from '../activity.js';

const clone = value => value == null ? value : structuredClone(value);
const base = () => ({ id: 'run', title: 'Research', ownerConversationId: 'owner', status: 'running', phase: 'experiments', generation: 0,
  createdAt: 1, updatedAt: 1, config: { rounds: 2, directions: ['momentum', 'liquidity'] }, events: [], trials: [], reflections: [], memory: [], data: {}, tasks: [], reportPending: false });
function harness(options = {}) {
  const db = new Map();
  const host = { scope: { kind: 'service' }, agents: { cancel() {} }, storage: {
    get(_collection, id) { return clone(db.get(id)); }, put(_collection, value) { db.set(value.id, clone(value)); return clone(value); }, list() { return [...db.values()].map(clone); },
  } };
  const runtime = new MiningRuntime(host, { now: () => 100, ...options }); runtime.save(base()); return { runtime, host };
}

test('event sequences survive bounded retention and repeated peer reads are deduplicated', () => {
  let run = base();
  for (let i = 0; i < 8; i++) run = appendActivity(run, run, [{ type: 'message', message: String(i) }], 10 + i, 3).run;
  assert.deepEqual(run.events.map(event => event.seq), [6, 7, 8]); assert.equal(run.activityDropped, 5);
  const edge = { type: 'report.read', fromTaskId: 'writer', toTaskId: 'reader' };
  run = appendActivity(run, run, [edge], 30, 3).run;
  for (let i = 0; i < 5; i++) run = appendActivity(run, run, [{ type: 'later' }], 31 + i, 3).run;
  const after = appendActivity(run, run, [edge], 50, 3);
  assert.equal(after.added.length, 0); assert.equal(after.run.activitySequence, 14);
});

test('public message projection excludes thinking, tool arguments, results and non-assistant messages', () => {
  const result = publicOutput({ id: 'message', role: 'assistant', status: 'streaming', segments: [
    { id: 'a', type: 'thinking', text: 'hidden-secret' }, { id: 'b', type: 'text', text: '**Public**' },
    { id: 'c', type: 'tool', tool_name: 'read', status: 'completed', arguments: 'argument-secret', result: 'result-secret' },
  ] });
  assert.equal(result.text, '**Public**'); assert.equal(result.segments.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /secret/); assert.equal(publicOutput({ role: 'user' }), null);
});

test('task observer stays in activation scope, preserves queued status and ignores stale generations', async () => {
  const scope = new AsyncLocalStorage(), f = scope.run('service', () => harness());
  const task = { id: 'task', generation: 0, role: 'researcher', mode: 'hypothesis', round: 0, direction: 'momentum', status: 'queued', createdAt: 1 };
  f.runtime.update('run', { tasks: [task] });
  let status = 'queued'; const seenScopes = [];
  f.host.agents.inspect = async id => { seenScopes.push(scope.getStore()); return { id, status, conversationId: 'conversation', toolCalls: [{ id: 'tool', name: 'auto_factor_context', status: 'started', startedAt: 2, arguments: 'hidden' }] }; };
  f.host.tasks = { read: async () => { seenScopes.push(scope.getStore()); return { active_response_message_id: 'message' }; } };
  f.host.messages = { read: async () => ({ id: 'message', role: 'assistant', status: 'streaming', segments: [{ id: 'public', type: 'text', text: '公开结论' }, { id: 'private', type: 'thinking', text: 'hidden' }] }) };
  await scope.run('unrelated caller', () => f.runtime.observeTask('run', 'task', 0));
  assert.equal(f.runtime.get('run').tasks[0].status, 'queued'); assert.equal(f.runtime.get('run').tasks[0].startedAt, undefined);
  status = 'running'; await f.runtime.observeTask('run', 'task', 0);
  assert.equal(f.runtime.get('run').tasks[0].startedAt, 100); assert.ok(seenScopes.every(value => value === 'service'));
  assert.doesNotMatch(JSON.stringify(activitySnapshot(f.runtime.get('run'))), /hidden/);
  let release; f.host.agents.inspect = () => new Promise(resolve => { release = resolve; });
  const pending = f.runtime.observeTask('run', 'task', 0);
  f.runtime.update('run', { generation: 1, tasks: [{ ...f.runtime.get('run').tasks[0], status: 'cancelled', finishedAt: 101 }] });
  release({ id: 'task', status: 'running' }); await pending;
  assert.equal(f.runtime.get('run').tasks[0].status, 'cancelled');
  await f.runtime.dispose(); assert.equal(f.runtime.taskPolls.size, 0);
});

test('only returned peer output pages create real directed handoffs and stable per-direction roles', async () => {
  const f = harness();
  const tasks = [
    { id: 'source-a', role: 'researcher', mode: 'hypothesis', round: 0, direction: 'momentum', generation: 0, status: 'completed', finishedAt: 2, output: { hypothesis: 'A' } },
    { id: 'source-b', role: 'researcher', mode: 'hypothesis', round: 0, direction: 'liquidity', generation: 0, status: 'completed', finishedAt: 2, output: { hypothesis: 'B' } },
    { id: 'reader', role: 'coder', mode: 'code', round: 0, direction: 'momentum', generation: 0, status: 'running' },
  ];
  f.runtime.update('run', { tasks, holdout: { secret: 99 }, data: { rows: ['sealed'] } });
  const child = { scope: { kind: 'subagent', conversationId: 'reader-conv' }, agents: { current: () => ({ id: 'reader', pluginId: 'sesame/auto-factor-mining', status: 'running', conversationId: 'reader-conv', input: { runId: 'run', role: 'coder', mode: 'code' } }) } };
  const page = f.runtime.context(child, 'run', 'team', 0, 1);
  assert.equal(page.team.items[0].taskId, 'source-a');
  f.runtime.context(child, 'run', 'team', 0, 1);
  assert.deepEqual(f.runtime.get('run').events.filter(event => event.type === 'report.read').map(event => [event.fromTaskId, event.toTaskId]), [['source-a', 'reader']]);
  f.runtime.context(child, 'run', 'memory');
  assert.equal(f.runtime.get('run').events.filter(event => event.type === 'report.read').length, 1);
  f.runtime.context(child, 'run', 'team', 1, 1);
  const snapshot = activitySnapshot(f.runtime.get('run'));
  assert.deepEqual(snapshot.tasks.slice(0, 2).map(task => task.role), ['researcher:0', 'researcher:1']);
  assert.equal(snapshot.workflow.stages.length, 13);
  assert.doesNotMatch(JSON.stringify(snapshot), /sealed|secret/);
  await f.runtime.dispose();
});
