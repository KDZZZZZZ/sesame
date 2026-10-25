import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, spec, utc, SYMBOL, FakeSocket } from './binance-fixture.mjs';
import { Market } from '../packages/binance/src/market.js';

const query = (binding, from, to, extra = {}) => ({ instrument: { sourceId: binding.sourceId, instrumentId: 'BTCUSDT' }, spec, range: { from: utc(from), to: utc(to) }, includeForming: true, direction: 'forward', ...extra });
test('public directory, exact filters and environment-specific references', async t => {
  const f = await fixture(t, { publicOnly: true }), market = f.service.market;
  const prod = market.bind({ configuration: { environment: 'production' } }), demo = market.bind({ configuration: { environment: 'testnet' } });
  const found = await market.search(prod, { query: 'BTC/USDT' }, { limit: 5 });
  assert.equal(found.items[0].ref.sourceId, 'binance:production:spot');
  const desc = (await market.describe(prod, { instrument: found.items[0].ref })).items[0];
  assert.equal(desc.price.tickSize.value, '0.01'); assert.equal(desc.quantity.step.value, '0.00001000'); assert.equal(desc.timeBasis.kind, 'utc');
  await assert.rejects(market.describe(demo, { instrument: found.items[0].ref }), { code: 'INSTRUMENT_MISMATCH' });
  assert.throws(() => market.bind({ connection: { id: prod.connection.id, revision: 'wrong' } }), { code: 'CONNECTION_CHANGED' });
});
test('history prefetch exceeds viewport and serves neighboring ranges from exact decimal cache', async t => {
  const f = await fixture(t), market = f.service.market, b = market.bind({}), end = Math.floor(f.clock.now() / 60000) * 60000 - 20 * 60000, from = end - 10 * 60000;
  const first = await market.queryBars(b, query(b, from, end), { limit: 100 });
  assert.equal(first.items.length, 10); assert.equal(first.items[0].volume.real.value.value, '1.23456789');
  const calls = f.calls.filter(row => row.path === '/api/v3/klines'); assert.ok(Number(calls[0].params.startTime) < from); assert.ok(Number(calls[0].params.endTime) > end);
  const neighboring = await market.queryBars(b, query(b, from - 5 * 60000, end + 5 * 60000), { limit: 100 });
  assert.equal(neighboring.items.length, 20); assert.equal(neighboring.metadata.cache.hit, true);
  assert.equal(f.calls.filter(row => row.path === '/api/v3/klines').length, calls.length);
});
test('unaligned and pre-listing cache coverage is retained instead of repeatedly reloading', async t => {
  const f = await fixture(t), market = f.service.market, b = market.bind({}), end = f.clock.now() - 50 * 60000;
  const request = query(b, end - 10 * 60000 + 12345, end);
  const first = await market.queryBars(b, request, { limit: 100 }); const count = f.calls.length;
  const second = await market.queryBars(b, request, { limit: 100 });
  assert.deepEqual(second.items, first.items); assert.equal(f.calls.length, count);
  assert.equal(second.metadata.cache.hit, true);
});
test('an observed empty history window is cached without fabricating candles', async t => {
  const f = await fixture(t), market = f.service.market, b = market.bind({}), end = f.clock.now() - 500 * 60000;
  f.overrides.push({ match: row => row.path === '/api/v3/klines', run: () => response([]) });
  const request = query(b, end - 5 * 60000, end), first = await market.queryBars(b, request, { limit: 100 });
  const count = f.calls.length, second = await market.queryBars(b, request, { limit: 100 });
  assert.deepEqual(first.items, []); assert.deepEqual(second.items, []); assert.equal(f.calls.length, count); assert.equal(second.metadata.cache.hit, true);
});
test('persistent history cache stays within 16 series across market lifetimes', async t => {
  const f = await fixture(t), first = f.service.market, records = first.records;
  const end = f.clock.now() - 1000 * 60000, from = end - 5 * 60000;
  for (let i = 0; i < 16; i++) {
    await first.history('testnet', { ...SYMBOL, symbol: `T${i}USDT` }, spec, from, end);
    f.clock.advance(1000);
  }
  const oldKeys = [...first.cache.keys()];
  await first.dispose();
  records.put('market-cache', 'stale-from-earlier-lifetime', { rows: [], spans: [], at: 0 });
  const reopened = new Market(first.client, records, { now: f.clock.now });
  t.after(() => reopened.dispose());
  assert.equal(records.list('market-cache').length, 16);
  assert.equal(records.get('market-cache', 'stale-from-earlier-lifetime'), undefined);
  for (let i = 16; i < 32; i++) {
    await reopened.history('testnet', { ...SYMBOL, symbol: `T${i}USDT` }, spec, from, end);
    f.clock.advance(1000);
    assert.equal(records.list('market-cache').length, 16);
  }
  assert.equal(reopened.cache.size, 16);
  assert.ok(oldKeys.every(key => records.get('market-cache', key) === undefined));
});
test('expired cache remains usable while a failed refresh does not clear candles', async t => {
  const f = await fixture(t), market = f.service.market, b = market.bind({}), end = f.clock.now() - 100 * 60000;
  const request = query(b, end - 5 * 60000, end), first = await market.queryBars(b, request, { limit: 20 });
  f.clock.advance(31 * 60000); f.overrides.push({ match: row => row.path === '/api/v3/klines', run: () => response({ code: -1003 }, 429, { 'Retry-After': '30' }) });
  const stale = await market.queryBars(b, request, { limit: 20 });
  assert.equal(stale.metadata.cache.stale, true); assert.deepEqual(stale.items, first.items);
  await Promise.allSettled(market.loads.values());
  const retained = await market.queryBars(b, request, { limit: 20 }); assert.deepEqual(retained.items, first.items);
});
test('snapshot pagination is frozen, ascending within backward pages and cursor scope checked', async t => {
  const f = await fixture(t), market = f.service.market, b = market.bind({}), end = Math.floor(f.clock.now() / 60000) * 60000 - 30 * 60000;
  const request = query(b, end - 20 * 60000, end, { direction: 'backward' });
  const first = await market.queryBars(b, request, { limit: 5 });
  assert.ok(first.nextCursor); assert.equal(first.items.length, 5); assert.ok(first.items[0].openTime.unixMs < first.items[4].openTime.unixMs);
  const second = await market.queryBars(b, request, { limit: 5, cursor: first.nextCursor }); assert.ok(second.items.at(-1).openTime.unixMs < first.items[0].openTime.unixMs);
  await assert.rejects(market.queryBars(b, { ...request, includeForming: false }, { limit: 5, cursor: first.nextCursor }), { code: 'INVALID_CURSOR' });
});
test('overlapping concurrent range loads do not overwrite each other or duplicate exact requests', async t => {
  const f = await fixture(t), market = f.service.market, b = market.bind({}), end = Math.floor(f.clock.now() / 60000) * 60000 - 1000 * 60000;
  const requests = [query(b, end - 5 * 60000, end), query(b, end - 300 * 60000, end - 295 * 60000), query(b, end - 300 * 60000, end - 295 * 60000)];
  const values = await Promise.all(requests.map(request => market.queryBars(b, request, { limit: 20 })));
  assert.ok(values.every(result => result.items.length === 5));
  assert.equal(f.calls.filter(row => row.path === '/api/v3/klines').length, 2);
});
test('source closure requires subsequent candle evidence, not elapsed local time', async t => {
  const f = await fixture(t), market = f.service.market, b = market.bind({}), end = Math.floor(f.clock.now() / 60000) * 60000;
  const first = await market.queryBars(b, query(b, end - 2 * 60000, end + 60000), { limit: 10 });
  assert.equal(first.items.at(-1).isClosed, false); assert.equal(first.items.at(-2).isClosed, true);
  f.clock.advance(10000); assert.equal(first.items.at(-1).isClosed, false);
});
test('monthly candle ends are taken from the native response', async t => {
  const f = await fixture(t), market = f.service.market;
  const start = Date.UTC(2024, 1, 1), end = Date.UTC(2024, 2, 1);
  const bar = market.bar('production', SYMBOL, { ...spec, timeframe: '1mo' }, [start, '1', '3', '1', '2', '4', end - 1, '8'], true);
  assert.equal(bar.endTime.unixMs, end); assert.equal((end - start) / 86400000, 29);
});
test('same candle topic uses one socket and unbinding one consumer keeps the other alive', async t => {
  const f = await fixture(t), market = f.service.market, streams = f.service.streams, firstBinding = market.bind({}), secondBinding = market.bind({});
  const before = FakeSocket.instances.length;
  const q = b => ({ instrument: { sourceId: b.sourceId, instrumentId: 'BTCUSDT' }, spec, tailLimit: 10, includeForming: true });
  const [a, b] = await Promise.all([streams.bars(firstBinding, q(firstBinding)), streams.bars(secondBinding, q(secondBinding))]);
  assert.equal(FakeSocket.instances.length - before, 1); const socket = f.latestSocket();
  const iterA = a.events[Symbol.asyncIterator](), iterB = b.events[Symbol.asyncIterator]();
  assert.equal((await iterA.next()).value.type, 'snapshot'); assert.equal((await iterB.next()).value.type, 'snapshot');
  await streams.unbind(firstBinding); assert.equal(socket.closed, false);
  const open = Math.floor(f.clock.now() / 60000) * 60000;
  socket.message({ e: 'kline', s: 'BTCUSDT', k: { i: '1m', t: open, T: open + 59999, o: '50000', h: '50002', l: '49999', c: '50001', v: '1.2', q: '60001.2', x: false } });
  assert.equal((await iterB.next()).value.type, 'bars.upsert'); await b.close(); assert.equal(socket.closed, true); assert.equal(streams.connections.size, 0);
});
test('stream disconnect emits a gap and immediately reattaching respects backoff', async t => {
  const f = await fixture(t), b = f.service.market.bind({}), q = { instrument: { sourceId: b.sourceId, instrumentId: 'BTCUSDT' }, spec, tailLimit: 5 };
  const subscription = await f.service.streams.bars(b, q), iterator = subscription.events[Symbol.asyncIterator](); await iterator.next();
  f.latestSocket().close(); assert.equal((await iterator.next()).value.type, 'stream.gap'); assert.equal((await iterator.next()).done, true);
  await assert.rejects(f.service.streams.bars(b, q), { code: 'RATE_LIMITED' });
  assert.equal(f.service.streams.consumers.size, 0);
});
test('subscription cancellation cleans listeners and the last socket', async t => {
  const f = await fixture(t), b = f.service.market.bind({}), abort = new AbortController();
  const subscription = await f.service.streams.quotes(b, { instruments: [{ sourceId: b.sourceId, instrumentId: 'BTCUSDT' }] }, abort.signal);
  const iterator = subscription.events[Symbol.asyncIterator](); const first = (await iterator.next()).value;
  assert.equal(first.snapshot.quotes[0].bid.value, '49999.99'); abort.abort();
  assert.equal((await iterator.next()).done, true); assert.equal(f.service.streams.connections.size, 0);
});
test('already-canceled quote initialization with a cached symbol never opens a socket', async t => {
  const f = await fixture(t), b = f.service.market.bind({}), abort = new AbortController();
  await f.service.market.row('testnet', 'BTCUSDT'); abort.abort(new Error('user cancelled'));
  const before = FakeSocket.instances.length;
  await assert.rejects(f.service.streams.quotes(b, { instruments: [{ sourceId: b.sourceId, instrumentId: 'BTCUSDT' }] }, abort.signal), /cancelled/);
  assert.equal(FakeSocket.instances.length, before); assert.equal(f.service.streams.connections.size, 0); assert.equal(f.service.streams.consumers.size, 0);
});
test('quote transport failure during first snapshot releases its socket and consumer', async t => {
  const f = await fixture(t), b = f.service.market.bind({});
  f.overrides.push({ match: row => row.path === '/api/v3/ticker/24hr', run: () => { f.latestSocket().close(); return response({ bidPrice: '49999', askPrice: '50000', lastPrice: '50000', bidQty: '1', askQty: '1', closeTime: f.clock.now() }); } });
  await assert.rejects(f.service.streams.quotes(b, { instruments: [{ sourceId: b.sourceId, instrumentId: 'BTCUSDT' }, { sourceId: b.sourceId, instrumentId: 'BTCUSDT' }] }), { code: 'SOURCE_UNAVAILABLE' });
  assert.equal(f.service.streams.connections.size, 0); assert.equal(f.service.streams.consumers.size, 0); assert.equal(f.latestSocket().closed, true);
});
