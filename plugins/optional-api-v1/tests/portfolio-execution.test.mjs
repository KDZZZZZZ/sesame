import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createExecution, migrateLegacy, PLUGIN, CONTEXT, APPLY } from '../packages/portfolio-execution/bindings.js';

const clone = value => value === undefined ? undefined : structuredClone(value);
function fixture({ backend = 'mt5', apply } = {}) {
  const rows = new Map(), calls = [], time = 1800000000000;
  const account = backend === 'mt5' ? { accountId: '123', server: 'broker', revision: '1' } : { accountId: '123', connectionId: 'route', revision: '1' };
  const host = { scope: { kind: 'main', conversationId: 'owner' }, plugins: { isActive: () => true, inspect: id => id === 'sesame/manual-trading' ? undefined : { version: id === 'sesame/mt5' ? '1.6.0' : '1.4.0' } },
    storage: { directory: randomUUID(), get: (key, id) => clone(rows.get(`${key}:${id}`)),
      put(key, value) { rows.set(`${key}:${value.id}`, clone(value)); return clone(value); },
      list: key => [...rows].filter(([id]) => id.startsWith(`${key}:`)).map(([, value]) => clone(value)),
      delete: (key, id) => rows.delete(`${key}:${id}`), transaction: fn => fn() },
    tools: { call: async request => { calls.push(clone(request)); return { account: clone(account), positions: [], orders: [], deployments: [] }; },
      invocation: () => clone({ chain: host.chain }) }, agents: { current: () => clone(host.task) } };
  const run = { id: 'run', plan: { id: 'plan', account: clone(account), ownerConversationId: 'owner', slippageBps: 50 }, decidedAt: time,
    decision: { unchanged: true, targets: [], pause_strategies: [] } };
  const execution = createExecution(host, { now: () => time, ...(apply ? { apply } : {}) });
  async function delegated(workflow = 'fixture/workflow') {
    const selection = await execution.configure({ id: 'binding', backend });
    const identity = await execution.context({ binding_id: 'binding', action: 'identity' });
    host.task = { id: 'task', pluginId: workflow, status: 'running', conversationId: 'child', input: { runId: 'run', role: 'executor', tradingPlan: { id: 'plan', account: clone(account), ownerConversationId: 'owner' },
      execution: { pluginId: PLUGIN, contextTool: CONTEXT, applyTool: APPLY, arguments: { binding_id: 'binding' }, account: identity.account, context: identity.taskContext } } };
    host.scope = { kind: 'subagent', conversationId: 'child' };
    host.chain = [{ pluginId: workflow, toolName: 'workflow_apply' }, { pluginId: PLUGIN, toolName: APPLY }];
    return selection;
  }
  return { host, execution, delegated, account, calls, run, args: { binding_id: 'binding', run } };
}

test('binding freezes native identity and declares complete composable execution/read tool contracts', async () => {
  for (const backend of ['mt5', 'qmt']) {
    const f = fixture({ backend });
    const selection = await f.execution.configure({ id: 'binding', backend });
    assert.deepEqual(selection, { plugin_id: PLUGIN, context_tool: CONTEXT, apply_tool: APPLY, arguments: { binding_id: 'binding' } });
    const identity = await f.execution.context({ binding_id: 'binding', action: 'identity' });
    assert(identity.tools.includes(APPLY)); assert(!identity.readTools.includes(APPLY));
    assert(identity.readTools.every(name => identity.tools.includes(name)));
    assert.equal(identity.quantityRules.integer, backend === 'qmt');
    assert.deepEqual(identity.fillSources, backend === 'mt5' ? [{ pluginId: 'sesame/mt5', provider: 'mt5/python/history_deals_get' }] : []);
    f.account.revision = '2';
    await assert.rejects(f.execution.context({ binding_id: 'binding', action: 'snapshot' }), { code: 'ACCOUNT_CHANGED' });
    await assert.rejects(f.execution.configure({ id: 'binding', backend }), { code: 'BINDING_CHANGED' });
    assert.equal((await f.execution.configure({ id: 'new-binding', backend })).arguments.binding_id, 'new-binding');
  }
});

test('different workflow identities can apply unchanged targets; every direct/forged/stale execution path fails', async () => {
  for (const workflow of ['fixture/first-workflow', 'fixture/other-workflow']) {
    const f = fixture(); await f.delegated(workflow);
    assert.equal((await f.execution.apply(f.args)).status, 'unchanged');
    assert(f.calls.every(call => call.name.endsWith('_trading_context')));
  }
  for (const change of [
    f => { f.host.chain = f.host.chain.slice(1); },
    f => { f.host.chain[0].pluginId = 'forged'; },
    f => { f.host.task.input.role = 'analyst'; },
    f => { f.host.task.status = 'cancelled'; },
    f => { f.host.task.input.execution.context.backend = 'other'; },
    f => { f.host.task.input.execution.arguments.binding_id = 'other'; },
    f => { f.args.run.id = 'other'; },
    f => { f.args.run.plan.account.revision = '2'; },
    f => { f.args.run.plan.ownerConversationId = 'other'; },
    f => { f.args.run.plan.backend = 'qmt'; },
  ]) {
    const f = fixture(); await f.delegated(); change(f);
    const before = f.calls.length;
    await assert.rejects(f.execution.apply(f.args));
    assert.equal(f.calls.length, before);
  }
});

test('bindings cannot be read or reused by another main owner or an unrelated child task', async () => {
  const f = fixture(); await f.execution.configure({ id: 'binding', backend: 'mt5' });
  f.host.scope.conversationId = 'another';
  await assert.rejects(f.execution.context({ binding_id: 'binding', action: 'identity' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.execution.configure({ id: 'binding', backend: 'qmt' }), { code: 'FORBIDDEN' });
  f.host.scope = { kind: 'subagent', conversationId: 'child' };
  await assert.rejects(f.execution.context({ binding_id: 'binding', action: 'snapshot' }), { code: 'FORBIDDEN' });
});

test('an older native plugin is rejected while binding, before a workflow can schedule incompatible execution', async () => {
  const f = fixture();
  f.host.plugins.inspect = id => id === 'sesame/manual-trading' ? undefined : { version: '1.5.0' };
  await assert.rejects(f.execution.configure({ id: 'binding', backend: 'mt5' }), { code: 'PREREQUISITE_REQUIRED' });
  assert.equal(f.calls.length, 0);
});

test('application receipt is written once and concurrent/restarted retries never replay native execution', async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ apply: async (_host, _run, options) => { calls++; await gate; options.assertActive(); return { status: 'unchanged', orders: [], pauses: [] }; } });
  await f.delegated();
  const first = f.execution.apply(f.args), second = f.execution.apply(f.args);
  release(); assert.deepEqual(await first, await second); assert.equal(calls, 1);
  const restarted = createExecution(f.host, { apply: () => assert.fail('must not replay') });
  assert.deepEqual(await restarted.apply(f.args), await first);
  await assert.rejects(restarted.apply({ ...f.args, run: { ...f.run, decidedAt: f.run.decidedAt + 1 } }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('an interrupted application returns retained progress as blocked and never retries its side effects', async () => {
  const f = fixture({ apply: async (_host, _run, options) => {
    options.checkpoint({ executionProgress: { status: 'checking', orders: [{ operationId: 'possibly-sent' }], pauses: [] } });
    throw new Error('interrupted after checkpoint');
  } });
  await f.delegated();
  await assert.rejects(f.execution.apply(f.args), /interrupted/);
  const restarted = createExecution(f.host, { apply: () => assert.fail('must not replay') });
  const result = await restarted.apply(f.args);
  assert.equal(result.status, 'blocked'); assert.equal(result.error.code, 'EXECUTION_INTERRUPTED');
  assert.equal(result.orders[0].operationId, 'possibly-sent');
  assert.throws(() => restarted.status({}), { code: 'FORBIDDEN' });
  f.host.scope = { kind: 'main', conversationId: 'owner' };
  const status = restarted.status({ run_id: 'run' });
  assert.equal(status.items[0].status, 'interrupted');
  assert.equal(status.items[0].orders[0].operation_id, 'possibly-sent');
  f.host.scope.conversationId = 'unrelated';
  assert.equal(restarted.status({}).items.length, 0);
});

test('two workflow runs on the same account serialize the complete target batch', { timeout: 2000 }, async () => {
  let release, entered, starts = 0;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const apply = async (_host, _run, options) => { starts++; if (starts === 1) { entered(); await gate; } options.assertActive(); return { status: 'unchanged', orders: [], pauses: [] }; };
  const f = fixture({ apply }), g = fixture({ apply });
  await f.delegated(); await g.delegated(); g.host.storage.directory = f.host.storage.directory;
  g.run.id = 'second-run'; g.host.task.input.runId = 'second-run';
  const first = f.execution.apply(f.args); await ready;
  const second = g.execution.apply(g.args);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(starts, 1);
  release(); await Promise.all([first, second]); assert.equal(starts, 2);
});

test('legacy import keeps exact owner receipts and foreign unknown blockers; repeats preserve newer recovery evidence', async () => {
  const f = fixture(), legacy = { id: 'old', conversationId: 'owner', fingerprint: 'fingerprint', kind: 'order', status: 'outcome_unknown', account: f.account, backend: 'mt5' };
  f.host.plugins.inspect = () => ({ tools: ['manual_trading_execution_export'] });
  f.host.tools.call = async () => ({ source: 'sesame/manual-trading', items: [legacy], unresolved: [{ ...legacy, id: 'foreign', conversationId: 'other' }], nextOffset: null, complete: true });
  await migrateLegacy(f.host);
  assert.deepEqual(f.host.storage.get('commands', 'old'), legacy);
  assert.equal(f.host.storage.list('legacy_blocks')[0].originalOperationId, 'foreign');
  f.host.storage.put('commands', { ...legacy, status: 'execution_observed' });
  await migrateLegacy(f.host);
  assert.equal(f.host.storage.get('commands', 'old').status, 'execution_observed');
  assert.equal(f.host.storage.list('legacy_blocks').length, 1);
  f.host.plugins.isActive = () => false;
  await assert.rejects(migrateLegacy(f.host), { code: 'PREREQUISITE_REQUIRED' });
  f.host.plugins.isActive = () => true; f.host.plugins.inspect = () => ({ tools: [] });
  await assert.rejects(migrateLegacy(f.host), { code: 'PREREQUISITE_REQUIRED' });
});

test('legacy import rejects conflicting IDs and never treats a broken export as an empty account', async () => {
  const f = fixture(); f.host.plugins.inspect = () => ({ tools: ['manual_trading_execution_export'] });
  f.host.tools.call = async () => ({ source: 'sesame/manual-trading', items: [{ id: 'old', conversationId: 'wrong', fingerprint: 'fp' }], unresolved: [], complete: true });
  await assert.rejects(migrateLegacy(f.host), { code: 'SOURCE_DATA_INVALID' });
  assert.equal(f.host.storage.list('migrations').length, 0);
  f.host.tools.call = async () => ({ source: 'sesame/manual-trading', items: [], unresolved: [], complete: false, nextOffset: 0 });
  await assert.rejects(migrateLegacy(f.host), { code: 'SOURCE_DATA_INVALID' });
});
