import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { applyPortfolio, targetOrders } from '../packages/portfolio-execution/portfolio.js';
import { createService } from '../packages/portfolio-execution/service.js';
import { createAdapters } from '../packages/portfolio-execution/adapters.js';
import { records, closeRecords } from '../packages/portfolio-execution/records.js';
import { createExecutionAdapter as mt5Adapter } from '../packages/mt5/backend/execution-adapter.js';
import { positionProjection, orderProjection } from '../packages/mt5/backend/execution-evidence.js';
import { records as mt5Records } from '../packages/mt5/backend/records.js';
import { createExecutionAdapter as qmtAdapter } from '../packages/qmt/execution-adapter.js';
import { executionProjection } from '../packages/qmt/execution-evidence.js';
import { capability as qmtCapability } from '../packages/qmt/execution.js';
import { declaredPlugins, delegated } from './portfolio-adapter-fixture.mjs';

const fixtures = [];
after(() => { for (const host of fixtures) { closeRecords(host); mt5Records(host).close(); assert.ok(resolve(host.context.storageRoot).startsWith(resolve(tmpdir(), 'portfolio-targets-'))); rmSync(host.context.storageRoot, { recursive: true, force: true }); } });

const clone = value => value === undefined ? undefined : structuredClone(value);
const mt5Position = (ticket, type, volume, magic = 0) => ({ ticket, symbol: 'EURUSD', type, volume, magic });
function nativeSubmit(host, observation, intent, send, kind = 'subagent') {
  const { backend, account } = observation;
  const adapterHost = { context: { ...host.context, kind, sessionId: 'child' } };
  const proof = kind === 'main' ? undefined : delegated(backend, account);
  if (backend === 'mt5') {
    const official = { settings: () => ({ account: { login: account.accountId, server: account.server }, version: account.revision }), call: send };
    return mt5Adapter(adapterHost, { official }).submit({ observation, intent }, undefined, proof);
  }
  const service = { command: (_name, request) => send(request) };
  const adapter = qmtAdapter(adapterHost, service, { account: async () => account });
  return qmtCapability('qmt_execution_submit', adapter.submit).execute({ observation, intent }, undefined, proof);
}
function fixture({ backend = 'mt5', positions = [], orders = [], nativeResult = 10009, quoteAge = 0, pauseStatus = 'stopped', onObservation } = {}) {
  let time = 1800000000000, observations = 0;
  const nativeSends = [], reads = [], pauses = [], checkpoints = [];
  const state = { positions: clone(positions), orders: clone(orders), account: backend === 'mt5'
    ? { accountId: 'fixture', server: 'Broker', revision: '1' } : { accountId: 'fixture', connectionId: 'QMT', revision: '1' } };
  function projection() {
    return backend === 'mt5' ? { positions: positionProjection(state.positions), orders: orderProjection(state.orders.map((row, index) => ({ ticket: String(index + 1), ...row }))), priceStep: '0.01' }
      : executionProjection(state.positions.map(row => ({ account_id: state.account.accountId, ...row })), state.orders.map((row, index) => ({ account_id: state.account.accountId, order_id: String(index + 1), ...row })), state.account, '600000.SH');
  }
  const host = { context: { kind: 'main', sessionId: 'conv_test', storageRoot: mkdtempSync(join(tmpdir(), 'portfolio-targets-')) },
    capabilities: { async invoke(id, input) {
      const request = { name: id.split('#')[1], arguments: input };
      reads.push(clone(request));
      if (request.name.endsWith('_execution_snapshot')) return { type: 'result', value: { contract: 'sesame.execution-adapter/1', backend, account: clone(state.account), positions: clone(state.positions), orders: clone(state.orders), projection: projection(), summary: {}, fills: [], deployments: [], capturedAt: time } };
      assert.equal(request.name, 'mt5_trading_pause'); pauses.push(clone(request.arguments));
      return { type: 'result', value: { status: pauseStatus, deployment: { id: request.arguments.deployment_id, status: pauseStatus }, nativeAction: 'remove_expert' } };
    } }, plugins: { read: declaredPlugins() } };
  fixtures.push(host);
  const orderRequest = createAdapters(host).orderRequest;
  const adapter = {
    async snapshot(selected, symbol) {
      observations++; onObservation?.({ state, observations });
      return { account: clone(state.account), symbol, projection: projection(), positions: clone(state.positions.filter(row => (row.symbol ?? row.stock_code) === symbol)), orders: clone(state.orders),
        spec: { name: symbol, volume_min: '0.1', volume_max: '100', volume_step: '0.1', trade_tick_size: '0.01', point: '0.01', filling_mode: 2, trade_exemode: 2 },
        quote: { clock:{status:'verified',ruleRevision:'fixture-clock-v1'}, sourceTimeMs: time - quoteAge, receivedAt: time, requestMs: 1, bid: '100.00', ask: '100.01' }, capturedAt: time, captureMs: 1 };
    },
    identity: async () => clone(state.account), orderRequest,
    async submit(observation, args) {
      return nativeSubmit(host, observation, args, request => {
        nativeSends.push({ args: clone(args), request: clone(request) });
        if (nativeResult === 'unknown') return { status: 'unknown' };
        if (backend === 'qmt') {
          state.orders.push({ stock_code: observation.symbol, order_status: '48' });
          return { status: 'submitted', result: { order_id: '600' } };
        }
        if (nativeResult === 10008) state.orders.push({ symbol: observation.symbol, state: '1' });
        if (nativeResult === 10009 || nativeResult === 10010) {
          const quantity = nativeResult === 10010 ? Decimal.div(args.quantity, '2') : args.quantity;
          if (args.action === 'close') {
            const index = state.positions.findIndex(row => String(row.ticket) === args.position_id);
            assert(index >= 0); const remaining = Decimal.sub(String(state.positions[index].volume), quantity);
            if (Decimal.compare(remaining, '0') === 0) state.positions.splice(index, 1); else state.positions[index].volume = remaining;
          } else state.positions.push({ ticket: String(1000 + nativeSends.length), symbol: observation.symbol, volume: quantity, type: args.side === 'buy' ? 0 : 1, magic: 0 });
        }
        return { status: 'returned', result: { result: { retcode: nativeResult, order: String(1000 + nativeSends.length), deal: String(2000 + nativeSends.length) }, execution_timing: { quote_to_send_ms: 1 } } };
      });
    },
  };
  const service = createService(host, { now: () => time, adapters: adapter });
  const run = { id: 'run_fixture', decidedAt: time, plan: { backend, account: clone(state.account), ownerConversationId: 'conv_test', slippageBps: 50 },
    decision: { unchanged: false, targets: [], pause_strategies: [] } };
  const apply = () => applyPortfolio(host, run, { now: () => time, service, assertActive() {}, checkpoint: value => checkpoints.push(clone(value)) });
  return { host, state, run, nativeSends, reads, pauses, checkpoints, projection, apply, advance: ms => { time += ms; }, get observations() { return observations; } };
}
const target = (quantity, backend = 'mt5') => ({ symbol: backend === 'mt5' ? 'EURUSD' : '600000.SH', quantity, unit: backend === 'mt5' ? 'lots' : 'shares' });

test('MT5 zero target closes both hedge legs and every source with exact native tickets', async () => {
  const f = fixture({ positions: [mt5Position('11', 0, '0.4'), mt5Position('22', 1, '0.2', 456), mt5Position('33', 0, '0.1', 789)] });
  f.run.decision.targets = [target('0')];
  const result = await f.apply();
  assert.equal(result.status, 'target_observed'); assert.equal(result.targetReached, true);
  assert.deepEqual(f.nativeSends.map(call => call.args.position_id), ['22', '11', '33']);
  assert.deepEqual(f.nativeSends.map(call => call.args.quantity), ['0.2', '0.4', '0.1']);
  assert.equal(f.nativeSends.every(call => call.args.action === 'close'), true);
  assert.deepEqual(f.state.positions, []);
});
test('unchanged target portfolio and already reached absolute targets send no order', async () => {
  const f = fixture({ positions: [mt5Position('11', 0, '0.4', 456)] });
  f.run.decision = { unchanged: true, targets: [], pause_strategies: [] };
  assert.equal((await f.apply()).status, 'unchanged'); assert.equal(f.nativeSends.length, 0);
  f.run.id = 'run_exact'; f.run.decision = { unchanged: false, targets: [target('0.4')], pause_strategies: [] };
  assert.equal((await f.apply()).status, 'target_observed'); assert.equal(f.nativeSends.length, 0);
});
test('positive and negative MT5 targets reverse opposing tickets and reach exact net quantity', async () => {
  for (const [initial, desired, expectedSide] of [[1, '0.5', 'buy'], [0, '-0.5', 'sell']]) {
    const f = fixture({ positions: [mt5Position('22', initial, '0.2', 456)] });
    const protection = expectedSide === 'buy' ? { stop_loss: '98', take_profit: '103' } : { stop_loss: '103', take_profit: '98' };
    f.run.decision.targets = [{ ...target(desired), ...protection }]; const result = await f.apply();
    assert.equal(result.status, 'target_observed'); assert.equal(f.nativeSends.length, 2);
    assert.equal(f.nativeSends[0].args.action, 'close'); assert.equal(f.nativeSends[1].args.action, 'market');
    assert.equal(f.nativeSends[1].args.side, expectedSide); assert.equal(f.nativeSends[1].args.quantity, '0.5');
    const [close, open] = f.nativeSends.map(send => send.request.arguments.request);
    assert.equal(close.sl, undefined); assert.equal(close.tp, undefined);
    assert.equal(open.sl, Number(protection.stop_loss)); assert.equal(open.tp, Number(protection.take_profit));
  }
});
test('same-direction reductions can partially close a strategy ticket without touching another symbol', () => {
  const orders = targetOrders('mt5', target('0.7'), positionProjection([mt5Position('11', 0, '0.5', 456), mt5Position('22', 0, '0.6', 789), { ticket: '44', symbol: 'GBPUSD', type: 0, volume: '1' }]));
  assert.deepEqual(orders, [{ action: 'close', side: 'sell', quantity: '0.4', position_id: '11' }]);
});
test('QMT full-account reduction obeys T+1 available shares before any native order', async () => {
  const f = fixture({ backend: 'qmt', positions: [{ stock_code: '600000.SH', volume: '200', can_use_volume: '100', origin: 'strategy' }] });
  f.run.decision.targets = [target('0', 'qmt')];
  const result = await f.apply(); assert.equal(result.status, 'blocked'); assert.equal(result.error.code, 'POSITION_UNAVAILABLE');
  assert.equal(f.nativeSends.length, 0);
  assert.deepEqual(targetOrders('qmt', target('100', 'qmt'), f.projection().positions), [{ action: 'limit', side: 'sell', quantity: '100' }]);
});
test('an unconfirmed EA stop records its receipt and blocks all subsequent portfolio orders', async () => {
  const f = fixture({ positions: [mt5Position('11', 0, '0.4')], pauseStatus: 'unknown' });
  f.run.decision = { unchanged: false, targets: [target('0')], pause_strategies: [{ deployment_id: 'ea-1', reason: 'Extreme drawdown risk' }] };
  const result = await f.apply(); assert.equal(result.status, 'blocked'); assert.equal(result.error.code, 'PAUSE_UNCONFIRMED');
  assert.equal(result.pauses[0].status, 'unknown'); assert.equal(f.nativeSends.length, 0); assert.equal(f.observations, 0);
  assert.equal(f.checkpoints.some(value => value.executionProgress.pauses.length === 1), true);
});
test('confirmed EA stop precedes closing all-origin positions', async () => {
  const f = fixture({ positions: [mt5Position('11', 0, '0.4', 456)] });
  f.run.decision = { unchanged: false, targets: [target('0')], pause_strategies: [{ deployment_id: 'ea-1', reason: 'Extreme drawdown risk' }] };
  const result = await f.apply(); assert.equal(result.status, 'target_observed'); assert.equal(f.pauses.length, 1); assert.equal(f.nativeSends.length, 1);
  assert.equal(f.reads[1].name, 'mt5_trading_pause'); assert.equal(result.pauses[0].nativeAction, 'remove_expert');
});
test('unknown, partial and accepted pending native receipts stop a multi-order hedge batch without resubmission', async () => {
  for (const nativeResult of ['unknown', 10010, 10008]) {
    const f = fixture({ positions: [mt5Position('11', 0, '0.4'), mt5Position('22', 1, '0.2', 456)], nativeResult });
    f.run.decision.targets = [target('0')];
    const first = await f.apply(); assert.equal(first.status, 'blocked'); assert.equal(first.error.code, 'EXECUTION_INCOMPLETE');
    assert.equal(f.nativeSends.length, 1); assert.equal(first.orders.length, 1);
    const second = await f.apply(); assert.equal(second.status, 'blocked'); assert.equal(f.nativeSends.length, 1);
    assert.equal(records(f.host).list('commands').length, 1);
  }
});
test('an unresolved previous-account send blocks a new run operation ID', async () => {
  const f = fixture({ nativeResult: 'unknown' }); f.run.decision.targets = [target('0.2')];
  await f.apply(); assert.equal(f.nativeSends.length, 1);
  f.run.id = 'another_run'; const result = await f.apply();
  assert.equal(result.error.code, 'UNRESOLVED_ORDER'); assert.equal(f.nativeSends.length, 1);
});
test('existing working MT5 or QMT orders block competing targets', async () => {
  for (const backend of ['mt5', 'qmt']) {
    const symbol = target('0', backend).symbol;
    const f = fixture({ backend, orders: backend === 'mt5' ? [{ symbol }] : [{ stock_code: symbol, order_status: '55' }] });
    f.run.decision.targets = [target(backend === 'mt5' ? '0.2' : '100', backend)];
    const result = await f.apply(); assert.equal(result.error.code, 'WORKING_ORDERS'); assert.equal(f.nativeSends.length, 0); assert.equal(f.observations, 0);
  }
});
test('QMT accepted limit order remains unconfirmed and cannot be automatically submitted twice', async () => {
  const f = fixture({ backend: 'qmt' }); f.run.decision.targets = [target('100', 'qmt')];
  const result = await f.apply(); assert.equal(result.orders[0].receipt.status, 'submitted'); assert.equal(result.status, 'blocked');
  await f.apply(); assert.equal(f.nativeSends.length, 1);
});
test('price limits and native execution guards preserve direction, account and original source timestamp', async () => {
  for (const [quantity, side, limit] of [['0.2', 'buy', '100.52'], ['-0.2', 'sell', '99.5']]) {
    const f = fixture(); f.run.decision.targets = [target(quantity)];
    assert.equal((await f.apply()).status, 'target_observed');
    const send = f.nativeSends[0]; assert.equal(send.args.side, side); assert.equal(send.args.price_limit, limit);
    const guard = send.request.arguments.execution_guard;
    assert.equal(guard.price_limit, limit); assert.equal(guard.expected_account, 'fixture'); assert.equal(guard.expected_server, 'Broker');
    assert.equal(guard.max_quote_age_ms, 5000); assert.equal(guard.max_quote_to_send_ms, 1000); assert.equal(guard.observed_at, 1800000000000);
  }
});
test('stale source quotes and decisions fail before dispatch without relabeling timestamps', async () => {
  const f = fixture({ quoteAge: 5001 }); f.run.decision.targets = [target('0.2')];
  assert.equal((await f.apply()).error.code, 'STALE_QUOTE'); assert.equal(f.nativeSends.length, 0);
  const g = fixture(); g.run.decision.targets = [target('0.2')]; g.advance(300001);
  assert.equal((await g.apply()).error.code, 'DECISION_EXPIRED'); assert.equal(g.reads.length, 0); assert.equal(g.nativeSends.length, 0);
});
test('account changes between frozen plan and execution or observation never dispatch a target order', async () => {
  const f = fixture(); f.run.decision.targets = [target('0.2')]; f.state.account.revision = '2';
  assert.equal((await f.apply()).error.code, 'ACCOUNT_CHANGED'); assert.equal(f.nativeSends.length, 0);
  const g = fixture({ onObservation: ({ state }) => { state.account.accountId = 'another'; } }); g.run.decision.targets = [target('0.2')];
  assert.equal((await g.apply()).error.code, 'ACCOUNT_CHANGED'); assert.equal(g.nativeSends.length, 0);
});
test('an external strategy position appearing after the first close prevents stale-delta overshoot', async () => {
  const f = fixture({ positions: [mt5Position('22', 1, '0.2', 456)], onObservation: ({ state, observations }) => {
    if (observations === 2) state.positions.push(mt5Position('33', 0, '0.3', 789));
  } });
  f.run.decision.targets = [target('0.5')]; const result = await f.apply();
  assert.equal(result.status, 'blocked'); assert.equal(result.error.code, 'POSITION_CHANGED');
  assert.equal(f.nativeSends.length, 1); assert.equal(f.nativeSends[0].args.action, 'close');
  assert.deepEqual(f.state.positions.map(row => [row.ticket, row.volume]), [['33', '0.3']]);
});

test('orders appearing after the account snapshot block the first or subsequent target order', async () => {
  for (const backend of ['mt5', 'qmt']) {
    const symbol = target('0', backend).symbol;
    const f = fixture({ backend, onObservation: ({ state }) => {
      state.orders.push(backend === 'mt5' ? { symbol } : { stock_code: symbol, order_status: '51' });
    } });
    f.run.decision.targets = [target(backend === 'mt5' ? '0.2' : '100', backend)];
    assert.equal((await f.apply()).error.code, 'WORKING_ORDERS'); assert.equal(f.nativeSends.length, 0);
  }
  const f = fixture({ positions: [mt5Position('22', 1, '0.2')], onObservation: ({ state, observations }) => {
    if (observations === 2) state.orders.push({ symbol: 'EURUSD' });
  } });
  f.run.decision.targets = [target('0.5')];
  assert.equal((await f.apply()).error.code, 'WORKING_ORDERS'); assert.equal(f.nativeSends.length, 1);
});

test('QMT cancellation-in-progress and unknown order states cannot authorize a replacement', async () => {
  for (const status of ['51', '52', '255', undefined]) {
    const f = fixture({ backend: 'qmt', orders: [{ stock_code: '600000.SH', order_status: status }] });
    f.run.decision.targets = [target('100', 'qmt')];
    assert.equal((await f.apply()).error.code, 'WORKING_ORDERS'); assert.equal(f.nativeSends.length, 0);
  }
});

test('scheduled native intents bind empty or all-origin positions while ordinary manual intents stay compatible', async () => {
  const { host } = fixture();
  const capture = async (observation, intent, kind) => {
    let request;
    await nativeSubmit(host, observation, intent, sent => { request = sent; return { status: 'unknown' }; }, kind);
    return request;
  };
  const observation = { backend: 'mt5', symbol: 'EURUSD', account: { accountId: 'fixture', server: 'Broker', revision: '1' }, positions: [], quote: { sourceTimeMs: 1800000000000, clock:{status:'verified',ruleRevision:'fixture-clock-v1'} }, expiresAt: 1800000060000,
    spec: { volume_min: '0.1', volume_max: '100', volume_step: '0.1', filling_mode: 2 } };
  const args = { user_authorized: true, action: 'market', side: 'buy', quantity: '0.2', price_limit: '101', backendCommandId: 'fixture-command-001', operation_id: 'test', remark: 'fixture' };
  assert.deepEqual((await capture(observation, args)).arguments.execution_guard.expected_positions, []);
  assert.equal((await capture(observation, args, 'main')).arguments.execution_guard.expected_positions, undefined);
  observation.positions = [mt5Position('11', 0, '0.4', 42), mt5Position('22', 1, '0.2')];
  assert.deepEqual((await capture(observation, { ...args, backendCommandId: 'fixture-command-002' })).arguments.execution_guard.expected_positions, [{ ticket: '11', type: 0, volume: '0.4' }, { ticket: '22', type: 1, volume: '0.2' }]);
  const qmt = { ...observation, backend: 'qmt', account: { accountId: 'fixture', connectionId: 'qmt', revision: '1' }, symbol: '600000.SH', positions: [{ account_id: 'fixture', stock_code: '600000.SH', volume: 100, can_use_volume: 0 }] };
  const qmtArgs = { ...args, action: 'limit', quantity: '100', limit_price: '100' };
  assert.deepEqual((await capture(qmt, qmtArgs)).execution_guard.expected_positions, [{ account_id: 'fixture', stock_code: '600000.SH', volume: '100', can_use_volume: '0' }]);
  qmt.positions[0].account_id = 'other';
  await assert.rejects(capture(qmt, qmtArgs), { code: 'SOURCE_DATA_INVALID' });
});
