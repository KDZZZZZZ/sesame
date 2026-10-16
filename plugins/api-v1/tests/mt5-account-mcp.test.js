import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAccountSummary, mapAccountSnapshot } from '../../optional-api-v1/packages/mt5/backend/contract-mapping.js';
import { MT5AccountProvider } from '../../optional-api-v1/packages/mt5/backend/providers.js';

// Field names and JSON types from the actual 2026-10-09 official MCP build 6230
// get_trading_account_info response. Account identity and amounts are synthetic;
// no user credentials, login, balance, broker name or native machine data is kept.
const official = {
  account: { server: 'Fixture-Demo', broker: 'Fixture Broker', login: 7001, name: 'Fixture Account', type: 'demo', read_only: false, margin_mode: 'hedging', balance: 10000.5, credit: 0, margin: 0, margin_free: 10000.5, profit: 0, equity: 10000.5, swaps: 0, commissions: 0, currency: 'USD' },
  terminal: { build: 6230, server_connected: true, experts_dll_allowed: false, experts_trade_allowed: false, mcp_trade_allowed: true },
};
const context = { connectionId: 'mt5-terminal', observedAt: 1000, snapshotId: 'fixture-snapshot', terminal: official.terminal };

test('official MCP account.type establishes demo/live mode, never the server name', () => {
  const summary = mapAccountSummary(official.account, context);
  assert.equal(summary.mode, 'demo'); assert.equal(summary.positionMode, 'hedging');
  assert.equal(summary.broker, 'Fixture Broker'); assert.equal(summary.baseCurrency.value, 'USD');
  assert.equal(summary.nativeLogin.value, '7001');
  assert.equal(mapAccountSummary({ ...official.account, type: 'real' }, context).mode, 'live');
  assert.equal(mapAccountSummary({ ...official.account, type: undefined }, context).mode, 'unknown');
  assert.equal(mapAccountSummary({ ...official.account, type: 'unsupported_account_kind' }, context).mode, 'unknown');
  assert.equal(mapAccountSummary({ ...official.account, type: 'real', trade_mode: 0 }, context).mode, 'unknown');
  for (const [trade_mode, mode] of [[0, 'demo'], [1, 'demo'], [2, 'live'], ['ACCOUNT_TRADE_MODE_DEMO', 'demo'], ['ACCOUNT_TRADE_MODE_REAL', 'live']]) {
    assert.equal(mapAccountSummary({ ...official.account, type: undefined, trade_mode }, context).mode, mode);
  }
});

test('official MCP snapshot retains zero and exact amounts while absent fields remain unknown', () => {
  const snapshot = mapAccountSnapshot(official.account, context);
  for (const field of ['balance', 'equity', 'available']) assert.deepEqual(snapshot[field], { status: 'value', value: { value: '10000.5', currency: 'USD' } });
  assert.deepEqual(snapshot.unrealizedPnl, { status: 'value', value: { value: '0', currency: 'USD' } });
  assert.deepEqual(snapshot.margin.used, { status: 'value', value: { value: '0', currency: 'USD' } });
  assert.deepEqual(snapshot.margin.free, snapshot.available);
  assert.equal(snapshot.margin.levelRatio.status, 'unknown'); assert.equal(snapshot.margin.maintenance.status, 'unknown');
  assert.equal(snapshot.realizedPnl.status, 'unknown'); assert.equal(snapshot.buyingPower.status, 'unsupported');
  assert.equal(Object.hasOwn(snapshot, 'leverage'), false, 'No leverage is supplied by this MCP response or promised by the current generic snapshot');
  assert.deepEqual(snapshot.restrictions.map(item => item.code), ['MT5_TERMINAL_EXPERTS_TRADE_ALLOWED']);
  const text = mapAccountSnapshot({ ...official.account, balance: '10000.1234567890123456789', equity: '0', margin_free: '0', margin_level: '150.25' }, context);
  assert.equal(text.balance.value.value, '10000.1234567890123456789'); assert.equal(text.equity.value.value, '0'); assert.equal(text.available.value.value, '0'); assert.equal(text.margin.levelRatio.value, '1.5025');
});

test('read-only and channel restrictions are explicit observations, not inferred permissions', () => {
  const blocked = mapAccountSnapshot({ ...official.account, read_only: true, trade_allowed: false, trade_expert: false }, { ...context, terminal: { experts_trade_allowed: false, mcp_trade_allowed: false } });
  assert.deepEqual(blocked.restrictions.map(item => item.code), ['MT5_READ_ONLY', 'MT5_TRADE_ALLOWED', 'MT5_TRADE_EXPERT', 'MT5_TERMINAL_EXPERTS_TRADE_ALLOWED', 'MT5_TERMINAL_MCP_TRADE_ALLOWED']);
  assert.ok(blocked.restrictions.every(item => item.observedAt === context.observedAt));
  assert.deepEqual(mapAccountSnapshot(official.account, { ...context, terminal: undefined }).restrictions, []);
});

test('account list, snapshot and subscription all consume the real official response shape', async t => {
  const calls = [];
  const provider = new MT5AccountProvider({ official: { config: { version: 9, account: { server: official.account.server, login: String(official.account.login) } } }, options: {}, market: { read: async (tool, args) => { calls.push([tool, args]); if (tool === 'get_trading_account_info') return structuredClone(official); if (tool === 'get_trading_open_positions') return { positions: [], orders: [] }; throw new Error('Unexpected native call ' + tool); } } });
  t.after(() => provider.dispose());
  const context = { bindingId: 'fixture', signal: new AbortController().signal };
  provider.bind({}, context);
  const accounts = await provider.listAccounts({ page: { limit: 10 } }, context), account = accounts.data.items[0];
  assert.equal(account.mode, 'demo');
  const snapshot = await provider.snapshot({ account: account.ref }, context);
  assert.equal(snapshot.data.account.mode, 'demo'); assert.equal(snapshot.data.equity.value.value, '10000.5');
  assert.equal(snapshot.meta.origin, 'observed'); assert.ok(snapshot.meta.warnings.some(item => item.code === 'NATIVE_JSON_PRECISION'));
  const subscription = await provider.subscribeAccount({ account: account.ref, topics: ['snapshot'] }, context);
  assert.equal(subscription.snapshot.snapshot.account.mode, 'demo');
  assert.deepEqual(subscription.snapshot.snapshot.restrictions.map(item => item.code), ['MT5_TERMINAL_EXPERTS_TRADE_ALLOWED']);
  await subscription.close(); provider.unbind(context);
  assert.ok(calls.every(([method]) => ['get_trading_account_info', 'get_trading_open_positions'].includes(method)));
});
