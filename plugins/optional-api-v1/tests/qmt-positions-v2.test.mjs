import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createService } from '../packages/qmt/service.js';
import { createPositionCapabilities } from '../packages/qmt/positions.js';
import { createCapabilities } from '../packages/qmt/index.js';
import { records, closeRecords } from '../packages/qmt/records.js';
import { position } from '../packages/qmt/mapping.js';
import { digest } from '@sesame/plugin-sdk/protocol';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'qmt-positions-'));
  const host = { context: { storageRoot: root, pluginId: 'sesame/qmt', kind: 'main', sessionId: 'conv_main' } };
  const config = { id: 'local', version: 7, connection_id: 'fixture-native', account_id: '00123', python_path: 'fixture-python', userdata_directory: root, sector: 'fixture' };
  records(host).put('configuration', config);
  const clock = () => 1800000000000;
  const state = { positions: [{ account_id: '00123', stock_code: '600000.SH', volume: '500', can_use_volume: '300', avg_price: '10.01', last_price: '10.02' }], orders: [], sends: 0, nativeRequests: [], failure: null };
  const service = createService(host, { platform: 'win32', now: clock, request: async payload => {
    state.nativeRequests.push(payload);
    let result;
    if (payload.action === 'positions') result = { items: structuredClone(state.positions) };
    else if (payload.action === 'orders') result = { items: structuredClone(state.orders) };
    else if (payload.action === 'quotes') result = { items: [{ symbol: '600000.SH', tick: { time: String(clock()), bidPrice: ['10.02'] } }] };
    else if (payload.action === 'order') {
      state.sends++;
      assert.equal(records(host).get('qmt_commands', payload.operation_id).status, 'outcome_unknown', 'Native command must already be durable');
      assert.equal(records(host).get('position_closes', 'close-one').receipt.status, 'outcome_unknown', 'Position intent must already be durable');
      if (state.failure) throw state.failure;
      result = { order_id: '9007199254740993', status: 'submitted' };
    } else throw new Error('Unexpected native operation ' + payload.action);
    return { ok: true, result, sample: { from: clock(), to: clock() } };
  } });
  // Override the time source only; the adapter still calls the real service/private SQLite/command guard path.
  const { createPositionManager } = await import('../packages/qmt/positions.js');
  const { capability } = await import('../packages/qmt/execution.js');
  const capabilities = [capability('close', (args, signal) => createPositionManager(host, service, { now: clock }).close(args, signal)), capability('read', (args, signal) => createPositionManager(host, service, { now: clock }).readReceipt(args, signal))];
  const invoke = (name, input, caller = 'host') => capabilities.find(item => item.name === name).execute(input, new AbortController().signal, { provenance: { caller: { pluginId: caller } } });
  const current = position(config, state.positions[0]);
  const expected = { instrument: current.instrument, side: current.side, quantity: current.quantity };
  const input = { binding: { connection: { id: 'fixture-native', revision: '7' }, account: { connectionId: 'fixture-native', accountId: '00123' } },
    positionId: current.id, operationId: 'close-one', quantity: { value: '200', unit: 'share' }, expected: { revision: digest({ id: current.id, account: current.account, ...expected }), ...expected } };
  t.after(async () => { await service.dispose(); closeRecords(host); assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'qmt-positions-'))); await rm(root, { recursive: true, force: true }); });
  return { host, service, config, state, input, invoke };
}

test('QMT positions are explicitly declared host services and the pure factory contains each binding', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/qmt/capabilities.json', import.meta.url), 'utf8'));
  const { validateCapabilityManifest } = await import(new URL('../../../../mt5agent/modules/plugins/capability-contract.js', import.meta.url));
  const checked = await validateCapabilityManifest(manifest);
  assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));
  const declared = manifest.services.find(item => item.contract === 'sesame.positions/1');
  assert.equal(declared.sourceId, 'account');
  assert.deepEqual(declared.operations, { close: 'positions_close', readReceipt: 'positions_read_receipt' });
  const names = createCapabilities({}).map(item => item.name);
  for (const name of Object.values(declared.operations)) {
    assert.ok(names.includes(name));
    assert.deepEqual(manifest.capabilities.find(item => item.id === name).consumers, ['host']);
  }
  assert.deepEqual(createPositionCapabilities({}, () => { throw new Error('Factory executed service'); }).map(item => item.name), ['positions_close', 'positions_read_receipt']);
});

test('QMT close preserves native decimal/ID data, sellable quantity, guarded limit intent and idempotency', async t => {
  const f = await fixture(t);
  const [one, two] = await Promise.all([f.invoke('close', f.input), f.invoke('close', f.input)]);
  assert.deepEqual(one, two); assert.equal(one.status, 'submitted'); assert.equal(f.state.sends, 1);
  assert.deepEqual(one.orderIds, ['9007199254740993']);
  const request = f.state.nativeRequests.find(item => item.action === 'order');
  assert.equal(request.side, 'sell'); assert.equal(request.shares, '200'); assert.equal(request.price, '10.02');
  assert.deepEqual(request.execution_guard.expected_positions, [{ account_id: '00123', stock_code: '600000.SH', volume: '500', can_use_volume: '300' }]);
  await assert.rejects(f.invoke('close', { ...f.input, quantity: { value: '100', unit: 'share' } }), { code: 'IDEMPOTENCY_CONFLICT' });
  const blocked = await f.invoke('close', { ...f.input, operationId: 'close-two' });
  assert.equal(blocked.status, 'rejected'); assert.equal(blocked.error.code, 'POSITION_OPERATION_PENDING'); assert.equal(f.state.sends, 1);
});

test('QMT rejects non-host callers, changed native holdings, stale binding and T+1 unavailable volume before sending', async t => {
  const f = await fixture(t);
  await assert.rejects(f.invoke('close', f.input, 'fixture/untrusted'), { code: 'FORBIDDEN' });
  f.state.positions[0].volume = '499';
  const changed = await f.invoke('close', f.input); assert.equal(changed.status, 'rejected'); assert.equal(changed.error.code, 'POSITION_CHANGED');
  f.state.positions[0].volume = '500';
  const unavailable = await f.invoke('close', { ...f.input, operationId: 't-plus-one', quantity: { value: '301', unit: 'share' } });
  assert.equal(unavailable.status, 'rejected'); assert.equal(unavailable.error.code, 'INVALID_QUANTITY');
  const stale = await f.invoke('close', { ...f.input, operationId: 'wrong-binding', binding: { ...f.input.binding, connection: { ...f.input.binding.connection, revision: '6' } } });
  assert.equal(stale.status, 'rejected'); assert.equal(stale.error.code, 'CONNECTION_CHANGED'); assert.equal(f.state.sends, 0);
});

test('QMT reports partial fills, completed partial close and flat position separately using the exact native order', async t => {
  const f = await fixture(t);
  await f.invoke('close', f.input);
  f.state.orders = [{ account_id: '00123', stock_code: '600000.SH', order_id: '9007199254740993', order_volume: '200', traded_volume: '100', order_status: '55' }];
  f.state.positions[0].volume = '400';
  const partial = await f.invoke('read', { binding: f.input.binding, operationId: f.input.operationId });
  assert.equal(partial.status, 'partially_filled'); assert.equal(partial.filledQuantity.value, '100');
  f.state.orders[0].traded_volume = '200'; f.state.orders[0].order_status = '56'; f.state.positions[0].volume = '300';
  const filled = await f.invoke('read', { binding: f.input.binding, operationId: f.input.operationId });
  assert.equal(filled.status, 'filled'); assert.equal(filled.remainingPositionQuantity.value, '300'); assert.equal(f.state.sends, 1);
});

test('QMT unknown native outcomes remain durable across adapter recreation and are never resent or guessed from an empty position', async t => {
  const f = await fixture(t);
  f.state.failure = Object.assign(new Error('Native transport lost'), { code: 'SOURCE_UNAVAILABLE' });
  const unknown = await f.invoke('close', f.input); assert.equal(unknown.status, 'outcome_unknown');
  f.state.positions = [];
  assert.equal((await f.invoke('read', { binding: f.input.binding, operationId: f.input.operationId })).status, 'outcome_unknown');
  assert.equal((await f.invoke('close', f.input)).status, 'outcome_unknown'); assert.equal(f.state.sends, 1);
});

test('QMT full close reports closed only after the exact native order fully fills and the position is absent', async t => {
  const f = await fixture(t); f.state.positions[0].can_use_volume = '500'; delete f.input.quantity;
  await f.invoke('close', f.input);
  f.state.orders = [{ account_id: '00123', stock_code: '600000.SH', order_id: '9007199254740993', order_volume: '500', traded_volume: '500', order_status: '56' }];
  f.state.positions = [];
  const receipt = await f.invoke('read', { binding: f.input.binding, operationId: f.input.operationId });
  assert.equal(receipt.status, 'closed'); assert.equal(receipt.filledQuantity.value, '500'); assert.equal(receipt.remainingPositionQuantity.value, '0'); assert.equal(f.state.sends, 1);
});
