import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response } from './binance-fixture.mjs';
import { createRecords } from '../packages/binance/src/records.js';

test('strict fixture completes order, amend, cancel and status with a stable client ID', async t => {
  const f = await fixture(t), execution = f.service.execution;
  const order = await execution.order(f.order()); assert.equal(order.status, 'submitted'); assert.equal(order.raw.result.status, 'NEW');
  const amended = await execution.mutate('amend', { operation_id: 'amend-001', original_operation_id: 'order-001', quantity: '0.00050', user_authorized: true });
  assert.equal(amended.raw.result.amendedOrder.origQty, '0.00050'); assert.equal(amended.raw.result.amendedOrder.clientOrderId, order.raw.clientOrderId);
  const canceled = await execution.mutate('cancel', { operation_id: 'cancel-001', original_operation_id: 'order-001', user_authorized: true });
  assert.equal(canceled.status, 'cancel_requested'); assert.equal(canceled.raw.result.status, 'CANCELED');
  const final = await execution.status({ operation_id: 'cancel-001' }); assert.equal(final.status, 'execution_reported'); assert.equal(final.raw.result.status, 'CANCELED');
  assert.equal(f.calls.filter(row => row.method === 'POST').length, 1);
});
test('duplicate concurrent order IDs send once and changing intent is rejected', async t => {
  const f = await fixture(t); const [a, b] = await Promise.all([f.service.execution.order(f.order()), f.service.execution.order(f.order())]);
  assert.deepEqual(a, b); assert.equal(f.calls.filter(row => row.method === 'POST').length, 1);
  await assert.rejects(f.service.execution.order(f.order({ quantity: '0.002' })), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('recovery uses a known exchange order ID when cancellation changes the client ID', async t => {
  const f = await fixture(t), placed = await f.service.execution.order(f.order());
  f.overrides.push({ match: row => row.method === 'DELETE', run: () => {
    const row = f.orders.get(placed.raw.clientOrderId); f.orders.delete(placed.raw.clientOrderId);
    row.status = 'CANCELED'; row.origClientOrderId = row.clientOrderId; row.clientOrderId = 'binance-generated-cancel-id';
    f.orders.set(row.clientOrderId, row); return response(row);
  } });
  await f.service.execution.mutate('cancel', { operation_id: 'cancel-new-client', original_operation_id: placed.raw.id, user_authorized: true });
  const status = await f.service.execution.status({ operation_id: 'cancel-new-client' });
  assert.equal(status.raw.result.status, 'CANCELED'); assert.equal(status.raw.recovery.outcome, 'observed');
  assert.equal(f.calls.at(-1).params.orderId, String(placed.raw.result.orderId));
});
test('unknown submission persists before dispatch, survives a reopened ledger and reconciles without resending', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.path === '/api/v3/order' && row.method === 'POST', run: call => {
    const records = createRecords(f.root), saved = records.get('commands', 'order-001'); records.close();
    assert.equal(saved.status, 'submitting'); assert.equal(saved.clientOrderId, call.params.newClientOrderId);
    f.orders.set(saved.clientOrderId, { symbol: 'BTCUSDT', orderId: 888, clientOrderId: saved.clientOrderId, side: 'BUY', type: 'LIMIT', origQty: '0.00100', executedQty: '0', price: '50000', status: 'NEW', time: f.clock.now(), updateTime: f.clock.now(), timeInForce: 'GTC' });
    return response({ code: -1007 }, 504);
  } });
  const unknown = await f.service.execution.order(f.order()); assert.equal(unknown.status, 'outcome_unknown');
  const repeated = await f.service.execution.order(f.order()); assert.equal(repeated.status, 'outcome_unknown');
  await assert.rejects(f.service.execution.order(f.order({ operation_id: 'dangerous-new-id' })), { code: 'OPERATION_OUTCOME_UNKNOWN' });
  const recovered = await f.service.execution.status({ operation_id: 'order-001' }); assert.equal(recovered.status, 'submitted');
  assert.equal(f.calls.filter(row => row.method === 'POST').length, 1);
});
test('not-found after unknown send keeps the outcome unknown', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.method === 'POST', run: () => { throw new Error('socket closed'); } });
  assert.equal((await f.service.execution.order(f.order())).status, 'outcome_unknown');
  const status = await f.service.execution.status({ operation_id: 'order-001' });
  assert.equal(status.status, 'outcome_unknown'); assert.equal(status.raw.recovery.outcome, 'unconfirmed');
});
test('a malformed successful order response remains unknown rather than rejected', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.path === '/api/v3/order' && row.method === 'POST', run: call => response({ symbol: 'BTCUSDT', clientOrderId: call.params.newClientOrderId, side: 'BUY', type: 'LIMIT', status: 'NEW', orderId: 888, origQty: 'not-decimal', executedQty: '0' }) });
  const receipt = await f.service.execution.order(f.order()); assert.equal(receipt.status, 'outcome_unknown'); assert.equal(receipt.submissionAttempted, true);
});
test('market sell consumes owned base asset, and oversized or nonaligned orders never send', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.execution.order(f.order({ side: 'sell', quantity: '2.00000' })), /free base-asset/);
  await assert.rejects(f.service.execution.order(f.order({ quantity: '0.001001' })), /lot step/);
  await assert.rejects(f.service.execution.order(f.order({ limit_price: '50000.001' })), /tick size/);
  assert.equal(f.calls.filter(row => row.method !== 'GET').length, 0);
  const closed = await f.service.execution.order(f.order({ operation_id: 'sell-001', action: 'market', side: 'sell' }));
  assert.equal(closed.status, 'execution_reported'); assert.equal(closed.raw.result.side, 'SELL');
});
test('private mutation uses the actual caller context despite shared transport lifetime', async t => {
  const f = await fixture(t);
  const child = f.service.executionFor({ context: { ...f.host.context, kind: 'subagent' } });
  await assert.rejects(child.order(f.order()), { code: 'FORBIDDEN' });
  assert.equal(f.calls.length, 0);
});
test('environment mismatch and changed credentials cannot replay old commands', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.execution.order(f.order({ environment: 'production' })), { code: 'CONNECTION_CHANGED' });
  await f.service.execution.order(f.order()); f.env.BINANCE_API_KEY = 'rotated-fixture-key';
  await assert.rejects(f.service.execution.status({ operation_id: 'order-001' }), { code: 'CONNECTION_CHANGED' });
});
test('test-order endpoint is explicitly non-trading and has a durable distinct receipt', async t => {
  const f = await fixture(t); const result = await f.service.execution.order(f.order(), undefined, true);
  assert.equal(result.status, 'validated'); assert.equal(result.raw.createsOrder, false); assert.equal(f.orders.size, 0);
  assert.equal(f.calls.filter(row => row.path === '/api/v3/order').length, 0);
});
test('a timed-out validation request cannot create an unknown live order or block subsequent trading', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.path === '/api/v3/order/test', run: () => { throw new Error('validation response lost'); } });
  const validation = await f.service.execution.order(f.order({ operation_id: 'test-timeout' }), undefined, true);
  assert.equal(validation.status, 'validation_unknown'); assert.equal(validation.raw.createsOrder, false);
  assert.equal((await f.service.execution.order(f.order())).status, 'submitted'); assert.equal(f.orders.size, 1);
});
test('amendment rejects increasing or below-filled quantities before mutation', async t => {
  const f = await fixture(t), order = await f.service.execution.order(f.order());
  await assert.rejects(f.service.execution.mutate('amend', { operation_id: 'bad-amend', original_operation_id: order.raw.id, quantity: '0.002', user_authorized: true }), /reduce/);
  f.orders.get(order.raw.clientOrderId).executedQty = '0.0008';
  await assert.rejects(f.service.execution.mutate('amend', { operation_id: 'bad-amend2', original_operation_id: order.raw.id, quantity: '0.0005', user_authorized: true }), /already filled/);
  assert.equal(f.calls.filter(row => row.method === 'PUT').length, 0);
});
test('stale source ticker prevents an order and no local timestamp substitutes for it', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.path === '/api/v3/ticker/24hr', run: () => response({ bidPrice: '49999', askPrice: '50000', lastPrice: '50000', closeTime: f.clock.now() - 3600000 }) });
  await assert.rejects(f.service.execution.order(f.order()), /stale/);
  assert.equal(f.calls.filter(row => row.method === 'POST').length, 0);
});
