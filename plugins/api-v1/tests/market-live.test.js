import { mt5Import, mt5Path, hostForStore } from './mt5-host.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from './mt5-host.js';
const { Market } = await mt5Import('market.js');
const { LiveMarket } = await mt5Import('live.js');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('batch subscriptions validate before starting and tag independent chart channels while sharing collectors', async () => {
  const app = await fixture();
  try {
    const { mt5, market } = app, live = mt5.live = new LiveMarket(mt5, { intervalMs: 25 });
    const events = [], input = { symbol: 'EURUSD', period: 'M1', from: 1, to: 1000 };
    market.query = async input => market.bars(input);
    market.latest = async input => ({ server: 'Demo', symbol: input.symbol, period: input.period, bars: [], updated_at: new Date().toISOString() });
    assert.throws(() => live.subscribeBatch([input, { ...input, period: 'bad' }], () => {})); assert.equal(live.entries.size, 0);
    assert.throws(() => live.subscribeBatch(Array(34).fill(input), () => {}));
    const stop = live.subscribeBatch([input, input, { ...input, symbol: 'GBPUSD' }], event => events.push(event));
    await pause(50); assert.equal(live.entries.size, 2);
    for (let channel = 0; channel < 3; channel++) assert.ok(events.some(e => e.channel === channel && e.type === 'snapshot'));
    stop(); assert.equal(live.entries.size, 0);
  } finally { await app.close(); }
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'market-live-')), store = new Store(directory); await mkdir(join(directory, 'mt5'));
  const mt5 = { storage: hostForStore(store).storage, host: hostForStore(store), official: { config: { account: { server: 'Demo', login: '1' } }, redact: value => value, access: () => ({ blocked_reason: null }) } };
  const market = mt5.market = new Market(mt5); market.connected = async () => ({ scope: market.scope() });
  return { mt5, market, store, async close() { await mt5.live?.close(); await market.close(); store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('visible subscribers share a 1000ms collector; quote events never enter the durable log and disconnect stops polling', async () => {
  const app = await fixture();
  try {
    const { market, store, mt5 } = app, live = mt5.live = new LiveMarket(mt5);
    let calls = 0, active = 0, maximum = 0;
    const from = Math.floor(Date.now() / 60000) * 60;
    market.query = async input => market.bars(input);
    market.latest = async input => {
      calls++; maximum = Math.max(maximum, ++active); await pause(20); active--;
      return { server: 'Demo', symbol: input.symbol, period: input.period, updated_at: new Date().toISOString(), time_basis: 'broker_server_unspecified', bars: [
        { time: from - 60, open: 1, high: 2, low: 1, close: 1.5, volume: 1 },
        { time: from, open: 1, high: 2, low: 1, close: 1 + calls / 100, volume: calls },
      ] };
    };
    const one = [], two = [], input = { symbol: 'EURUSD', period: 'M1', from: from - 600, to: from + 600 };
    const stopOne = live.subscribe(input, event => one.push(event)), stopTwo = live.subscribe(input, event => two.push(event));
    await pause(2150);
    assert.equal(live.intervalMs, 1000); assert.ok(calls >= 3 && calls <= 4, `one shared collector, ${calls} upstream reads`); assert.equal(maximum, 1);
    assert.ok(one.filter(e => e.type === 'bars').length >= 3); assert.equal(one.filter(e => e.type === 'bars').length, two.filter(e => e.type === 'bars').length);
    assert.equal(store.cursor(), '0'); assert.equal(store.list('dataset').length, 0);
    assert.equal(market.bars(input).bars.length, 1, 'only the completed candle is persisted');
    stopOne(); assert.equal(live.entries.size, 1); stopTwo(); const stopped = calls;
    await pause(1100); assert.equal(calls, stopped); assert.equal(live.entries.size, 0);
  } finally { await app.close(); }
});

test('account changes discard an in-flight old feed and never publish it under the new account', async () => {
  const app = await fixture();
  try {
    const { mt5, market } = app, live = mt5.live = new LiveMarket(mt5, { intervalMs: 20 });
    market.query = async input => market.bars(input);
    let release; market.latest = () => new Promise(resolve => { release = resolve; });
    const events = [], stop = live.subscribe({ symbol: 'EURUSD', period: 'M1', from: 1, to: 1000 }, event => events.push(event));
    await pause(10); mt5.official.config.account.login = '2';
    release({ bars: [{ time: 900, close: 123 }] }); await pause(40);
    assert.equal(events.filter(e => e.type === 'bars').length, 0);
    assert.ok(events.some(e => e.type === 'status' && e.data.state === 'scope_changed')); stop();
  } finally { await app.close(); }
});

test('live values arrive while the initial history request is still pending', async () => {
  const app = await fixture();
  let finishHistory;
  try {
    const { mt5, market } = app, live = mt5.live = new LiveMarket(mt5, { intervalMs: 25 });
    market.query = () => new Promise(resolve => { finishHistory = resolve; });
    market.latest = async () => ({ server: 'Demo', symbol: 'EURUSD', period: 'M1', bars: [{ time: 900, open: 1, high: 2, low: 1, close: 1.5, volume: 1 }], updated_at: new Date().toISOString() });
    const events = [], stop = live.subscribe({ symbol: 'EURUSD', period: 'M1', from: 1, to: 1000 }, event => events.push(event));
    await pause(50);
    assert.ok(events.some(e => e.type === 'bars'), 'a cold download must not block the live chart');
    finishHistory(market.bars({ symbol: 'EURUSD', period: 'M1', from: 1, to: 1000 })); stop();
  } finally { finishHistory?.({ bars: [] }); await app.close(); }
});

test('automatic cache eviction invalidates coverage but preserves the ledger and frozen evidence', async () => {
  const app = await fixture();
  try {
    const { market, store } = app, range = { symbol: 'EURUSD', period: 'M1', from: 1000, to: 1060 };
    market.read = async () => ({ ok: true, history: [{ time: 1000, open: 1, high: 2, low: 1, close: 1.5, tick_volume: 10 }] });
    await market.sync(range); store.put('dataset', { id: 'evidence', rows: market.bars(range).bars });
    market.db.prepare('INSERT INTO deals VALUES(?,?,?,?,?)').run('deal', market.scope().key, 'EURUSD', 1000, JSON.stringify({ id: 'deal' }));
    market.db.exec('UPDATE cache_blocks SET accessed=0'); market.cache.trim();
    assert.equal(market.bars(range).bars.length, 0); assert.equal(market.db.prepare('SELECT COUNT(*) n FROM ranges').get().n, 0);
    assert.equal(market.trades(range).items.length, 1); assert.equal(store.get('dataset', 'evidence').rows[0].close, 1.5);
    await market.query(range); assert.equal(market.bars(range).bars.length, 1, 'evicted history is fetched transparently');
  } finally { await app.close(); }
});

test('capacity pressure evicts old history in the same series while protecting the active download range', async () => {
  const app = await fixture();
  try {
    const { market } = app, { db } = market, put = db.prepare('INSERT INTO bars VALUES(?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    for (let block = 0; block < 8; block++) {
      const start = 1_000_000 + block * 4000 * 60, end = start + 4000 * 60;
      for (let time = start; time < end; time += 60) put.run('Demo', 'EURUSD', 'M1', time, 1.12345, 1.23456, 1.01234, 1.12345, 100);
      market.cache.touch({ server: 'Demo', symbol: 'EURUSD', period: 'M1', start, end });
      market.recordRange('Demo', 'EURUSD', 'M1', start, end, new Date().toISOString());
    }
    db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
    market.cache.maxBytes = 2 * 1024 * 1024;
    assert.ok(market.cache.stats().bytes > market.cache.maxBytes, 'fixture must exert actual disk pressure');
    const active = { from: 1_000_000 + 7 * 4000 * 60, to: 1_000_000 + 8 * 4000 * 60 };
    market.activeRanges.set('Demo:EURUSD:M1', active);
    const result = market.cache.trim(128 * 1024);
    assert.equal(result.writable, true); assert.ok(result.bytes + 128 * 1024 <= result.max_bytes);
    assert.equal(market.bars({ symbol: 'EURUSD', period: 'M1', ...active }).bars.length, 4000);
    assert.equal(market.bars({ symbol: 'EURUSD', period: 'M1', from: 1_000_000, to: 1_000_000 + 4000 * 60 }).bars.length, 0);
  } finally { await app.close(); }
});
