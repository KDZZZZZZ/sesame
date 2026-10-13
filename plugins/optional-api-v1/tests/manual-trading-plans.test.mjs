import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { TradingRuntime } from '../packages/manual-trading/runtime.js';
import { makePlan, selectModel, accountKey, ROLES, validateDecision } from '../packages/manual-trading/plans.js';
import { stages, taskTools } from '../packages/manual-trading/team.js';

const T0 = Date.parse('2026-10-13T12:00:00Z');
const copy = value => value === undefined ? undefined : structuredClone(value);
const baseModel = { provider: 'fixture', id: 'primary', configurationDigest: 'sha256:primary-v1' };
const alternateModel = { provider: 'fixture', id: 'alternate', configurationDigest: 'sha256:alternate-v1' };
const unchanged = { unchanged: true, targets: [], rationale: 'Available evidence does not justify changing any position.', pause_strategies: [], evidence_dataset_ids: [] };

function fixture(t, { service = true } = {}) {
  let time = T0, account = { accountId: 'account-1', server: 'Fixture-Demo', revision: '1' };
  const records = new Map(), jobs = new Map(), requests = [], brokerCalls = [], events = [], files = new Map();
  const blobs = new Map(), artifacts = new Map();
  const models = [copy(baseModel), copy(alternateModel)];
  const storage = {
    directory: `plans-fixture-${Math.random()}`,
    get: (kind, id) => copy(records.get(`${kind}:${id}`)),
    put(kind, value) { records.set(`${kind}:${value.id}`, copy(value)); return copy(value); },
    list: kind => [...records].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => copy(value)),
    delete: (kind, id) => records.delete(`${kind}:${id}`),
    transaction: fn => fn(),
  };
  const reportFiles = {
    list: async () => ({ entries: [...files.values()].map(({ content: _content, ...entry }) => copy(entry)) }),
    mkdir: async ({ path }) => { if (files.has(path)) throw new Error('Already exists'); const entry = { id: `dir-${files.size}`, path, kind: 'directory' }; files.set(path, entry); return copy(entry); },
    write: async ({ path, content }) => { const entry = { id: `file-${files.size}`, path, kind: 'file', content }; files.set(path, entry); return copy(entry); },
    read: async ({ path }) => copy(files.get(path)),
  };
  const artifactPort = {
    blob(value) { const bytes = Buffer.from(value), hash = digest(bytes); blobs.set(hash, bytes); return { digest: hash, size: bytes.length }; },
    readBlob(ref) { const bytes = blobs.get(ref.digest); assert.equal(bytes?.length, ref.size); assert.equal(digest(bytes), ref.digest); return Buffer.from(bytes); },
    publish(input) {
      const previous = artifacts.get(input.operationId);
      if (previous) { assert.equal(canonical(previous.input), canonical(input), 'Artifact operation IDs cannot change their evidence'); return copy(previous.ref); }
      assert.equal(input.manifest.schemaVersion, '1.0.0');
      for (const blob of input.manifest.blobs) artifactPort.readBlob(blob);
      const ref = { id: `artifact-${artifacts.size + 1}`, revision: 'revision-1', digest: digest(input.manifest), kind: input.manifest.kind, schemaVersion: input.manifest.schemaVersion };
      artifacts.set(input.operationId, { input: copy(input), ref }); return copy(ref);
    },
    read(ref) { const value = [...artifacts.values()].find(item => canonical(item.ref) === canonical(ref)); assert.ok(value, 'Exact artifact revision must exist'); return { ref: copy(ref), manifest: copy(value.input.manifest) }; },
  };
  const terminal = new Set(['completed', 'failed', 'canceled', 'interrupted', 'expired']);
  function view(job) {
    return copy({ id: job.id, pluginId: 'sesame/manual-trading', requestId: job.request.requestId, status: job.status,
      conversationId: job.conversationId, model: job.request.model, result: job.result ?? null, error: job.error ?? null });
  }
  const agents = {
    // Match the host port's declared request and result shape. Completion is
    // controlled by the test, without a model, network, or a hidden task loop.
    submit(request) {
      const fields = ['requestId', 'title', 'kind', 'instructions', 'input', 'tools', 'model', 'lane', 'queue', 'expiresAt', 'timeoutMs', 'maxTurns', 'maxToolCalls', 'output'];
      assert.ok(Object.keys(request).every(key => fields.includes(key)), 'Use only public Agent request fields');
      assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 40000);
      const previous = [...jobs.values()].find(job => job.request.requestId === request.requestId);
      if (previous) { assert.equal(canonical(previous.request), canonical(request)); return view(previous); }
      const selected = models.find(model => model.provider === request.model.provider && model.id === request.model.id);
      if (!selected || canonical(selected) !== canonical(request.model)) throw Object.assign(new Error('Agent model configuration changed'), { code: 'MODEL_CHANGED' });
      const job = { id: `agent-${jobs.size + 1}`, request: copy(request), status: 'queued', conversationId: null };
      jobs.set(job.id, job); requests.push(copy(request)); return view(job);
    },
    wait(id, signal) {
      const job = jobs.get(id);
      if (terminal.has(job.status)) return Promise.resolve(view(job));
      job.status = 'running'; job.conversationId = `conv-${id}`;
      return new Promise((resolve, reject) => {
        const abort = () => { cleanup(); reject(signal.reason ?? new Error('aborted')); };
        const cleanup = () => signal?.removeEventListener('abort', abort);
        job.finish = () => { cleanup(); resolve(view(job)); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    },
    cancel(id, reason) { const job = jobs.get(id); if (!job) throw new Error('Missing task'); if (!terminal.has(job.status)) { job.status = 'canceled'; job.error = reason; job.finish?.(); } return view(job); },
    inspect: id => view(jobs.get(id)), current: () => null,
  };
  const snapshot = () => ({ account: copy(account), capturedAt: time, summary: { equity: '10000' },
    positions: [], orders: [], fills: [], historicalOrders: [], deployments: [], historyCoverage: { status: 'complete' } });
  const host = { scope: { kind: service ? 'service' : 'main', conversationId: service ? null : 'conv_main' }, storage, agents,
    inference: { models: () => copy(models) }, datasets: { read: id => storage.get('datasets', id), list: () => storage.list('datasets') },
    reports: { files: { forSpace: () => reportFiles } },
    artifacts: artifactPort,
    plugins: { inspect: () => ({ state: 'enabled' }), isActive: () => true },
    events: { emit: (name, payload) => events.push({ name, payload: copy(payload) }) },
    tools: { call: async (request, signal) => {
      signal?.throwIfAborted(); brokerCalls.push(copy(request));
      assert.ok(['mt5_trading_context', 'qmt_trading_context'].includes(request.name), `Unexpected side effect: ${request.name}`);
      return { details: request.arguments.action === 'identity' ? { account: copy(account) } : snapshot() };
    } },
  };
  const main = { ...host, scope: { kind: 'main', conversationId: 'conv_main' } };
  let runtime = new TradingRuntime(host, { now: () => time, timer: false });
  t.after(async () => {
    const disposing = runtime.dispose();
    // Fixture cleanup must not hang if a regression leaves a reporter alive
    // after its business run became terminal. That case is tested explicitly.
    for (const job of jobs.values()) if (!terminal.has(job.status)) agents.cancel(job.id, 'Test fixture cleanup');
    await disposing;
  });
  const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('Expected observable state was not reached'); };
  return {
    host, main, records, models, jobs, requests, brokerCalls, events, files, storage, waitFor,
    get runtime() { return runtime; }, get time() { return time; }, get account() { return copy(account); },
    advance: milliseconds => { time += milliseconds; }, setAccount: value => { account = copy(value); },
    input: (extra = {}) => ({ id: 'plan-1', title: 'Fixture portfolio', backend: 'mt5', mode: 'single', model: copy(baseModel), symbols: ['EURUSD'], ...extra }),
    active: role => [...jobs.values()].filter(job => job.status === 'running' && (!role || job.request.input.role === role)),
    child(id) { const job = jobs.get(id); return { ...host, scope: { kind: 'subagent', conversationId: job.conversationId }, agents: { ...agents, current: () => ({ ...view(job), input: copy(job.request.input) }) } }; },
    finish(id, text = `Report from ${jobs.get(id)?.request.input.role}`) { const job = jobs.get(id); assert.equal(job.status, 'running'); job.status = 'completed'; job.result = { text }; job.finish(); },
    restart: async () => { runtime = new TradingRuntime(host, { now: () => time, timer: false }); await runtime.start(); return runtime; },
    async completeSingle(runId) {
      await waitFor(() => [...jobs.values()].some(job => job.status === 'running' && job.request.input.runId === runId && job.request.input.role === 'manager'));
      const manager = [...jobs.values()].find(job => job.status === 'running' && job.request.input.runId === runId && job.request.input.role === 'manager');
      await runtime.context(this.child(manager.id), runId);
      runtime.decide(this.child(manager.id), runId, unchanged);
      this.finish(manager.id);
      await waitFor(() => [...jobs.values()].some(job => job.status === 'running' && job.request.input.runId === runId && job.request.input.role === 'executor'));
      const executor = [...jobs.values()].find(job => job.status === 'running' && job.request.input.runId === runId && job.request.input.role === 'executor');
      await runtime.apply(this.child(executor.id), runId);
      this.finish(executor.id);
      await waitFor(() => runtime.run(runId).status === 'completed');
      if (!runtime.run(runId).report) {
        await waitFor(() => [...jobs.values()].some(job => job.status === 'running' && job.request.input.runId === runId && job.request.input.role === 'reporter'));
        const reporter = [...jobs.values()].find(job => job.status === 'running' && job.request.input.runId === runId && job.request.input.role === 'reporter');
        await runtime.archive(this.child(reporter.id), runId); this.finish(reporter.id);
      }
      await waitFor(() => ![...runtime.running.values()].some(entry => entry.runId === runId));
    },
  };
}

test('each role may override its model while the frozen default covers omitted roles', t => {
  const f = fixture(t);
  for (const role of ROLES) {
    const plan = makePlan(f.main, f.input({ mode: 'team', agent_models: { [role]: alternateModel } }), f.account, null, f.time);
    for (const selectedRole of ROLES) assert.equal((plan.agentModels[selectedRole] ?? plan.model).id, selectedRole === role ? 'alternate' : 'primary');
    f.models[0].configurationDigest = 'sha256:mutated-after-save';
    assert.equal(plan.model.configurationDigest, baseModel.configurationDigest, 'saved plans do not share mutable registry descriptors');
    f.models[0] = copy(baseModel);
  }
  assert.throws(() => makePlan(f.main, f.input({ agent_models: { invented: alternateModel } }), f.account), { code: 'INVALID_ARGUMENT' });
});

test('unavailable or drifted configurations require an explicit new model selection', t => {
  const f = fixture(t);
  f.models[0].configurationDigest = 'sha256:new-route';
  assert.throws(() => selectModel(f.main, baseModel), { code: 'MODEL_CHANGED' });
  assert.throws(() => selectModel(f.main, { provider: 'fixture', id: 'removed' }), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(selectModel(f.main, { provider: 'fixture', id: 'primary' }).configurationDigest, 'sha256:new-route');
});

test('team stages give analysts read tools and reserve decision and execution tools for their roles', () => {
  const plan = { mode: 'team', debateRounds: 2, backend: 'mt5' };
  const sequence = stages(plan);
  assert.equal(sequence[0].length, 4);
  assert.deepEqual(sequence.slice(1).flat(), ['bull', 'bear', 'bull', 'bear', 'risk', 'manager']);
  for (const role of ['market', 'fundamentals', 'news', 'sentiment', 'bull', 'bear', 'risk']) {
    const tools = taskTools(plan, role, true);
    assert.ok(tools.includes('manual_trading_context')); assert.ok(tools.includes('financial_research_read'));
    assert.ok(!tools.includes('manual_trading_decide')); assert.ok(!tools.includes('manual_trading_apply')); assert.ok(!tools.includes('mt5_trade'));
  }
  assert.ok(taskTools(plan, 'manager', false).includes('manual_trading_decide'));
  assert.ok(!taskTools(plan, 'manager', false).includes('financial_research_query'));
});

test('completed stages explicitly share reports with subsequent roles using their actual frozen models', async t => {
  const f = fixture(t);
  const plan = await f.runtime.configure(f.main, f.input({ mode: 'team', debate_rounds: 1, agent_models: { market: alternateModel, manager: alternateModel, executor: alternateModel } }));
  const run = f.runtime.trigger(plan.id, { kind: 'manual', id: 'team-run' });
  await f.waitFor(() => f.active().length === 4);
  const analysts = f.active();
  assert.equal(analysts.find(job => job.request.input.role === 'market').request.model.id, 'alternate');
  assert.equal(analysts.find(job => job.request.input.role === 'news').request.model.id, 'primary');
  const first = await f.runtime.context(f.child(analysts[0].id), run.id, 'team');
  assert.deepEqual(first.reports.items, []);
  for (const job of analysts.slice(0, 3)) f.finish(job.id, `source-backed ${job.request.input.role}`);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.active('bull').length, 0, 'a debate cannot skip an unfinished analyst');
  f.finish(analysts[3].id, `source-backed ${analysts[3].request.input.role}`);
  await f.waitFor(() => f.active('bull').length === 1);
  const bull = f.active('bull')[0], bullContext = await f.runtime.context(f.child(bull.id), run.id, 'team');
  assert.deepEqual(new Set(bullContext.reports.items.map(report => report.role)), new Set(['market', 'fundamentals', 'news', 'sentiment']));
  f.finish(bull.id, 'Bull: evidence supports holding with uncertainty.');
  await f.waitFor(() => f.active('bear').length === 1);
  const bear = f.active('bear')[0], bearContext = await f.runtime.context(f.child(bear.id), run.id, 'team');
  assert.ok(bearContext.reports.items.some(report => report.text.startsWith('Bull:')));
  f.finish(bear.id, 'Bear: no sufficient evidence to change exposure.');
  await f.waitFor(() => f.active('risk').length === 1);
  const risk = f.active('risk')[0];
  assert.equal((await f.runtime.context(f.child(risk.id), run.id, 'team')).reports.total, 6);
  f.finish(risk.id, 'Risk: maintain existing targets.');
  await f.completeSingle(run.id);
  const finished = f.runtime.run(run.id);
  assert.equal(finished.status, 'completed'); assert.equal(finished.execution.status, 'unchanged');
  assert.equal(finished.tasks.find(task => task.role === 'executor').model.id, 'alternate');
  assert.equal(finished.memoryError, undefined); assert.ok(finished.report.fileId);
  assert.ok(f.storage.list('trading_memory_runs')[0].reports.some(report => report.role === 'bear'));
  const artifact = f.host.artifacts.read(finished.report.evidenceRef);
  assert.equal(artifact.ref.kind, 'resource');
  const frozen = JSON.parse(f.host.artifacts.readBlob(artifact.manifest.blobs[0]).toString('utf8'));
  assert.equal(frozen.status, 'completed'); assert.equal(frozen.decision.unchanged, true);
  assert.equal(frozen.execution.status, 'unchanged'); assert.deepEqual(frozen.execution.orders, []); assert.equal(frozen.execution.targetReached, null);
  assert.deepEqual(JSON.parse(f.files.get(finished.report.dataPath).content), frozen, 'JSON companion and immutable resource contain the same factual run');
});

test('daily evidence retains an unexecuted target without turning it into fills or returns', async t => {
  const f = fixture(t); await f.runtime.configure(f.main, f.input());
  const run = f.runtime.trigger('plan-1', { kind: 'manual', id: 'unexecuted-target' });
  await f.waitFor(() => f.active('manager').length === 1);
  const manager = f.active('manager')[0];
  await f.runtime.context(f.child(manager.id), run.id);
  f.runtime.decide(f.child(manager.id), run.id, { ...unchanged, unchanged: false, targets: [{ symbol: 'EURUSD', quantity: '0.1', unit: 'lots' }] });
  f.finish(manager.id);
  await f.waitFor(() => f.active('executor').length === 1);
  f.finish(f.active('executor')[0].id, 'Execution was not attempted.');
  await f.waitFor(() => f.runtime.run(run.id).status === 'failed' && f.active('reporter').length === 1);
  const reporter = f.active('reporter')[0], report = await f.runtime.archive(f.child(reporter.id), run.id);
  f.finish(reporter.id);
  const artifact = f.host.artifacts.read(report.evidenceRef);
  const frozen = JSON.parse(f.host.artifacts.readBlob(artifact.manifest.blobs[0]).toString('utf8'));
  assert.equal(frozen.error.code, 'NOT_EXECUTED'); assert.equal(frozen.decision.targets[0].quantity, '0.1');
  assert.equal(frozen.execution, undefined); assert.deepEqual(frozen.snapshot.fills, []);
  assert.equal(frozen.realizedPnl, undefined); assert.equal(frozen.actualTradeReturn, undefined);
  assert.equal(f.storage.list('trading_memory_runs')[0].execution, null);
  assert.ok(f.brokerCalls.every(call => call.arguments.action === 'identity' || call.arguments.action === 'snapshot'));
});

test('interval ticks coalesce elapsed periods and do not submit the same interval twice', async t => {
  const f = fixture(t), plan = await f.runtime.configure(f.main, f.input({ interval_minutes: 5 }));
  f.advance(5 * 60000);
  await Promise.all([f.runtime.tick(), f.runtime.tick(), f.runtime.tick()]);
  assert.equal(f.storage.list('runs').length, 1); assert.equal(f.requests.length, 1);
  assert.equal(f.storage.list('runs')[0].trigger.id, String(plan.nextDueAt));
  f.advance(60 * 60000); await f.runtime.tick(); await f.runtime.tick();
  assert.equal(f.storage.list('runs').length, 2, 'missed intervals create a latest run, not twelve stale runs');
  assert.equal(f.requests.length, 1, 'the second interval waits behind the same active account');
});

test('event identity is idempotent across redelivery time and rejects changed payload', async t => {
  const f = fixture(t); await f.runtime.configure(f.main, f.input({ event_keys: ['news'] }));
  const [first] = f.runtime.event('news', 'event-1', { headline: 'Same observed event' });
  f.advance(1000);
  const [again] = f.runtime.event('news', 'event-1', { headline: 'Same observed event' });
  assert.equal(again.id, first.id); assert.equal(f.storage.list('runs').length, 1); assert.equal(f.requests.length, 1);
  assert.throws(() => f.runtime.event('news', 'event-1', { headline: 'Different payload' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('same-account plans run serially while new pending triggers replace only their own plan queue', async t => {
  const f = fixture(t);
  const a = await f.runtime.configure(f.main, f.input({ id: 'a' }));
  const b = await f.runtime.configure(f.main, f.input({ id: 'b' }));
  assert.equal(accountKey(a), accountKey(b));
  const active = f.runtime.trigger(a.id, { kind: 'manual', id: 'active' });
  const pending1 = f.runtime.trigger(b.id, { kind: 'manual', id: 'pending-1' });
  const pending2 = f.runtime.trigger(b.id, { kind: 'manual', id: 'pending-2' });
  assert.equal(f.requests.length, 1); assert.equal(f.runtime.run(pending1.id).status, 'cancelled');
  assert.equal(f.runtime.run(pending1.id).supersededBy, pending2.id); assert.equal(f.runtime.run(pending2.id).status, 'queued');
  await f.completeSingle(active.id);
  await f.waitFor(() => f.active('manager').some(job => job.request.input.runId === pending2.id));
  assert.equal(f.requests.filter(request => request.input.runId === pending1.id).length, 0);
  await f.completeSingle(pending2.id);
  assert.equal(f.runtime.run(pending2.id).status, 'completed');
});

test('canceling a queued run does not cancel another active run on the same account', async t => {
  const f = fixture(t);
  await f.runtime.configure(f.main, f.input({ id: 'a' })); await f.runtime.configure(f.main, f.input({ id: 'b' }));
  const active = f.runtime.trigger('a', { kind: 'manual', id: 'active' });
  const queued = f.runtime.trigger('b', { kind: 'manual', id: 'queued' });
  f.runtime.cancel(queued.id, 'Only cancel the queued plan');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.runtime.run(queued.id).status, 'cancelled');
  assert.equal(f.runtime.run(active.id).status, 'researching');
  assert.equal(f.active('manager').length, 1);
  await f.completeSingle(active.id);
});

test('canceling active work is terminal and re-delivering that trigger never replays it', async t => {
  const f = fixture(t); await f.runtime.configure(f.main, f.input());
  const trigger = { kind: 'manual', id: 'cancel-once' }, run = f.runtime.trigger('plan-1', trigger);
  await f.waitFor(() => f.active().length === 1);
  f.runtime.cancel(run.id, 'Stop this run');
  await f.waitFor(() => f.runtime.running.size === 0);
  const before = f.requests.length;
  assert.equal(f.runtime.trigger('plan-1', trigger).status, 'cancelled');
  await f.runtime.tick(); assert.equal(f.requests.length, before);
  assert.equal(f.runtime.run(run.id).execution, undefined);
});

test('restart retains partial execution receipts and interrupts unfinished runs without replay', async t => {
  const f = fixture(t); const plan = await f.runtime.configure(f.main, f.input());
  const frozen = { id: 'persisted-run', planId: plan.id, plan, trigger: { kind: 'manual', id: 'interrupted' }, status: 'executing', createdAt: f.time,
    tasks: [], reports: [], decision: unchanged, executionProgress: { orders: [{ operationId: 'already-submitted', receipt: { status: 'outcome_unknown' } }] } };
  f.storage.put('runs', frozen);
  await f.restart(); await f.runtime.tick();
  const recovered = f.runtime.run(frozen.id);
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.error.code, 'RESTART_INTERRUPTED');
  assert.deepEqual(recovered.executionProgress, frozen.executionProgress);
  assert.equal(f.requests.length, 0); assert.equal(f.brokerCalls.filter(call => call.arguments.action === 'snapshot').length, 0);
});

test('disposing a terminal failed run cancels its pending reporter instead of waiting forever', async t => {
  const f = fixture(t); await f.runtime.configure(f.main, f.input());
  const run = f.runtime.trigger('plan-1', { kind: 'manual', id: 'terminal-reporter' });
  await f.waitFor(() => f.active('manager').length === 1);
  f.finish(f.active('manager')[0].id, 'Manager ended without submitting a structured decision.');
  await f.waitFor(() => f.runtime.run(run.id).status === 'failed' && f.active('reporter').length === 1);
  const disposing = f.runtime.dispose(); let finished = false;
  disposing.then(() => { finished = true; });
  await f.waitFor(() => finished);
  assert.equal(f.active('reporter').length, 0);
  assert.equal(f.runtime.run(run.id).status, 'failed', 'shutdown should preserve the factual business failure');
});

test('an account or connection revision changed before observation cannot produce a saved decision', async t => {
  const f = fixture(t); await f.runtime.configure(f.main, f.input());
  const run = f.runtime.trigger('plan-1', { kind: 'manual', id: 'account-change' });
  await f.waitFor(() => f.active('manager').length === 1);
  const manager = f.active('manager')[0], child = f.child(manager.id);
  f.setAccount({ ...f.account, revision: '2' });
  await assert.rejects(f.runtime.context(child, run.id), { code: 'ACCOUNT_CHANGED' });
  assert.throws(() => f.runtime.decide(child, run.id, unchanged), { code: 'RUN_NOT_READY' });
  assert.equal(f.runtime.run(run.id).decision, undefined); assert.equal(f.runtime.run(run.id).snapshot, undefined);
});

test('a model configuration change after plan creation fails the run before any decision or execution', async t => {
  const f = fixture(t); await f.runtime.configure(f.main, f.input());
  f.models[0].configurationDigest = 'sha256:changed-route';
  const run = f.runtime.trigger('plan-1', { kind: 'manual', id: 'model-drift' });
  await f.waitFor(() => f.runtime.run(run.id).status === 'failed' && f.runtime.running.size === 0);
  assert.equal(f.runtime.run(run.id).error.code, 'MODEL_CHANGED');
  assert.equal(f.requests.length, 0); assert.equal(f.runtime.run(run.id).decision, undefined); assert.equal(f.runtime.run(run.id).execution, undefined);
});

test('decision validation supports unchanged exposure and rejects inconsistent target instructions', () => {
  const plan = { backend: 'qmt', symbols: ['600000.SH'] }, snapshot = { positions: [], deployments: [] };
  assert.equal(validateDecision(plan, snapshot, unchanged).unchanged, true);
  assert.throws(() => validateDecision(plan, snapshot, { ...unchanged, targets: [{ symbol: '600000.SH', quantity: '100', unit: 'shares' }] }), { code: 'INVALID_DECISION' });
  assert.throws(() => validateDecision(plan, snapshot, { ...unchanged, unchanged: false, targets: [{ symbol: '600000.SH', quantity: '-1', unit: 'shares' }] }), { code: 'INVALID_DECISION' });
});
