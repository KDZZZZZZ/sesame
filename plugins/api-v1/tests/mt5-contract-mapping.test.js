import test from 'node:test';
import assert from 'node:assert/strict';
import { accountIdentity, barEnd, decimal, mapAccountSnapshot, mapBar, mapFill, mapInstrument, mapLedgerEntry, mapOrder, mapPosition, nativeId, Revisions, sourceTime } from '../../optional-api-v1/packages/mt5/backend/contract-mapping.js';

const context = { account: { connectionId: 'terminal', accountId: 'broker-7001' }, sourceId: 'broker-source', server: 'Broker-Demo', currency: 'USD', revisions: new Revisions() };
const barContext = { ...context, seriesId: 'EURUSD-1m', spec: { timeframe: '1m' } };

test('native decimal strings retain precision, and unsafe ticket numbers are rejected', () => {
  assert.equal(decimal('1.000000000000000000000000000000001'), '1.000000000000000000000000000000001');
  assert.equal(decimal(1e-7), '0.0000001');
  assert.equal(decimal(-1.2e22), '-12000000000000000000000');
  assert.equal(nativeId('9007199254740993123'), '9007199254740993123');
  assert.throws(() => nativeId(9007199254740993123), /precision/);
  assert.throws(() => decimal(Infinity), /finite/);
});

test('unknown broker clock stays wall time and calendar months are not 30 days', () => {
  const wall = sourceTime('2026-02-01T00:00:00', 'Broker-Demo');
  assert.equal(wall.basis, 'wall'); assert.equal(wall.authority, 'Broker-Demo');
  assert.equal(barEnd(wall, '1mo').value, '2026-03-01T00:00:00.000');
  assert.equal(sourceTime('2026-02-01T00:00:00Z', 'Broker-Demo').basis, 'utc');
  assert.equal(sourceTime(1769904000, 'Broker-Demo').basis, 'wall');
});

test('forming bars preserve real and tick volume, with monotonic revisions', () => {
  const row = { time: '2026-09-01T00:01:00', open: '1.1', high: '1.3', low: '1.0', close: '1.2', tick_volume: 0, real_volume: '2.50' };
  const ctx = { ...barContext, revisions: new Revisions(), realVolumeUnit: 'contract' };
  const first = mapBar(row, ctx), repeated = mapBar(row, ctx), updated = mapBar({ ...row, close: '1.3' }, ctx);
  assert.equal(first.isClosed, false); assert.equal(first.closure, 'unknown');
  assert.equal(first.volume.default, 'real'); assert.deepEqual(first.volume.tick, { status: 'value', value: '0' });
  assert.deepEqual(first.volume.real.value, { value: '2.50', unit: 'contract' });
  assert.equal(repeated.revision, first.revision); assert.equal(updated.id, first.id); assert.equal(updated.revision, '2');
  const closed = mapBar({ ...row, close: '1.3' }, { ...ctx, nextOpenTime: '2026-09-01T00:02:00' });
  assert.equal(closed.isClosed, true); assert.equal(closed.closure, 'source'); assert.equal(closed.revision, '3');
});

test('missing volume is never filled with zero and native negative prices remain valid', () => {
  const row = { time: 1000, open: '-2', high: '-1', low: '-3', close: '-1.5' };
  const bar = mapBar(row, barContext);
  assert.equal(bar.volume.default, 'none'); assert.equal(bar.volume.tick.status, 'unknown');
  assert.throws(() => mapBar({ ...row, high: '-4' }, barContext), /OHLC/);
  assert.throws(() => mapBar({ ...row, tick_volume: '1.5' }, barContext), /integer/);
});

test('instrument precision does not invent a tick size, lot step, calendar or traded volume unit', () => {
  const instrument = mapInstrument({ symbol: 'EURUSD', digits: 5, point: 0.00001 }, context);
  assert.equal(instrument.price.displayDecimals, 5); assert.equal(instrument.price.tickSize.status, 'unknown');
  assert.equal(instrument.quantity.step.status, 'unknown'); assert.equal(instrument.calendar.status, 'unknown');
  assert.equal(instrument.ref.sourceId, context.sourceId); assert.equal(instrument.quantity.unit, 'lot');
});

test('account zero, missing and unsupported values remain distinct; margin percentage becomes a ratio', () => {
  const account = mapAccountSnapshot({ login: '7001', server: 'Broker-Demo', balance: '0', equity: '0', margin_level: '150.25', currency: 'USD', margin_mode: 'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING' }, { connectionId: 'terminal', observedAt: 1234, snapshotId: 'a' });
  assert.deepEqual(account.balance, { status: 'value', value: { value: '0', currency: 'USD' } });
  assert.equal(account.unrealizedPnl.status, 'unknown'); assert.equal(account.buyingPower.status, 'unsupported');
  assert.equal(account.margin.levelRatio.value, '1.5025'); assert.equal(account.account.positionMode, 'hedging');
  assert.notEqual(accountIdentity('Broker-Demo', '7001'), accountIdentity('Other-Broker', '7001'));
});

test('hedged native positions retain identity and manual trades have no fabricated run', () => {
  const row = { ticket: '17', symbol: 'EURUSD', type: 'POSITION_TYPE_BUY', volume: '0.10', price_open: '1.12', profit: '0' };
  const first = mapPosition(row, context), second = mapPosition({ ...row, ticket: '18' }, context);
  assert.notEqual(first.id, second.id); assert.equal(first.strategyRunId.status, 'unknown');
  assert.equal(first.unrealizedPnl.value.value, '0'); assert.equal(first.openedAt.status, 'unknown');
});

test('orders preserve partial fills and cancel-pending without treating them as cancelled', () => {
  const row = { ticket: '19', symbol: 'EURUSD', type: 'ORDER_TYPE_BUY_LIMIT', volume_initial: '1.00', volume_current: '0.40', state: 'ORDER_STATE_PARTIAL', time_setup: '2026-09-01T01:00:00', price_open: '1.1' };
  const order = mapOrder(row, context);
  assert.equal(order.filledQuantity.value, '0.60'); assert.equal(order.status, 'partially_filled');
  assert.equal(mapOrder({ ...row, state: 'ORDER_STATE_REQUEST_CANCEL' }, context).status, 'cancel_pending');
  assert.equal(order.correlation.status, 'unknown');
  assert.throws(() => mapOrder({ ...row, volume_current: '1.01' }, context), /remaining/);
});

test('fill identity includes the account; repeated and corrected native fills retain ID', () => {
  const row = { deal_id: '9007199254740993123', order_id: '19', symbol: 'EURUSD', action: 'buy', time: '2026-09-01T01:01:00', volume: '0.60', price: '1.1', profit: '0', commission: '-0.1', fee: '0', swap: '0' };
  const first = mapFill(row, context), repeated = mapFill(row, context), corrected = mapFill({ ...row, profit: '2' }, context);
  assert.equal(repeated.id, first.id); assert.equal(repeated.revision, first.revision); assert.equal(corrected.revision, '2');
  assert.notEqual(mapFill(row, { ...context, account: { ...context.account, accountId: 'other-account' } }).id, first.id);
  assert.equal(first.correlation.status, 'unknown'); assert.equal(first.fees.status, 'value');
  assert.equal(mapFill({ ...row, fee: undefined }, context).fees.status, 'unknown');
});

test('non-trading native deals become signed ledger entries without guessing fill relationships', () => {
  const base = { ticket: '200', type: 'DEAL_TYPE_BALANCE', time: '2026-09-01T01:00:00', profit: '1000' };
  const deposit = mapLedgerEntry(base, context), withdrawal = mapLedgerEntry({ ...base, ticket: '201', profit: '-20' }, context);
  assert.equal(deposit.kind, 'deposit'); assert.equal(withdrawal.kind, 'withdrawal');
  assert.equal(withdrawal.amount.value, '-20'); assert.deepEqual(deposit.relatedFillIds, []);
  assert.equal(mapLedgerEntry({ ...base, type: 'DEAL_TYPE_BUY' }, context), null);
});

 test('actual native history deal price_open is this fill price, never price_close; missing fees remain unknown',()=>{
  const buy={deal_id:'101',order_id:'201',position_id:'201',symbol:'BTCUSD',action:'buy',entry:'in',reason:'Expert',open_time:'2026-10-10T03:27:00',price_open:82539.24,volume:.01,profit:0,commission:-.27,magic_number:61011108,contract_size:1};
  const sell={deal_id:'102',order_id:'202',position_id:'201',symbol:'BTCUSD',action:'sell',entry:'out',reason:'Expert',open_time:'2026-10-10T03:28:01',price_open:82555.80,price_close:82539.24,volume:.01,volume_closed:.01,profit:.17,commission:-.27,magic_number:61011108,contract_size:1};
  const opened=mapFill(buy,context),closed=mapFill(sell,context);assert.equal(opened.price,'82539.24');assert.equal(closed.price,'82555.8');assert.equal(closed.side,'sell');assert.equal(closed.quantity.value,'0.01');assert.equal(closed.fees.status,'unknown');assert.equal(opened.fees.status,'unknown');assert.equal(closed.realizedPnl.value.value,'0.17');
  assert.equal(mapFill({...sell,price:'82555.8000000000000001'},context).price,'82555.8000000000000001','canonical price retains priority and precision');
  assert.throws(()=>mapFill({...sell,price_open:undefined},context),{code:'INVALID_NATIVE_DATA'},'price_close is not a valid missing-fill-price substitute');
 });
 test('native historical order done_time is a supported update alias without replacing canonical time_done',()=>{
  const row={order_id:'202',symbol:'BTCUSD',action:'sell',state:'filled',open_time:'2026-10-10T03:27:00',done_time:'2026-10-10T03:28:01',volume:.01,volume_current:0};
  const mapped=mapOrder(row,context);assert.equal(mapped.updatedAt.value,'2026-10-10T03:28:01');assert.equal(mapped.createdAt.value,'2026-10-10T03:27:00');
  assert.equal(mapOrder({...row,time_done:'2026-10-10T03:28:02'},context).updatedAt.value,'2026-10-10T03:28:02');
 });
