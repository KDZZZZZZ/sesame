import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest } from '@sesame/plugin-sdk/protocol';
import { TradingRuntime } from '../packages/manual-trading/runtime.js';
import { activitySnapshot, appendActivity } from '../packages/manual-trading/activity.js';
import { stages } from '../packages/manual-trading/team.js';
import { TradingActivityViewer } from '../packages/manual-trading/viewer.js';

const T0 = Date.parse('2026-10-13T12:00:00Z');
const clone = value => value === undefined ? undefined : structuredClone(value);
const unchanged = { unchanged: true, targets: [], pause_strategies: [], evidence_dataset_ids: [], rationale: 'No new evidence warrants changing the observed portfolio.' };
const terminal = new Set(['completed', 'failed', 'canceled']);
const flush = async predicate => { for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('Expected fixture state was not reached'); };

function fixture(t, options = {}) {
  let now = T0, sequence = 0;
  const records = new Map(), jobs = new Map(), messages = new Map(), files = new Map();
  const account = { accountId: 'activity-fixture', server: 'Fictional', revision: '1' }, model = { provider: 'fixture', id: 'local', configurationDigest: 'fixture-v1' };
  const plan = { id: 'plan', title: '真实调度观测夹具', ownerConversationId: 'conv_main', backend: 'mt5', account, model, agentModels: {}, mode: 'single', debateRounds: 1,
    symbols: [], instructions: '', taskTimeoutMs: 30000, enabled: true, reportFolder: '手工交易日报/activity', eventCooldownMs: 5000 };
  const storage = { get: (kind, id) => clone(records.get(`${kind}:${id}`)), list: kind => [...records].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => clone(value)),
    put: (kind, value) => { records.set(`${kind}:${value.id}`, clone(value)); return clone(value); }, transaction: action => action(), directory: 'fictional-activity-fixture' };
  const view = job => JSON.parse(JSON.stringify({ id: job.id, pluginId: 'sesame/manual-trading', status: job.status, conversationId: job.conversationId ?? null,
    createdAt: job.createdAt, completedAt: job.completedAt, model: job.request.model, toolCalls: job.toolCalls, result: job.result, error: job.error }));
  const agents = {
    submit(request) { const job = { id: `task-${++sequence}`, request: clone(request), createdAt: now, status: 'queued', toolCalls: [] }; jobs.set(job.id, job); return view(job); },
    inspect: id => view(jobs.get(id)),
    wait(id, signal) { const job = jobs.get(id); return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(signal.reason ?? new Error('aborted')); }, cleanup = () => signal?.removeEventListener('abort', abort);
      job.finish = () => { cleanup(); resolve(view(job)); }; job.reject = error => { cleanup(); reject(error); };
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    }); },
    cancel(id, reason) { const job = jobs.get(id); if (!terminal.has(job.status)) { job.status = 'canceled'; job.completedAt = now; job.error = reason; job.finish?.(); } return view(job); }, current: () => null,
  };
  const snapshot = { account, capturedAt: now, positions: [], summary: { equity: 10000 }, deployments: [], orders: [], fills: [], historicalOrders: [] };
  const filePort = { list: async () => ({ entries: [...files.values()] }), mkdir: async ({ path }) => { const value = { id: path, path, kind: 'directory' }; files.set(path, value); return value; },
    write: async ({ path, content }) => { const value = { id: path, path, content, kind: 'file' }; files.set(path, value); return value; }, read: async ({ path }) => files.get(path) };
  const host = { scope: { kind: 'service', conversationId: null }, storage, agents, inference: { models: () => [model] }, plugins: { inspect: () => ({ state: 'enabled' }) },
    reports: { files: { forSpace: () => filePort } }, artifacts: { blob: value => ({ digest: digest(value), size: Buffer.byteLength(value) }), publish: input => ({ id: 'artifact', revision: 'r1', digest: digest(input.manifest), kind: input.manifest.kind, schemaVersion: '1.0.0' }) },
    events: { emit() {} }, datasets: { read() { throw new Error('No research data was requested'); } },
    tasks: { read: id => { const job = [...jobs.values()].find(value => value.conversationId === id); return { id, stage: '公开工作状态', active_response_message_id: job.messageId ?? null }; } },
    messages: { read: id => clone(messages.get(id)) }, tools: { call: async request => { assert.equal(request.name, 'mt5_trading_context'); return { details: clone(snapshot) }; } } };
  if (options.inspect === false) delete agents.inspect;
  const runtime = new TradingRuntime(host, { timer: false, now: () => now, activityPollMs: 60000, ...options });
  runtime.memoryFor = () => ({ context: () => ({}), record: () => ({}) });
  storage.put('plans', plan);
  t.after(async () => { const disposing = runtime.dispose(); for (const job of jobs.values()) if (!terminal.has(job.status)) agents.cancel(job.id, 'Fixture ended'); await disposing; });
  return { runtime, host, storage, plan, jobs, messages, files, snapshot, view,
    main: { ...host, scope: { kind: 'main', conversationId: 'conv_main' } },
    advance() { now += 100; return now; },
    run(id = 'observed') { return runtime.save({ id, planId: plan.id, plan: clone(plan), trigger: { kind: 'manual', id }, status: 'queued', createdAt: now, tasks: [], reports: [], reportPending: true, snapshot: clone(snapshot) }); },
    start(id) { const job = jobs.get(id); job.status = 'running'; job.conversationId = `conv-${id}`; return job; },
    child(id) { const job = jobs.get(id); return { ...host, scope: { kind: 'subagent', conversationId: job.conversationId }, agents: { ...agents, current: () => ({ ...view(job), input: clone(job.request.input) }) } }; },
    finish(id, status = 'completed') { const job = jobs.get(id); job.status = status; job.completedAt = now; job.result = status === 'completed' ? { text: `${job.request.input.role} 的公开最终报告` } : null; job.error = status === 'completed' ? null : 'Fixture failure'; job.finish(); },
  };
}

test('activity snapshots use the actual stages, retain role rounds, and require an explicit model mock marker', t => {
  const f = fixture(t), run = f.run();
  run.plan.mode = 'team'; run.plan.debateRounds = 2; run.plan.model.provider = 'mock-looking-name';
  run.trigger = { kind: 'event', key: 'positions', id: 'PRIVATE_TRIGGER_ID', data: { secret: 'PRIVATE_EVENT_PAYLOAD' } };
  run.tasks = [{ id: 'bear-2', role: 'bear', round: 4, model: run.plan.model, status: 'queued' }, { id: 'reporter', role: 'reporter', round: 0, model: run.plan.model, status: 'queued' }];
  const original = clone(run), actual = activitySnapshot(run, { mode: 'live', feedUrl: 'events' });
  assert.deepEqual(actual.workflow.stages.map(stage => stage.roles), [...stages(run.plan), ['executor'], ['reporter']]);
  assert.deepEqual(actual.workflow.stages.map(stage => stage.index), actual.workflow.stages.map((_, i) => i));
  assert.equal(actual.tasks[0].stageIndex, 4); assert.equal(actual.tasks[1].stageIndex, stages(run.plan).length + 1); assert.equal(actual.tasks[1].round, 0);
  assert.equal(actual.mockModelResponses, false); assert.equal(actual.run.title, run.plan.title); assert.equal(actual.tasks[0].provider, 'mock-looking-name');
  assert.deepEqual(actual.run.trigger, { kind: 'event', key: 'positions' }); assert.doesNotMatch(JSON.stringify(actual), /PRIVATE_/);
  assert.deepEqual(run, original); actual.events.length = 0; assert.ok(run.activity.events.length);
  assert.throws(() => activitySnapshot(run, { mode: 'demo' }), /live or archive/);
  assert.throws(() => activitySnapshot(run, { mode: 'replay' }), /live or archive/);
  const old = { ...run }; delete old.activity;
  assert.equal(activitySnapshot(old).recorded, false); assert.deepEqual(activitySnapshot(old).events, []);
});

test('durable sequence numbers survive bounded retention and listeners cannot mutate or interrupt saves', t => {
  const f = fixture(t, { activityLimit: 3 }), notices = [];
  f.runtime.onActivity(() => { throw new Error('Broken viewer'); });
  f.runtime.onActivity(async () => { throw new Error('Disconnected viewer'); });
  const unsubscribe = f.runtime.onActivity(notice => { notices.push(clone(notice)); notice.run.status = 'not-authoritative'; });
  const run = f.run();
  f.runtime.update(run.id, { status: 'researching', startedAt: f.advance() });
  for (let i = 0; i < 5; i++) f.runtime.update(run.id, { executionProgress: { status: `observed-${i}`, orders: [], pauses: [] } });
  const current = f.runtime.run(run.id), events = current.activity.events;
  assert.deepEqual(events.map(event => event.seq), [5, 6, 7]); assert.equal(current.activity.dropped, 4); assert.equal(current.activity.truncated, true);
  assert.equal(current.status, 'researching'); assert.equal(new Set(events.map(event => event.id)).size, 3);
  const count = notices.length; f.runtime.save(current); assert.equal(notices.length, count, 'An unchanged save is not activity.');
  const resumed = new TradingRuntime(f.host, { timer: false, activityLimit: 3 });
  resumed.activity(run.id, 'report.read', { fromTaskId: 'source', toTaskId: 'reader' });
  assert.equal(resumed.run(run.id).activity.seq, 8);
  unsubscribe(); f.runtime.update(run.id, { error: { message: 'An observed failure' } }); assert.equal(notices.length, count);
  const once = appendActivity(resumed.run(run.id), [{ type: 'report.read', fromTaskId: 'source', toTaskId: 'reader' }], { at: T0, limit: 1 });
  assert.equal(once.events.length, 0, 'Read deduplication survives log truncation.');
  return resumed.dispose();
});

test('communication edges require a registered child to receive the actual reports page', async t => {
  const f = fixture(t), run = f.run(), request = role => ({ model: f.plan.model, input: { role, runId: run.id, tradingPlan: { id: f.plan.id, account: f.plan.account } } });
  const first = f.host.agents.submit(request('market')), second = f.host.agents.submit(request('news')), reader = f.host.agents.submit(request('manager'));
  f.start(reader.id);
  f.runtime.update(run.id, { tasks: [{ ...first, role: 'market', round: 0 }, { ...second, role: 'news', round: 0 }, { ...reader, role: 'manager', round: 1 }],
    reports: [{ taskId: first.id, role: 'market', round: 0, status: 'completed', createdAt: T0, text: '市场报告' }, { taskId: second.id, role: 'news', round: 0, status: 'completed', createdAt: T0, text: '新闻报告' }] });
  const reads = () => f.runtime.run(run.id).activity.events.filter(event => event.type === 'report.read');
  await f.runtime.context(f.main, run.id, 'all'); await f.runtime.context(f.child(reader.id), run.id, 'account');
  assert.deepEqual(reads(), []);
  const page = await f.runtime.context(f.child(reader.id), run.id, 'team', 1, 1);
  assert.equal(page.reports.items[0].taskId, second.id);
  assert.deepEqual(reads().map(event => [event.fromTaskId, event.toTaskId]), [[second.id, reader.id]]);
  await f.runtime.context(f.child(reader.id), run.id, 'all', 1, 1); await f.runtime.context(f.child(reader.id), run.id, 'team', 9, 1);
  assert.equal(reads().length, 1);
  await f.runtime.context(f.child(reader.id), run.id, 'team', 0, 1); assert.equal(reads().length, 2);
  const intruder = f.host.agents.submit(request('manager')); f.start(intruder.id);
  await assert.rejects(f.runtime.context(f.child(intruder.id), run.id, 'team'), /registered/); assert.equal(reads().length, 2);
  const bad = f.run('missing-snapshot'); delete bad.snapshot; bad.tasks = clone(f.runtime.run(run.id).tasks);
  f.runtime.save(bad);
  const child = f.child(reader.id); child.agents.current = () => ({ ...f.view(f.jobs.get(reader.id)), input: { ...request('manager').input, runId: bad.id } });
  child.tools = { call: async () => { throw new Error('Snapshot unavailable'); } };
  await assert.rejects(f.runtime.context(child, bad.id, 'team'), /Snapshot unavailable/);
  assert.equal(f.runtime.run(bad.id).activity.events.some(event => event.type === 'report.read'), false);
});

test('public polling records observed statuses and tool receipts but excludes reasoning and tool payloads', async t => {
  const f = fixture(t), run = f.run(), pending = f.runtime.task(run.id, 'manager', 0);
  const task = [...f.jobs.values()][0];
  await f.runtime.observeTask(run.id, task.id);
  assert.equal(f.runtime.run(run.id).tasks[0].status, 'queued');
  assert.equal(f.runtime.run(run.id).activity.events.some(event => event.type === 'task.running'), false);
  f.start(task.id); task.messageId = 'public-message';
  task.toolCalls = [{ id: 'call-1', name: 'financial_research_query', status: 'started', startedAt: f.advance(), arguments: { secret: 'PRIVATE_ARGUMENTS' } }];
  f.messages.set(task.messageId, { id: task.messageId, role: 'assistant', status: 'streaming', thinking: 'PRIVATE_THINKING',
    segments: [{ id: 's1', type: 'text', text: '正在核对公开证据。' }, { id: 's2', type: 'tool', tool_name: 'financial_research_query', status: 'running', result: 'PRIVATE_RESULT' }, { id: 's3', type: 'thinking', text: 'PRIVATE_THINKING' }] });
  await f.runtime.observeTask(run.id, task.id); const seq = f.runtime.run(run.id).activity.seq;
  await f.runtime.observeTask(run.id, task.id); assert.equal(f.runtime.run(run.id).activity.seq, seq);
  let observed = activitySnapshot(f.runtime.run(run.id));
  assert.equal(observed.tasks[0].status, 'running'); assert.equal(observed.tasks[0].publicOutput.text, '正在核对公开证据。');
  assert.doesNotMatch(JSON.stringify(f.runtime.run(run.id)), /PRIVATE_/);
  task.toolCalls[0].status = 'returned'; task.toolCalls[0].completedAt = f.advance();
  await f.runtime.observeTask(run.id, task.id);
  observed = activitySnapshot(f.runtime.run(run.id));
  assert.deepEqual(observed.events.filter(event => event.type.startsWith('tool.')).map(event => event.type), ['tool.started', 'tool.finished']);
  const originalInspect = f.host.agents.inspect; f.host.agents.inspect = () => { throw new Error('Observation unavailable'); };
  await f.runtime.observeTask(run.id, task.id); assert.equal(f.runtime.run(run.id).tasks[0].status, 'running');
  assert.match(f.runtime.run(run.id).tasks[0].observationError.message, /unavailable/); f.host.agents.inspect = originalInspect;
  f.finish(task.id); await pending;
  assert.equal(f.runtime.taskPolls.size, 0); assert.equal(f.runtime.run(run.id).reports[0].text, 'manager 的公开最终报告');
});

test('a host without inspect never gains an invented running transition', async t => {
  const f = fixture(t, { inspect: false }), run = f.run(), pending = f.runtime.task(run.id, 'manager', 0), task = [...f.jobs.values()][0];
  f.start(task.id); f.finish(task.id); await pending;
  assert.equal(f.runtime.run(run.id).tasks[0].startedAt, undefined);
  assert.deepEqual(f.runtime.run(run.id).activity.events.filter(event => event.type.startsWith('task.')).map(event => event.type), ['task.queued', 'task.completed']);
});

test('native completion cannot erase a public-read failure before a successful public read', async t => {
  const f = fixture(t), run = f.run(), pending = f.runtime.task(run.id, 'manager', 0), task = [...f.jobs.values()][0];
  f.start(task.id); task.messageId = 'recoverable-public-message';
  f.messages.set(task.messageId, { id: task.messageId, role: 'assistant', status: 'completed', content: [{ type: 'text', text: '恢复后的公开回复' }] });
  const read = f.host.messages.read; f.host.messages.read = () => { throw Object.assign(new Error('Public message unavailable'), { code: 'task_private' }); };
  await f.runtime.observeTask(run.id, task.id);
  assert.equal(f.runtime.run(run.id).tasks[0].stage, '公开工作状态');
  f.finish(task.id); await pending;
  assert.equal(f.runtime.run(run.id).tasks[0].observationError.code, 'task_private');
  f.host.messages.read = read; await f.runtime.observeTask(run.id, task.id);
  assert.equal(f.runtime.run(run.id).tasks[0].publicOutput.text, '恢复后的公开回复');
  assert.equal(f.runtime.run(run.id).tasks[0].observationError, undefined);
});

test('older minimal task receipts can omit optional conversation and timing fields', async t => {
  const f = fixture(t, { inspect: false }), run = f.run();
  f.host.agents.wait = async id => ({ id, status: 'completed', result: { text: 'Public completion' } });
  await f.runtime.task(run.id, 'manager', 0);
  assert.equal(f.runtime.run(run.id).reports[0].text, 'Public completion');
  assert.equal(activitySnapshot(f.runtime.run(run.id)).tasks[0].startedAt, null);
});

test('the real single workflow emits decision, execution and archive evidence with an explicit mock marker', async t => {
  const f = fixture(t, { mockModelResponses: true });
  const run = f.runtime.trigger(f.plan.id, { kind: 'manual', id: 'actual-flow' });
  const next = async role => { await flush(() => [...f.jobs.values()].some(job => job.request.input.role === role)); const job = [...f.jobs.values()].find(value => value.request.input.role === role); f.start(job.id); await f.runtime.observeTask(run.id, job.id); return job; };
  const manager = await next('manager'); await f.runtime.context(f.child(manager.id), run.id); f.runtime.decide(f.child(manager.id), run.id, unchanged); f.finish(manager.id);
  const executor = await next('executor'); await f.runtime.apply(f.child(executor.id), run.id); f.finish(executor.id);
  const reporter = await next('reporter'); await f.runtime.archive(f.child(reporter.id), run.id); f.finish(reporter.id);
  await flush(() => f.runtime.running.size === 0);
  const observed = activitySnapshot(f.runtime.run(run.id), { mode: 'archive' }), types = observed.events.map(event => event.type);
  for (const type of ['run.queued', 'run.started', 'task.queued', 'task.running', 'task.completed', 'report.ready', 'decision.saved', 'execution.progress', 'report.archived', 'run.finished']) assert.ok(types.includes(type), type);
  assert.equal(types.at(-1), 'run.finished'); assert.equal(observed.mockModelResponses, true);
  assert.deepEqual(observed.tasks.map(task => task.stageIndex), [0, 1, 2]); assert.equal(observed.tasks[2].round, 0);
  assert.equal(observed.run.execution.status, 'unchanged'); assert.equal(observed.events.some(event => event.type === 'report.read'), false, 'Scheduling is not evidence of report exchange.');
  const before = clone(observed.events); f.runtime.trigger(f.plan.id, { kind: 'manual', id: 'actual-flow' }); assert.deepEqual(activitySnapshot(f.runtime.run(run.id)).events, before);
});

test('real parallel research and sequential debate create only the report edges each role actually read', async t => {
  const f = fixture(t); f.plan.mode = 'team'; f.storage.put('plans', f.plan);
  const run = f.runtime.trigger(f.plan.id, { kind: 'manual', id: 'actual-team' }), workflow = stages(f.plan);
  for (const [round, roles] of workflow.entries()) {
    await flush(() => [...f.jobs.values()].filter(job => job.request.input.round === round && roles.includes(job.request.input.role)).length === roles.length);
    const stageJobs = [...f.jobs.values()].filter(job => job.request.input.round === round && roles.includes(job.request.input.role));
    for (const job of stageJobs) {
      f.start(job.id); await f.runtime.observeTask(run.id, job.id);
      await f.runtime.context(f.child(job.id), run.id, 'team');
      if (job.request.input.role === 'manager') f.runtime.decide(f.child(job.id), run.id, unchanged);
    }
    for (const job of stageJobs) f.finish(job.id);
  }
  await flush(() => [...f.jobs.values()].some(job => job.request.input.role === 'executor'));
  const executor = [...f.jobs.values()].find(job => job.request.input.role === 'executor');
  f.start(executor.id); await f.runtime.apply(f.child(executor.id), run.id); f.finish(executor.id);
  await flush(() => [...f.jobs.values()].some(job => job.request.input.role === 'reporter'));
  const reporter = [...f.jobs.values()].find(job => job.request.input.role === 'reporter');
  f.start(reporter.id); await f.runtime.archive(f.child(reporter.id), run.id); f.finish(reporter.id);
  await flush(() => f.runtime.running.size === 0);
  const actual = activitySnapshot(f.runtime.run(run.id)), edges = actual.events.filter(event => event.type === 'report.read'), byId = new Map(actual.tasks.map(task => [task.id, task]));
  const incoming = role => edges.filter(event => byId.get(event.toTaskId).role === role);
  assert.equal(incoming('bull').length, 4); assert.equal(incoming('bear').length, 5);
  assert.equal(incoming('risk').length, 6); assert.equal(incoming('manager').length, 7);
  assert.ok(edges.every(event => byId.get(event.fromTaskId).stageIndex < byId.get(event.toTaskId).stageIndex));
  assert.equal(incoming('executor').length, 0); assert.equal(incoming('reporter').length, 0);
  assert.deepEqual(actual.tasks.filter(task => task.stageIndex === 0).map(task => task.role), workflow[0]);
});

test('cancellation uses the host receipt and disposal removes pollers and subscribers', async t => {
  const f = fixture(t), notices = []; f.runtime.onActivity(value => notices.push(value));
  const run = f.runtime.trigger(f.plan.id, { kind: 'manual', id: 'cancel-flow' });
  const job = [...f.jobs.values()][0]; f.start(job.id); await f.runtime.observeTask(run.id, job.id);
  f.runtime.cancel(run.id, 'Fixture user stopped the plan'); await flush(() => f.runtime.running.size === 0);
  const final = f.runtime.run(run.id);
  assert.equal(final.status, 'cancelled'); assert.equal(final.tasks[0].status, 'canceled');
  assert.equal(final.activity.events.filter(event => event.type === 'task.cancelled').length, 1);
  assert.equal(final.activity.events.filter(event => event.type === 'run.finished').length, 1);
  assert.equal(final.execution, undefined); assert.equal(f.runtime.taskPolls.size, 0);
  await f.runtime.dispose(); assert.equal(f.runtime.activityListeners.size, 0);
  const count = notices.length; await f.runtime.observeTask(run.id, job.id); assert.equal(notices.length, count);
});

test('wait failures preserve their error while recording a separately confirmed cancellation', async t => {
  const f = fixture(t), run = f.run(), pending = f.runtime.task(run.id, 'manager', 0), rejected = assert.rejects(pending, /Fixture wait disconnected/);
  const job = [...f.jobs.values()][0]; f.start(job.id); job.reject(new Error('Fixture wait disconnected')); await rejected;
  assert.equal(f.runtime.run(run.id).tasks[0].status, 'canceled');
  assert.equal(f.runtime.run(run.id).activity.events.filter(event => event.type === 'task.cancelled').length, 1);
  assert.equal(f.runtime.run(run.id).activity.events.some(event => event.type === 'report.ready'), false);
  assert.equal(f.runtime.taskPolls.size, 0);
});

test('restart reconciles leftover reporter tasks without replaying a terminal business run', async t => {
  for (const scenario of [
    { name: 'completed with an archived daily report', status: 'completed', native: 'running', expected: 'canceled', report: true },
    { name: 'failed before daily report creation and host task missing', status: 'failed', native: 'missing', expected: 'interrupted', report: false },
    { name: 'completed reporter receipt was not persisted', status: 'completed', native: 'completed', expected: 'completed', report: false },
  ]) await t.test(scenario.name, async child => {
    const f = fixture(child), run = f.run(), receipt = { status: 'unchanged', targetReached: true, orders: [], pauses: [] };
    const reporter = f.host.agents.submit({ model: f.plan.model, input: { role: 'reporter' } }); f.start(reporter.id);
    const job = f.jobs.get(reporter.id); job.status = scenario.native === 'missing' ? 'running' : scenario.native;
    if (scenario.native === 'completed') { job.completedAt = f.advance(); job.result = { text: '已完成的原生归档回复' }; }
    const report = scenario.report ? { fileId: 'saved-daily', path: '手工交易日报/activity/saved.html', state: 'archived' } : undefined;
    const error = scenario.status === 'failed' ? { code: 'ORIGINAL_FAILURE', message: 'Original business failure' } : undefined;
    f.runtime.update(run.id, { status: scenario.status, completedAt: T0, execution: receipt, report, reportPending: true, error,
      tasks: [{ id: 'saved-executor', role: 'executor', round: 1, model: f.plan.model, status: 'completed', completedAt: T0 },
        { ...reporter, role: 'reporter', round: 0, status: scenario.native === 'missing' ? 'queued' : 'running' }] });
    const original = f.runtime.run(run.id), inspected = [], canceled = [], nativeInspect = f.host.agents.inspect, nativeCancel = f.host.agents.cancel;
    f.host.agents.inspect = id => { inspected.push(id); if (scenario.native === 'missing') throw Object.assign(new Error('Host task not found'), { code: 'not_found' }); return nativeInspect(id); };
    f.host.agents.cancel = async (id, reason) => { canceled.push(id); return nativeCancel(id, reason); };
    f.host.agents.submit = () => assert.fail('Restart must not submit another Agent or replay execution');
    f.host.tools.call = async () => assert.fail('Restart must not call a trading backend');
    const resumed = new TradingRuntime(f.host, { timer: false, now: () => T0 + 1000 }), viewer = new TradingActivityViewer(resumed);
    child.after(async () => { await viewer.dispose(); await resumed.dispose(); });
    await assert.rejects(viewer.archive(f.main, run.id), { code: 'RUN_NOT_FINISHED' });
    await resumed.start();
    const recovered = resumed.run(run.id), task = recovered.tasks.find(value => value.id === reporter.id);
    assert.equal(recovered.status, scenario.status); assert.equal(recovered.completedAt, original.completedAt);
    assert.deepEqual(recovered.execution, receipt); assert.deepEqual(recovered.report, report); assert.deepEqual(recovered.error, error);
    assert.equal(recovered.reportPending, !scenario.report); assert.equal(task.status, scenario.expected);
    assert.deepEqual(inspected, [reporter.id]); assert.deepEqual(canceled, scenario.native === 'running' ? [reporter.id] : []);
    assert.equal(recovered.activity.events.filter(event => event.type === 'run.finished').length, 1);
    if (scenario.native === 'missing') {
      assert.equal(task.observationError.code, 'not_found'); assert.equal(task.recovery.kind, 'host_task_missing');
      assert.equal(recovered.activity.events.some(event => event.type === 'task.completed' && event.taskId === reporter.id), false);
    } else assert.equal(task.completedAt, f.jobs.get(reporter.id).completedAt);
    if (scenario.native === 'completed') assert.equal(recovered.reports.find(value => value.taskId === reporter.id).text, '已完成的原生归档回复');
    const archived = await viewer.archive(f.main, run.id), recording = JSON.parse(f.files.get(archived.dataPath).content);
    assert.equal(archived.state, 'archived'); assert.equal(recording.tasks.find(value => value.id === reporter.id).status, scenario.expected);
    assert.deepEqual(recording.run.execution, receipt); assert.equal(recording.events.at(-1).type, 'run.finished');
    const stable = resumed.run(run.id); await resumed.start(); assert.deepEqual(resumed.run(run.id), stable, 'A later start preserves the recovered record and archive.');
  });
});

test('restart does not make an unconfirmed live reporter archivable', async t => {
  const f = fixture(t), run = f.run(), reporter = f.host.agents.submit({ model: f.plan.model, input: { role: 'reporter' } }); f.start(reporter.id);
  f.runtime.update(run.id, { status: 'completed', completedAt: T0, tasks: [{ ...reporter, role: 'reporter', round: 0, status: 'running' }] });
  const cancel = f.host.agents.cancel;
  f.host.agents.cancel = async () => { throw Object.assign(new Error('Host cancellation unavailable'), { code: 'HOST_UNAVAILABLE' }); };
  const resumed = new TradingRuntime(f.host, { timer: false }), viewer = new TradingActivityViewer(resumed);
  t.after(async () => { await viewer.dispose(); await resumed.dispose(); });
  try {
    await resumed.start();
    const recovered = resumed.run(run.id);
    assert.equal(recovered.tasks[0].status, 'running'); assert.equal(recovered.tasks[0].observationError.code, 'HOST_UNAVAILABLE');
    assert.equal(recovered.activity.events.some(event => event.type === 'run.finished'), false);
    await assert.rejects(viewer.archive(f.main, run.id), { code: 'RUN_NOT_FINISHED' });
  } finally { f.host.agents.cancel = cancel; }
});

test('a main event observes public streaming text through the actual service HostContext', { skip: !process.env.SESAME_HOST_ROOT, timeout: 45000 }, async () => {
  const root = process.env.SESAME_HOST_ROOT;
  const { fixture: nativeFixture, eventually } = await import(pathToFileURL(join(root, 'tests/fixture-provider.js')));
  const { createTools } = await import(pathToFileURL(join(root, 'modules/agent/tools.js')));
  const { createHostContext } = await import(pathToFileURL(join(root, 'modules/plugins/context.js')));
  const held = [], publicText = '公开阶段文字：正在核对真实工具上下文。';
  const app = await nativeFixture({ responseHandler: (_body, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = { id: 'activity-public-stream', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: publicText }, finish_reason: null }] };
    response.write(`data: ${JSON.stringify(chunk)}\n\n`); held.push(response); return true;
  } });
  try {
    const manifest = JSON.parse(await readFile(new URL('../packages/mt5/plugin.json', import.meta.url)));
    const definitions = JSON.parse(await readFile(new URL('../packages/mt5/tools.json', import.meta.url))).filter(tool => tool.name === 'mt5_trading_context');
    app.runtime.plugins.register({ id: 'sesame/mt5', version: manifest.version, digest: `sha256:${'c'.repeat(64)}`, title: 'Activity account fixture', description: 'No broker connection',
      default_state: 'mounted', agent_scope: 'all', execution: 'native', runtime_status: 'ready', tool_names: ['mt5_trading_context'], main_tool_names: [], definitions,
      resources: [], skills: [], diagnostics: [], dependency_lock: [], module: Promise.resolve({ createTools: () => definitions.map(definition => ({ ...definition,
        execute: async () => ({ details: { account: { accountId: 'activity-only', server: 'Fictional', revision: '1' } }, content: [] }),
      })) }) });
    app.runtime.options.plugins['sesame/manual-trading'] = { activityPollMs: 20 };
    const draft = join(app.runtime.workspaces.root('conv_main'), 'activity-stream-fixture');
    await cp(fileURLToPath(new URL('../packages/manual-trading/', import.meta.url)), draft, { recursive: true });
    const checked = await app.runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(checked.passed, true, JSON.stringify(checked.results));
    const installed = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
    assert.equal(installed.runtime_status, 'ready'); app.runtime.plugins.activate('conv_main', installed.id);
    const main = async (name, args = {}) => {
      const result = await createTools(app.runtime, 'conv_main').find(tool => tool.name === name).execute(`activity-main-${name}`, args);
      assert.ok(!result.isError, JSON.stringify(result)); return result.details;
    };
    const descriptor = (await main('manual_trading_models')).models.find(value => value.provider === 'fixture' && value.id === 'fixture');
    const model = { provider: descriptor.provider, id: descriptor.id, configurationDigest: descriptor.configurationDigest };
    const plan = await main('manual_trading_plan', { action: 'save', plan: { title: '公开流观测', backend: 'mt5', mode: 'single', model, event_keys: ['activity.test'], enabled: true } });
    const triggered = await main('manual_trading_event', { key: 'activity.test', event_id: 'actual-main-event' });
    assert.equal(triggered.runs[0].planId, plan.id);
    const id = triggered.runs[0].id, serviceHost = createHostContext(app.runtime, app.runtime.plugins.entry(installed.id));
    await eventually(() => held.length === 1);
    let actual;
    try { actual = await eventually(() => { const run = serviceHost.storage.get('runs', id); return run.tasks[0]?.publicOutput?.text === publicText ? run : null; }, 5000); }
    catch (error) { assert.fail(`${error.message}: ${JSON.stringify(serviceHost.storage.get('runs', id).tasks.map(task => ({ status: task.status, observationError: task.observationError })))}`); }
    assert.equal(actual.tasks[0].status, 'running'); assert.equal(actual.reports.length, 0, 'Text is observed before a final role report exists.');
    assert.equal(actual.tasks[0].publicOutput.status, 'streaming'); assert.equal(actual.tasks[0].observationError, undefined);
    assert.deepEqual(activitySnapshot(actual).run.trigger, { kind: 'event', key: 'activity.test' });
    await main('manual_trading_runs', { action: 'cancel', run_id: id });
  } finally { for (const response of held) response.destroy(); await app.dispose(); }
});
