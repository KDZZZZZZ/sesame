import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collaboration } from '../packages/manual-trading/team.js';
import { createExecution, PLUGIN, CONTEXT, APPLY } from '../packages/portfolio-execution/bindings.js';
import { closeRecords as closeExecutionRecords } from '../packages/portfolio-execution/records.js';
import { fixture, unchanged } from './manual-trading-plans-fixture.mjs';

const input = (f, extra = {}) => {
  const { id: _id, mode: _mode, ...config } = f.input({ research: { plugins: ['custom/research'], tools: ['lookup'] } });
  return { ...config, request_id: 'analysis-once', instructions: 'Compare H1 scenarios, sources and invalidation conditions.', ...extra };
};
const finishTeam = async (f, id, { analysts = true } = {}) => {
  if (analysts) {
    await f.waitFor(() => f.active().length === 4);
    for (const job of f.active()) f.finish(job.id, `## ${job.request.input.role}\nObserved source evidence.`);
  }
  for (const role of ['bull', 'bear', 'risk', 'manager']) {
    await f.waitFor(() => f.active(role).length === 1);
    const job = f.active(role)[0];
    await f.call('context', f.child(job.id), id, role === 'risk' ? 'all' : 'team');
    if (role === 'manager') await assert.rejects(f.call('decide', f.child(job.id), id, unchanged), { code: 'READ_ONLY_WORKFLOW' });
    f.finish(job.id, `## ${role}\nEvidence supports waiting for the stated trigger; losses depend on verified position size.`);
  }
  await f.waitFor(() => f.runtime.run(id).status === 'completed' && f.runtime.running.size === 0);
};

test('one public analysis call owns a true collaboration Run and returns Markdown without a report, target, executor or schedule', async t => {
  const f = await fixture(t);
  f.entries.splice(f.entries.findIndex(entry => entry.id === 'sesame/memory'), 1);
  const args = input(f), run = await f.runtime.analyze(f.main, args);
  assert.ok(run.workflow?.id, 'Admission returns the actual workflow reference before role completion');
  const root = f.runs.read(run.workflow.id);
  assert.equal(root.kind, 'workflow'); assert.equal(root.parentRunId, null);
  assert.deepEqual(root.task.collaboration, collaboration(run.plan));
  assert.equal(root.task.collaboration.agents.length, 8);
  assert.equal(root.task.collaboration.agents.some(agent => agent.id === 'executor'), false);
  assert.deepEqual(root.task.output, { type: 'none' }); assert.equal(run.reportPending, false);
  assert.equal(run.plan.intervalMinutes, null); assert.deepEqual(run.plan.eventKeys, []); assert.equal(run.plan.accountEvents, false);
  assert.equal((await f.runtime.dependencies(f.main, run.id)).available, true, 'No confirmed personal-risk rule is required for advisory research');
  assert.equal((await f.runtime.analyze(f.main, args)).id, run.id);
  await assert.rejects(f.runtime.analyze(f.main, { ...args, report: true }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.runtime.apply(f.main, run.id), { code: 'READ_ONLY_WORKFLOW' });
  assert.throws(() => f.runtime.trigger(run.planId, { kind: 'manual', id: 'extra-cycle' }), { code: 'READ_ONLY_WORKFLOW' });
  await assert.rejects(f.runtime.setEnabled(f.main, run.planId, true), { code: 'READ_ONLY_WORKFLOW' });
  await finishTeam(f, run.id);
  const done = f.runtime.run(run.id), settled = f.runs.read(root.id);
  assert.equal(done.decision, undefined); assert.equal(done.execution, undefined); assert.equal(done.report, undefined);
  assert.equal(f.artifacts.size, 0); assert.equal(f.managed.size, 0);
  assert.match(settled.output.summary, /^## manager/); assert.equal(settled.output.report, null);
  assert.equal(done.tasks.length, 8);
  for (const task of done.tasks) {
    const child = f.runs.read(task.id);
    assert.equal(child.parentRunId, root.id); assert.equal(child.task.agentId, task.role);
    assert.equal(child.task.collaboration, undefined);
  }
  assert.ok(f.requests.every(request => request.allowedCalls.every(call => !['manual_trading_decide', 'manual_trading_apply', 'fixture_apply', 'manual_trading_review'].includes(call.capabilityId))));
  assert.ok(f.brokerCalls.every(call => call.name === 'fixture_context'));
});

test('explicit report option reserves the same workflow output before work and publishes one advisory report with Markdown attachment', async t => {
  const f = await fixture(t), run = await f.runtime.analyze(f.main, input(f, { report: true }));
  const root = f.runs.read(run.workflow.id);
  assert.equal(root.task.output.type, 'report'); assert.equal(root.task.output.space, 'research');
  assert.match(root.task.output.path, /\.html$/); assert.equal(run.report, undefined); assert.equal(f.artifacts.size, 0);
  await finishTeam(f, run.id);
  const done = f.runtime.run(run.id);
  assert.equal(f.artifacts.size, 1); assert.equal(done.report.ref.kind, 'report');
  assert.equal(f.runs.read(root.id).output.report.ref.id, done.report.ref.id);
  const markdown = await f.host.resources.read(done.report.ref, { part: 'content', entry: 'analysis.md' });
  assert.equal(markdown.content, done.summary);
  const html = await f.host.resources.read(done.report.ref, { part: 'content', entry: 'report.html' });
  assert.doesNotMatch(html.content, /<h2>目标仓位<\/h2>|等待执行/);
  assert.match(html.content, /<h2>manager<\/h2>/);
  assert.equal((html.content.match(/<h2>manager<\/h2>/g) ?? []).length, 1);
  assert.doesNotMatch(html.content, /<h2>(?:market|fundamentals|news|sentiment|bull|bear|risk)<\/h2>/);
  assert.doesNotMatch(html.content, /<pre>## (?:manager|market)/);
  assert.equal(done.decision, undefined); assert.equal(done.execution, undefined);
});

test('a missing news dependency pauses and resumes the same workflow/member identity with completed evidence retained', async t => {
  const f = await fixture(t), run = await f.runtime.analyze(f.main, input(f));
  await f.waitFor(() => f.active().length === 4);
  const news = f.active('news')[0];
  for (const job of f.active().filter(job => job.id !== news.id)) f.finish(job.id, `Retained ${job.request.input.role} evidence`);
  await f.waitFor(() => f.runtime.run(run.id).reports.length === 3);
  const retainedReports = structuredClone(f.runtime.run(run.id).reports);
  f.runs.interrupt(news.id, { reason: 'Selected news provider is missing its configured credential; existing price evidence is retained.' });
  await f.waitFor(() => f.runs.read(run.workflow.id).status === 'interrupted' && f.runtime.running.size === 0);
  const paused = f.runs.read(run.workflow.id), sessionId = paused.executionSessionId;
  assert.equal(f.runtime.run(run.id).status, 'interrupted'); assert.equal(f.runtime.run(run.id).report, undefined);
  assert.deepEqual(f.runtime.run(run.id).reports, retainedReports);
  await f.runs.resume(paused.id, { interruptIds: paused.interrupts.filter(item => !item.resolvedAt).map(item => item.id), response: { resolution: 'The selected provider configuration was repaired.' } });
  await f.waitFor(() => f.active('news').length === 1);
  assert.equal(f.active('news')[0].id, news.id); assert.equal(f.runs.read(paused.id).executionSessionId, sessionId);
  assert.equal(f.runtime.run(run.id).workflow.id, paused.id);
  assert.equal(f.active().length, 1, 'Already completed analysts are not dispatched again');
  f.finish(news.id, 'Verified news source and event timing.');
  await finishTeam(f, run.id, { analysts: false });
  const done = f.runtime.run(run.id);
  assert.equal(done.tasks.length, 8); assert.equal(done.reports.length, 8); assert.equal(done.status, 'completed');
  for (const report of retainedReports) assert.deepEqual(done.reports.find(value => value.taskId === report.taskId), report);
  assert.ok(f.brokerCalls.every(call => call.name === 'fixture_context'));
});

test('analysis declaration exposes its exact configuration and keeps scheduling/execution out of its input', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/manual-trading/capabilities.json', import.meta.url)));
  const cap = manifest.capabilities.find(value => value.id === 'manual_trading_analyze');
  assert.deepEqual(cap.consumers, ['agent', 'host']);
  assert.equal(cap.inputSchema.properties.report.default, false);
  for (const field of ['interval_minutes', 'event_keys', 'account_events', 'enabled', 'mode']) assert.equal(cap.inputSchema.properties[field], undefined);
  assert.equal(cap.inputSchema.properties.agent_models.properties.executor, undefined);
  assert.ok(cap.usage.prerequisites.some(value => value.includes('readiness')));
});

test('concurrent identical admissions share one workflow and a partial admission can be retried with its original ID', async t => {
  const f = await fixture(t), args = input(f);
  const [first, second] = await Promise.all([f.runtime.analyze(f.main, args), f.runtime.analyze(f.main, args)]);
  assert.equal(first.id, second.id); assert.equal(first.workflow.id, second.workflow.id);
  assert.equal(f.storage.list('plans').length, 1); assert.equal(f.storage.list('runs').length, 1);
  await assert.rejects(f.runtime.analyze(f.main, { ...args, instructions: 'Different question' }), { code: 'IDEMPOTENCY_CONFLICT' });
  f.runtime.cancel(first.id, 'Fixture done'); await f.waitFor(() => f.runtime.running.size === 0);
  const trigger = f.runtime.trigger;
  f.runtime.trigger = () => { throw new Error('Fixture interruption between configuration and admission'); };
  const retryArgs = input(f, { request_id: 'admission-retry' });
  await assert.rejects(f.runtime.analyze(f.main, retryArgs), /between configuration and admission/);
  assert.ok(f.storage.list('plans').some(plan => plan.lastRunId === null));
  f.runtime.trigger = trigger;
  const retried = await f.runtime.analyze(f.main, retryArgs);
  assert.ok(retried.id); assert.ok(retried.workflow?.id);
  assert.equal((await f.runtime.analyze(f.main, retryArgs)).workflow.id, retried.workflow.id);
});

test('analysis excludes other plugins declared trading/configuration writes while preserving evidence caching', async t => {
  const f = await fixture(t), research = f.entries.find(entry => entry.id === 'custom/research');
  research.tools.push('other_order', 'source_configure');
  research.effects = { other_order: ['external-trading', 'plugin.state.write'], source_configure: ['application-configuration'], lookup: ['network', 'resources.publish', 'plugin.state.write'] };
  await assert.rejects(f.runtime.analyze(f.main, input(f, { research: { plugins: ['custom/research'], tools: ['other_order', 'source_configure'] } })), error => {
    assert.equal(error.code, 'READ_ONLY_WORKFLOW'); assert.match(error.message, /other_order, source_configure/); return true;
  });
  const run = await f.runtime.analyze(f.main, input(f, { research: { plugins: ['custom/research'] } }));
  assert.deepEqual(run.plan.research.tools, ['lookup']);
  await f.waitFor(() => f.active().length === 4);
  assert.ok(f.requests.every(request => request.allowedCalls.every(call => !['other_order', 'source_configure'].includes(call.capabilityId))));
});

const mt5WriteTools = ['mt5_trade', 'mt5_system', 'mt5_edit', 'mt5_chart', 'mt5_test', 'mt5_python', 'mt5_backtest', 'mt5_compile', 'mt5_project',
  'mt5_update_configuration', 'mt5_import_configuration', 'mt5_deployment', 'mt5_start_terminal', 'mt5_connect', 'mt5_dependencies', 'mt5_trading_pause', 'mt5_trading_order'];
const mt5ReadTools = ['mt5_catalog', 'mt5_call', 'mt5_cache', 'mt5_command', 'mt5_inspect', 'mt5_report_data', 'mt5_trade_detail', 'mt5_trading_context', 'mt5_trading_command'];
async function registerManifest(f, name) {
  const manifest = JSON.parse(await readFile(new URL(`../packages/${name}/capabilities.json`, import.meta.url)));
  const plugin = JSON.parse(await readFile(new URL(`../packages/${name}/plugin.json`, import.meta.url)));
  const capabilities = manifest.capabilities.filter(cap => cap.consumers.includes('agent'));
  f.entries.push({ id: plugin.id, version: plugin.version, state: 'discoverable', digest: `real-${name}-manifest`, tools: capabilities.map(cap => cap.id),
    effects: Object.fromEntries(capabilities.map(cap => [cap.id, cap.effects])) });
}

test('analysis uses the real MT5 declarations to exclude native writes and retain market, indicator and evidence reads', async t => {
  const f = await fixture(t); await registerManifest(f, 'mt5');
  const run = await f.runtime.analyze(f.main, input(f, { research: { plugins: ['sesame/mt5'] } }));
  for (const name of mt5WriteTools) assert.equal(run.plan.research.tools.includes(name), false, `${name} must not be granted by default`);
  for (const name of mt5ReadTools) assert.ok(run.plan.research.tools.includes(name), `${name} remains available for research`);
  await finishTeam(f, run.id);
  assert.equal(f.requests.length, 8);
  for (const request of f.requests) {
    for (const name of mt5WriteTools) assert.equal(request.allowedCalls.some(call => call.pluginId === 'sesame/mt5' && call.capabilityId === name), false, `${request.input.role} must not receive ${name}`);
    for (const name of mt5ReadTools) assert.ok(request.allowedCalls.some(call => call.pluginId === 'sesame/mt5' && call.capabilityId === name), `${request.input.role} keeps ${name}`);
  }
});

test('analysis explicitly rejects each writable MT5 entry before admitting a workflow or Agent', async t => {
  const f = await fixture(t); await registerManifest(f, 'mt5');
  for (const name of mt5WriteTools) await assert.rejects(f.runtime.analyze(f.main,
    input(f, { request_id: `analysis-${name}`, research: { plugins: ['sesame/mt5'], tools: [name] } })), error => {
    assert.equal(error.code, 'READ_ONLY_WORKFLOW'); assert.ok(error.message.includes(name)); return true;
  });
  assert.equal(f.requests.length, 0); assert.equal(f.storage.list('plans').length, 0); assert.equal(f.storage.list('runs').length, 0);
});

test('analysis retains safe market tools from a real MT5 binding and filters mixed readTools with financial research only', async t => {
  let service, portfolioHost, injectMixed = false;
  t.after(() => { if (portfolioHost) closeExecutionRecords(portfolioHost); });
  const f = await fixture(t, { invokeCapability: async (id, args) => {
    if (id !== `${PLUGIN}#${CONTEXT}`) return;
    const value = await service.context(args);
    if (args.action === 'identity' && injectMixed) { value.tools.push('mt5_python'); value.readTools.push('mt5_python'); }
    return { type: 'result', value };
  } });
  await registerManifest(f, 'mt5'); await registerManifest(f, 'portfolio-execution'); await registerManifest(f, 'financial-research');
  const nativeReads = [];
  portfolioHost = { context: { ...f.main.context, pluginId: PLUGIN, storageRoot: join(f.host.context.storageRoot, 'portfolio') }, plugins: f.main.plugins,
    capabilities: { invoke: async (id, args) => {
      assert.equal(id, 'sesame/mt5#mt5_trading_context'); nativeReads.push(args.action);
      return { type: 'result', value: { account: f.account, capturedAt: f.time, summary: {}, positions: [], orders: [], fills: [], historicalOrders: [], deployments: [] } };
    } } };
  service = createExecution(portfolioHost);
  const execution = await service.configure({ backend: 'mt5', id: 'analysis-binding' });
  const identity = await service.context({ ...execution.arguments, action: 'identity' });
  const safeReads = [CONTEXT, 'mt5_trading_context', 'mt5_catalog', 'mt5_call'];
  assert.deepEqual(identity.readTools, safeReads, 'The producer explicitly grants schema discovery plus market/indicator reads');
  for (const mixed of [false, true]) {
    injectMixed = mixed;
    const run = await f.runtime.analyze(f.main, input(f, { execution, request_id: `binding-${mixed ? 'mixed' : 'safe'}`, research: { plugins: ['sesame/financial-research'] } }));
    assert.deepEqual(run.plan.execution.readTools, safeReads);
    assert.ok(run.plan.execution.tools.every(name => ![APPLY, ...mt5WriteTools].includes(name)));
    await finishTeam(f, run.id);
    const requests = f.requests.filter(request => request.input.runId === run.id);
    assert.equal(requests.length, 8);
    for (const request of requests) {
      assert.deepEqual(request.input.execution.readTools, safeReads);
      for (const name of safeReads) assert.ok(request.allowedCalls.some(call => call.capabilityId === name), `${request.input.role} keeps ${name}`);
      for (const name of [...mt5WriteTools, APPLY]) assert.equal(request.allowedCalls.some(call => call.capabilityId === name), false, `${request.input.role} must not receive ${name} from execution`);
      assert.ok(request.input.execution.allowedCalls.every(call => ![...mt5WriteTools, APPLY].includes(call.capabilityId)));
    }
  }
  assert.ok(nativeReads.every(action => ['identity', 'snapshot'].includes(action)));
  await assert.rejects(f.runtime.analyze(f.main, input(f, { execution, request_id: 'explicit-mixed-python', research: { plugins: ['sesame/mt5'], tools: ['mt5_python'] } })), { code: 'READ_ONLY_WORKFLOW' });
});

test('analysis rejects an execution context that declares writes before saving or dispatching', async t => {
  const f = await fixture(t);
  f.entries[0].effects = { fixture_context: ['native-state.write'] };
  await assert.rejects(f.runtime.analyze(f.main, input(f)), error => {
    assert.equal(error.code, 'READ_ONLY_WORKFLOW'); assert.ok(error.message.includes('fixture_context')); return true;
  });
  assert.equal(f.brokerCalls.length, 0, 'Reject a declared write context before even requesting its identity');
  assert.equal(f.requests.length, 0); assert.equal(f.storage.list('plans').length, 0); assert.equal(f.storage.list('runs').length, 0);
});

test('the analysis package validates, installs and exposes its registered entry in the actual host', { skip: !process.env.SESAME_HOST_ROOT, timeout: 60000 }, async () => {
  const root = process.env.SESAME_HOST_ROOT;
  const { Store } = await import(pathToFileURL(join(root, 'modules/agent/store.js')));
  const { Runtime } = await import(pathToFileURL(join(root, 'modules/agent/runtime.js')));
  const { createTools } = await import(pathToFileURL(join(root, 'modules/agent/tools.js')));
  const directory = await mkdtemp(join(tmpdir(), 'manual-analysis-host-'));
  let store, runtime;
  try {
    store = new Store(join(directory, 'host'));
    runtime = new Runtime(store, { piDir: join(directory, 'pi'), officialPluginsDirectory: join(directory, 'empty') });
    await runtime.init();
    const draft = join(runtime.workspaces.root('conv_main'), 'manual-analysis-draft');
    await cp(fileURLToPath(new URL('../packages/manual-trading/', import.meta.url)), draft, { recursive: true });
    const checked = await runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(checked.passed, true, JSON.stringify(checked.results));
    const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
    assert.equal(installed.runtime_status, 'ready'); runtime.plugins.activate('conv_main', installed.id);
    const analysis = createTools(runtime, 'conv_main').find(tool => tool.name === 'manual_trading_analyze');
    assert.ok(analysis); assert.ok(analysis.parameters.properties.report);
    assert.equal(analysis.parameters.properties.interval_minutes, undefined);
    assert.equal(runtime.runs.list().length, 0, 'Package registration never starts research or trading');
  } finally {
    await runtime?.close(); store?.close(); await rm(directory, { recursive: true, force: true });
  }
});
