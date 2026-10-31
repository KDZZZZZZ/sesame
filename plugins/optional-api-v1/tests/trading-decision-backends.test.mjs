import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonical } from '@sesame/plugin-sdk/protocol';
import { createTradingContext as mt5Context, createCapabilities as mt5Capabilities } from '../packages/mt5/tools/trading-context.js';
import { records as mt5Records } from '../packages/mt5/backend/records.js';
import { createTradingContext as qmtContext } from '../packages/qmt/trading-context.js';
import { createService } from '../packages/qmt/service.js';
import { capability as qmtCapability, exclusive } from '../packages/qmt/execution.js';
import { records as qmtRecords, closeRecords as closeQMTRecords } from '../packages/qmt/records.js';
import { createCapabilities as qmtCapabilities } from '../packages/qmt/index.js';
import { createCapabilities as pythonCapabilities } from '../packages/mt5/tools/python/index.js';
import { builtinRoutes, pluginRoute } from '../packages/mt5/backend/plugin-routing.js';

const account = { accountId: '123', server: 'broker', revision: '1' };
const qmtAccount = { accountId: '123', connectionId: 'connection', revision: '1' };
const mt5Order = { server: 'python', tool: 'order_send', command_id: 'workflow-command-0001', arguments: { request: { action: 'TRADE_ACTION_DEAL', symbol: 'EURUSD', volume: 0.1, type: 'ORDER_TYPE_BUY' }, execution_guard: { expected_account: '123', expected_server: 'broker', expected_positions: [] } } };
const order = { operation_id: 'once', user_authorized: true, account_id: '123', connection_revision: '1', symbol: '600000.SH', side: 'sell', shares: '100', price: '10',
  execution_guard: { observed_at: 1, expires_at: 2, max_quote_age_ms: 5000, max_quote_to_send_ms: 1000, price_limit: '10', expected_positions: [] } };

function taskHost(t, backend, role = 'executor') {
  const directory = mkdtempSync(join(tmpdir(), `workflow-${backend}-`)), boundAccount = backend === 'mt5' ? account : qmtAccount;
  const host = { context: { pluginId: `sesame/${backend}`, kind: 'subagent', sessionId: 'child', storageRoot: directory },
    agent: { taskId: 'task-1', runId: 'agent-run-1', pluginId: 'sesame/trading-decision', status: 'running', sessionId: 'child',
      input: { tradingPlan: { id: 'plan', account: boundAccount, ownerConversationId: 'parent' }, runId: 'cycle', role,
        execution: { pluginId: 'sesame/portfolio-execution', contextTool: 'portfolio_execution_context', applyTool: 'portfolio_execution_apply', arguments: { binding_id: 'binding' }, account: boundAccount, context: { bindingId: 'binding', backend, account: boundAccount } } } } };
  host.chain = [{ pluginId: host.agent.pluginId, capabilityId: `${host.agent.pluginId}#workflow_apply` },
    { pluginId: 'sesame/portfolio-execution', capabilityId: 'sesame/portfolio-execution#portfolio_execution_apply' }];
  t.after(() => { if (backend === 'mt5') mt5Records(host).close(); else closeQMTRecords(host); rmSync(directory, { recursive: true, force: true }); });
  return host;
}
// Only the host-supplied third execute argument carries trusted task lineage.
function execution(host, action) {
  return { provenance: { agent: structuredClone(host.agent), chain: [...structuredClone(host.chain), { pluginId: host.context.pluginId, capabilityId: `${host.context.pluginId}#${action}` }] } };
}
function composed(host, workflow) { host.agent.pluginId = workflow; host.chain[0] = { pluginId: workflow, capabilityId: `${workflow}#workflow_apply` }; }
function mt5Fixture(t, role) {
  const host = taskHost(t, 'mt5', role), calls = [], config = { version: 1, account: { login: '123', server: 'broker' } };
  const deployments = [{ id: 'own', login: '123', server: 'broker', status: 'running' }, { id: 'foreign', login: '999', server: 'broker', status: 'running' }];
  const data = { account_info: { login: '123', server: 'broker' }, terminal_info: { connected: true },
    positions_get: [{ ticket: 'manual', magic: 0 }, { ticket: 'strategy', magic: 42 }], orders_get: [], history_deals_get: [{ ticket: 'fill' }], history_orders_get: [] }, receipts = new Map();
  const mt5 = { official: { settings: () => config, redact: value => structuredClone(value), async call(request, owner) {
    if (receipts.has(request.command_id)) return receipts.get(request.command_id);
    calls.push(request);
    if (request.tool === 'order_send') assert.ok(mt5Records(host).get('mt5_trading_commands', request.command_id), 'Intent is durable before native dispatch');
    const receipt = { status: 'returned', conversation_id: owner, result: { result: request.tool === 'order_send' ? { retcode: 10009, order: '91' } : structuredClone(data[request.tool]) } };
    receipts.set(request.command_id, receipt); return receipt;
  }, command(id, owner) { const receipt = receipts.get(id); assert.equal(receipt?.conversation_id, owner); return receipt; } },
    market: { connected: async () => ({}) }, deployments: { list: () => deployments, async stop(id) { calls.push({ stop: id }); return { ...deployments.find(d => d.id === id), status: 'stopped' }; } } };
  const service = mt5Context(host, mt5);
  const invoke = (method, args, signal) => service[method](args, signal, execution(host, `mt5_trading_${method}`));
  return { host, mt5, config, calls, service, invoke };
}
function qmtFixture(t, role = 'executor') {
  const host = taskHost(t, 'qmt', role), calls = [];
  qmtRecords(host).put('configuration', { id: 'local', version: 1, connection_id: 'connection', account_id: '123', python_path: 'virtual-python', userdata_directory: 'virtual-mini' });
  const service = createService(host, { platform: 'win32', request: async request => {
    calls.push(request);
    if (['order', 'cancel'].includes(request.action)) assert.equal(qmtRecords(host).get('qmt_commands', request.operation_id).status, 'outcome_unknown');
    return { ok: true, sample: { from: 1, to: 2 }, result: request.action === 'order' ? { status: 'submitted', order_id: '44' }
      : request.action === 'cancel' ? { status: 'cancel_requested', order_id: request.order_id }
      : request.action === 'asset' ? { asset: { account_id: '123' } } : { items: request.action === 'positions' ? [{ stock_code: '600000.SH', volume: '100', origin: 'strategy' }] : [] } };
  } });
  t.after(() => service.dispose());
  const invoke = (action, args, signal) => qmtCapability(`qmt_trading_${action}`, () => action === 'context' ? qmtContext(host, service)(args, signal)
    : action === 'command' ? service.commandRecord(args.operation_id, host.context, host)
    : service.command(action, args, signal, host.context, host)).execute(args, signal, execution(host, `qmt_trading_${action}`));
  return { host, service, calls, invoke };
}

test('composed workflow identities use the exact MT5 account contract without a trading-decision name', async t => {
  for (const workflow of ['fixture/another-workflow', 'fixture/rebalance']) {
    const f = mt5Fixture(t); composed(f.host, workflow);
    assert.equal((await f.invoke('context', { action: 'snapshot' })).account.accountId, account.accountId);
    assert.equal((await f.invoke('order', mt5Order)).status, 'returned'); assert.equal(f.calls.filter(c => c.tool === 'order_send').length, 1);
  }
});
test('MT5 rejects direct calls, forged ancestors, wrong roles and stale tasks before sending', async t => {
  for (const change of [
    h => { h.chain = []; }, h => { h.chain[0].pluginId = 'fixture/unrelated'; },
    h => { h.chain[1].capabilityId = 'sesame/portfolio-execution#portfolio_execution_context'; },
    h => { h.agent.input.role = 'analyst'; }, h => { h.agent.status = 'cancelled'; },
    h => { h.agent.input.execution.account = { ...account, revision: '2' }; },
    h => { h.agent.input.execution.context.backend = 'qmt'; }, h => { h.agent.sessionId = 'expired-session'; },
  ]) { const f = mt5Fixture(t); change(f.host); await assert.rejects(f.invoke('order', mt5Order)); assert.equal(f.calls.length, 0); }
});
test('composed QMT orders keep native guards and idempotence; JSON authorization cannot replace lineage', async t => {
  const f = qmtFixture(t); composed(f.host, 'fixture/another-workflow');
  assert.equal((await f.invoke('context', { action: 'identity' })).account.accountId, '123');
  const receipt = await f.invoke('order', order); assert.deepEqual(await f.invoke('order', order), receipt); assert.equal(f.calls.length, 1);
  f.host.chain = [];
  await assert.rejects(f.invoke('order', { ...order, operation_id: 'forged', authorization: { chain: ['trusted'] } }), { code: 'FORBIDDEN' }); assert.equal(f.calls.length, 1);
});
test('configuration is rechecked after the actual QMT queue and MT5 asynchronous pause preparation', async t => {
  const q = qmtFixture(t); let release;
  const blocked = exclusive(q.host, () => new Promise(resolve => { release = resolve; })); await new Promise(resolve => setImmediate(resolve));
  const pending = q.invoke('order', order);
  qmtRecords(q.host).put('configuration', { ...qmtRecords(q.host).get('configuration', 'local'), version: 2 }); release(); await blocked;
  await assert.rejects(pending); assert.equal(q.calls.length, 0);
  const m = mt5Fixture(t); m.mt5.market.connected = async () => { m.config.version = 2; };
  await assert.rejects(m.invoke('pause', { deployment_id: 'own', account, reason: 'Risk' }), { code: 'CONNECTION_CHANGED' }); assert.equal(m.calls.length, 0);
});
test('MT5 full context includes manual and strategy positions with explicit native history limits', async t => {
  const f = mt5Fixture(t, 'analyst'), snapshot = await f.invoke('context', { action: 'snapshot', history_days: 3 });
  assert.deepEqual(snapshot.positions.map(p => p.ticket), ['manual', 'strategy']); assert.deepEqual(snapshot.deployments.map(d => d.id), ['own']);
  assert.equal(snapshot.historyCoverage.complete, false); assert.deepEqual(f.calls.find(c => c.tool === 'positions_get').arguments, {});
  assert.match(f.calls.find(c => c.tool === 'history_deals_get').arguments.date_from, /Z$/);
});
test('MT5 guards reject analysts, foreign deployments and stale account before stopping', async t => {
  const f = mt5Fixture(t), args = { deployment_id: 'own', account, reason: 'Portfolio risk' };
  f.host.agent.input.role = 'analyst'; await assert.rejects(f.invoke('pause', args), { code: 'FORBIDDEN' }); f.host.agent.input.role = 'executor';
  await assert.rejects(f.invoke('pause', { ...args, deployment_id: 'foreign' }), { code: 'ACCOUNT_MISMATCH' });
  f.host.agent.input.tradingPlan.account = { ...account, revision: '2' };
  await assert.rejects(f.invoke('pause', args), { code: 'ACCOUNT_MISMATCH' }); assert.equal(f.calls.length, 0);
});
test('MT5 risk receipt confirms EA stop without implying a close or automatic resume', async t => {
  const f = mt5Fixture(t), result = await f.invoke('pause', { deployment_id: 'own', account, reason: 'Drawdown risk' });
  assert.equal(result.status, 'stopped'); assert.equal(result.nativeAction, 'remove_expert'); assert.equal(result.planId, 'plan'); assert.equal(result.runId, 'cycle');
  assert.deepEqual(f.calls, [{ stop: 'own' }]);
});
test('cancellation during final MT5 connection check prevents EA stop', async t => {
  const f = mt5Fixture(t), controller = new AbortController(); f.mt5.market.connected = async () => controller.abort();
  await assert.rejects(f.invoke('pause', { deployment_id: 'own', account, reason: 'Risk' }, controller.signal)); assert.equal(f.calls.length, 0);
});
test('MT5 incomplete native reads and configuration drift never become empty positions', async t => {
  const f = mt5Fixture(t, 'analyst'), original = f.mt5.official.call;
  f.mt5.official.call = async request => request.tool === 'positions_get' ? { status: 'returned', result: { result: null } } : original(request);
  await assert.rejects(f.invoke('context', { action: 'snapshot' }), { code: 'SOURCE_UNAVAILABLE' });
  f.mt5.official.call = async request => { const result = await original(request); f.config.version = 2; return result; };
  await assert.rejects(f.invoke('context', { action: 'snapshot' }), { code: 'CONNECTION_CHANGED' });
});
test('QMT context includes strategy positions and explicitly limits history to the current native day', async t => {
  const f = qmtFixture(t, 'analyst'), snapshot = await f.invoke('context', { action: 'snapshot' });
  assert.equal(snapshot.positions[0].origin, 'strategy'); assert.equal(snapshot.historyCoverage.scope, 'current_native_trading_day');
  assert.deepEqual(snapshot.deployments, []); assert.equal(f.calls.some(c => c.action === 'order'), false);
});
test('QMT executor keeps exact intent idempotence and receipt account checks', async t => {
  const f = qmtFixture(t), a = await f.invoke('order', order);
  assert.deepEqual(await f.invoke('order', order), a); assert.deepEqual(f.calls[0].execution_guard, order.execution_guard); assert.deepEqual(f.invoke('command', { operation_id: 'once' }), a);
  await assert.rejects(f.invoke('order', { ...order, shares: '200' }), { code: 'IDEMPOTENCY_CONFLICT' });
  f.host.agent.input.role = 'analyst'; await assert.rejects(f.invoke('order', order), { code: 'FORBIDDEN' }); assert.equal(f.calls.length, 1);
});
test('QMT plans cannot omit native guards, cross accounts or call without a matching task context', async t => {
  const f = qmtFixture(t); await assert.rejects(f.service.command('order', order, undefined, f.host.context), { code: 'FORBIDDEN' });
  const { execution_guard: _guard, ...unguarded } = order;
  await assert.rejects(f.invoke('order', unguarded), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.invoke('order', { ...order, account_id: '999' }), { code: 'CONNECTION_CHANGED' }); assert.equal(f.calls.length, 0);
});
test('QMT cancellation retains original intent and rejects another task session', async t => {
  const f = qmtFixture(t); await f.invoke('order', order);
  const args = { operation_id: 'cancel-once', user_authorized: true, account_id: '123', connection_revision: '1', original_operation_id: 'once', order_id: '44' };
  const result = await f.invoke('cancel', args); assert.equal(result.status, 'cancel_requested'); assert.equal(f.calls[1].original_intent.symbol, '600000.SH');
  assert.deepEqual(await f.invoke('cancel', args), result); assert.equal(f.calls.length, 2); f.host.agent.sessionId = 'different';
  await assert.rejects(f.invoke('order', { ...order, operation_id: 'new' }), { code: 'FORBIDDEN' });
  assert.throws(() => f.invoke('command', { operation_id: 'once' }), { code: 'FORBIDDEN' });
});
test('MT5 arguments containing user-authored agent metadata or old signatures confer no authority', async t => {
  const f = mt5Fixture(t), input = { ...mt5Order, authorization: { signature: 'claimed', expiresAt: Date.now() + 1000 }, provenance: execution(f.host, 'mt5_trading_order').provenance };
  await assert.rejects(f.service.order(input), { code: 'FORBIDDEN' }); f.host.chain = [];
  await assert.rejects(f.invoke('order', input), { code: 'FORBIDDEN' }); assert.equal(f.calls.length, 0);
});
test('scheduled MT5 and QMT execution require complete expected positions', async t => {
  const m = mt5Fixture(t), q = qmtFixture(t), { expected_positions: _mt5Expected, ...mt5Guard } = mt5Order.arguments.execution_guard;
  await assert.rejects(m.invoke('order', { ...mt5Order, arguments: { ...mt5Order.arguments, execution_guard: mt5Guard } }), { code: 'invalid_request' });
  const { expected_positions: _qmtExpected, ...qmtGuard } = order.execution_guard;
  await assert.rejects(q.invoke('order', { ...order, execution_guard: qmtGuard }), { code: 'INVALID_ARGUMENT' }); assert.equal(m.calls.length, 0); assert.equal(q.calls.length, 0);
});
test('MT5 replay retains the parent receipt and permits narrow main recovery after a revision change', async t => {
  const f = mt5Fixture(t), receipt = await f.invoke('order', mt5Order);
  assert.equal(receipt.conversation_id, 'parent'); assert.deepEqual(await f.invoke('order', mt5Order), receipt); assert.equal(f.calls.length, 1);
  await assert.rejects(f.invoke('order', { ...mt5Order, arguments: { ...mt5Order.arguments, request: { ...mt5Order.arguments.request, volume: 0.2 } } }), { code: 'IDEMPOTENCY_CONFLICT' });
  f.host.context.kind = 'main'; f.host.context.sessionId = 'parent'; f.config.version = 2;
  assert.deepEqual(f.invoke('command', { command_id: mt5Order.command_id }), receipt);
  f.host.context.sessionId = 'different'; assert.throws(() => f.invoke('command', { command_id: mt5Order.command_id }), { code: 'FORBIDDEN' });
  f.host.context.sessionId = 'parent'; f.config.account.login = '999'; assert.throws(() => f.invoke('command', { command_id: mt5Order.command_id }), { code: 'FORBIDDEN' });
});
test('MT5 durable intent cannot be claimed by a later child even with identical order input', async t => {
  const f = mt5Fixture(t); await f.invoke('order', mt5Order); f.host.agent.taskId = 'another-task';
  await assert.rejects(f.invoke('order', mt5Order), { code: 'IDEMPOTENCY_CONFLICT' }); assert.equal(f.calls.length, 1);
});
test('QMT uses full capability IDs and strips redundant input proof before native dispatch', async t => {
  const f = qmtFixture(t); f.host.chain[1].capabilityId = 'fixture/forged#portfolio_execution_apply';
  await assert.rejects(f.invoke('order', order), { code: 'FORBIDDEN' }); f.host.chain[1].capabilityId = 'sesame/portfolio-execution#portfolio_execution_apply';
  await f.invoke('order', { ...order, authorization: { signature: 'not-an-authority' } }); assert.equal(Object.hasOwn(f.calls[0], 'authorization'), false);
  assert.deepEqual(await f.invoke('order', order), f.invoke('command', { operation_id: 'once' })); assert.equal(f.calls.length, 1);
});
test('QMT queued cancellation prevents native dispatch; main trading uses the explicit main context', async t => {
  const f = qmtFixture(t), controller = new AbortController(); let release;
  const blocked = exclusive(f.host, () => new Promise(resolve => { release = resolve; })); await new Promise(resolve => setImmediate(resolve));
  const pending = f.invoke('order', order, controller.signal); controller.abort(); release(); await blocked;
  await assert.rejects(pending); assert.equal(f.calls.length, 0); f.host.context.kind = 'main'; f.host.context.sessionId = 'parent';
  await f.service.command('order', { ...order, operation_id: 'main-order' }); assert.equal(f.calls.length, 1);
});
test('Python read capability cannot route trading-class methods around the guarded entry', async t => {
  const f = mt5Fixture(t);
  f.mt5.official.route = (server, tool) => pluginRoute(builtinRoutes(), server, tool, undefined, ['order_send', 'login', 'initialize'].includes(tool) ? 'trading' : 'standard');
  const tool = pythonCapabilities(f.host, f.mt5)[0];
  for (const name of ['order_send', 'initialize', 'login']) await assert.rejects(tool.execute({ ...mt5Order, tool: name }), { code: 'mt5_wrong_plugin' }); assert.equal(f.calls.length, 0);
});
test('QMT receipt recovery permits same-domain revision changes and rejects another owner or account', async t => {
  const f = qmtFixture(t), receipt = await f.invoke('order', order);
  qmtRecords(f.host).put('configuration', { ...qmtRecords(f.host).get('configuration', 'local'), version: 2 }); f.host.context.kind = 'main'; f.host.context.sessionId = 'parent';
  assert.deepEqual(f.invoke('command', { operation_id: 'once' }), receipt);
  f.host.context.sessionId = 'other'; assert.throws(() => f.invoke('command', { operation_id: 'once' }), { code: 'FORBIDDEN' });
  f.host.context.sessionId = 'parent'; qmtRecords(f.host).put('configuration', { ...qmtRecords(f.host).get('configuration', 'local'), account_id: '999' });
  assert.throws(() => f.invoke('command', { operation_id: 'once' }), { code: 'ACCOUNT_MISMATCH' });
});
test('trading capabilities are explicitly declared and remain available to workflow children', t => {
  for (const [name, actual] of [['mt5', mt5Capabilities(taskHost(t, 'mt5'), {})], ['qmt', qmtCapabilities(taskHost(t, 'qmt')).filter(item => item.name.startsWith('qmt_trading_'))]]) {
    const root = new URL(`../packages/${name}/`, import.meta.url), manifest = JSON.parse(readFileSync(new URL('plugin.json', root))), declared = JSON.parse(readFileSync(new URL(manifest.capability_manifest, root)));
    for (const binding of actual) { const item = declared.capabilities.find(item => item.id === binding.name); assert.ok(item?.consumers.includes('agent')); assert.ok(!manifest.main_tool_names.includes(binding.name)); assert.equal(typeof binding.execute, 'function'); }
  }
});
test('QMT rejects the removed signature-only legacy task even with a valid private-key proof', async t => {
  const f = qmtFixture(t), keys = generateKeyPairSync('ed25519'), expiresAt = Date.now() + 50000;
  delete f.host.agent.input.execution; f.host.agent.input.tradingPlan.backend = 'qmt'; f.host.agent.input.executionPublicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const signature = sign(null, Buffer.from(canonical({ version: 1, taskId: f.host.agent.runId, runId: f.host.agent.input.runId, action: 'qmt_trading_order', args: order, expiresAt })), keys.privateKey).toString('base64');
  await assert.rejects(f.invoke('order', { ...order, authorization: { expiresAt, signature } }), { code: 'FORBIDDEN' }); assert.equal(f.calls.length, 0);
});
