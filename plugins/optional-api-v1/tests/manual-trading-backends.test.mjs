import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonical } from '@sesame/plugin-sdk/protocol';
import { Type } from '@sesame/plugin-sdk/schema';
import { createTradingContext as mt5Context, createTools as mt5Tools } from '../packages/mt5/tools/trading-context.js';
import { createTradingContext as qmtContext } from '../packages/qmt/trading-context.js';
import { createService } from '../packages/qmt/service.js';
import { createTools as qmtTools } from '../packages/qmt/index.js';
import { createTools as pythonTools } from '../packages/mt5/tools/python/index.js';
import { builtinRoutes, pluginRoute } from '../packages/mt5/backend/plugin-routing.js';

const account = { accountId: '123', server: 'broker', revision: '1' };
const qmtAccount = { accountId: '123', connectionId: 'connection', revision: '1' };
function taskHost(backend = 'mt5', role = 'executor') {
  const rows = new Map();
  const keys = generateKeyPairSync('ed25519');
  const host = {
    scope: { kind: 'subagent', conversationId: 'child' },
    privateKey: keys.privateKey,
    task: { id: 'task-1', pluginId: 'sesame/manual-trading', status: 'running', conversationId: 'child',
      input: { executionPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), tradingPlan: { id: 'plan', backend, account: backend === 'mt5' ? account : qmtAccount, ownerConversationId: 'parent' }, runId: 'cycle', role } },
    agents: { current: () => structuredClone(host.task) },
    storage: { directory: `backend-fixture-${backend}`, get: (collection, id) => rows.get(`${collection}:${id}`),
      put(collection, value) { rows.set(`${collection}:${value.id}`, structuredClone(value)); return structuredClone(value); } },
    configuration: { exclusive: fn => fn() }, environment: {},
    tools: { Type, string: description => Type.String({ description, minLength: 1, maxLength: 20000 }),
      optional: description => Type.Optional(Type.String({ description, minLength: 1, maxLength: 20000 })),
      define: (name, description, properties, execute) => ({ name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) },
  };
  return host;
}
function signed(host, action, args, expiresAt = Date.now() + 50000) {
  const signature = sign(null, Buffer.from(canonical({ version: 1, taskId: host.task.id, runId: host.task.input.runId, action, args, expiresAt })), host.privateKey).toString('base64');
  return { ...args, authorization: { expiresAt, signature } };
}
function composed(host, backend, workflow = 'fixture/another-workflow') {
  host.task.pluginId = workflow;
  delete host.task.input.executionPublicKey;
  delete host.task.input.tradingPlan.backend;
  const account = host.task.input.tradingPlan.account;
  host.task.input.execution = { pluginId: 'sesame/portfolio-execution', contextTool: 'portfolio_execution_context', applyTool: 'portfolio_execution_apply', arguments: { binding_id: 'binding' }, account,
    context: { bindingId: 'binding', backend, account } };
  host.chain = [{ pluginId: workflow, toolName: 'workflow_apply' }, { pluginId: 'sesame/portfolio-execution', toolName: 'portfolio_execution_apply' }, { pluginId: `sesame/${backend}`, toolName: `${backend}_trading_order` }];
  host.tools.invocation = () => structuredClone({ chain: host.chain });
}

test('composed workflow identities use the same MT5 exact-account contract without a manual-trading name', async () => {
  for (const workflow of ['fixture/another-workflow', 'fixture/rebalance']) {
    const f = mt5Fixture(); composed(f.host, 'mt5', workflow);
    assert.equal((await f.service.context({ action: 'snapshot' })).account.accountId, account.accountId);
    assert.equal((await f.service.order(mt5Order)).status, 'returned');
    assert.equal(f.calls.filter(c => c.tool === 'order_send').length, 1);
  }
});

test('MT5 composed execution rejects direct calls, forged ancestors, changed account, role and expired task before sending', async () => {
  const changes = [
    h => { h.chain = h.chain.slice(2); },
    h => { h.chain[0].pluginId = 'fixture/unrelated'; },
    h => { h.chain[1].toolName = 'portfolio_execution_context'; },
    h => { h.task.input.role = 'analyst'; },
    h => { h.task.status = 'cancelled'; },
    h => { h.task.input.execution.account = { ...account, revision: '2' }; },
    h => { h.task.input.execution.context.backend = 'qmt'; },
    h => { h.tools.invocation = () => { throw Object.assign(new Error('Expired invocation'), { code: 'FORBIDDEN' }); }; },
  ];
  for (const change of changes) {
    const f = mt5Fixture(); composed(f.host, 'mt5'); change(f.host);
    await assert.rejects(f.service.order(mt5Order));
    assert.equal(f.calls.filter(c => c.tool === 'order_send').length, 0);
  }
});

test('composed QMT orders keep guards, idempotence and account checks; JSON authorization cannot replace the invocation chain', async () => {
  const f = qmtFixture(); composed(f.host, 'qmt');
  assert.equal((await qmtContext(f.host, f.service)({ action: 'identity' })).account.accountId, '123');
  const receipt = await f.service.command('order', order, undefined, f.host.scope, f.host);
  assert.deepEqual(await f.service.command('order', order, undefined, f.host.scope, f.host), receipt);
  assert.equal(f.calls.length, 1);
  f.host.chain = f.host.chain.slice(2);
  await assert.rejects(f.service.command('order', { ...order, operation_id: 'forged', authorization: { chain: ['trusted'] } }, undefined, f.host.scope, f.host), { code: 'FORBIDDEN' });
  assert.equal(f.calls.length, 1);
});

test('composed authorization is rechecked after a QMT queue and MT5 asynchronous pause preparation', async () => {
  const q = qmtFixture(); composed(q.host, 'qmt');
  q.host.configuration.exclusive = async action => { q.host.chain = q.host.chain.slice(2); return action(); };
  await assert.rejects(q.service.command('order', order, undefined, q.host.scope, q.host), { code: 'FORBIDDEN' });
  assert.equal(q.calls.length, 0);
  const m = mt5Fixture(); composed(m.host, 'mt5'); m.host.chain.at(-1).toolName = 'mt5_trading_pause';
  m.mt5.market.connected = async () => { m.host.task.status = 'cancelled'; };
  await assert.rejects(m.service.pause({ deployment_id: 'own', account, reason: 'Risk' }), { code: 'FORBIDDEN' });
  assert.equal(m.calls.length, 0);
});
function mt5Fixture(role) {
  const host = taskHost('mt5', role), calls = [];
  const config = { version: 1, account: { login: '123', server: 'broker' } };
  const deployments = [{ id: 'own', login: '123', server: 'broker', status: 'running' }, { id: 'foreign', login: '999', server: 'broker', status: 'running' }];
  const data = { account_info: { login: '123', server: 'broker' }, terminal_info: { connected: true },
    positions_get: [{ ticket: 'manual', magic: 0 }, { ticket: 'strategy', magic: 42 }], orders_get: [], history_deals_get: [{ ticket: 'fill' }], history_orders_get: [] };
  const receipts = new Map();
  const mt5 = { official: { settings: () => config, async call(request, owner) {
    if (receipts.has(request.command_id)) return receipts.get(request.command_id);
    calls.push(request);
    const receipt = { status: 'returned', conversation_id: owner, result: { result: request.tool === 'order_send' ? { retcode: 10009, order: '91' } : structuredClone(data[request.tool]) } };
    receipts.set(request.command_id, receipt); return receipt;
  }, command(id, owner) { const receipt = receipts.get(id); assert.equal(receipt?.conversation_id, owner); return receipt; } },
    market: { connected: async () => ({}) }, deployments: { list: () => deployments, async stop(id) { calls.push({ stop: id }); return { ...deployments.find(d => d.id === id), status: 'stopped' }; } } };
  return { host, mt5, config, calls, service: mt5Context(host, mt5) };
}

test('MT5 full account context includes manual and strategy positions; snapshot never filters origin', async () => {
  const f = mt5Fixture('analyst'); const snapshot = await f.service.context({ action: 'snapshot', history_days: 3 });
  assert.deepEqual(snapshot.positions.map(p => p.ticket), ['manual', 'strategy']);
  assert.deepEqual(snapshot.deployments.map(d => d.id), ['own']);
  assert.equal(snapshot.historyCoverage.complete, false);
  assert.deepEqual(f.calls.find(c => c.tool === 'positions_get').arguments, {});
  assert.match(f.calls.find(c => c.tool === 'history_deals_get').arguments.date_from, /Z$/);
});
test('MT5 guards reject unrelated tasks, stale identity, analysts and foreign deployment before stop', async () => {
  const f = mt5Fixture(); const args = { deployment_id: 'own', account, reason: 'Portfolio risk' };
  f.host.task.pluginId = 'other'; await assert.rejects(f.service.pause(args), { code: 'FORBIDDEN' });
  f.host.task.pluginId = 'sesame/manual-trading'; f.host.task.input.role = 'analyst';
  await assert.rejects(f.service.pause(args), { code: 'FORBIDDEN' });
  f.host.task.input.role = 'executor';
  await assert.rejects(f.service.pause(signed(f.host, 'mt5_trading_pause', { ...args, deployment_id: 'foreign' })), { code: 'ACCOUNT_MISMATCH' });
  f.config.version = 2; await assert.rejects(f.service.pause(args), { code: 'ACCOUNT_MISMATCH' });
  assert.equal(f.calls.some(c => c.stop), false);
});
test('MT5 risk receipt confirms EA stop, does not imply close or automatic resume', async () => {
  const f = mt5Fixture(); const result = await f.service.pause(signed(f.host, 'mt5_trading_pause', { deployment_id: 'own', account, reason: 'Drawdown risk' }));
  assert.equal(result.status, 'stopped'); assert.equal(result.nativeAction, 'remove_expert');
  assert.equal(result.planId, 'plan'); assert.equal(result.runId, 'cycle');
  assert.deepEqual(f.calls.filter(c => c.stop), [{ stop: 'own' }]);
});
test('cancellation during final MT5 connection check prevents EA stop', async () => {
  const f = mt5Fixture(), controller = new AbortController();
  f.mt5.market.connected = async () => controller.abort();
  await assert.rejects(f.service.pause(signed(f.host, 'mt5_trading_pause', { deployment_id: 'own', account, reason: 'Risk' }), controller.signal));
  assert.equal(f.calls.some(c => c.stop), false);
});
test('MT5 rejects incomplete native reads and configuration drift instead of reporting empty positions', async () => {
  const f = mt5Fixture('analyst'), original = f.mt5.official.call;
  f.mt5.official.call = async request => request.tool === 'positions_get' ? { status: 'returned', result: { result: null } } : original(request);
  await assert.rejects(f.service.context({ action: 'snapshot' }), { code: 'SOURCE_UNAVAILABLE' });
  f.mt5.official.call = async request => { const result = await original(request); f.config.version = 2; return result; };
  await assert.rejects(f.service.context({ action: 'snapshot' }), { code: 'CONNECTION_CHANGED' });
});
function qmtFixture(role = 'executor') {
  const host = taskHost('qmt', role), calls = [];
  host.storage.put('configuration', { id: 'local', version: 1, connection_id: 'connection', account_id: '123', python_path: 'virtual-python', userdata_directory: 'virtual-mini' });
  const service = createService(host, { platform: 'win32', request: async request => {
    calls.push(request);
    return { ok: true, sample: { from: 1, to: 2 }, result: request.action === 'order' ? { status: 'submitted', order_id: '44' }
      : request.action === 'cancel' ? { status: 'cancel_requested', order_id: request.order_id }
      : request.action === 'asset' ? { asset: { account_id: '123' } } : { items: request.action === 'positions' ? [{ stock_code: '600000.SH', volume: '100', origin: 'strategy' }] : [] } };
  } });
  return { host, service, calls };
}
const order = { operation_id: 'once', user_authorized: true, account_id: '123', connection_revision: '1', symbol: '600000.SH', side: 'sell', shares: '100', price: '10',
  execution_guard: { observed_at: 1, expires_at: 2, max_quote_age_ms: 5000, max_quote_to_send_ms: 1000, price_limit: '10', expected_positions: [] } };
test('QMT context includes strategy positions and explicitly limits history to current day', async () => {
  const f = qmtFixture('analyst'), snapshot = await qmtContext(f.host, f.service)({ action: 'snapshot' });
  assert.equal(snapshot.positions[0].origin, 'strategy'); assert.equal(snapshot.historyCoverage.scope, 'current_native_trading_day');
  assert.deepEqual(snapshot.deployments, []); assert.equal(f.calls.some(c => c.action === 'order'), false);
});
test('QMT executor preserves native command idempotence and exact-account receipt checks', async () => {
  const f = qmtFixture();
  const args = signed(f.host, 'qmt_trading_order', order);
  const a = await f.service.command('order', args, undefined, f.host.scope, f.host);
  assert.deepEqual(await f.service.command('order', signed(f.host, 'qmt_trading_order', order), undefined, f.host.scope, f.host), a);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].execution_guard, order.execution_guard);
  assert.deepEqual(f.service.commandRecord('once', f.host.scope, f.host), a);
  await assert.rejects(f.service.command('order', signed(f.host, 'qmt_trading_order', { ...order, shares: '200' }), undefined, f.host.scope, f.host), { code: 'IDEMPOTENCY_CONFLICT' });
  f.host.task.input.role = 'analyst'; await assert.rejects(f.service.command('order', order, undefined, f.host.scope, f.host), { code: 'FORBIDDEN' });
});
test('QMT plan orders cannot omit guard or cross account and obsolete API still rejects subagent scope', async () => {
  const f = qmtFixture();
  await assert.rejects(f.service.command('order', order, undefined, f.host.scope), { code: 'FORBIDDEN' });
  const { execution_guard: _executionGuard, ...unguarded } = order;
  await assert.rejects(f.service.command('order', signed(f.host, 'qmt_trading_order', unguarded), undefined, f.host.scope, f.host), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.service.command('order', signed(f.host, 'qmt_trading_order', { ...order, account_id: '999' }), undefined, f.host.scope, f.host), { code: 'CONNECTION_CHANGED' });
  assert.equal(f.calls.length, 0);
});
test('QMT plan cancel reuses retained original ownership and rejects forged task identity', async () => {
  const f = qmtFixture();
  await f.service.command('order', signed(f.host, 'qmt_trading_order', order), undefined, f.host.scope, f.host);
  const args = { operation_id: 'cancel-once', user_authorized: true, account_id: '123', connection_revision: '1', original_operation_id: 'once', order_id: '44' };
  const result = await f.service.command('cancel', signed(f.host, 'qmt_trading_cancel', args), undefined, f.host.scope, f.host);
  assert.equal(result.status, 'cancel_requested'); assert.equal(f.calls[1].original_intent.symbol, '600000.SH');
  assert.deepEqual(await f.service.command('cancel', signed(f.host, 'qmt_trading_cancel', args), undefined, f.host.scope, f.host), result); assert.equal(f.calls.length, 2);
  f.host.task.conversationId = 'different';
  await assert.rejects(f.service.command('order', { ...order, operation_id: 'new' }, undefined, f.host.scope, f.host), { code: 'FORBIDDEN' });
  assert.throws(() => f.service.commandRecord('once', f.host.scope, f.host), { code: 'FORBIDDEN' });
});
const mt5Order = { server: 'python', tool: 'order_send', command_id: 'signed-command-0001', arguments: { request: { action: 'TRADE_ACTION_DEAL', symbol: 'EURUSD', volume: 0.1, type: 'ORDER_TYPE_BUY' }, execution_guard: { expected_account: '123', expected_server: 'broker', expected_positions: [] } } };
test('MT5 signed order rejects absent/tampered/expired proof and unrelated tasks without native dispatch', async () => {
  const f = mt5Fixture();
  await assert.rejects(f.service.order(mt5Order), { code: 'FORBIDDEN' });
  const args = signed(f.host, 'mt5_trading_order', mt5Order);
  await assert.rejects(f.service.order({ ...args, arguments: { ...args.arguments, request: { ...args.arguments.request, volume: 9 } } }), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.order(signed(f.host, 'mt5_trading_pause', mt5Order)), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.order(signed(f.host, 'mt5_trading_order', mt5Order, Date.now() - 1)), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.order(signed(f.host, 'mt5_trading_order', mt5Order, Date.now() + 120000)), { code: 'FORBIDDEN' });
  f.host.task.pluginId = 'other'; await assert.rejects(f.service.order(args), { code: 'FORBIDDEN' });
  assert.equal(f.calls.length, 0);
});
test('scheduled MT5/QMT execution requires expected positions while main guarded APIs remain compatible', async () => {
  const m = mt5Fixture(), q = qmtFixture();
  const { expected_positions: _mt5Expected, ...mt5Guard } = mt5Order.arguments.execution_guard;
  await assert.rejects(m.service.order(signed(m.host, 'mt5_trading_order', { ...mt5Order, arguments: { ...mt5Order.arguments, execution_guard: mt5Guard } })), { code: 'invalid_request' });
  const { expected_positions: _qmtExpected, ...qmtGuard } = order.execution_guard;
  await assert.rejects(q.service.command('order', signed(q.host, 'qmt_trading_order', { ...order, execution_guard: qmtGuard }), undefined, q.host.scope, q.host), { code: 'INVALID_ARGUMENT' });
  assert.equal(m.calls.length, 0); assert.equal(q.calls.length, 0);
});
test('MT5 signed intent replay retains parent-owned receipt, recoverable by main after revision change', async () => {
  const f = mt5Fixture(), args = signed(f.host, 'mt5_trading_order', mt5Order);
  const receipt = await f.service.order(args);
  assert.equal(receipt.conversation_id, 'parent');
  assert.deepEqual(await f.service.order(signed(f.host, 'mt5_trading_order', mt5Order)), receipt); assert.equal(f.calls.length, 1);
  assert.equal(Object.hasOwn(f.calls[0], 'authorization'), false);
  await assert.rejects(f.service.order(signed(f.host, 'mt5_trading_order', { ...mt5Order, arguments: { ...mt5Order.arguments, request: { ...mt5Order.arguments.request, volume: 0.2 } } })), { code: 'IDEMPOTENCY_CONFLICT' });
  f.host.scope.kind = 'main'; f.host.scope.conversationId = 'parent'; f.config.version = 2;
  assert.deepEqual(f.service.command({ command_id: mt5Order.command_id }), receipt);
  f.host.scope.conversationId = 'different'; assert.throws(() => f.service.command({ command_id: mt5Order.command_id }), { code: 'FORBIDDEN' });
  f.host.scope.conversationId = 'parent'; f.config.account.login = '999'; assert.throws(() => f.service.command({ command_id: mt5Order.command_id }), { code: 'FORBIDDEN' });
});
test('MT5 stop requires exact signed parameters and rechecks proof after async connection', async () => {
  const f = mt5Fixture(), args = { deployment_id: 'own', account, reason: 'Extreme risk' };
  await assert.rejects(f.service.pause(args), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.pause({ ...signed(f.host, 'mt5_trading_pause', args), reason: 'Changed risk' }), { code: 'FORBIDDEN' });
  f.mt5.market.connected = async () => { f.host.task.input.executionPublicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }); };
  await assert.rejects(f.service.pause(signed(f.host, 'mt5_trading_pause', args)), { code: 'FORBIDDEN' });
  assert.equal(f.calls.length, 0);
});
test('QMT signed order/cancel reject unsigned or altered intent and strip proof before native/fingerprint', async () => {
  const f = qmtFixture();
  await assert.rejects(f.service.command('order', order, undefined, f.host.scope, f.host), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.command('order', { ...signed(f.host, 'qmt_trading_order', order), shares: '900' }, undefined, f.host.scope, f.host), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.command('order', signed(f.host, 'qmt_trading_cancel', order), undefined, f.host.scope, f.host), { code: 'FORBIDDEN' });
  await f.service.command('order', signed(f.host, 'qmt_trading_order', order), undefined, f.host.scope, f.host);
  assert.equal(Object.hasOwn(f.calls[0], 'authorization'), false);
  const cancel = { operation_id: 'stop-order', user_authorized: true, account_id: '123', connection_revision: '1', original_operation_id: 'once', order_id: '44' };
  await assert.rejects(f.service.command('cancel', cancel, undefined, f.host.scope, f.host), { code: 'FORBIDDEN' });
  await f.service.command('cancel', signed(f.host, 'qmt_trading_cancel', cancel), undefined, f.host.scope, f.host);
  assert.equal(f.calls.length, 2); assert.equal(Object.hasOwn(f.calls[1], 'authorization'), false);
});
test('QMT validates proof again after configuration queue; main APIs retain unsigned usage', async () => {
  const f = qmtFixture(), args = signed(f.host, 'qmt_trading_order', order);
  f.host.configuration.exclusive = async fn => { f.host.task.id = 'different-task'; return fn(); };
  await assert.rejects(f.service.command('order', args, undefined, f.host.scope, f.host), { code: 'FORBIDDEN' });
  assert.equal(f.calls.length, 0);
  f.host.scope.kind = 'main'; f.host.configuration.exclusive = fn => fn();
  await f.service.command('order', order, undefined, f.host.scope); assert.equal(f.calls.length, 1);
});
test('Python read entry cannot route trading-class methods around signed entry', async () => {
  const f = mt5Fixture();
  f.mt5.official.route = (server, tool) => pluginRoute(builtinRoutes(), server, tool, undefined, ['order_send', 'login', 'initialize'].includes(tool) ? 'trading' : 'standard');
  const tool = pythonTools(f.host, f.mt5)[0];
  for (const name of ['order_send', 'initialize', 'login']) await assert.rejects(tool.execute({ ...mt5Order, tool: name }), { code: 'mt5_wrong_plugin' });
  assert.equal(f.calls.length, 0);
});
test('QMT narrow receipt recovery allows same domain revision change and rejects another owner/account', async () => {
  const f = qmtFixture();
  const receipt = await f.service.command('order', signed(f.host, 'qmt_trading_order', order), undefined, f.host.scope, f.host);
  f.host.storage.put('configuration', { ...f.host.storage.get('configuration', 'local'), version: 2 });
  f.host.scope.kind = 'main'; f.host.scope.conversationId = 'parent';
  assert.deepEqual(f.service.commandRecord('once', f.host.scope, f.host), receipt);
  f.host.scope.conversationId = 'other'; assert.throws(() => f.service.commandRecord('once', f.host.scope, f.host), { code: 'FORBIDDEN' });
  f.host.scope.conversationId = 'parent'; f.host.storage.put('configuration', { ...f.host.storage.get('configuration', 'local'), account_id: '999' });
  assert.throws(() => f.service.commandRecord('once', f.host.scope, f.host), { code: 'ACCOUNT_MISMATCH' });
});
test('new tools match declared metadata and remain available to plan tasks', () => {
  const host = taskHost();
  for (const [name, actual] of [['mt5', mt5Tools(host, {})], ['qmt', qmtTools(host).filter(t => t.name.startsWith('qmt_trading_'))]]) {
    const root = new URL(`../packages/${name}/`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('plugin.json', root))), declared = JSON.parse(readFileSync(new URL('tools.json', root)));
    for (const tool of actual) { assert(manifest.tool_names.includes(tool.name)); assert(!manifest.main_tool_names.includes(tool.name));
      assert.deepEqual(JSON.parse(JSON.stringify(tool.parameters)), declared.find(t => t.name === tool.name).parameters); }
  }
});
