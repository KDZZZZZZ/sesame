import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCapabilities } from '../packages/binance/index.js';
import { fixture, response, utc } from './binance-fixture.mjs';

test('account presentation retains the actual read window, not the requested history range', async t => {
  const f = await fixture(t), source = f.service.account, b = await source.bind({}), ref = source.ref(b.account);
  const start = f.clock.now();
  f.overrides.push({ match: row => row.path === '/api/v3/account', run: () => {
    f.clock.advance(37);
    return response({ uid: 12345, accountType: 'SPOT', canTrade: true, balances: [] });
  } });
  const listed = await source.list(b, {}, { limit: 10 });
  assert.deepEqual(listed.metadata.meta.samplingWindow, { from: start, to: f.clock.now() });
  assert.ok(f.clock.now() >= start + 37, 'sampling includes the request and any shared rate-limit wait');
  assert.equal(listed.metadata.meta.observedAt, f.clock.now());
  assert.equal(listed.metadata.meta.consistency, 'bounded');
  const snapshotStart = f.clock.now(), snapshot = await source.snapshot(b, { account: ref });
  assert.deepEqual(snapshot.metadata.meta.samplingWindow, { from: snapshotStart, to: f.clock.now() });
  for (const [path, method, query] of [
    ['/api/v3/openOrders', 'orders', { account: ref, scope: 'working' }],
    ['/api/v3/myTrades', 'fills', { account: ref, instruments: [{ sourceId: b.sourceId, instrumentId: 'BTCUSDT' }], range: { from: utc(start - 60000), to: utc(start) } }],
  ]) {
    const from = f.clock.now();
    f.overrides.push({ match: row => row.path === path, run: () => { f.clock.advance(23); return response([]); } });
    const result = await source[method](b, query, { limit: 10 });
    assert.deepEqual(result.metadata.meta.samplingWindow, { from, to: f.clock.now() });
    assert.ok(f.clock.now() >= from + 23);
    assert.equal(result.metadata.meta.observedAt, f.clock.now());
  }
});

test('all 28 native bindings and standard services match the package declaration', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/binance/capabilities.json', import.meta.url), 'utf8'));
  assert.deepEqual(createCapabilities({ context: { storageRoot: 'unused' } }).map(row => row.name).sort(), manifest.capabilities.map(row => row.binding.name).sort());
  assert.equal(manifest.capabilities.length, 28);
  assert.equal(manifest.sources[0].contract, 'sesame.market/1'); assert.equal(manifest.sources[1].contract, 'sesame.account/1');
  assert.equal(manifest.sources[1].operations.queryPositions, undefined);
  assert.equal(manifest.services[0].contract, 'sesame.execution-adapter/1');
  for (const cap of manifest.capabilities) {
    assert.equal(cap.inputSchema.type, 'object'); assert.equal(cap.outputSchema.type, 'object');
    assert.ok(cap.usage.purpose && cap.usage.inputs && cap.usage.outputs);
    if (cap.id.startsWith('market_')) assert.equal(cap.configurationRequirements?.some(row => row.field === 'api_key' || row.field === 'api_secret') ?? false, false);
    if (cap.id.startsWith('binance_execution_') || cap.id === 'binance_account') assert.deepEqual(cap.configurationRequirements.filter(row => !row.optional).map(row => row.field), ['api_key', 'api_secret']);
  }
  assert.deepEqual(manifest.configuration.fields.filter(row => row.schema.writeOnly).map(row => row.id), ['api_key', 'api_secret']);
});
test('account source exposes exact multi-asset balances without invented positions or equity', async t => {
  const f = await fixture(t), source = f.service.account, b = await source.bind({});
  const listed = await source.list(b, {}, { limit: 10 }); assert.equal(listed.items.length, 1); assert.equal(listed.items[0].mode, 'demo');
  const result = await source.snapshot(b, { account: listed.items[0].ref }), item = result.items[0];
  assert.equal(item.balance.status, 'unknown'); assert.equal(item.equity.status, 'unknown'); assert.equal(item.margin.used.status, 'not_applicable');
  assert.equal(item.native.balances[0].free, '1.00000000'); assert.equal(item.native.balances[0].asset, 'BTC');
  f.env.BINANCE_ENVIRONMENT = 'production';
  await assert.rejects(source.snapshot(b, { account: listed.items[0].ref }), { code: 'CONNECTION_CHANGED' });
  assert.doesNotThrow(() => source.unbind(b));
});
test('normalized order and fill rows retain units, UTC and exact commission asset', async t => {
  const f = await fixture(t), placed = await f.service.execution.order(f.order()), source = f.service.account, b = await source.bind({}), ref = source.ref(b.account);
  const orders = await source.orders(b, { account: ref, scope: 'working' }, { limit: 10 });
  assert.equal(orders.items[0].quantity.unit, 'BTC'); assert.equal(orders.items[0].quantity.value, '0.00100'); assert.equal(orders.items[0].positionEffect.status, 'not_applicable');
  assert.equal(orders.items[0].status, 'working'); assert.equal(orders.items[0].createdAt.basis, 'utc');
  f.overrides.push({ match: row => row.path === '/api/v3/myTrades', run: () => response([{ id: 99, orderId: placed.raw.result.orderId, time: f.clock.now() - 1000, isBuyer: true, qty: '0.00012345', price: '50000.12345678', commission: '0.00000001', commissionAsset: 'BNB' }]) });
  const fills = await source.fills(b, { account: ref, instruments: [{ sourceId: b.sourceId, instrumentId: 'BTCUSDT' }], range: { from: utc(f.clock.now() - 60000), to: utc(f.clock.now() + 1) } }, { limit: 10 });
  assert.equal(fills.items[0].price, '50000.12345678'); assert.deepEqual(fills.items[0].fees.value, [{ value: '0.00000001', currency: 'BNB' }]);
});
test('historical queries require a bounded explicit symbol and mark upstream window truncation', async t => {
  const f = await fixture(t), source = f.service.account, b = await source.bind({}), ref = source.ref(b.account), range = { from: utc(f.clock.now() - 60000), to: utc(f.clock.now() + 1) };
  await assert.rejects(source.fills(b, { account: ref, range }, { limit: 10 }), /explicit Binance instruments/);
  f.overrides.push({ match: row => row.path === '/api/v3/myTrades', run: () => response(Array.from({ length: 1000 }, (_, id) => ({ id, orderId: id + 1, time: f.clock.now() - 1000, isBuyer: true, qty: '0.001', price: '50000', commission: '0.000001', commissionAsset: 'BTC' }))) });
  const read = await source.fills(b, { account: ref, range, instruments: [{ sourceId: b.sourceId, instrumentId: 'BTCUSDT' }] }, { limit: 1000 });
  assert.equal(read.items.length, 1000); assert.equal(read.metadata.truncated, true); assert.equal(read.metadata.coverage.complete, false);
});
test('numeric identifiers outside safe integer range are rejected instead of rounded', async t => {
  const f = await fixture(t), source = f.service.account, symbol = await f.service.market.row('testnet', 'BTCUSDT');
  assert.throws(() => source.fill('testnet', { connectionId: 'binance:testnet:spot', accountId: '1' }, { id: Number.MAX_SAFE_INTEGER + 1, orderId: 1, time: f.clock.now(), qty: '1', price: '1', commission: '0', commissionAsset: 'USDT' }, symbol), /not exact/);
});
