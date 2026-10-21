import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MT5Official } from '../packages/mt5/backend/official.js';
import { records } from '../packages/mt5/backend/records.js';
import { accountIdentity, sourceIdentity, mapPosition } from '../packages/mt5/backend/contract-mapping.js';
import { createPositionManager } from '../packages/mt5/positions.js';
import { createCapabilities } from '../packages/mt5/index.js';
import { digest } from '@sesame/plugin-sdk/protocol';

const sourceTime = Date.UTC(2026, 9, 21, 12);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mt5-positions-'));
  const host = { context: { storageRoot: root, pluginId: 'sesame/mt5', kind: 'main', sessionId: 'conv_main' } };
  const official = await new MT5Official(host, null).init(), now = () => sourceTime;
  official.config = { ...official.config, version: 7, account: { login: '9007199254740993', server: 'Fixture-Broker' } };
  const state = { positions: [{ ticket: '9007199254740995', identifier: '9007199254740995', symbol: 'EURUSD', type: 0, volume: 1.5 }], sends: 0, requests: [],
    result: { retcode: 10008, order: '9007199254741001', deal: '0', volume: 0 }, deals: [], orders: [], error: null, nativeError: null, login: official.config.account.login, beforeSend: null,
    tick: { time: (sourceTime + 10800000) / 1000, time_msc: sourceTime + 10800000, bid: 1.1, ask: 1.1002 },
    quoteClock: { status: 'verified', source: 'mt5/python/symbol_info_tick', server: official.config.account.server, accountId: official.config.account.login,
      rawTimeMs: sourceTime + 10800000, sourceTimeMs: sourceTime, basis: 'server-wall', offsetMinutes: 180,
      ruleId: 'ftmo-demo-current-tick-2026', ruleRevision: 'ftmo-demo-current-tick-2026-v1' } };
  official.python = { available: () => true, close: async () => {}, call: async (tool, args) => {
    state.requests.push({ tool, args });
    let result;
    if (tool === 'account_info') result = { login: state.login, server: 'Fixture-Broker', trade_allowed: true, trade_expert: true };
    else if (tool === 'terminal_info') result = { connected: true, trade_allowed: true, tradeapi_disabled: false };
    else if (tool === 'positions_get') result = structuredClone(state.positions);
    else if (tool === 'orders_get') result = structuredClone(state.orders.filter(row => [1, 3].includes(row.state)));
    else if (tool === 'symbol_info') result = { volume_min: 0.01, volume_max: 100, volume_step: 0.01, filling_mode: 3, trade_exemode: 2 };
    else if (tool === 'symbol_info_tick') { result = structuredClone(state.tick); await state.afterTick?.(); }
    else if (tool === 'history_orders_get') result = structuredClone(state.orders.filter(row => ![1, 3].includes(row.state)));
    else if (tool === 'history_deals_get') result = structuredClone(state.deals);
    else if (tool === 'order_send') {
      state.sends++;
      const command = records(host).list('mt5_command').find(row => row.tool === 'order_send');
      assert.equal(command.status, 'running', 'Native command must be durable before native dispatch');
      assert.equal(records(host).get('position_closes', 'close-one').receipt.status, 'outcome_unknown', 'Close intent must already be durable');
      await state.beforeSend?.(args);
      if (state.error) throw state.error;
      if (state.nativeError) return structuredClone(state.nativeError);
      result = structuredClone(state.result);
    } else throw new Error('Unexpected native tool ' + tool);
    return { result, last_error: [1, 'Success'], package_version: 'synthetic-fixture',
      ...(tool === 'symbol_info_tick' ? { quote_clock: structuredClone(state.quoteClock) } : {}) };
  } };
  const manager = () => createPositionManager(host, { official }, { now });
  const execution = { provenance: { caller: { pluginId: 'host' } } };
  const invoke = (method, args, caller = 'host') => manager()[method](args, new AbortController().signal, { ...execution, provenance: { caller: { pluginId: caller } } });
  const binding = { connection: { id: 'mt5-terminal', revision: '7' }, account: { connectionId: 'mt5-terminal', accountId: accountIdentity('Fixture-Broker', state.login) } };
  const actual = mapPosition(state.positions[0], { account: binding.account, sourceId: sourceIdentity('Fixture-Broker'), server: 'Fixture-Broker' });
  const fields = { instrument: actual.instrument, side: actual.side, quantity: actual.quantity };
  const input = { binding, positionId: actual.id, operationId: 'close-one', quantity: { value: '0.5', unit: 'lot' }, expected: { revision: digest({ id: actual.id, account: actual.account, ...fields }), ...fields } };
  t.after(async () => { await official.close(); records(host).close(); assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'mt5-positions-'))); await rm(root, { recursive: true, force: true }); });
  return { host, official, state, input, invoke };
}

test('MT5 account close uses two explicit immediate host service capabilities and a pure factory', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/mt5/capabilities.json', import.meta.url), 'utf8'));
  const { validateCapabilityManifest } = await import(new URL('../../../../mt5agent/modules/plugins/capability-contract.js', import.meta.url));
  const checked = await validateCapabilityManifest(manifest); assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));
  const service = manifest.services.find(row => row.contract === 'sesame.positions/1');
  assert.equal(service.sourceId, 'account');
  const names = createCapabilities({}).map(row => row.name);
  for (const name of Object.values(service.operations)) {
    const declared = manifest.capabilities.find(row => row.id === name);
    assert.ok(names.includes(name)); assert.equal(declared.execution, 'immediate'); assert.deepEqual(declared.consumers, ['host']);
  }
});

test('MT5 close retains one native command, ticket precision and final-mile portfolio guard across concurrent duplicates', async t => {
  const f = await fixture(t);
  const [one, two] = await Promise.all([f.invoke('close', f.input), f.invoke('close', f.input)]);
  assert.equal(one.status, 'submitted'); assert.deepEqual(one, two); assert.equal(f.state.sends, 1);
  assert.deepEqual(one.orderIds, ['9007199254741001']);
  const { request, execution_guard: guard } = f.state.requests.find(row => row.tool === 'order_send').args;
  assert.equal(request.action, 'TRADE_ACTION_DEAL'); assert.equal(request.position, '9007199254740995');
  assert.equal(request.type, 'ORDER_TYPE_SELL'); assert.equal(request.volume, 0.5); assert.equal(request.type_filling, 'ORDER_FILLING_FOK');
  assert.deepEqual(guard.expected_positions, [{ ticket: '9007199254740995', type: 0, volume: '1.5' }]);
  assert.equal(guard.expected_account, '9007199254740993'); assert.equal(guard.expected_server, 'Fixture-Broker');
  assert.equal(guard.quote_clock_revision, f.state.quoteClock.ruleRevision);
  assert.equal(guard.observed_at, sourceTime); assert.equal(guard.expires_at, sourceTime + 60000);
  const quote = records(f.host).list('mt5_command').find(row => row.tool === 'symbol_info_tick').result;
  assert.deepEqual(quote.result, f.state.tick); assert.deepEqual(quote.quote_clock, f.state.quoteClock);
  assert.ok(quote.result.time_msc > guard.observed_at, 'Raw server-wall tick remains future-looking before interpretation');
  await assert.rejects(f.invoke('close', { ...f.input, quantity: { value: '1', unit: 'lot' } }), { code: 'IDEMPOTENCY_CONFLICT' });
  const blocked = await f.invoke('close', { ...f.input, operationId: 'replacement' });
  assert.equal(blocked.status, 'rejected'); assert.equal(blocked.error.code, 'POSITION_OPERATION_PENDING'); assert.equal(f.state.sends, 1);
});

test('MT5 close uses verified normalized quote freshness rather than raw server-wall time', async t => {
  for (const delta of [-5001, -5000, 1]) await t.test(String(delta), async child => {
    const f = await fixture(child);
    f.state.tick.time_msc += delta; f.state.tick.time = Math.floor(f.state.tick.time_msc / 1000);
    f.state.quoteClock.rawTimeMs += delta; f.state.quoteClock.sourceTimeMs += delta;
    const result = await f.invoke('close', f.input);
    assert.equal(result.status, delta === -5000 ? 'submitted' : 'rejected');
    assert.equal(f.state.sends, delta === -5000 ? 1 : 0);
    if (delta !== -5000) assert.equal(result.error.code, 'STALE_QUOTE');
  });
});

test('MT5 close rejects missing, unverified and mismatched quote proofs without dispatch', async t => {
  const cases = [
    ['missing', f => { f.state.quoteClock = undefined; }, 'QUOTE_CLOCK_UNVERIFIED'],
    ['unverified', f => { Object.assign(f.state.quoteClock, { status: 'unverified', sourceTimeMs: null, basis: 'unknown', offsetMinutes: null, ruleId: null, ruleRevision: null }); }, 'QUOTE_CLOCK_UNVERIFIED'],
    ['account', f => { f.state.quoteClock.accountId = 'other'; }, 'ACCOUNT_MISMATCH'],
    ['server', f => { f.state.quoteClock.server = 'Other-Broker'; }, 'ACCOUNT_MISMATCH'],
    ['raw time', f => { f.state.quoteClock.rawTimeMs++; }, 'SOURCE_DATA_INVALID'],
    ['normalization', f => { f.state.quoteClock.sourceTimeMs++; }, 'SOURCE_DATA_INVALID'],
    ['revision', f => { delete f.state.quoteClock.ruleRevision; }, 'SOURCE_DATA_INVALID'],
  ];
  for (const [name, change, code] of cases) await t.test(name, async child => {
    const f = await fixture(child); change(f);
    const result = await f.invoke('close', f.input);
    assert.equal(result.status, 'rejected'); assert.equal(result.error.code, code); assert.equal(f.state.sends, 0);
    assert.equal(records(f.host).list('mt5_command').some(row => row.tool === 'order_send'), false);
  });
});

test('MT5 close still brackets verified quote reads with the exact account and connection', async t => {
  for (const kind of ['account', 'connection']) await t.test(kind, async child => {
    const f = await fixture(child);
    f.state.afterTick = () => { if (kind === 'account') f.state.login = 'another-account'; else f.official.config.version++; };
    const result = await f.invoke('close', f.input);
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.code, kind === 'account' ? 'ACCOUNT_MISMATCH' : 'CONNECTION_CHANGED');
    assert.equal(f.state.sends, 0);
  });
});

test('MT5 preflight rejects untrusted callers, changed native accounts/positions, unit and quantity precision', async t => {
  const f = await fixture(t);
  await assert.rejects(f.invoke('close', f.input, 'plugin/untrusted'), { code: 'FORBIDDEN' });
  f.state.login = 'another-account';
  assert.equal((await f.invoke('close', f.input)).error.code, 'ACCOUNT_MISMATCH');
  f.state.login = f.official.config.account.login; f.state.positions[0].volume = 1.4;
  assert.equal((await f.invoke('close', { ...f.input, operationId: 'changed' })).error.code, 'POSITION_CHANGED');
  f.state.positions[0].volume = 1.5;
  assert.equal((await f.invoke('close', { ...f.input, operationId: 'wrong-unit', quantity: { value: '1', unit: 'share' } })).error.code, 'INVALID_QUANTITY');
  assert.equal((await f.invoke('close', { ...f.input, operationId: 'precision', quantity: { value: '0.50000000000000001', unit: 'lot' } })).error.code, 'INVALID_QUANTITY');
  f.official.config.version++;
  assert.equal((await f.invoke('close', { ...f.input, operationId: 'revision' })).error.code, 'CONNECTION_CHANGED');
  assert.equal(f.state.sends, 0);
});

test('MT5 close distinguishes correlated partial fill, complete requested fill and actual flat position', async t => {
  const f = await fixture(t), read = () => f.invoke('readReceipt', { binding: f.input.binding, operationId: f.input.operationId });
  await f.invoke('close', f.input);
  f.state.deals = [{ ticket: '9007199254741011', order: '9007199254741001', position_id: '9007199254740995', symbol: 'EURUSD', type: 1, entry: 1, volume: 0.2 }];
  f.state.positions[0].volume = 1.3;
  assert.equal((await read()).status, 'partially_filled');
  f.state.deals.push({ ...f.state.deals[0], ticket: '9007199254741012', volume: 0.3 }); f.state.positions[0].volume = 1;
  const filled = await read(); assert.equal(filled.status, 'filled'); assert.equal(filled.filledQuantity.value, '0.5'); assert.equal(filled.remainingPositionQuantity.value, '1');
  assert.equal(f.state.sends, 1);
});

test('MT5 full close needs exact native fills plus actual zero position; unrelated fills never qualify', async t => {
  const f = await fixture(t); delete f.input.quantity;
  await f.invoke('close', f.input);
  f.state.positions = [];
  f.state.deals = [{ ticket: '9007199254741011', order: 'different-order', position_id: '9007199254740995', symbol: 'EURUSD', type: 1, entry: 1, volume: 1.5 }];
  const input = { binding: f.input.binding, operationId: f.input.operationId };
  assert.notEqual((await f.invoke('readReceipt', input)).status, 'closed');
  f.state.deals[0].order = '9007199254741001';
  const closed = await f.invoke('readReceipt', input); assert.equal(closed.status, 'closed'); assert.equal(closed.filledQuantity.value, '1.5');
  assert.equal(closed.remainingPositionQuantity.value, '0'); assert.equal(f.state.sends, 1);
});

test('MT5 ambiguous native dispatch survives adapter recreation and is never resent or inferred from an empty position', async t => {
  const f = await fixture(t);
  f.state.error = new Error('Controlled native transport loss');
  assert.equal((await f.invoke('close', f.input)).status, 'outcome_unknown');
  f.state.positions = [];
  assert.equal((await f.invoke('readReceipt', { binding: f.input.binding, operationId: f.input.operationId })).status, 'outcome_unknown');
  assert.equal((await f.invoke('close', f.input)).status, 'outcome_unknown'); assert.equal(f.state.sends, 1);
});

test('MT5 maps explicit native guard rejection separately from broker timeout and preserves durable results after SQLite reopen', async t => {
  for (const scenario of ['guard-reject', 'broker-reject', 'timeout']) await t.test(scenario, async child => {
    const f = await fixture(child);
    if (scenario === 'guard-reject') f.state.nativeError = { error: 'POSITION_CHANGED', message: 'Fixture final-mile position changed', submission_attempted: false };
    else f.state.result = { retcode: scenario === 'broker-reject' ? 10014 : 10012, order: '0', deal: '0', volume: 0, comment: 'Fixture native result' };
    const receipt = await f.invoke('close', f.input), expectedStatus = scenario === 'timeout' ? 'outcome_unknown' : 'rejected';
    assert.equal(receipt.status, expectedStatus); assert.equal(f.state.sends, 1);
    records(f.host).close();
    const restored = await new MT5Official(f.host, null).init(); restored.config = f.official.config;
    const manager = createPositionManager(f.host, { official: restored }, { now: () => sourceTime + 1 });
    const execution = { provenance: { caller: { pluginId: 'host' } } };
    try {
      assert.equal((await manager.close(f.input, undefined, execution)).status, expectedStatus);
      assert.equal((await manager.readReceipt({ binding: f.input.binding, operationId: f.input.operationId }, undefined, execution)).status, expectedStatus);
      assert.equal(f.state.sends, 1);
    } finally { await restored.close(); }
  });
});
