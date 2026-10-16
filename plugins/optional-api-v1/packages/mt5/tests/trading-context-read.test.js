import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingContext } from '../tools/trading-context.js';

function fixture(overrides = {}) {
  const calls = [], config = { version: 1, account: { login: '123', server: 'Synthetic' } };
  const data = {
    account_info: { login: '123', server: 'Synthetic', equity: 10000 },
    terminal_info: { connected: true }, positions_get: [], orders_get: [], history_deals_get: [], history_orders_get: [],
  };
  const mt5 = { official: {
    settings: () => config,
    redact: value => value,
    async call(request, owner, signal) {
      calls.push(request); assert.equal(owner, 'isolated-session');
      if (overrides.call) return overrides.call(request, config, signal);
      return { id: request.command_id, status: 'returned', result: { result: data[request.tool], last_error: [1, 'Success'] } };
    },
  }, deployments: { list: () => [{ id: 'owned', login: '123', server: 'Synthetic' }, { id: 'other', login: '456', server: 'Other' }] } };
  const host = { context: { kind: 'main', sessionId: 'isolated-session' } };
  return { calls, config, data, service: createTradingContext(host, mt5, { now: () => 1700000000000 }) };
}

test('confirmed Python IPC failure sends one command and retains actionable native evidence', async () => {
  const f = fixture({ call: request => ({ id: request.command_id, status: 'failed', result: { result: null, last_error: [-10004, 'No IPC connection'] } }) });
  let failure;
  try { await f.service.context({ action: 'snapshot' }); } catch (error) { failure = error; }
  assert.equal(f.calls.length, 1, 'a known failed account probe must not queue five more native reads');
  assert.equal(f.calls[0].server, 'python');
  assert.equal(failure.code, 'MT5_PYTHON_UNAVAILABLE');
  assert.deepEqual({ ...failure.details, recovery: undefined }, {
    transport: 'python', requiredTransport: 'python', method: 'account_info', commandId: f.calls[0].command_id,
    commandStatus: 'failed', nativeCode: -10004, nativeMessage: 'No IPC connection', retryable: false, recovery: undefined,
  });
  assert.match(failure.details.recovery, /same account.*new workflow run/i);
});

test('account mismatch stops before terminal, position or history reads', async () => {
  const f = fixture(); f.data.account_info.login = 'different';
  await assert.rejects(f.service.context({ action: 'snapshot' }), { code: 'ACCOUNT_MISMATCH' });
  assert.deepEqual(f.calls.map(c => c.tool), ['account_info']);
});

test('disconnected broker stops after the two identity/channel observations', async () => {
  const f = fixture(); f.data.terminal_info.connected = false;
  await assert.rejects(f.service.context({ action: 'snapshot' }), { code: 'SOURCE_UNAVAILABLE' });
  assert.deepEqual(f.calls.map(c => c.tool), ['account_info', 'terminal_info']);
});

test('a valid snapshot retains account rows and UTC range and ignores stale last_error on successful data', async () => {
  const f = fixture();
  const original = f.data.account_info;
  f.data.positions_get = [{ ticket: '9007199254740993', symbol: 'EURUSD', type: 0, volume: '0.01' }];
  const result = await f.service.context({ action: 'snapshot', history_days: 2 });
  assert.equal(result.summary, original);
  assert.deepEqual(result.positions, f.data.positions_get);
  assert.deepEqual(result.orders, []);
  assert.deepEqual(result.fills, []);
  assert.deepEqual(result.historicalOrders, []);
  assert.deepEqual(result.deployments.map(d => d.id), ['owned']);
  assert.equal(result.historyCoverage.complete, false);
  assert.equal(result.historyCoverage.requestedTo - result.historyCoverage.requestedFrom, 2 * 86400000);
  assert.deepEqual(f.calls.map(c => c.tool), ['account_info', 'terminal_info', 'positions_get', 'orders_get', 'history_deals_get', 'history_orders_get']);
  for (const request of f.calls.filter(c => c.tool.startsWith('history_'))) {
    assert.equal(request.arguments.date_from, '2023-11-12T22:13:20.000Z');
    assert.equal(request.arguments.date_to, '2023-11-14T22:13:20.000Z');
  }
  const g = fixture({ call: request => ({ id: request.command_id, status: 'returned', result: { result: request.tool === 'account_info' ? { login: '123', server: 'Synthetic' } : request.tool === 'terminal_info' ? { connected: true } : [], last_error: [-10004, 'Old diagnostic'] } }) });
  assert.deepEqual((await g.service.context({ action: 'snapshot' })).positions, []);
});

test('preflight errors keep their code and do not become a guessed deterministic IPC failure', async () => {
  const f = fixture({ call: () => { throw Object.assign(new Error('Plugin permission is disabled'), { code: 'mt5_permission_denied', details: { submission_attempted: false } }); } });
  await assert.rejects(f.service.context({ action: 'snapshot' }), error => {
    assert.equal(error.code, 'mt5_permission_denied'); assert.equal(error.details.transport, 'python');
    assert.equal(error.details.method, 'account_info'); assert.equal(error.details.submission_attempted, false);
    assert.notEqual(error.details.retryable, false); return true;
  });
  assert.equal(f.calls.length, 1);
});

test('ordinary native errors retain diagnostics and stop before further account reads', async () => {
  const f = fixture({ call: request => ({ id: request.command_id, status: 'failed', result: { result: null, last_error: [-2, 'Invalid parameters'] } }) });
  await assert.rejects(f.service.context({ action: 'snapshot' }), error => {
    assert.equal(error.code, 'SOURCE_UNAVAILABLE'); assert.equal(error.details.nativeCode, -2);
    assert.equal(error.details.nativeMessage, 'Invalid parameters'); assert.notEqual(error.details.retryable, false); return true;
  });
  assert.equal(f.calls.length, 1);
});

test('a malformed positions observation stops before orders or history instead of returning a partial snapshot', async () => {
  const f = fixture(); f.data.positions_get = {};
  await assert.rejects(f.service.context({ action: 'snapshot' }), { code: 'SOURCE_DATA_INVALID' });
  assert.deepEqual(f.calls.map(c => c.tool), ['account_info', 'terminal_info', 'positions_get']);
});

test('cancellation propagates its reason immediately without queuing account reads', async () => {
  const controller = new AbortController(), reason = new Error('Synthetic cancellation');
  const f = fixture({ call: () => { controller.abort(reason); throw reason; } });
  await assert.rejects(f.service.context({ action: 'snapshot' }, controller.signal), error => error === reason);
  assert.equal(f.calls.length, 1);
  const g = fixture();
  await assert.rejects(g.service.context({ action: 'snapshot' }, controller.signal), error => error === reason);
  assert.equal(g.calls.length, 0);
});

test('a configuration revision change stops additional native reads', async () => {
  const f = fixture({ call: (request, config) => {
    config.version++;
    return { id: request.command_id, status: 'returned', result: { result: { login: '123', server: 'Synthetic' } } };
  } });
  await assert.rejects(f.service.context({ action: 'snapshot' }), { code: 'CONNECTION_CHANGED' });
  assert.equal(f.calls.length, 1);
});
