import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Market, brokerTime } from '../backend/market.js';
import { MT5MarketProvider } from '../backend/providers.js';
import { providerCall } from '../backend/sources.js';
import { sourceIdentity } from '../backend/contract-mapping.js';

const server = 'Fixture-Demo', observedAt = Date.parse('2026-10-17T06:00:00Z');
const rows = [1, 2, 3].map(hour => ({ time: `2026-10-16T0${hour}:00:00`,
  open: '2000.10', high: '2002.00', low: '1999.00', close: '2001.25', tick_volume: '10' }));
const range = { from: { basis: 'wall', authority: server, value: '2026-10-16T00:00:00' },
  to: { basis: 'wall', authority: server, value: '2026-10-17T00:00:00' } };
const spec = { timeframe: '1h', priceBasis: 'bid', adjustment: 'none', session: 'all', calendarRevision: { status: 'unknown' } };
const local = { symbol: 'XAUUSD', period: 'H1', from: brokerTime(range.from.value), to: brokerTime(range.to.value) };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mt5-offline-cache-'));
  await mkdir(join(directory, 'mt5'));
  const calls = [], config = { version: 1, account: { server, login: '42' }, servers: { terminal: { url: 'http://127.0.0.1:22346/mcp' } } };
  const mt5 = { storage: { directory }, official: { config, redact: value => value } };
  const market = mt5.market = new Market(mt5);
  market.read = async tool => {
    calls.push(tool);
    assert.equal(tool, 'get_trading_account_info', 'offline queries must not request live history');
    return { account: { ...config.account }, terminal: { server_connected: false } };
  };
  market.cacheNativeBars(server, 'XAUUSD', 'H1', rows, observedAt);
  market.cacheNativeBars('Other-Demo', 'XAUUSD', 'H1', [rows[0]], observedAt - 1000);
  const provider = new MT5MarketProvider(mt5), service = { providers: { market: provider } };
  t.after(async () => { provider.dispose(); await market.close(); await rm(directory, { recursive: true, force: true }); });
  const binding = await providerCall(service, 'market', 'bind', { binding: {} });
  const invoke = (operation, query = {}, selected = binding) => providerCall(service, 'market', operation, { binding: selected, query });
  return { mt5, market, config, calls, provider, service, binding, invoke };
}

test('typed-only history is discoverable and locally readable with bounded, deduplicated pagination', async t => {
  const f = await fixture(t);
  assert.equal(f.market.db.prepare('SELECT COUNT(*) n FROM bars').get().n, 0);
  const item = f.market.inventory().items.find(row => row.server === server && row.symbol === 'XAUUSD');
  assert.deepEqual(item, { server, symbol: 'XAUUSD', period: 'H1', bar_count: 3,
    first_time: brokerTime(rows[0].time), last_time: brokerTime(rows[2].time), updated_at: new Date(observedAt).toISOString() });
  const first = f.market.bars({ ...local, limit: 2 });
  assert.equal(first.bars.length, 2); assert.equal(first.has_more, true);
  assert.equal(first.next_before, brokerTime(rows[1].time));
  assert.equal(first.updated_at, new Date(observedAt).toISOString());
  assert.equal(first.time_basis, 'broker_server_unspecified');
  assert.equal(first.freshness, 'stale');
  assert.deepEqual(first.bars[0], { time: brokerTime(rows[1].time), open: 2000.10, high: 2002, low: 1999, close: 2001.25, volume: 10 });
  const older = f.market.bars({ ...local, to: first.next_before, limit: 2 });
  assert.deepEqual(older.bars.map(row => row.time), [brokerTime(rows[0].time)]);
  assert.equal(older.has_more, false);
  assert.equal(f.calls.length, 0, 'local inventory and bars must not probe the broker');

  f.market.db.prepare('INSERT INTO bars VALUES(?,?,?,?,?,?,?,?,?)').run(server, 'XAUUSD', 'H1', brokerTime(rows[1].time), 1, 2, 0, 1, 2);
  assert.equal(f.market.inventory().items.find(row => row.server === server).bar_count, 3, 'the same observation in both stores is counted once');
  const overlapping = f.market.bars({ ...local, limit: 2, offset: 1 }).bars;
  assert.deepEqual(overlapping.map(row => row.time), [brokerTime(rows[0].time), brokerTime(rows[1].time)]);
  assert.equal(overlapping[1].open, 1, 'adding typed history does not replace an existing local observation');
});

test('offline symbol discovery returns real cached references and the standard history path retains stale evidence', async t => {
  const f = await fixture(t), symbols = await f.market.symbols();
  assert.equal(symbols.cached, true);
  assert.deepEqual(symbols.items.map(row => row.symbol), ['XAUUSD']);
  const found = await f.invoke('searchInstruments', { query: 'XAUUSD' });
  assert.equal(found.items.length, 1);
  const instrument = found.items[0].ref;
  assert.deepEqual(instrument, { sourceId: sourceIdentity(server), instrumentId: 'XAUUSD' });
  assert.equal(found.metadata.meta.freshness, 'stale');
  assert.equal(found.metadata.meta.observedAt, observedAt);
  assert.ok(found.metadata.meta.warnings.some(row => row.code === 'OFFLINE_CACHE'));
  const described = await f.invoke('describeInstrument', { instrument });
  assert.deepEqual(described.items[0].ref, instrument);
  assert.equal(described.items[0].price.tickSize.status, 'unknown');
  assert.ok(described.metadata.meta.warnings.some(row => row.code === 'DISPLAY_PRECISION_UNKNOWN'));
  assert.deepEqual(described.metadata.meta.sourceTime, { basis: 'wall', authority: server, value: rows.at(-1).time });
  assert.equal(described.metadata.meta.freshness, 'stale');
  assert.equal(described.metadata.meta.observedAt, observedAt);
  assert.ok(described.metadata.meta.warnings.some(row => row.code === 'CACHED_SOURCE_TIME'));
  assert.ok(!f.calls.includes('get_time_information'), 'an offline description must not add a blocking clock probe');

  const historical = await f.invoke('queryBars', { instrument, spec, range, includeForming: true });
  assert.equal(historical.items.length, 3);
  assert.deepEqual(historical.items.map(row => row.isClosed), [true, true, false]);
  assert.equal(historical.items[0].open, '2000.10', 'the standard path retains native decimal text');
  assert.equal(historical.items[0].openTime.basis, 'wall');
  assert.equal(historical.items[0].openTime.authority, server);
  assert.equal(historical.metadata.meta.freshness, 'stale');
  assert.equal(historical.metadata.meta.observedAt, observedAt);
  assert.equal(historical.metadata.coverage.complete, false);
  assert.ok(historical.metadata.meta.warnings.some(row => row.code === 'OFFLINE_CACHE'));
  const anchoredRange = { from: range.from, to: { ...described.metadata.meta.sourceTime, value: '2026-10-16T03:00:01' } };
  const anchored = await f.invoke('queryBars', { instrument, spec, range: anchoredRange, includeForming: true });
  assert.deepEqual(anchored.items.map(row => row.openTime.value), rows.map(row => row.time), 'the half-open range includes the observed opening time without adding future bars');
  assert.equal(anchored.items.at(-1).isClosed, false);
  assert.equal(anchored.metadata.coverage.complete, false);
  const closed = await f.invoke('queryBars', { instrument, spec, range, includeForming: false });
  assert.equal(closed.items.length, 2);
  await assert.rejects(f.invoke('subscribeBars', { instrument, spec, tailLimit: 2 }), { code: 'SOURCE_UNAVAILABLE' });
});

for (const change of ['server', 'login', 'endpoint']) test(`offline cache cannot revive a binding after ${change} changes`, async t => {
  const f = await fixture(t);
  if (change === 'endpoint') f.config.servers.terminal.url = 'http://127.0.0.1:22347/mcp';
  else f.config.account[change] = change === 'server' ? 'Other-Demo' : '84';
  await assert.rejects(f.invoke('searchInstruments', { query: 'XAUUSD' }), { code: 'CONNECTION_CHANGED' });
  await assert.rejects(f.invoke('queryBars', { instrument: { sourceId: sourceIdentity(server), instrumentId: 'XAUUSD' }, spec, range }), { code: 'CONNECTION_CHANGED' });
  await assert.rejects(providerCall(f.service, 'market', 'bind', { binding: { connection: f.binding.connection } }), { code: 'CONNECTION_CHANGED' });
  const current = await providerCall(f.service, 'market', 'bind', { binding: {} });
  const found = await f.invoke('searchInstruments', { query: 'XAUUSD' }, current);
  const instrument = found.items[0].ref;
  assert.equal(instrument.sourceId, sourceIdentity(f.config.account.server));
  const currentRange = { from: { ...range.from, authority: f.config.account.server }, to: { ...range.to, authority: f.config.account.server } };
  const history = await f.invoke('queryBars', { instrument, spec, range: currentRange, includeForming: true }, current);
  assert.equal(history.items.length, change === 'server' ? 1 : 3, 'a new same-server binding may reuse public broker history');
});

test('explicit invalid revisions and mismatched instrument sources never fall back to another cache', async t => {
  const f = await fixture(t);
  await assert.rejects(providerCall(f.service, 'market', 'bind', { binding: { connection: { ...f.binding.connection, revision: 'invalid-revision' } } }), { code: 'CONNECTION_CHANGED' });
  await assert.rejects(f.invoke('queryBars', { instrument: { sourceId: sourceIdentity('Other-Demo'), instrumentId: 'XAUUSD' }, spec, range }), { code: 'INSTRUMENT_MISMATCH' });
});

test('offline native account mismatch and permission failures cannot be hidden by retained cache', async t => {
  const f = await fixture(t);
  f.market.read = async () => ({ account: { server, login: '99' }, terminal: { server_connected: false } });
  const query = { instrument: { sourceId: sourceIdentity(server), instrumentId: 'XAUUSD' }, spec, range, includeForming: true };
  await assert.rejects(f.invoke('searchInstruments', { query: 'XAUUSD' }), { code: 'ACCOUNT_MISMATCH' });
  await assert.rejects(f.invoke('queryBars', query), { code: 'ACCOUNT_MISMATCH' });
  f.provider.reads.clear();
  f.market.read = async () => { throw Object.assign(new Error('read denied'), { code: 'mt5_permission_denied' }); };
  await assert.rejects(f.invoke('searchInstruments', { query: 'XAUUSD' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.invoke('queryBars', query), { code: 'FORBIDDEN' });
  const bug = new TypeError('unexpected adapter failure');
  f.market.read = async () => { throw bug; };
  await assert.rejects(f.invoke('searchInstruments', { query: 'XAUUSD' }), error => error === bug);
  await assert.rejects(f.invoke('queryBars', query), error => error === bug);
});

test('an account change while the offline probe is pending prevents fallback under the old binding', async t => {
  const f = await fixture(t);
  let finish;
  f.market.read = () => new Promise(resolve => { finish = resolve; });
  const pending = f.invoke('searchInstruments', { query: 'XAUUSD' });
  f.config.account.login = '84';
  finish({ account: { server, login: '42' }, terminal: { server_connected: false } });
  await assert.rejects(pending, { code: 'CONNECTION_CHANGED' });
});

test('unknown cached symbols and uncovered history do not fabricate results', async t => {
  const f = await fixture(t);
  const search = await f.invoke('searchInstruments', { query: 'NOT-CACHED' });
  assert.equal(search.items.length, 0);
  const instrument = { sourceId: sourceIdentity(server), instrumentId: 'NOT-CACHED' };
  await assert.rejects(f.invoke('describeInstrument', { instrument }), { code: 'NOT_FOUND' });
  await assert.rejects(f.invoke('queryBars', { instrument, spec, range }), { code: 'SOURCE_UNAVAILABLE' });
});

test('the offline source clock uses only the exact broker and instrument typed observations', async t => {
  const f = await fixture(t), instrument = { sourceId: sourceIdentity(server), instrumentId: 'XAUUSD' };
  const newer = { ...rows[0], time: '2026-10-19T09:00:00' };
  f.market.cacheNativeBars('Other-Demo', 'XAUUSD', 'H1', [newer], observedAt + 1000);
  f.market.cacheNativeBars(server, 'OTHER', 'H1', [newer], observedAt + 1000);
  f.market.db.prepare('INSERT INTO bars VALUES(?,?,?,?,?,?,?,?,?)').run(server, 'XAUUSD', 'H1', brokerTime(newer.time), 1, 2, 0, 1, 2);
  const described = await f.invoke('describeInstrument', { instrument });
  assert.deepEqual(described.metadata.meta.sourceTime, { basis: 'wall', authority: server, value: rows.at(-1).time });
  f.market.db.prepare('DELETE FROM contract_bars WHERE server=? AND symbol=?').run(server, 'XAUUSD');
  const unknown = await f.invoke('describeInstrument', { instrument });
  assert.equal(unknown.metadata.meta.sourceTime, undefined, 'legacy data and another binding are not an implicit wall-clock anchor');
  assert.ok(!unknown.metadata.meta.warnings.some(row => row.code === 'CACHED_SOURCE_TIME'));
  assert.equal(unknown.metadata.meta.freshness, 'stale');
  assert.ok(!f.calls.includes('get_time_information'));
});

function useOnlineClock(f, readClock) {
  f.provider.reads.clear();
  f.market.read = async (tool, _args, signal) => {
    f.calls.push(tool);
    if (tool === 'get_trading_account_info') return { account: { ...f.config.account }, terminal: { server_connected: true } };
    if (tool === 'get_marketwatch_symbols') return { symbols: [{ symbol: 'XAUUSD', digits: 2 }] };
    if (tool === 'get_time_information') return readClock(signal);
    throw Error(`Unexpected fixture read: ${tool}`);
  };
}

test('an online description prefers actual trade-server time and never infers it from UTC/local fields', async t => {
  const f = await fixture(t), instrument = { sourceId: sourceIdentity(server), instrumentId: 'XAUUSD' };
  useOnlineClock(f, () => ({ trade_server_last_known_time: '2026-10-20T12:34:56', utc_time: '2026-10-20T09:34:56Z', local_time: '2026-10-20T05:34:56' }));
  const live = await f.invoke('describeInstrument', { instrument });
  assert.deepEqual(live.metadata.meta.sourceTime, { basis: 'wall', authority: server, value: '2026-10-20T12:34:56' });
  assert.equal(live.metadata.meta.freshness, 'live');
  assert.ok(!live.metadata.meta.warnings.some(row => row.code === 'CACHED_SOURCE_TIME'));
  useOnlineClock(f, () => ({ utc_time: '2026-10-20T09:34:56Z', local_time: '2026-10-20T05:34:56' }));
  const cached = await f.invoke('describeInstrument', { instrument });
  assert.deepEqual(cached.metadata.meta.sourceTime, { basis: 'wall', authority: server, value: rows.at(-1).time });
  assert.equal(cached.metadata.meta.freshness, 'stale');
  assert.equal(cached.metadata.meta.observedAt, observedAt);
  f.market.db.prepare('DELETE FROM contract_bars WHERE server=? AND symbol=?').run(server, 'XAUUSD');
  const unknown = await f.invoke('describeInstrument', { instrument });
  assert.equal(unknown.metadata.meta.sourceTime, undefined);
});

for (const code of ['FORBIDDEN', 'AUTH_REQUIRED', 'ACCOUNT_MISMATCH', 'CONNECTION_CHANGED']) test(`a source-time probe cannot conceal ${code} behind a cached anchor`, async t => {
  const f = await fixture(t), cause = Object.assign(new Error('Fixture clock probe failed'), { code });
  useOnlineClock(f, () => { throw cause; });
  await assert.rejects(f.invoke('describeInstrument', { instrument: { sourceId: sourceIdentity(server), instrumentId: 'XAUUSD' } }), error => error === cause);
});

test('a cancelled source-time probe cannot return the retained description', async t => {
  const f = await fixture(t), controller = new AbortController();
  useOnlineClock(f, () => { controller.abort(); return { trade_server_last_known_time: rows.at(-1).time }; });
  await assert.rejects(providerCall(f.service, 'market', 'describeInstrument', {
    binding: f.binding, query: { instrument: { sourceId: sourceIdentity(server), instrumentId: 'XAUUSD' } },
  }, controller.signal), { name: 'AbortError' });
});

test('a temporarily unavailable source clock can return a stale typed anchor without refreshing its observation time', async t => {
  const f = await fixture(t);
  useOnlineClock(f, () => { throw Object.assign(new Error('Fixture clock unavailable'), { code: 'TIMEOUT' }); });
  const described = await f.invoke('describeInstrument', { instrument: { sourceId: sourceIdentity(server), instrumentId: 'XAUUSD' } });
  assert.deepEqual(described.metadata.meta.sourceTime, { basis: 'wall', authority: server, value: rows.at(-1).time });
  assert.equal(described.metadata.meta.freshness, 'stale');
  assert.equal(described.metadata.meta.observedAt, observedAt);
  assert.ok(described.metadata.meta.warnings.some(row => row.code === 'CACHED_SOURCE_TIME'));
});
