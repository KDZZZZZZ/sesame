import { workflowReports } from './workflow-report-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TradingRuntime } from '../packages/trading-decision/runtime.js';
import { records, closeRecords } from '../packages/trading-decision/records.js';
import { resourceFixture } from '../../api-v1/tests/mt5-resource-fixture.js';

const memoryCapabilities = [...['memory_trading_context', 'memory_read'].map(localId => ({ pluginId: 'sesame/memory', localId, consumers: ['agent'] })), { pluginId: 'sesame/data-access', localId: 'data_read', consumers: ['agent'] }];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'manual-unified-'));
  const host = { context: { pluginId: 'sesame/trading-decision', pluginVersion: 'test', pluginRevision: 'sha256:test', storageRoot: root, sessionId: 'workflow-session', runId: 'workflow-run', kind: 'subagent' }, events: { emit: async () => {} } };
  host.plugins = { read: async id => ['sesame/memory', 'sesame/data-access'].includes(id) ? { id, state: 'discoverable', digest: 'memory-fixture' } : null };
  const observations = [];
  host.capabilities = { invoke: async (id, input) => {
    assert.equal(id, 'fixture/execution#context'); assert.equal(input.action, 'snapshot'); observations.push(structuredClone(input));
    return { type: 'result', value: { account: { accountId: 'fixture' }, capturedAt: 1, positions: [], orders: [], fills: [], historicalOrders: [], deployments: [], historyCoverage: { scope: 'synthetic_observed_range', complete: false } } };
  } };
  const resources = resourceFixture(host), emitted = [];
  const reportService = workflowReports(host);
  const execution = { run: { id: 'workflow-run' }, attempt: 1, checkpoint: async state => { execution.checkpointState = structuredClone(state); }, interrupt: async value => { execution.checkpointState=value.state; throw Object.assign(new Error(value.reason), { code: 'RUN_INTERRUPTED', details: value }); }, provenance: { caller: { pluginId: 'sesame/trading-decision' }, workflow: { runId: 'workflow-run', sessionId: 'workflow-session', ownerSessionId: 'main' } },
    emit: (type, data) => emitted.push({ type, data }), progress: data => emitted.push({ type: 'progress', data }) };
  const runtime = new TradingRuntime(host, { timer: false });
  t.after(async () => { await runtime.dispose(); closeRecords(host); await rm(root, { recursive: true, force: true }); });
  const plan = { id: 'plan', title: 'Controlled no-broker fixture', ownerConversationId: 'main', account: { accountId: 'fixture' }, execution: { pluginId: 'fixture/execution', contextTool: 'context', arguments: {} }, reportFolder: 'Reports', symbols: [] };
  records(host).put('plans', plan); runtime.save({ id: 'business-run', planId: plan.id, plan, status: 'queued', createdAt: 1800000000000, tasks: [], reports: [] });
  return { host, runtime, execution, emitted, observations, reportService, ...resources };
}

test('the trading workflow declares a native Run and no custom live HTML protocol', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/trading-decision/capabilities.json', import.meta.url)));
  assert.equal(manifest.capabilities.find(cap => cap.id === 'trading_decision_workflow_execute').kind, 'workflow');
  assert.deepEqual(manifest.views, []); assert.equal(manifest.capabilities.some(cap => cap.id.startsWith('activity_')), false);
});

test('an execution error interrupts with its checkpoint and resumes without repeating a completed stage', async t => {
  const f = await fixture(t), roles = [];
  let blocked = true;
  f.runtime.task = async (id, role) => {
    roles.push(role);
    if (role === 'manager') f.runtime.update(id, { decision: { unchanged: true, targets: [], rationale: 'Retained manager decision' } });
    else if (blocked) throw Object.assign(new Error('Temporary execution transport error'), { code: 'ECONNRESET' });
    else f.runtime.update(id, { execution: { status: 'unchanged', targetReached: true, orders: [], pauses: [] } });
  };
  await assert.rejects(f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution), /Temporary execution transport error/);
  const run = f.runtime.run('business-run');
  assert.equal(run.status, 'interrupted'); assert.equal(run.error.code, 'ECONNRESET'); assert.equal(run.execution, undefined); assert.equal(run.report, undefined);
  assert.equal(run.stageIndex, 1); assert.ok(run.decision); assert.equal(f.emitted.some(event => event.type === 'artifact'), false);
  blocked = false; f.execution.attempt = 2;
  const done = await f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution);
  assert.equal(done.status, 'completed'); assert.equal(done.runId, run.id); assert.equal(f.runtime.run(run.id).workflow.id, 'workflow-run');
  assert.deepEqual(roles, ['manager', 'executor', 'executor']); assert.equal(done.report.ref.kind, 'report');
});

test('a workflow cannot borrow another main conversation plan using input metadata', async t => {
  const f = await fixture(t); f.execution.provenance.workflow.ownerSessionId = 'another-owner';
  f.runtime.task = () => assert.fail('Untrusted owner must not dispatch any Agent');
  await assert.rejects(f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution), { code: 'FORBIDDEN' });
  assert.equal(f.runtime.run('business-run').status, 'queued');
});

test('consuming a paged team result emits only real, deduplicated Run handoffs', async t => {
  const f = await fixture(t);
  f.runtime.update('business-run', { snapshot: { account: {}, capturedAt: 1 },
    tasks: [{ id: 'manager', role: 'manager' }, { id: 'executor', role: 'executor' }],
    reports: [{ taskId: 'executor', role: 'executor', text: 'Own retained context' }, { taskId: 'manager', role: 'manager', text: 'Frozen target decision' }] });
  f.runtime.executions.set('business-run', f.execution);
  const child = { ...f.host, context: { ...f.host.context, sessionId: 'executor-session', runId: 'executor' } };
  const provenance = { agent: { pluginId: 'sesame/trading-decision', sessionId: 'executor-session', runId: 'executor', input: {
    runId: 'business-run', role: 'executor', tradingPlan: { id: 'plan', account: { accountId: 'fixture' } } } } };
  await f.runtime.invocation.run({ provenance }, async () => {
    for (let i = 0; i < 2; i++) await f.runtime.context(child, 'business-run', 'team', 1, 1);
  });
  assert.deepEqual(f.emitted.filter(event => event.type === 'handoff'), [{ type: 'handoff', data: { fromRunId: 'manager', toRunId: 'executor' } }]);
});

test('cancel ends the actual workflow Run while retaining its business checkpoint', async t => {
  const f = await fixture(t), cancelled = [];
  f.host.runs = { cancel: async (ref, options) => { cancelled.push({ ref, options }); return { run: { id: ref.id, status: 'cancelled' } }; } };
  f.runtime.update('business-run', { workflow: { id: 'workflow-run' }, status: 'deciding', tasks: [{ id: 'manager', role: 'manager', status: 'running' }] });
  f.runtime.cancel('business-run', 'Explicit stop');
  await Promise.allSettled(f.runtime.cancelling);
  assert.ok(cancelled.some(call => call.ref.id === 'workflow-run' && call.options.reason === 'Explicit stop'));
  assert.equal(f.runtime.run('business-run').status, 'cancelled');
  assert.equal(f.runtime.run('business-run').tasks[0].status, 'cancelled');
});

test('interrupt after a completed stage retains its checkpoint and resumes the same business run after reopening SQLite', async t => {
  const f = await fixture(t), roles = [];
  let interruptOnce = true;
  f.execution.checkpoint = async state => {
    f.execution.checkpointState = structuredClone(state);
    if (state.stageIndex === 1 && interruptOnce) { interruptOnce = false; throw Object.assign(new Error('Dependency repaired by the main Agent before resume'), { code: 'RUN_INTERRUPTED' }); }
  };
  f.runtime.task = async (id, role) => {
    roles.push(role);
    if (role === 'manager') f.runtime.update(id, { decision: { unchanged: true, targets: [], rationale: 'No fictional order required' }, contextError: { code: 'MT5_PYTHON_UNAVAILABLE', message: 'Cached before pause' } });
  };
  await assert.rejects(f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution), { code: 'RUN_INTERRUPTED' });
  const paused = f.runtime.run('business-run');
  assert.equal(paused.status, 'interrupted'); assert.equal(paused.stageIndex, 1); assert.equal(paused.report, undefined); assert.equal(paused.completedAt, undefined);
  assert.equal(f.emitted.some(event => event.type === 'artifact'), false);
  closeRecords(f.host);
  const resumed = new TradingRuntime(f.host, { timer: false });
  t.after(() => resumed.dispose());
  resumed.task = async (id, role) => { roles.push(role); resumed.update(id, { execution: { status: 'unchanged', targetReached: true, orders: [], pauses: [] } }); };
  f.execution.attempt = 2; f.execution.resume = { reason: 'Dependency restored' };
  const result = await resumed.execute(f.host, 'business-run', new AbortController().signal, f.execution);
  assert.equal(result.runId, 'business-run'); assert.equal(resumed.run(result.runId).workflow.id, 'workflow-run');
  assert.deepEqual(roles, ['manager', 'executor']); assert.equal(resumed.run(result.runId).contextError, null);
  assert.equal(result.status, 'completed'); assert.equal(result.report.ref.kind, 'report');
});

test('an interrupted accepted role reuses its Run identity and creates only one report entry', async t => {
  const f = await fixture(t), model = { provider: 'fixture', id: 'one', configurationDigest: 'one' };
  const plan = { ...f.runtime.run('business-run').plan, model, agentModels: {}, instructions: '',
    execution: { readTools: [], plugins: [], revisions: [] } };
  f.runtime.update('business-run', { plan });
  let invokes = 0, cancels = 0, state = 'interrupted';
  f.host.capabilities = {
    list: async () => ({ items: [...memoryCapabilities, ...['trading_decision_context', 'trading_decision_review', 'trading_decision_decide'].map(localId => ({ pluginId: 'sesame/trading-decision', localId, consumers: ['agent'] }))] }),
    invoke: async () => { invokes++; return { type: 'run', run: { id: 'retained-agent' } }; },
  };
  f.host.runs = { read: async () => ({ run: { id: 'retained-agent', status: state, output: state === 'completed' ? { text: 'Saved observed result', sessionId: 'retained-session' } : null } }),
    cancel: async () => { cancels++; } };
  f.runtime.workHosts.set('business-run', f.host); f.runtime.executions.set('business-run', f.execution);
  await assert.rejects(f.runtime.task('business-run', 'manager', 0, new AbortController().signal), { code: 'RUN_INTERRUPTED' });
  assert.equal(cancels, 0); assert.equal(f.runtime.run('business-run').tasks[0].completedAt, undefined);
  state = 'completed';
  await f.runtime.task('business-run', 'manager', 0, new AbortController().signal);
  await f.runtime.task('business-run', 'manager', 0, new AbortController().signal);
  assert.equal(invokes, 1); assert.equal(f.runtime.run('business-run').tasks.length, 1); assert.equal(f.runtime.run('business-run').reports.length, 1);
});

test('requires readiness is pure while the real workflow checks unavailable native transport before any Agent', async t => {
  const f = await fixture(t), model = { provider: 'fixture', id: 'one', configurationDigest: 'one' };
  const plan = { ...f.runtime.run('business-run').plan, enabled: true, model, agentModels: {},
    execution: { pluginId: 'fixture/execution', contextTool: 'context', readTools: [], plugins: ['fixture/execution'], revisions: [], arguments: {} } };
  f.host.context.models = [model]; records(f.host).put('plans', plan); f.runtime.update('business-run', { plan });
  const before = f.runtime.run('business-run'), calls = [];
  f.host.capabilities = {
    list: async () => ({ items: [...memoryCapabilities, ...['trading_decision_context', 'trading_decision_review', 'trading_decision_decide', 'trading_decision_apply'].map(localId => ({ pluginId: 'sesame/trading-decision', localId, consumers: ['agent'] }))] }),
    invoke: async (id, input) => { calls.push({ id, input }); throw Object.assign(new Error('No IPC connection'), { code: 'MT5_PYTHON_UNAVAILABLE', details: { retryable: false, nativeCode: -10004 } }); },
  };
  const result = await f.runtime.dependencies(f.host, 'business-run', new AbortController().signal);
  assert.equal(result.available, true); assert.equal(result.details.readinessScope, 'frozen-declarations-and-local-state'); assert.equal(result.details.liveObservation, 'not-probed');
  assert.deepEqual(calls, [], 'A requires probe must not call or start the live adapter.');
  assert.deepEqual(f.runtime.run('business-run'), before);
  f.host.context.models = [];
  assert.equal((await f.runtime.dependencies(f.host, 'business-run')).available, false); assert.equal(calls.length, 0);
  f.host.context.models = [model];
  f.runtime.task = () => assert.fail('No Agent may start before live account observation succeeds.');
  await assert.rejects(f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution), { code: 'RUN_INTERRUPTED' });
  assert.deepEqual(calls, [{ id: 'fixture/execution#context', input: { action: 'snapshot', history_days: 30 } }]);
  const interrupted = f.runtime.run('business-run');
  assert.equal(interrupted.error.code, 'MT5_PYTHON_UNAVAILABLE'); assert.deepEqual(interrupted.plan, before.plan);
  assert.equal(interrupted.decision, undefined); assert.equal(interrupted.executionStartedAt, undefined); assert.equal(interrupted.report, undefined);
});

test('a sent execution without its saved receipt blocks recovery and is never resent', async t => {
  const f = await fixture(t), plan = { ...f.runtime.run('business-run').plan, enabled: true };
  records(f.host).put('plans', plan); f.runtime.update('business-run', { plan, executionStartedAt: 1, decision: { unchanged: false, targets: [{ symbol: 'FIXTURE', quantity: '0' }] } });
  f.runtime.authorize = () => f.runtime.run('business-run');
  f.host.capabilities = { invoke: () => assert.fail('Unknown external result must not be resent') };
  assert.equal((await f.runtime.dependencies(f.host, 'business-run')).details.cause.code, 'EXECUTION_OUTCOME_UNKNOWN');
  await assert.rejects(f.runtime.apply(f.host, 'business-run'), error => error.code === 'DEPENDENCY_UNAVAILABLE' && error.details.cause.code === 'EXECUTION_OUTCOME_UNKNOWN');
  const receipt = { status: 'filled', orders: [{ operationId: 'original' }], pauses: [] };
  f.runtime.update('business-run', { execution: receipt });
  assert.deepEqual(await f.runtime.apply(f.host, 'business-run'), receipt);
});

test('waiting for a retained child uses its parent workflow context to join the resumed attempt', async t => {
  const f = await fixture(t), reads = [], waits = [];
  const runs = owner => ({
    read: async () => { reads.push(owner); return { run: { id: 'child', status: 'queued', revision: 2 } }; },
    wait: async () => { waits.push(owner); return { run: { id: 'child', status: 'completed', revision: 3, output: { text: 'Saved result' } } }; },
  });
  f.host.runs = runs('service');
  const workflowHost = { ...f.host, runs: runs('parent-workflow') };
  const result = await f.runtime.waitTask('child', new AbortController().signal, () => {}, workflowHost);
  assert.equal(result.status, 'completed');
  assert.deepEqual(reads, ['parent-workflow']); assert.deepEqual(waits, ['parent-workflow']);
});

test('a resumed workflow keeps later work on the same account queued without a scheduler slot', async t => {
  const f = await fixture(t), plan = { ...f.runtime.run('business-run').plan, enabled: true };
  records(f.host).put('plans', plan);
  f.runtime.update('business-run', { plan, status: 'deciding', workflow: { id: 'retained-workflow' } });
  f.runtime.save({ id: 'next-round', planId: plan.id, plan, status: 'queued', createdAt: 1800000000001, trigger: { kind: 'manual' }, tasks: [], reports: [] });
  let invokes = 0;
  f.host.capabilities = { invoke: async () => { invokes++; f.runtime.update('next-round', { status: 'completed' }); return { type: 'run', run: { id: 'unexpected-next-workflow' } }; } };
  f.host.runs = { wait: async () => ({ reason: 'settled', run: { id: 'unexpected-next-workflow', status: 'completed' } }) };
  assert.equal(f.runtime.running.size, 0);
  f.runtime.pump(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(invokes, 0); assert.equal(f.runtime.run('next-round').status, 'queued');
});

test('interruption during report publication retains execution and cannot announce a finished workflow', async t => {
  const f = await fixture(t), roles = [], notifications = [], archive = f.runtime.archive.bind(f.runtime);
  f.host.events.emit = event => notifications.push(event);
  f.runtime.task = async (id, role) => {
    roles.push(role);
    if (role === 'manager') f.runtime.update(id, { decision: { unchanged: true, targets: [] } });
    else f.runtime.update(id, { execution: { status: 'unchanged', orders: [], pauses: [] } });
  };
  let stop = true;
  f.runtime.archive = async (...args) => { if (stop) { stop = false; throw Object.assign(new Error('Publication safely interrupted'), { code: 'RUN_INTERRUPTED' }); } return archive(...args); };
  await assert.rejects(f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution), { code: 'RUN_INTERRUPTED' });
  assert.equal(f.runtime.run('business-run').status, 'interrupted'); assert.ok(f.runtime.run('business-run').execution); assert.equal(f.runtime.run('business-run').report, undefined);
  assert.equal(notifications.some(event => event.topic.endsWith('run.finished')), false);
  f.execution.attempt = 2;
  const done = await f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution);
  assert.equal(done.status, 'completed'); assert.deepEqual(roles, ['manager', 'executor']); assert.ok(done.report);
});

test('history pages preserve unavailable QMT order history rather than empty complete evidence', async t => {
  const f = await fixture(t), coverage = { scope: 'current_native_trading_day', complete: false, orders: { status: 'partial' }, fills: { status: 'partial' }, historicalOrders: { status: 'unavailable', reason: 'native_current_day_only' } };
  f.runtime.update('business-run', { snapshot: { account: { accountId: 'fixture' }, capturedAt: 1, positions: [], orders: [], fills: [], historicalOrders: [], deployments: [], historyCoverage: coverage } });
  const main = { ...f.host, context: { ...f.host.context, kind: 'main', sessionId: 'main' } };
  const result = await f.runtime.context(main, 'business-run', 'history');
  assert.deepEqual(result.coverage, coverage); assert.deepEqual(result.historicalOrders.items, []);
  assert.equal(result.historicalOrders.status, 'unavailable'); assert.equal(result.historicalOrders.reason, 'native_current_day_only');
});

test('unavailable required execution evidence blocks writes without replacing the saved plan or decision', async t => {
  const f = await fixture(t), original = f.runtime.run('business-run');
  const plan = { ...original.plan, enabled: true, execution: { ...original.plan.execution, revisions: [], arguments: {}, applyTool: 'apply' } };
  records(f.host).put('plans', plan);
  const snapshot = { account: plan.account, positions: [], orders: [], fills: [], historicalOrders: [], deployments: [], historyCoverage: { complete: false, historicalOrders: { status: 'unavailable', reason: 'native_current_day_only' } } };
  const decision = { unchanged: false, targets: [{ symbol: 'FIXTURE', quantity: '1', unit: 'contracts' }], pause_strategies: [], rationale: 'Frozen target; unavailable history must not prove no previous orders.' };
  f.runtime.update(original.id, { plan, snapshot, decision, status: 'decided' });
  f.runtime.authorize = () => f.runtime.run(original.id);
  f.host.capabilities = { invoke: () => assert.fail('Unavailable required evidence must prevent all writes') };
  await assert.rejects(f.runtime.apply(f.host, original.id), { code: 'EXECUTION_EVIDENCE_UNAVAILABLE' });
  assert.deepEqual(f.runtime.run(original.id).decision, decision); assert.deepEqual(f.runtime.run(original.id).plan, plan);
  assert.equal(f.runtime.run(original.id).executionStartedAt, undefined);
  f.runtime.update(original.id, { plan: { ...plan, workflow: { reviews: [{ id: 'review' }], execute: true } }, reviewChecks: { review: { verdict: 'block' } } });
  await assert.rejects(f.runtime.apply(f.host, original.id), { code: 'EXECUTION_NOT_AUTHORIZED' });
});

test('pure readiness defers honest incomplete history to decision-only workflow execution', async t => {
  const f = await fixture(t), model = { provider: 'fixture', id: 'one', configurationDigest: 'one' }, roles = [];
  const plan = { ...f.runtime.run('business-run').plan, enabled: true, model, agentModels: {}, workflow: { reviews: [], execute: false }, execution: { pluginId: 'fixture/execution', contextTool: 'context', readTools: [], plugins: ['fixture/execution'], revisions: [], arguments: {} } };
  f.host.context.models = [model]; records(f.host).put('plans', plan); f.runtime.update('business-run', { plan });
  let observations = 0;
  f.host.capabilities = { list: async () => ({ items: [...memoryCapabilities, ...['trading_decision_context', 'trading_decision_review', 'trading_decision_decide'].map(localId => ({ pluginId: 'sesame/trading-decision', localId, consumers: ['agent'] }))] }), invoke: async id => {
    assert.equal(id, 'fixture/execution#context'); observations++;
    return { type: 'result', value: { account: plan.account, positions: [], orders: [], fills: [], historicalOrders: [], deployments: [], historyCoverage: { complete: false, historicalOrders: { status: 'unavailable', reason: 'native_current_day_only' } } } };
  } };
  workflowReports(f.host);
  assert.equal((await f.runtime.dependencies(f.host, 'business-run')).available, true); assert.equal(observations, 0);
  f.runtime.task = async (id, role) => { roles.push(role); f.runtime.update(id, { decision: { unchanged: true, targets: [], rationale: 'Read-only outcome despite explicitly unavailable historical orders.' } }); };
  const result = await f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution);
  assert.equal(observations, 1); assert.deepEqual(roles, ['manager']); assert.equal(result.status, 'completed');
  assert.equal(f.runtime.run('business-run').executionDisposition, 'decision_only'); assert.equal(f.runtime.run('business-run').execution, undefined);
});

test('report inspector retry retains exact publication and never repeats a completed trade or manager', async t => {
  const f = await fixture(t), roles = [];
  f.runtime.task = async (id, role) => { roles.push(role); f.runtime.update(id, role === 'manager' ? { decision: { unchanged: true, targets: [] } } : { execution: { status: 'unchanged', orders: [], pauses: [] } }); };
  f.reportService.inspectionStatus = 'failed';
  await assert.rejects(f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution), { code: 'RUN_INTERRUPTED' });
  const saved = f.runtime.run('business-run'), ref = saved.reportPublication.ref;
  assert.equal(saved.report, undefined); assert.ok(saved.execution); assert.equal(saved.reportPublication.renderStatus, 'not_checked');
  assert.equal(f.observations.length, 1);
  f.reportService.inspectionStatus = 'rendered'; f.execution.attempt = 2;
  const done = await f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution);
  assert.deepEqual(done.report.ref, ref); assert.equal(done.report.renderStatus, 'rendered'); assert.deepEqual(roles, ['manager', 'executor']);
  assert.equal(f.observations.length, 1, 'Report-only recovery must not re-enter the native adapter.');
  assert.equal(f.reportService.calls.filter(call => call.id.endsWith('#report_publish')).length, 1);
});

test('workflow validates the actual adapter account snapshot before starting a decision', async t => {
  const f = await fixture(t), original = f.runtime.run('business-run'); let observations = 0;
  f.host.capabilities.invoke = async id => {
    assert.equal(id, 'fixture/execution#context'); observations++;
    return { type: 'result', value: { account: { accountId: 'different-native-account' }, positions: [], orders: [], fills: [], historicalOrders: [], deployments: [], historyCoverage: { complete: false } } };
  };
  f.runtime.task = () => assert.fail('A mismatched account must block all decision/execution Agents.');
  await assert.rejects(f.runtime.execute(f.host, original.id, new AbortController().signal, f.execution), { code: 'RUN_INTERRUPTED' });
  const retained = f.runtime.run(original.id);
  assert.equal(observations, 1); assert.equal(retained.error.code, 'ACCOUNT_CHANGED'); assert.deepEqual(retained.plan, original.plan);
  assert.equal(retained.decision, undefined); assert.equal(retained.executionStartedAt, undefined); assert.equal(retained.report, undefined);
});

test('resumed execution rechecks required live evidence outside the pure probe and never sends an unavailable trade', async t => {
  const f = await fixture(t), model = { provider: 'fixture', id: 'one', configurationDigest: 'one' };
  const plan = { ...f.runtime.run('business-run').plan, enabled: true, model, agentModels: {}, execution: { pluginId: 'fixture/execution', contextTool: 'context', applyTool: 'apply', readTools: [], plugins: ['fixture/execution'], revisions: [], arguments: {} } };
  const snapshot = { account: plan.account, positions: [], orders: [], fills: [], historicalOrders: [], deployments: [], historyCoverage: { complete: false, scope: 'original_observed_range' } };
  const decision = { unchanged: false, targets: [{ symbol: 'FIXTURE', quantity: '1', unit: 'contracts' }], pause_strategies: [], rationale: 'Original frozen target retained while current required evidence is unavailable.' };
  f.host.context.models = [model]; records(f.host).put('plans', plan); f.runtime.update('business-run', { plan, stageIndex: 1, snapshot, decision, status: 'decided' });
  let observations = 0;
  f.host.capabilities = { list: async () => ({ items: [{ pluginId: 'sesame/trading-decision', localId: 'trading_decision_apply', consumers: ['agent'] }] }), invoke: async (id, input) => {
    assert.equal(id, 'fixture/execution#context'); assert.equal(input.action, 'snapshot'); observations++;
    return { type: 'result', value: { ...snapshot, historyCoverage: { complete: false, historicalOrders: { status: 'unavailable', reason: 'native_current_day_only' } } } };
  } };
  assert.equal((await f.runtime.dependencies(f.host, 'business-run')).available, true); assert.equal(observations, 0);
  f.runtime.task = () => assert.fail('Required live evidence must block the executor before any write.');
  await assert.rejects(f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution), { code: 'RUN_INTERRUPTED' });
  const retained = f.runtime.run('business-run');
  assert.equal(observations, 1); assert.equal(retained.error.code, 'EXECUTION_EVIDENCE_UNAVAILABLE'); assert.equal(retained.executionStartedAt, undefined);
  assert.deepEqual(retained.plan, plan); assert.deepEqual(retained.decision, decision); assert.deepEqual(retained.snapshot, snapshot);
});
