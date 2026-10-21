import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { records } from '../backend/records.js';
import { tradingPrepare } from '../backend/trading-prepare.js';
import { officialTool } from '../backend/plugin-tools.js';
import { PYTHON_TOOLS } from '../backend/python-tools.js';
import { createCapabilities as configurationCapabilities } from '../tools/configuration.js';
import manifest from '../capabilities.json' with { type: 'json' };
import plugin from '../plugin.json' with { type: 'json' };
import { Value } from '@sesame/plugin-sdk/schema/value';

const input = (extra = {}) => ({ symbol: 'EURUSD', command_id: 'fast-prepare-fixture-01', user_authorized: true, ...extra });
const sourceTime = Date.UTC(2026, 9, 21, 12);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mt5-fast-prepare-')), events = [], calls = [], changes = [];
  const host = { context: { storageRoot: root, sessionId: 'fixture-owner', kind: 'main' }, events: { emit: value => events.push(value) } };
  const config = { version: 8, allow_trading: true, account: { login: '7001', server: 'Fixture-Demo' } };
  const native = { account: { login: '7001', server: 'Fixture-Demo', type: 'demo', read_only: false }, terminal: { server_connected: true, experts_trade_allowed: true, mcp_trade_allowed: true } };
  const data = {
    account_info: { login: '7001', server: 'Fixture-Demo', trade_allowed: true, trade_expert: true, equity: 10000 },
    terminal_info: { connected: true, trade_allowed: true, tradeapi_disabled: false },
    symbol_info: { name: 'EURUSD', volume_min: 0.01, volume_step: 0.01, volume_max: 100 },
    positions_get: [{ symbol: 'EURUSD', ticket: '101', volume: 0.01 }], orders_get: [],
    symbol_info_tick: { time: (sourceTime + 10800000) / 1000, time_msc: sourceTime + 10800000, bid: 1.1, ask: 1.1001 }, initialize: true,
  };
  let permissions = 0, clock = sourceTime + 1000;
  const f = { host, config, native, data, calls, changes, events, preparations: 0,
    quoteClock: { status: 'verified', source: 'mt5/python/symbol_info_tick', server: config.account.server, accountId: config.account.login,
      rawTimeMs: data.symbol_info_tick.time_msc, sourceTimeMs: sourceTime, basis: 'server-wall', offsetMinutes: 180,
      ruleId: 'ftmo-demo-current-tick-2026', ruleRevision: 'ftmo-demo-current-tick-2026-v1' } };
  const mt5 = f.mt5 = { official: {
    config, settings: () => structuredClone(config), redact: text => text.replaceAll('fixture-secret', '[redacted]'), jobs: new Map(),
    async configure(args) {
      changes.push(args); assert.equal(args.expected_version, config.version);
      assert.deepEqual(args, { expected_version: config.version, allow_trading: true });
      config.allow_trading = true; config.version++;
      if (f.configured) await f.configured();
      return structuredClone(config);
    },
    async call(request, owner, signal) {
      assert.equal(owner, host.context.sessionId); assert.equal(request.server, 'python');
      assert.notEqual(request.tool, 'order_send'); assert.notEqual(request.tool, 'login');
      calls.push(request);
      const override = await f.call?.(request, signal);
      if (override) return override;
      return { id: request.command_id, status: 'returned', result: { result: structuredClone(data[request.tool]), last_error: [1, 'Success'],
        ...(request.tool === 'symbol_info_tick' ? { quote_clock: structuredClone(f.quoteClock) } : {}) } };
    },
  }, market: { async connected() {
    permissions++; if (f.permissionRead) await f.permissionRead();
    return { scope: { login: '7001', server: 'Fixture-Demo' }, info: structuredClone(native) };
  } } };
  const ports = { now: () => ++clock, prepare: async () => {
    f.preparations++; assert.equal(mt5.official.jobs.size, 0);
    if (f.prepare) return f.prepare();
    native.terminal.experts_trade_allowed = true;
    return { restarted: true, verified: true };
  } };
  f.invoke = (args = input(), signal) => tradingPrepare(host, mt5, args, signal, ports);
  f.permissionReads = () => permissions;
  f.store = records(host);
  t.after(async () => { f.store.close(); assert.equal(dirname(root), resolve(tmpdir())); await rm(root, { recursive: true, force: true }); });
  return f;
}

test('ready connection skips permission mutations, initialization, history, catalog and restart', async t => {
  const f = await fixture(t), result = await f.invoke();
  assert.deepEqual(result.account, { accountId: '7001', server: 'Fixture-Demo', revision: '8' });
  for (const [key, method] of Object.entries({ summary: 'account_info', terminal: 'terminal_info', spec: 'symbol_info', positions: 'positions_get', orders: 'orders_get', tick: 'symbol_info_tick' })) assert.deepEqual(result[key], f.data[method]);
  assert.equal(result.preparation.status, 'ready'); assert.equal(result.preparation.initialized, false);
  assert.equal(result.preparation.restarted, false); assert.equal(result.preparation.applicationPermissionChanged, false);
  assert.match(result.preparation.readScheduling, /serial/);
  assert.ok(result.capturedAt > result.readStartedAt);
  assert.equal(f.permissionReads(), 1); assert.equal(f.preparations, 0); assert.deepEqual(f.changes, []);
  assert.deepEqual(f.calls.map(row => row.tool), ['account_info', 'terminal_info', 'symbol_info', 'positions_get', 'orders_get', 'symbol_info_tick', 'account_info']);
  for (const call of f.calls.filter(row => ['symbol_info', 'positions_get', 'orders_get', 'symbol_info_tick'].includes(row.tool))) assert.deepEqual(call.arguments, { symbol: 'EURUSD' });
});

test('existing authorization enables only application/algo flags once, then reads fresh data on repeats', async t => {
  const f = await fixture(t); f.config.allow_trading = false; f.native.terminal.experts_trade_allowed = false;
  const args = input({ expected_account: { accountId: '7001', server: 'Fixture-Demo', revision: '8' } });
  const first = await f.invoke(args);
  assert.equal(first.account.revision, '9'); assert.equal(first.preparation.applicationPermissionChanged, true);
  assert.equal(first.preparation.algorithmPermissionChanged, true); assert.equal(first.preparation.restarted, true);
  f.data.symbol_info_tick.ask = 1.2;
  const second = await f.invoke(args);
  assert.equal(second.tick.ask, 1.2); assert.ok(second.capturedAt > first.capturedAt);
  assert.equal(f.changes.length, 1); assert.equal(f.preparations, 1);
  assert.equal(f.calls.filter(call => call.tool === 'symbol_info_tick').length, 2);
  assert.notEqual(f.calls[0].command_id, f.calls[7].command_id, 'read receipts must not cache old facts');
});

test('only explicit native -10004 recovers Python once on the exact configured connection', async t => {
  const f = await fixture(t); let initialized = false;
  f.call = async request => {
    if (request.tool === 'initialize') initialized = true;
    if (request.tool === 'account_info' && !initialized) return { status: 'failed', result: { result: null, last_error: [-10004, 'No IPC connection'] } };
  };
  const result = await f.invoke(); assert.equal(result.preparation.initialized, true);
  assert.deepEqual(f.calls.slice(0, 4).map(call => call.tool), ['account_info', 'initialize', 'account_info', 'terminal_info']);
  assert.deepEqual(f.calls.find(call => call.tool === 'initialize').arguments, {});
  await f.invoke(); assert.equal(f.calls.filter(call => call.tool === 'initialize').length, 1);
  const g = await fixture(t); g.call = async () => ({ status: 'failed', result: { result: null, last_error: [-2, 'Invalid arguments'] } });
  await assert.rejects(g.invoke(), { code: 'SOURCE_UNAVAILABLE' }); assert.equal(g.calls.length, 1);
});

test('persistent IPC failure and unknown initialize never loop or claim ready', async t => {
  for (const unknown of [false, true]) {
    const f = await fixture(t);
    f.call = async request => request.tool === 'initialize'
      ? unknown ? { status: 'unknown', error: 'unknown initialize' } : undefined
      : { status: 'failed', result: { result: null, last_error: [-10004, 'No IPC connection'] } };
    await assert.rejects(f.invoke(), error => ['MT5_PYTHON_UNAVAILABLE', 'SOURCE_UNAVAILABLE'].includes(error.code));
    assert.equal(f.calls.filter(call => call.tool === 'initialize').length, 1);
    await assert.rejects(f.invoke());
    assert.equal(f.calls.filter(call => call.tool === 'initialize').length, 1);
  }
});

test('independent symbol reads are dispatched together but all settle before any failure returns', async t => {
  const f = await fixture(t), started = [], deferred = new Map();
  let allStarted; const ready = new Promise(resolve => { allStarted = resolve; });
  f.call = async request => {
    if (!['symbol_info', 'positions_get', 'orders_get'].includes(request.tool)) return;
    started.push(request.tool); if (started.length === 3) allStarted();
    await new Promise(resolve => deferred.set(request.tool, resolve));
    if (request.tool === 'positions_get') return { status: 'failed', result: { result: null, last_error: [-2, 'failed fixture'] } };
  };
  let finished = false; const pending = f.invoke().finally(() => { finished = true; });
  await ready; assert.deepEqual(started, ['symbol_info', 'positions_get', 'orders_get']);
  deferred.get('positions_get')(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  deferred.get('orders_get')(); deferred.get('symbol_info')();
  await assert.rejects(pending, { code: 'SOURCE_UNAVAILABLE' });
  assert.equal(f.calls.some(call => call.tool === 'symbol_info_tick'), false);
});

test('new input, role and expected-account failures happen before reads or permission changes', async t => {
  for (const bad of [input({ user_authorized: false }), input({ symbol: '' }), input({ extra: true }), input({ command_id: 'short' }), input({ expected_account: { accountId: '7001', server: 'Fixture-Demo', revision: '7' } })]) {
    const f = await fixture(t); f.config.allow_trading = false;
    await assert.rejects(f.invoke(bad)); assert.equal(f.permissionReads(), 0); assert.equal(f.calls.length, 0); assert.deepEqual(f.changes, []);
  }
  const f = await fixture(t); f.host.context.kind = 'subagent';
  await assert.rejects(f.invoke(), { code: 'FORBIDDEN' }); assert.equal(f.permissionReads(), 0);
});

test('binding changes at permission, parallel-read and final-account boundaries reject readiness', async t => {
  for (const phase of ['permission', 'parallel', 'final']) {
    const f = await fixture(t); let accountReads = 0;
    if (phase === 'permission') f.permissionRead = async () => { f.config.version++; };
    f.call = async request => {
      if (phase === 'parallel' && request.tool === 'orders_get') f.config.version++;
      if (request.tool === 'account_info' && ++accountReads === 2 && phase === 'final') f.data.account_info.login = '7002';
    };
    await assert.rejects(f.invoke(), error => ['version_conflict', 'CONNECTION_CHANGED', 'ACCOUNT_MISMATCH'].includes(error.code));
    assert.notEqual(f.store.list('mt5_trading_preparations')[0]?.status, 'ready');
  }
});

test('read-only account and blocked native Python flags are explicit, not automatically changed', async t => {
  for (const [mutate, code] of [
    [f => { f.native.account.read_only = true; }, 'mt5_account_read_only'],
    [f => { f.data.terminal_info.tradeapi_disabled = true; }, 'MT5_PYTHON_TRADING_DISABLED'],
    [f => { f.data.account_info.trade_allowed = false; }, 'MT5_ACCOUNT_TRADING_DISABLED'],
    [f => { f.data.account_info.trade_expert = false; }, 'MT5_ACCOUNT_EXPERT_DISABLED'],
  ]) {
    const f = await fixture(t); mutate(f);
    await assert.rejects(f.invoke(), { code }); assert.equal(f.preparations, 0); assert.deepEqual(f.changes, []);
  }
});

test('MCP order authorization is not confused with a ready Python execution transport', async t => {
  const f = await fixture(t); f.native.terminal.mcp_trade_allowed = false;
  assert.equal((await f.invoke()).preparation.status, 'ready');
  const g = await fixture(t); g.native.terminal.experts_trade_allowed = false; g.native.terminal.mcp_trade_allowed = false;
  await assert.rejects(g.invoke(), { code: 'mcp_trading_not_authorized' }); assert.equal(g.preparations, 0);
});

test('concurrent same commands share preparation; mismatched commands cannot reuse the identity', async t => {
  const f = await fixture(t); f.native.terminal.experts_trade_allowed = false;
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  f.prepare = async () => { entered(); await new Promise(resolve => { release = resolve; }); f.native.terminal.experts_trade_allowed = true; return { restarted: true, verified: true }; };
  const first = f.invoke(); await started; const second = f.invoke();
  await assert.rejects(f.invoke(input({ symbol: 'GBPUSD' })), { code: 'idempotency_conflict' });
  release(); const results = await Promise.all([first, second]); assert.deepEqual(results[0], results[1]);
  assert.equal(f.preparations, 1); assert.equal(f.calls.filter(call => call.tool === 'symbol_info_tick').length, 1);
  await assert.rejects(f.invoke(input({ symbol: 'GBPUSD' })), { code: 'idempotency_conflict' });
});

test('cancellation during restart allows cleanup but never proceeds into a ready snapshot', async t => {
  const f = await fixture(t), controller = new AbortController(); f.native.terminal.experts_trade_allowed = false;
  f.prepare = async () => { controller.abort(); f.native.terminal.experts_trade_allowed = true; return { restarted: true, verified: true }; };
  await assert.rejects(f.invoke(input(), controller.signal), { name: 'AbortError' }); assert.equal(f.calls.length, 0);
  const g = await fixture(t); await assert.rejects(g.invoke(input(), controller.signal), { name: 'AbortError' });
  assert.equal(g.permissionReads(), 0); assert.equal(g.store.list('mt5_trading_preparations').length, 0);
});

test('verified server-wall quote retains raw future tick and exposes its bound normalized clock', async t => {
  const f = await fixture(t), result = await f.invoke();
  assert.deepEqual(result.tick, f.data.symbol_info_tick);
  assert.ok(result.tick.time_msc > result.capturedAt);
  assert.deepEqual(result.quote_clock, f.quoteClock);
  assert.ok(result.quote_clock.sourceTimeMs <= result.readStartedAt);
  assert.equal(result.tick.time_msc - result.quote_clock.sourceTimeMs, 10800000);
});

test('explicit verified UTC proof passes through without a second conversion', async t => {
  const f = await fixture(t);
  Object.assign(f.data.symbol_info_tick, { time: sourceTime / 1000, time_msc: sourceTime });
  Object.assign(f.quoteClock, { rawTimeMs: sourceTime, sourceTimeMs: sourceTime, basis: 'utc', offsetMinutes: 0,
    ruleId: 'fixture-explicit-utc', ruleRevision: 'fixture-explicit-utc-v1' });
  const result = await f.invoke();
  assert.deepEqual(result.tick, f.data.symbol_info_tick); assert.deepEqual(result.quote_clock, f.quoteClock);
  assert.equal(result.quote_clock.sourceTimeMs, result.tick.time_msc);
});

test('missing, unverified or inconsistent quote clocks cannot become a ready preparation', async t => {
  const cases = [
    ['missing', f => { f.quoteClock = undefined; }, 'QUOTE_CLOCK_UNVERIFIED'],
    ['unverified', f => { Object.assign(f.quoteClock, { status: 'unverified', sourceTimeMs: null, basis: 'unknown', offsetMinutes: null, ruleId: null, ruleRevision: null, reason: 'unknown_server' }); }, 'QUOTE_CLOCK_UNVERIFIED'],
    ['account', f => { f.quoteClock.accountId = 'other'; }, 'ACCOUNT_MISMATCH'],
    ['server', f => { f.quoteClock.server = 'Other-Demo'; }, 'ACCOUNT_MISMATCH'],
    ['raw time', f => { f.quoteClock.rawTimeMs++; }, 'SOURCE_DATA_INVALID'],
    ['normalized time', f => { f.quoteClock.sourceTimeMs++; }, 'SOURCE_DATA_INVALID'],
    ['missing normalized time', f => { f.quoteClock.sourceTimeMs = null; }, 'SOURCE_DATA_INVALID'],
    ['source', f => { f.quoteClock.source = 'fixture/untrusted'; }, 'SOURCE_DATA_INVALID'],
    ['basis', f => { f.quoteClock.basis = 'unknown'; }, 'SOURCE_DATA_INVALID'],
    ['rule', f => { f.quoteClock.ruleId = ''; }, 'SOURCE_DATA_INVALID'],
    ['revision', f => { f.quoteClock.ruleRevision = ''; }, 'SOURCE_DATA_INVALID'],
    ['oversized revision', f => { f.quoteClock.ruleRevision = 'x'.repeat(129); }, 'SOURCE_DATA_INVALID'],
    ['offset', f => { f.quoteClock.offsetMinutes = '180'; }, 'SOURCE_DATA_INVALID'],
    ['out-of-range offset', f => { f.quoteClock.offsetMinutes = 841; f.quoteClock.sourceTimeMs = f.quoteClock.rawTimeMs - 841 * 60000; }, 'SOURCE_DATA_INVALID'],
    ['UTC offset', f => { f.quoteClock.basis = 'utc'; }, 'SOURCE_DATA_INVALID'],
  ];
  for (const [name, change, code] of cases) await t.test(name, async child => {
    const f = await fixture(child); change(f);
    await assert.rejects(f.invoke(), { code });
    assert.equal(f.store.get('mt5_trading_preparations', input().command_id).status, 'failed');
  });
});

test('malformed symbol rows cannot become a ready snapshot', async t => {
  for (const key of ['positions_get', 'orders_get']) {
    const g = await fixture(t); g.data[key] = [{ symbol: 'OTHER' }];
    await assert.rejects(g.invoke(), { code: 'SOURCE_DATA_INVALID' });
    assert.equal(g.calls.some(call => call.tool === 'symbol_info_tick'), false);
  }
});

test('execution guard schema requires quote clock provenance while cancellation stays independent', () => {
  const schema = PYTHON_TOOLS.find(tool => tool.name === 'order_send').inputSchema;
  const args = { request: { action: 'TRADE_ACTION_DEAL' }, execution_guard: {
    observed_at: sourceTime, expires_at: sourceTime + 60000, max_quote_age_ms: 5000, max_quote_to_send_ms: 1000,
    price_limit: '1.1', side: 'buy', expected_account: '7001', expected_server: 'Fixture-Demo',
  } };
  assert.equal(Value.Check(schema, args), false);
  args.execution_guard.quote_clock_revision = 'ftmo-demo-current-tick-2026-v1';
  assert.equal(Value.Check(schema, args), true);
  args.execution_guard.quote_clock_revision = '';
  assert.equal(Value.Check(schema, args), false);
  args.execution_guard.quote_clock_revision = 'x'.repeat(129);
  assert.equal(Value.Check(schema, args), false);
  assert.equal(Value.Check(schema, { request: { action: 'TRADE_ACTION_REMOVE' }, cancellation_guard: {
    expected_account: '7001', expected_server: 'Fixture-Demo', symbol: 'EURUSD', remark: 'fixture', order: '100', side: 'buy',
  } }), true);
});

test('route rejection identifies the correct agent tool without a native call', async () => {
  const mt5 = { official: { route: () => ({ group: 'python', agent_tool: 'mt5_python' }), call: () => { throw new Error('must not call'); } } };
  const tool = officialTool({ context: { sessionId: 'fixture' } }, mt5, 'official');
  await assert.rejects(tool.execute({ server: 'python', tool: 'account_info', arguments: {} }), error => error.code === 'mt5_wrong_plugin' && error.message.includes('mt5_python') && !error.message.includes('其他插件'));
});

test('public declaration and configuration factory expose the same main-only compact contract', async t => {
  const f = await fixture(t), descriptor = manifest.capabilities.find(row => row.id === 'mt5_trading_prepare');
  assert.ok(plugin.main_tool_names.includes(descriptor.id));
  assert.equal(Value.Check(descriptor.inputSchema, input()), true);
  assert.equal(Value.Check(descriptor.inputSchema, input({ expected_account: { accountId: '7001', server: 'Fixture-Demo', revision: '8' } })), true);
  assert.equal(Value.Check(descriptor.inputSchema, input({ user_authorized: false })), false);
  assert.ok(descriptor.configurationRequirements.find(row => row.field === 'allow_trading').optional, 'readiness must allow the authorized prepare entry to enable its own permission');
  const handler = configurationCapabilities(f.host, f.mt5, {}).find(row => row.name === descriptor.binding.name);
  const result = await handler.execute(input());
  assert.equal(Value.Check(descriptor.outputSchema, result), true);
});

test('native failures stay redacted in exceptions and durable preparation receipts', async t => {
  const f = await fixture(t);
  f.call = async () => { throw Object.assign(new Error('failure fixture-secret'), { code: 'fixture_native_error', details: { nativeMessage: 'fixture-secret' } }); };
  await assert.rejects(f.invoke(), error => error.code === 'fixture_native_error' && !JSON.stringify([error.message, error.details]).includes('fixture-secret'));
  assert.doesNotMatch(JSON.stringify(f.store.list('mt5_trading_preparations')), /fixture-secret/);
});

test('failed algorithm preparation is never repeated or converted to ready by a duplicate request', async t => {
  const f = await fixture(t); f.native.terminal.experts_trade_allowed = false;
  f.prepare = async () => { throw new Error('fixture terminal preparation failed'); };
  await assert.rejects(f.invoke()); await assert.rejects(f.invoke(), { code: 'native_config_not_applied' });
  assert.equal(f.preparations, 1); assert.equal(f.calls.length, 0);
});
