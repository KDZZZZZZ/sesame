import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TradingRuntime } from '../packages/manual-trading/runtime.js';
import { records, closeRecords } from '../packages/manual-trading/records.js';
import { resourceFixture } from '../../api-v1/tests/mt5-resource-fixture.js';

const memoryCapabilities = ['memory_trading_context', 'memory_read'].map(localId => ({ pluginId: 'sesame/memory', localId, consumers: ['agent'] }));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'manual-unified-'));
  const host = { context: { pluginId: 'sesame/manual-trading', pluginVersion: 'test', pluginRevision: 'sha256:test', storageRoot: root, sessionId: 'workflow-session', runId: 'workflow-run', kind: 'subagent' }, events: { emit: async () => {} } };
  host.plugins = { read: async id => id === 'sesame/memory' ? { id, state: 'discoverable', digest: 'memory-fixture' } : null };
  const resources = resourceFixture(host), emitted = [];
  const execution = { run: { id: 'workflow-run' }, attempt: 1, checkpoint: async state => { execution.checkpointState = structuredClone(state); }, interrupt: async value => { execution.checkpointState=value.state; throw Object.assign(new Error(value.reason), { code: 'RUN_INTERRUPTED', details: value }); }, provenance: { caller: { pluginId: 'sesame/manual-trading' }, workflow: { runId: 'workflow-run', sessionId: 'workflow-session', ownerSessionId: 'main' } },
    emit: (type, data) => emitted.push({ type, data }), progress: data => emitted.push({ type: 'progress', data }) };
  const runtime = new TradingRuntime(host, { timer: false });
  t.after(async () => { await runtime.dispose(); closeRecords(host); await rm(root, { recursive: true, force: true }); });
  const plan = { id: 'plan', title: 'Controlled no-broker fixture', ownerConversationId: 'main', account: { accountId: 'fixture' }, mode: 'single', reportFolder: 'Reports', symbols: [] };
  records(host).put('plans', plan); runtime.save({ id: 'business-run', planId: plan.id, plan, status: 'queued', createdAt: 1800000000000, tasks: [], reports: [] });
  return { host, runtime, execution, emitted, ...resources };
}

test('manual workflow declares a native Run and no custom live HTML protocol', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/manual-trading/capabilities.json', import.meta.url)));
  assert.equal(manifest.capabilities.find(cap => cap.id === 'workflow_execute').kind, 'workflow');
  assert.deepEqual(manifest.views, []); assert.equal(manifest.capabilities.some(cap => cap.id.startsWith('activity_')), false);
});

test('failure archives only observed evidence then rejects the actual workflow; no reporter Agent is created', async t => {
  const f = await fixture(t), roles = [];
  f.runtime.task = async (_id, role) => { roles.push(role); throw Object.assign(new Error('Controlled model failure'), { code: 'MODEL_UNAVAILABLE' }); };
  await assert.rejects(f.runtime.execute(f.host, 'business-run', new AbortController().signal, f.execution), /Controlled model failure/);
  const run = f.runtime.run('business-run');
  assert.equal(run.status, 'failed'); assert.equal(run.execution, undefined); assert.equal(run.report.ref.kind, 'report');
  assert.deepEqual(roles, ['manager']); assert.equal(run.reportPending, false);
  assert.ok(f.emitted.some(event => event.type === 'artifact' && event.data.ref.id === run.report.ref.id));
  const artifact = f.artifacts.get(run.report.ref.id); assert.ok(artifact.manifest.blobs.some(blob => blob.path === 'run.json'));
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
    tasks: [{ id: 'analyst-a', role: 'market' }, { id: 'analyst-b', role: 'news' }, { id: 'manager', role: 'manager' }],
    reports: [{ taskId: 'analyst-a', role: 'market', text: 'First evidence' }, { taskId: 'analyst-b', role: 'news', text: 'Second evidence' }] });
  f.runtime.executions.set('business-run', f.execution);
  const child = { ...f.host, context: { ...f.host.context, sessionId: 'manager-session', runId: 'manager' } };
  const provenance = { agent: { pluginId: 'sesame/manual-trading', sessionId: 'manager-session', runId: 'manager', input: {
    runId: 'business-run', role: 'manager', tradingPlan: { id: 'plan', account: { accountId: 'fixture' } } } } };
  await f.runtime.invocation.run({ provenance }, async () => {
    for (let i = 0; i < 2; i++) await f.runtime.context(child, 'business-run', 'team', 1, 1);
  });
  assert.deepEqual(f.emitted.filter(event => event.type === 'handoff'), [{ type: 'handoff', data: { fromRunId: 'analyst-b', toRunId: 'manager' } }]);
});

test('cancel ends the actual workflow Run while retaining its business checkpoint', async t => {
  const f = await fixture(t), cancelled = [];
  f.host.runs = { cancel: async (ref, options) => { cancelled.push({ ref, options }); return { run: { id: ref.id, status: 'cancelled' } }; } };
  f.runtime.update('business-run', { workflow: { id: 'workflow-run' }, status: 'researching', tasks: [{ id: 'manager', role: 'manager', status: 'running' }] });
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
  const plan = { ...f.runtime.run('business-run').plan, model, agentModels: {}, instructions: '', taskTimeoutMs: 30000,
    execution: { readTools: [], plugins: [], revisions: [] }, research: { tools: [], plugins: [], revisions: [] } };
  f.runtime.update('business-run', { plan });
  let invokes = 0, cancels = 0, state = 'interrupted';
  f.host.capabilities = {
    list: async () => ({ items: [...memoryCapabilities, ...['manual_trading_context', 'manual_trading_review', 'manual_trading_decide'].map(localId => ({ pluginId: 'sesame/manual-trading', localId, consumers: ['agent'] }))] }),
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

test('preflight reads the actual selected transport and reports unavailable without an Agent or a state mutation', async t => {
  const f = await fixture(t), model = { provider: 'fixture', id: 'one', configurationDigest: 'one' };
  const plan = { ...f.runtime.run('business-run').plan, enabled: true, model, agentModels: {},
    execution: { pluginId: 'fixture/execution', contextTool: 'context', readTools: [], plugins: ['fixture/execution'], revisions: [], arguments: {} }, research: { tools: [], plugins: [], revisions: [] } };
  f.host.context.models = [model]; records(f.host).put('plans', plan); f.runtime.update('business-run', { plan });
  const before = f.runtime.run('business-run'), calls = [];
  f.host.capabilities = {
    list: async () => ({ items: [...memoryCapabilities, ...['manual_trading_context', 'manual_trading_review', 'manual_trading_decide', 'manual_trading_apply'].map(localId => ({ pluginId: 'sesame/manual-trading', localId, consumers: ['agent'] }))] }),
    invoke: async (id, input) => { calls.push({ id, input }); throw Object.assign(new Error('No IPC connection'), { code: 'MT5_PYTHON_UNAVAILABLE', details: { retryable: false, nativeCode: -10004 } }); },
  };
  const result = await f.runtime.dependencies(f.host, 'business-run', new AbortController().signal);
  assert.equal(result.available, false); assert.equal(result.details.cause.code, 'MT5_PYTHON_UNAVAILABLE');
  assert.deepEqual(calls, [{ id: 'fixture/execution#context', input: { action: 'snapshot', history_days: 30 } }]);
  assert.deepEqual(f.runtime.run('business-run'), before);
  f.host.context.models = [];
  assert.equal((await f.runtime.dependencies(f.host, 'business-run')).available, false); assert.equal(calls.length, 1, 'Unavailable model prevents even the account read');
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
  f.runtime.update('business-run', { plan, status: 'researching', workflow: { id: 'retained-workflow' } });
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
