import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical } from '@sesame/plugin-sdk/protocol';
import { TradingRuntime } from '../packages/manual-trading/runtime.js';
import { records, closeRecords } from '../packages/manual-trading/records.js';
import { resourceFixture } from '../../api-v1/tests/mt5-resource-fixture.js';

const hostRoot = new URL('../../../../mt5agent/', import.meta.url);
const { Store } = await import(new URL('modules/agent/store.js', hostRoot));
const { RunService } = await import(new URL('modules/agent/run-service.js', hostRoot));
const { createRunsPort } = await import(new URL('modules/plugins/host-v2/runs.js', hostRoot));
const manifest = JSON.parse(await readFile(new URL('../packages/manual-trading/capabilities.json', import.meta.url)));
export const baseModel = { provider: 'fixture', id: 'primary', configurationDigest: 'sha256:primary-v1' };
export const alternateModel = { provider: 'fixture', id: 'alternate', configurationDigest: 'sha256:alternate-v1' };
export const unchanged = { unchanged: true, targets: [], rationale: 'Available evidence does not justify changing any position.', pause_strategies: [], evidence_dataset_ids: [] };
export const copy = value => value === undefined ? undefined : structuredClone(value);

// The scheduler and private receipts are real. Only model completion, broker
// observations and resource bytes are controlled; executions use the host Run ledger.
export async function fixture(t, { invokeCapability } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'manual-plans-v2-'));
  const store = new Store(join(root, 'host')), runs = new RunService(store);
  let time = Date.parse('2026-10-13T12:00:00Z'), account = { accountId: 'account-1', server: 'Fixture-Demo', revision: '1' };
  const models = [copy(baseModel), copy(alternateModel)], jobs = new Map(), requests = [], brokerCalls = [], events = [], executors = new Map();
  runs.setResolver(run => executors.get(run.id));
  const entries = [
    { id: 'fixture/execution', state: 'discoverable', digest: 'fixture-v1', tools: ['fixture_context', 'fixture_apply'] },
    { id: 'custom/research', state: 'discoverable', digest: 'research-v1', tools: ['lookup'] },
    { id: 'sesame/memory', state: 'discoverable', digest: 'memory-v1', tools: ['memory_trading_context', 'memory_read', 'memory_manage'] },
  ];
  let extraExecutionTools = [];
  const identity = () => ({ account: copy(account), tools: [...entries[0].tools, ...extraExecutionTools], readTools: ['fixture_context'], taskContext: { bindingId: 'fixture' }, quantityRules: { unit: 'contracts', signed: true, integer: false }, accountProvider: { pluginId: 'fixture/execution', providerId: 'account' } });
  const execution = () => ({ pluginId: entries[0].id, contextTool: 'fixture_context', applyTool: 'fixture_apply', arguments: {}, account: copy(account), context: identity().taskContext, tools: identity().tools, readTools: identity().readTools, quantityRules: identity().quantityRules, accountProvider: identity().accountProvider, plugins: [entries[0].id], revisions: [{ id: entries[0].id, digest: entries[0].digest }] });
  const snapshot = () => ({ account: copy(account), capturedAt: time, summary: { equity: '10000' }, positions: [], orders: [], fills: [], historicalOrders: [], deployments: [], historyCoverage: { status: 'complete' } });
  const host = { context: { pluginId: 'sesame/manual-trading', pluginVersion: 'test', pluginRevision: 'test', storageRoot: join(root, 'plugin'), sessionId: null, runId: null, kind: 'service', models },
    plugins: { read: async id => copy(entries.find(entry => entry.id === id)) }, events: { emit: async event => events.push(copy(event)) } };
  const resourceState = resourceFixture(host);
  let runtime;
  function scoped(context) {
    const selected = { ...host, context };
    selected.runs = createRunsPort({ runtime: { runs }, context });
    selected.capabilities = {
      async list(filter = {}) {
        const items = [...manifest.capabilities.map(cap => ({ pluginId: 'sesame/manual-trading', localId: cap.id, consumers: cap.consumers })),
          ...entries.flatMap(entry => entry.tools.map(localId => ({ pluginId: entry.id, localId, consumers: ['agent', 'host'], effects: entry.effects?.[localId] ?? [] })))];
        return { items: items.filter(item => !filter.pluginId || item.pluginId === filter.pluginId) };
      },
      async invoke(id, input, options = {}) {
        options.signal?.throwIfAborted();
        const intercepted = await invokeCapability?.(id, input, options);
        if (intercepted !== undefined) return intercepted;
        if (id === 'fixture/execution#fixture_context' || id === 'fixture/execution#fixture_apply') {
          const name = id.split('#')[1]; brokerCalls.push({ name, arguments: copy(input) });
          return { type: 'result', value: name === 'fixture_apply'
            ? { status: 'unchanged', orders: [], pauses: [], targetReached: null, before: snapshot(), after: snapshot(), completedAt: time }
            : input.action === 'identity' ? identity() : snapshot() };
        }
        assert.ok(['host.agent.run', 'sesame/manual-trading#workflow_execute'].includes(id), `Undeclared fixture capability: ${id}`);
        const agent = id === 'host.agent.run';
        if (agent) {
          const model = models.find(value => value.provider === input.model.provider && value.id === input.model.id);
          if (!model || canonical(model) !== canonical(input.model)) throw Object.assign(new Error('Agent model configuration changed'), { code: 'MODEL_CHANGED' });
          assert.ok(input.allowedCalls.every(call => call.pluginId && call.capabilityId));
        }
        const ownerSessionId = agent ? runs.read(context.runId).sessionId : options.task?.sessionId ?? context.sessionId;
        const executor = async executionContext => {
          const sessionId = `session-${executionContext.run.id}`;
          runs.bindSession(executionContext.run.id, sessionId);
          if (!agent) {
            const workflow = { runId: executionContext.run.id, sessionId, ownerSessionId };
            return runtime.execute(scoped({ ...host.context, runId: workflow.runId, sessionId, kind: 'subagent' }), input.runId, executionContext.signal,
              { ...executionContext, provenance: { caller: { pluginId: host.context.pluginId }, workflow } });
          }
          const job = { id: executionContext.run.id, request: copy(input), status: 'running', conversationId: sessionId, parentRunId: context.runId };
          jobs.set(job.id, job); requests.push(copy(input));
          executionContext.progress({ sessionId });
          return new Promise((resolve, reject) => {
            const signal = executionContext.signal;
            const abort = () => { job.status = 'cancelled'; reject(signal.reason); };
            job.finish = text => { signal.removeEventListener('abort', abort); job.status = 'completed'; resolve({ text, sessionId, model: copy(input.model), turns: 1, toolCalls: [] }); };
            signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
          });
        };
        const ref = runs.start({ kind: agent ? 'agent' : 'workflow', capabilityId: id, pluginId: context.pluginId,
          sessionId: ownerSessionId, parentRunId: context.runId, operationId: options.operationId, input, task: options.task }, executor);
        executors.set(ref.id, executor);
        if (options.signal) {
          const abort = () => {
            if (options.signal.reason?.code === 'RUN_INTERRUPTED') {
              if (['queued', 'running'].includes(runs.read(ref.id).status)) runs.interrupt(ref.id, { reason: options.signal.reason.message });
            } else runs.cancel(ref.id, { reason: 'Parent execution stopped' });
          };
          options.signal.addEventListener('abort', abort, { once: true });
          runs.watch(ref.id, run => { if (['completed', 'failed', 'cancelled', 'unknown'].includes(run.status)) options.signal.removeEventListener('abort', abort); });
        }
        return { type: 'run', run: ref };
      },
    };
    return selected;
  }
  Object.assign(host, scoped(host.context));
  const main = scoped({ ...host.context, kind: 'main', sessionId: 'conv_main' });
  runtime = new TradingRuntime(host, { now: () => time, timer: false });
  t.after(async () => {
    await runtime.dispose(); await runs.close(); closeRecords(host); store.close();
    assert.ok(root.startsWith(join(tmpdir(), 'manual-plans-v2-'))); await rm(root, { recursive: true, force: true });
  });
  const waitFor = async predicate => {
    for (let i = 0; i < 500; i++) { if (await predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
    assert.fail(`Expected state was not reached: ${JSON.stringify(records(host).list('runs').map(run => ({ id: run.id, status: run.status, error: run.error, reportError: run.reportError })))}`);
  };
  const f = { ...resourceState, host, main, models, jobs, requests, brokerCalls, events, entries, storage: records(host), runs, waitFor,
    get runtime() { return runtime; }, get time() { return time; }, get account() { return copy(account); }, get execution() { return execution(); },
    advance: milliseconds => { time += milliseconds; }, setAccount: value => { account = copy(value); },
    setExecutionTools: value => { extraExecutionTools = [...value]; },
    input: (extra = {}) => ({ id: 'plan-1', title: 'Fixture portfolio', execution: { plugin_id: 'fixture/execution', context_tool: 'fixture_context', apply_tool: 'fixture_apply' }, mode: 'single', model: copy(baseModel), symbols: ['EURUSD'], ...extra }),
    active: role => [...jobs.values()].filter(job => job.status === 'running' && (!role || job.request.input.role === role)),
    child(id) { const job = jobs.get(id); return scoped({ ...host.context, kind: 'subagent', sessionId: job.conversationId, runId: id }); },
    call(method, child, ...args) {
      const job = jobs.get(child.context.runId), workflow = runs.read(job.parentRunId);
      const provenance = { workflow: { runId: workflow.id, sessionId: workflow.executionSessionId, ownerSessionId: workflow.sessionId },
        agent: { pluginId: host.context.pluginId, taskId: job.id, runId: job.id, sessionId: job.conversationId, input: copy(job.request.input) } };
      return runtime.invocation.run({ provenance }, () => runtime[method](child, ...args));
    },
    finish(id, text = `Report from ${jobs.get(id)?.request.input.role}`) { const job = jobs.get(id); assert.equal(job.status, 'running'); job.finish(text); },
    async report(runId) { return JSON.parse((await host.resources.read(runtime.run(runId).report.ref, { part: 'content', entry: 'run.json' })).content); },
    restart: async () => { await runtime.dispose(); runtime = new TradingRuntime(host, { now: () => time, timer: false }); await runtime.start(); return runtime; },
    async completeSingle(runId) {
      await waitFor(() => f.active('manager').some(job => job.request.input.runId === runId));
      const manager = f.active('manager').find(job => job.request.input.runId === runId);
      await f.call('context', f.child(manager.id), runId); await f.call('decide', f.child(manager.id), runId, unchanged); f.finish(manager.id);
      await waitFor(() => f.active('executor').some(job => job.request.input.runId === runId));
      const executor = f.active('executor').find(job => job.request.input.runId === runId);
      await f.call('apply', f.child(executor.id), runId); f.finish(executor.id);
      await waitFor(() => runtime.run(runId).report && ![...runtime.running.values()].some(entry => entry.runId === runId));
    },
  };
  return f;
}
