import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, selectModel, accountKey, ROLES, validateDecision } from '../packages/manual-trading/plans.js';
import { stages, taskTools, taskPlugins } from '../packages/manual-trading/team.js';
import { fixture, baseModel, alternateModel, unchanged, copy } from './manual-trading-plans-fixture.mjs';

test('a failed event subscription close still clears local ownership and is not repeated', async t => {
  const f = await fixture(t), failure = new Error('Event stream close failed'), controller = new AbortController();
  let closed = 0, drained = 0;
  f.runtime.subscriptions.set('plan-1', { controller, stream: { close: async () => { closed++; throw failure; } }, promise: Promise.resolve().then(() => { drained++; }) });
  await assert.rejects(f.runtime.unsubscribe('plan-1'), error => error === failure);
  assert.equal(controller.signal.aborted, true); assert.equal(closed, 1); assert.equal(drained, 1);
  assert.equal(f.runtime.subscriptions.size, 0);
  await f.runtime.unsubscribe('plan-1'); assert.equal(closed, 1);
});

test('each role may override its model while the frozen default covers omitted roles', async t => {
  const f = await fixture(t);
  for (const role of ROLES) {
    const plan = await makePlan(f.main, f.input({ mode: 'team', agent_models: { [role]: alternateModel } }), f.execution, null, f.time);
    for (const selectedRole of ROLES) assert.equal((plan.agentModels[selectedRole] ?? plan.model).id, selectedRole === role ? 'alternate' : 'primary');
    f.models[0].configurationDigest = 'sha256:mutated-after-save';
    assert.equal(plan.model.configurationDigest, baseModel.configurationDigest, 'saved plans do not share mutable registry descriptors');
    f.models[0] = copy(baseModel);
  }
  await assert.rejects(makePlan(f.main, f.input({ agent_models: { invented: alternateModel } }), f.execution), { code: 'INVALID_ARGUMENT' });
});

test('unavailable or drifted configurations require an explicit new model selection', async t => {
  const f = await fixture(t);
  f.models[0].configurationDigest = 'sha256:new-route';
  assert.throws(() => selectModel(f.main, baseModel), { code: 'MODEL_CHANGED' });
  assert.throws(() => selectModel(f.main, { provider: 'fixture', id: 'removed' }), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(selectModel(f.main, { provider: 'fixture', id: 'primary' }).configurationDigest, 'sha256:new-route');
});

test('the main Agent can repair a missing manager decision and resume the same workflow without a new user reply', async t => {
  const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input());
  const created = f.runtime.trigger(plan.id, { kind: 'manual', id: 'repair-manager-output' });
  await f.waitFor(() => f.active('manager').length === 1);
  const manager = f.active('manager')[0];
  await f.call('context', f.child(manager.id), created.id);
  f.finish(manager.id, 'Retained account analysis recommends leaving the portfolio unchanged.');
  await f.waitFor(() => f.runtime.run(created.id).status === 'interrupted' && f.runtime.running.size === 0);
  const paused = f.runtime.run(created.id), hostRun = f.runs.read(paused.workflow.id);
  const blocked = await f.runtime.dependencies(f.main, created.id);
  assert.equal(blocked.available, false); assert.equal(blocked.details.cause.code, 'NO_DECISION');
  assert.match(blocked.reason, /manual_trading_decide/); assert.equal(f.active('executor').length, 0);
  await f.runtime.context(f.main, created.id);
  await f.runtime.decide(f.main, created.id, unchanged);
  assert.equal((await f.runtime.dependencies(f.main, created.id)).available, true);
  await f.runs.resume(hostRun.id, { interruptIds: hostRun.interrupts.filter(item => !item.resolvedAt).map(item => item.id), response: { resolution: 'Saved the unchanged target using retained account evidence and the existing authorization.' } });
  await f.waitFor(() => f.active('executor').length === 1);
  const executor = f.active('executor')[0];
  await f.call('apply', f.child(executor.id), created.id); f.finish(executor.id);
  await f.waitFor(() => f.runtime.run(created.id).status === 'completed');
  const done = f.runtime.run(created.id);
  assert.equal(done.workflow.id, hostRun.id); assert.equal(done.tasks.find(task => task.role === 'manager').id, manager.id);
  assert.equal(f.requests.filter(request => request.input.role === 'manager').length, 1);
  assert.equal(done.reports.find(report => report.taskId === manager.id).text, 'Retained account analysis recommends leaving the portfolio unchanged.');
});

test('team stages preserve task responsibilities and use selected capability tools', async t => {
  const f = await fixture(t), plan = await makePlan(f.main, f.input({mode:'team',debate_rounds:2,research:{plugins:['custom/research']}}), f.execution);
  assert.equal(stages(plan)[0].length, 4);
  for (const role of ['market','risk','manager']) {
    const tools = taskTools(plan, role);
    assert.ok(tools.includes('lookup'));
    assert.ok(tools.includes('fixture_context'));
    assert.ok(!tools.includes('fixture_apply'));
    assert.ok(!tools.includes('manual_trading_apply'));
  }
  assert.ok(taskTools(plan, 'manager').includes('manual_trading_decide'));
  assert.equal(ROLES.includes('reporter'), false, 'The workflow publishes its final report without a mechanical Agent');
  assert.deepEqual(taskTools(plan, 'executor'), ['manual_trading_apply']);
  assert.ok(!taskTools(plan, 'executor').includes('lookup'));
});

test('research selection freezes arbitrary plugins and preserves only explicit methods', async t => {
  const f = await fixture(t), plan = await makePlan(f.main, f.input({research:{plugins:['custom/research']}}), f.execution);
  assert.deepEqual(plan.research.plugins,['custom/research']);
  assert.deepEqual((await makePlan(f.main, f.input(), f.execution, plan)).research,plan.research);
  assert.deepEqual((await makePlan(f.main, f.input({research:{plugins:[]}}), f.execution, plan)).research.tools,[]);
  f.main.plugins.read = async () => ({state:'disabled'});
  await assert.rejects(makePlan(f.main,f.input({research:{plugins:['custom/research']}}),f.execution),{code:'PREREQUISITE_REQUIRED'});
});

test('saved workflows contain no execution backend and reject foreign-owner configuration', async t => {
  const f=await fixture(t), plan=await f.runtime.configure(f.main,f.input());
  assert.equal('backend' in plan,false);
  assert.equal(plan.execution.quantityRules.unit,'contracts');
  const other={...f.main,context:{...f.main.context,kind:'main',sessionId:'other'}};
  await assert.rejects(f.runtime.configure(other,f.input()),{code:'FORBIDDEN'});
  await assert.rejects(f.runtime.setEnabled(other,plan.id,false),{code:'FORBIDDEN'});
  assert.equal(f.runtime.plan(plan.id).enabled,true);
});

test('actual child progress is visible and a dependency interruption preserves its error without a final report', async t => {
  const f = await fixture(t);
  const plan = await f.runtime.configure(f.main, f.input());
  const started = f.runtime.trigger(plan.id, { kind: 'manual', id: 'observable-failure' });
  await f.waitFor(() => f.active('manager').length === 1);
  const child = f.active('manager')[0];
  await f.waitFor(() => f.runtime.run(started.id).tasks.some(task => task.id === child.id && task.status === 'running'));
  const observed = f.runtime.run(started.id).tasks.find(task => task.id === child.id);
  assert.equal(observed.conversationId, f.runs.read(child.id).executionSessionId);
  assert.ok(observed.startedAt);
  f.runs.interrupt(child.id, { reason: 'Synthetic provider unavailable; no execution attempted' });
  await f.waitFor(() => f.runtime.run(started.id).status === 'interrupted' && f.runtime.running.size === 0);
  const finished = f.runtime.run(started.id);
  assert.equal(finished.status, 'interrupted'); assert.equal(finished.execution, undefined); assert.equal(finished.report, undefined);
  assert.match(finished.error.message, /Synthetic provider unavailable/);
  assert.ok(!JSON.stringify(finished).includes('[object Object]'));
  assert.equal(f.runs.read(finished.tasks[0].id).status, 'interrupted');
  assert.equal(f.requests.some(request => request.input.role === 'executor'), false);
});

test('team reports remain readable without an account connection and deterministic snapshot failures are bounded to their run', async t => {
  const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input());
  const makeRun = id => f.runtime.save({ id, planId: plan.id, plan, status: 'researching', createdAt: f.time, tasks: [], reports: [{ taskId: 'peer', role: 'news', text: 'Observed public evidence' }] });
  const run = makeRun('unavailable-account'), next = makeRun('reconnected-account');
  let reads = 0, connected = false;
  const unavailable = Object.assign(new Error('Python IPC connection is unavailable'), { code: 'MT5_PYTHON_UNAVAILABLE', details: { retryable: false, requiredTransport: 'python', nativeCode: -10004, recovery: 'Reconnect the configured terminal, verify the same account, then resume the retained workflow.' } });
  const main = { ...f.main, capabilities: { ...f.main.capabilities, invoke: async (...args) => { reads++; if (!connected) throw unavailable; return f.main.capabilities.invoke(...args); } } };
  assert.equal((await f.runtime.context(main, run.id, 'team')).reports.items[0].text, 'Observed public evidence');
  assert.equal(reads, 0, 'Reading team results has no snapshot dependency');
  for (const section of ['account', 'history', 'memory', 'all']) await assert.rejects(f.runtime.context(main, run.id, section), error => error.code === 'DEPENDENCY_UNAVAILABLE' && error.details.cause.code === unavailable.code && error.details.retryable === false);
  assert.equal(reads, 1, 'A confirmed connection failure is not dispatched repeatedly within one run');
  assert.equal((await f.runtime.context(main, run.id, 'team')).reports.total, 1);
  connected = true;
  await assert.rejects(f.runtime.context(main, run.id, 'account'), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.equal((await f.runtime.context(main, next.id, 'account')).account.accountId, f.account.accountId);
  assert.equal(reads, 2, 'Connection recovery is rechecked in an explicit new run');
});

test('a transient snapshot failure is not classified or cached as nonretryable', async t => {
  const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input());
  const run = f.runtime.save({ id: 'transient-account', planId: plan.id, plan, status: 'researching', createdAt: f.time, tasks: [], reports: [] });
  let reads = 0;
  const main = { ...f.main, capabilities: { ...f.main.capabilities, invoke: (...args) => {
    if (++reads === 1) throw Object.assign(new Error('Temporary transport timeout'), { code: 'TIMEOUT' });
    return f.main.capabilities.invoke(...args);
  } } };
  await assert.rejects(f.runtime.context(main, run.id, 'account'), { code: 'TIMEOUT' });
  assert.equal((await f.runtime.context(main, run.id, 'account')).account.accountId, f.account.accountId);
  assert.equal(reads, 2);
});

test('completed stages explicitly share reports with subsequent roles using their actual frozen models', async t => {
  const f = await fixture(t);
  const plan = await f.runtime.configure(f.main, f.input({ mode: 'team', debate_rounds: 1, agent_models: { market: alternateModel, manager: alternateModel, executor: alternateModel } }));
  const run = f.runtime.trigger(plan.id, { kind: 'manual', id: 'team-run' });
  await f.waitFor(() => f.active().length === 4);
  const analysts = f.active();
  assert.equal(analysts.find(job => job.request.input.role === 'market').request.model.id, 'alternate');
  assert.equal(analysts.find(job => job.request.input.role === 'news').request.model.id, 'primary');
  const first = await f.call('context', f.child(analysts[0].id), run.id, 'team');
  assert.deepEqual(first.reports.items, []);
  for (const job of analysts.slice(0, 3)) f.finish(job.id, `source-backed ${job.request.input.role}`);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.active('bull').length, 0, 'a debate cannot skip an unfinished analyst');
  f.finish(analysts[3].id, `source-backed ${analysts[3].request.input.role}`);
  await f.waitFor(() => f.active('bull').length === 1);
  const bull = f.active('bull')[0], bullContext = await f.call('context', f.child(bull.id), run.id, 'team');
  assert.deepEqual(new Set(bullContext.reports.items.map(report => report.role)), new Set(['market', 'fundamentals', 'news', 'sentiment']));
  f.finish(bull.id, 'Bull: evidence supports holding with uncertainty.');
  await f.waitFor(() => f.active('bear').length === 1);
  const bear = f.active('bear')[0], bearContext = await f.call('context', f.child(bear.id), run.id, 'team');
  assert.ok(bearContext.reports.items.some(report => report.text.startsWith('Bull:')));
  f.finish(bear.id, 'Bear: no sufficient evidence to change exposure.');
  await f.waitFor(() => f.active('risk').length === 1);
  const risk = f.active('risk')[0];
  assert.equal((await f.call('context', f.child(risk.id), run.id, 'team')).reports.total, 6);
  f.finish(risk.id, 'Risk: maintain existing targets.');
  await f.completeSingle(run.id);
  const finished = f.runtime.run(run.id);
  assert.equal(finished.status, 'completed'); assert.equal(finished.execution.status, 'unchanged');
  assert.equal(finished.tasks.find(task => task.role === 'executor').model.id, 'alternate');
  assert.equal(finished.memoryError, undefined); assert.equal(finished.report.ref.kind, 'report');
  assert.ok(f.storage.list('trading_memory_runs')[0].reports.some(report => report.role === 'bear'));
  const frozen = await f.report(run.id);
  assert.equal(frozen.status, 'completed'); assert.equal(frozen.decision.unchanged, true);
  assert.equal(frozen.execution.status, 'unchanged'); assert.deepEqual(frozen.execution.orders, []); assert.equal(frozen.execution.targetReached, null);
  assert.equal(f.artifacts.size, 1, 'One report artifact contains the immutable run attachment');
  assert.equal(f.runs.list({kind:'agent'}).length, finished.tasks.length);
});

test('interrupted evidence retains an unexecuted target without turning it into fills or returns', async t => {
  const f = await fixture(t); await f.runtime.configure(f.main, f.input());
  const run = f.runtime.trigger('plan-1', { kind: 'manual', id: 'unexecuted-target' });
  await f.waitFor(() => f.active('manager').length === 1);
  const manager = f.active('manager')[0];
  await f.call('context', f.child(manager.id), run.id);
  await f.call('decide', f.child(manager.id), run.id, { ...unchanged, unchanged: false, targets: [{ symbol: 'EURUSD', quantity: '0.1', unit: 'contracts' }] });
  f.finish(manager.id);
  await f.waitFor(() => f.active('executor').length === 1);
  f.finish(f.active('executor')[0].id, 'Execution was not attempted.');
  await f.waitFor(() => f.runtime.run(run.id).status === 'interrupted' && f.runtime.running.size === 0);
  const frozen = f.runtime.run(run.id);
  assert.equal(frozen.error.code, 'NOT_EXECUTED'); assert.equal(frozen.decision.targets[0].quantity, '0.1');
  assert.equal(frozen.execution, undefined); assert.deepEqual(frozen.snapshot.fills, []);
  assert.equal(frozen.realizedPnl, undefined); assert.equal(frozen.actualTradeReturn, undefined);
  assert.equal(frozen.report, undefined); assert.equal(f.storage.list('trading_memory_runs').length, 0);
  assert.equal((await f.runtime.dependencies(f.main, run.id)).details.cause.code, 'NOT_EXECUTED');
  assert.ok(f.brokerCalls.every(call => call.arguments.action === 'identity' || call.arguments.action === 'snapshot'));
});

test('interval ticks coalesce elapsed periods and do not submit the same interval twice', async t => {
  const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input({ interval_minutes: 5 }));
  f.advance(5 * 60000 - 1); await f.runtime.tick();
  assert.equal(f.storage.list('runs').length, 0, 'The minimum interval is a real time gate');
  f.advance(1);
  await Promise.all([f.runtime.tick(), f.runtime.tick(), f.runtime.tick()]);
  assert.equal(f.storage.list('runs').length, 1); await f.waitFor(() => f.requests.length === 1);
  assert.equal(f.storage.list('runs')[0].trigger.id, String(plan.nextDueAt));
  f.advance(60 * 60000); await f.runtime.tick(); await f.runtime.tick();
  assert.equal(f.storage.list('runs').length, 2, 'missed intervals create a latest run, not twelve stale runs');
  assert.equal(f.requests.length, 1, 'the second interval waits behind the same active account');
});

test('event cooldown retains queued work until the exact time threshold without early Agent dispatch', async t => {
  const f = await fixture(t); await f.runtime.configure(f.main, f.input({ event_keys: ['news'], event_cooldown_seconds: 60 }));
  const [first] = f.runtime.event('news', 'first', {}); await f.completeSingle(first.id);
  const [next] = f.runtime.event('news', 'next', {}), count = f.requests.length;
  assert.equal(f.runtime.run(next.id).status, 'queued');
  f.advance(59999); await f.runtime.tick();
  assert.equal(f.runtime.run(next.id).status, 'queued'); assert.equal(f.requests.length, count);
  f.advance(1); await f.runtime.tick();
  await f.waitFor(() => f.active('manager').some(job => job.request.input.runId === next.id));
  assert.equal(f.requests.length, count + 1);
  await f.completeSingle(next.id);
});

test('event identity is idempotent across redelivery time and rejects changed payload', async t => {
  const f = await fixture(t); await f.runtime.configure(f.main, f.input({ event_keys: ['news'] }));
  const [first] = f.runtime.event('news', 'event-1', { headline: 'Same observed event' });
  f.advance(1000);
  const [again] = f.runtime.event('news', 'event-1', { headline: 'Same observed event' });
  assert.equal(again.id, first.id); assert.equal(f.storage.list('runs').length, 1); await f.waitFor(() => f.requests.length === 1);
  assert.throws(() => f.runtime.event('news', 'event-1', { headline: 'Different payload' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('same-account plans run serially while new pending triggers replace only their own plan queue', async t => {
  const f = await fixture(t);
  const a = await f.runtime.configure(f.main, f.input({ id: 'a' }));
  const b = await f.runtime.configure(f.main, f.input({ id: 'b' }));
  assert.equal(accountKey(a), accountKey(b));
  const active = f.runtime.trigger(a.id, { kind: 'manual', id: 'active' });
  const pending1 = f.runtime.trigger(b.id, { kind: 'manual', id: 'pending-1' });
  const pending2 = f.runtime.trigger(b.id, { kind: 'manual', id: 'pending-2' });
  await f.waitFor(() => f.requests.length === 1); assert.equal(f.runtime.run(pending1.id).status, 'cancelled');
  assert.equal(f.runtime.run(pending1.id).supersededBy, pending2.id); assert.equal(f.runtime.run(pending2.id).status, 'queued');
  await f.completeSingle(active.id);
  await f.waitFor(() => f.active('manager').some(job => job.request.input.runId === pending2.id));
  assert.equal(f.requests.filter(request => request.input.runId === pending1.id).length, 0);
  await f.completeSingle(pending2.id);
  assert.equal(f.runtime.run(pending2.id).status, 'completed');
});

test('canceling a queued run does not cancel another active run on the same account', async t => {
  const f = await fixture(t);
  await f.runtime.configure(f.main, f.input({ id: 'a' })); await f.runtime.configure(f.main, f.input({ id: 'b' }));
  const active = f.runtime.trigger('a', { kind: 'manual', id: 'active' });
  const queued = f.runtime.trigger('b', { kind: 'manual', id: 'queued' });
  f.runtime.cancel(queued.id, 'Only cancel the queued plan');
  await f.waitFor(() => f.active('manager').length === 1);
  assert.equal(f.runtime.run(queued.id).status, 'cancelled');
  assert.equal(f.runtime.run(active.id).status, 'researching');
  assert.equal(f.active('manager').length, 1);
  await f.completeSingle(active.id);
});

test('canceling active work is terminal and re-delivering that trigger never replays it', async t => {
  const f = await fixture(t); await f.runtime.configure(f.main, f.input());
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
  const f = await fixture(t); const plan = await f.runtime.configure(f.main, f.input());
  const frozen = { id: 'persisted-run', planId: plan.id, plan, trigger: { kind: 'manual', id: 'interrupted' }, status: 'executing', createdAt: f.time,
    tasks: [], reports: [], decision: unchanged, executionProgress: { orders: [{ operationId: 'already-submitted', receipt: { status: 'outcome_unknown' } }] } };
  f.storage.put('runs', frozen);
  await f.restart(); await f.runtime.tick();
  const recovered = f.runtime.run(frozen.id);
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.error.code, 'RESTART_INTERRUPTED');
  assert.deepEqual(recovered.executionProgress, frozen.executionProgress);
  assert.equal(f.requests.length, 0); assert.equal(f.brokerCalls.filter(call => call.arguments.action === 'snapshot').length, 0);
});

test('a missing manager decision interrupts the workflow and releases resources without blocking shutdown', async t => {
  const f = await fixture(t); await f.runtime.configure(f.main, f.input());
  const run = f.runtime.trigger('plan-1', { kind: 'manual', id: 'terminal-failure' });
  await f.waitFor(() => f.active('manager').length === 1);
  f.finish(f.active('manager')[0].id, 'Manager ended without submitting a structured decision.');
  await f.waitFor(() => f.runtime.run(run.id).status === 'interrupted' && f.runtime.running.size === 0);
  await f.runtime.dispose();
  assert.equal(f.active().length, 0);
  assert.equal(f.runtime.run(run.id).status, 'interrupted'); assert.equal(f.runtime.run(run.id).report, undefined);
  assert.equal(f.runtime.run(run.id).error.code, 'NO_DECISION');
  assert.equal(f.runs.read(f.runtime.run(run.id).workflow.id).status, 'interrupted');
  assert.deepEqual(f.requests.map(request => request.input.role), ['manager']);
});

test('an account or connection revision changed before observation cannot produce a saved decision', async t => {
  const f = await fixture(t); await f.runtime.configure(f.main, f.input());
  const run = f.runtime.trigger('plan-1', { kind: 'manual', id: 'account-change' });
  await f.waitFor(() => f.active('manager').length === 1);
  const manager = f.active('manager')[0], child = f.child(manager.id);
  f.setAccount({ ...f.account, revision: '2' });
  await assert.rejects(f.call('context', child, run.id), { code: 'ACCOUNT_CHANGED' });
  await assert.rejects(f.call('decide', child, run.id, unchanged), { code: 'RUN_NOT_READY' });
  assert.equal(f.runtime.run(run.id).decision, undefined); assert.equal(f.runtime.run(run.id).snapshot, undefined);
});

test('a model configuration change after plan creation interrupts before any decision or execution', async t => {
  const f = await fixture(t); await f.runtime.configure(f.main, f.input());
  f.models[0].configurationDigest = 'sha256:changed-route';
  const run = f.runtime.trigger('plan-1', { kind: 'manual', id: 'model-drift' });
  await f.waitFor(() => f.runtime.run(run.id).status === 'interrupted' && f.runtime.running.size === 0);
  assert.equal(f.runtime.run(run.id).error.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(f.runtime.run(run.id).report, undefined);
  assert.equal(f.requests.length, 0); assert.equal(f.runtime.run(run.id).decision, undefined); assert.equal(f.runtime.run(run.id).execution, undefined);
});

test('decision validation supports unchanged exposure and rejects inconsistent target instructions', () => {
  const plan = { execution: { quantityRules: {unit:'shares',signed:false,integer:true} }, symbols: ['600000.SH'] }, snapshot = { positions: [], deployments: [] };
  assert.equal(validateDecision(plan, snapshot, unchanged).unchanged, true);
  assert.throws(() => validateDecision(plan, snapshot, { ...unchanged, targets: [{ symbol: '600000.SH', quantity: '100', unit: 'shares' }] }), { code: 'INVALID_DECISION' });
  assert.throws(() => validateDecision(plan, snapshot, { ...unchanged, unchanged: false, targets: [{ symbol: '600000.SH', quantity: '-1', unit: 'shares' }] }), { code: 'INVALID_DECISION' });
});

test('configuration rejects an oversized composed plugin set before saving or scheduling', async t => {
  const f = await fixture(t);
  const dependencies = Array.from({ length: 7 }, (_, i) => ({ id: `custom/native-${i}`, state: 'discoverable', digest: `native-${i}`, tools: [`native_read_${i}`] }));
  const skills = Array.from({ length: 24 }, (_, i) => ({ id: `custom/skill-${i}`, state: 'discoverable', digest: `skill-${i}`, tools: [] }));
  f.entries.push(...dependencies, ...skills);
  f.setExecutionTools(dependencies.flatMap(entry => entry.tools));
  await assert.rejects(f.runtime.configure(f.main, f.input({ research: { plugins: skills.map(entry => entry.id) } })), { code: 'PLUGIN_BUDGET_EXCEEDED' });
  assert.equal(f.storage.list('plans').length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.managed.size, 0);
  const plan = await f.runtime.configure(f.main, f.input({ research: { plugins: skills.slice(1).map(entry => entry.id) } }));
  assert.equal(taskPlugins(plan, 'manager').length, 32, 'The manager budget includes its required personal-memory plugin');
});
