import { randomUUID } from 'node:crypto';
import { amount, check, connection, Decimal, digest, environment, metadata, same, sourceId, unknown, utc, value } from './common.js';
import { Pages } from './pages.js';

export const intervals = Object.freeze({ '1s': 1000, '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '8h': 28800000, '12h': 43200000, '1d': 86400000, '3d': 259200000, '1w': 604800000, '1mo': 2678400000 });
const nativeInterval = timeframe => timeframe === '1mo' ? '1M' : timeframe;
const SOFT_TTL = 30 * 60000, MAX_ROWS = 12000, MAX_SERIES = 16;
export const symbolId = id => { check(typeof id === 'string' && /^[\p{L}\p{N}]{2,40}$/u.test(id), 'Use the exact Binance Spot symbol returned by the directory', 'INVALID_ARGUMENT'); return id; };
export class Market {
  constructor(client, records, { now = Date.now } = {}) {
    this.client = client; this.records = records; this.now = now; this.bindings = new Map(); this.pages = new Pages(now);
    this.catalogs = new Map(); this.catalogTasks = new Map(); this.symbols = new Map(); this.symbolTasks = new Map(); this.cache = new Map(); this.loads = new Map(); this.revisions = new Map(); this.sequence = 0n;
    this.trimCache();
  }
  bind(input = {}) {
    const env = environment(input.configuration?.environment ?? input.connection?.id?.split(':')[1] ?? this.client.config().environment);
    const identity = connection(env);
    check(!input.connection || same(input.connection, identity), 'Binance public connection identity changed', 'CONNECTION_CHANGED');
    check(!input.configuration || Object.keys(input.configuration).every(key => key === 'environment'), 'Only an explicit Binance environment is configurable for this source', 'INVALID_ARGUMENT');
    const binding = { bindingId: randomUUID(), environment: env, connection: identity, sourceId: sourceId(env), health: 'configured' };
    this.bindings.set(binding.bindingId, binding); return binding;
  }
  bound(binding, instrument) {
    const current = this.bindings.get(binding?.bindingId);
    check(current && same(current.connection, binding.connection), 'Binance source binding is closed or changed', 'CONNECTION_CHANGED');
    check(!instrument || instrument.sourceId === current.sourceId, 'Instrument belongs to another Binance environment or source', 'INSTRUMENT_MISMATCH');
    if (instrument) symbolId(instrument.instrumentId);
    return current;
  }
  async catalog(env, signal) {
    const cached = this.catalogs.get(env);
    if (cached && this.now() - cached.at < 300000) return cached;
    if (this.catalogTasks.has(env)) return this.catalogTasks.get(env);
    const task = (async () => {
      const data = await this.client.request(env, 'GET', '/api/v3/exchangeInfo', { permissions: 'SPOT', showPermissionSets: false }, { signal });
      check(Array.isArray(data.symbols) && data.symbols.length <= 20000, 'Invalid Binance symbol directory', 'INVALID_PROVIDER_DATA');
      const rows = data.symbols.filter(row => row.isSpotTradingAllowed !== false && typeof row.symbol === 'string');
      const item = { rows, at: this.now() }; this.catalogs.set(env, item); return item;
    })();
    this.catalogTasks.set(env, task); try { return await task; } finally { this.catalogTasks.delete(env); }
  }
  summary(env, row) { return { ref: { sourceId: sourceId(env), instrumentId: row.symbol }, symbol: row.symbol, name: `${row.baseAsset}/${row.quoteAsset}`, assetClass: 'crypto', venue: value(`Binance Spot ${env}`) }; }
  async row(env, symbol, signal) {
    symbolId(symbol);
    const key = `${env}:${symbol}`, catalog = this.catalogs.get(env), cached = this.symbols.get(key);
    const fresh = item => item && this.now() - item.at < 300000;
    const known = fresh(catalog) ? catalog.rows.find(row => row.symbol === symbol) : fresh(cached) ? cached.row : null;
    if (known) return known;
    if (this.symbolTasks.has(key)) return this.symbolTasks.get(key);
    const task = (async () => {
      // A chart/order already names its symbol. Fetch that symbol's complete
      // trading filters, without downloading the whole exchange directory.
      const data = await this.client.request(env, 'GET', '/api/v3/exchangeInfo', { symbol, showPermissionSets: false }, { signal });
      const row = data.symbols?.find(row => row.symbol === symbol && row.isSpotTradingAllowed !== false);
      check(row, 'Binance Spot symbol was not found', 'NOT_FOUND');
      if (this.symbols.size >= 256 && !this.symbols.has(key)) this.symbols.delete(this.symbols.keys().next().value);
      this.symbols.set(key, { row, at: this.now() }); return row;
    })();
    this.symbolTasks.set(key, task); try { return await task; } finally { this.symbolTasks.delete(key); }
  }
  async search(binding, query, page, signal) {
    const b = this.bound(binding);
    return this.pages.read(b.bindingId, query, page, async () => {
      const catalog = await this.catalog(b.environment, signal), filter = String(query.query ?? '').toLowerCase(); this.bound(binding);
      return { items: catalog.rows.map(row => this.summary(b.environment, row)).filter(row => `${row.symbol} ${row.name}`.toLowerCase().includes(filter) && (!query.assetClasses || query.assetClasses.includes('crypto')) && (!query.venues || query.venues.includes(row.venue.value))).sort((a, b) => a.symbol.localeCompare(b.symbol)), metadata: { connection: b.connection, meta: metadata(catalog.at) } };
    });
  }
  instrument(env, row) {
    const lot = row.filters?.find(f => f.filterType === 'LOT_SIZE'), price = row.filters?.find(f => f.filterType === 'PRICE_FILTER');
    const tick = price?.tickSize && Decimal.compare(amount(price.tickSize), '0') > 0 ? Decimal.normalize(price.tickSize) : null;
    return { ...this.summary(env, row), currency: value(row.quoteAsset), price: { tickSize: tick ? value(tick) : unknown('PRICE_FILTER tickSize is unavailable'), displayDecimals: tick ? (tick.split('.')[1]?.length ?? 0) : Math.min(20, row.quoteAssetPrecision ?? 8) },
      quantity: { unit: row.baseAsset, min: lot ? value(amount(lot.minQty)) : unknown('LOT_SIZE missing'), max: lot ? value(amount(lot.maxQty)) : unknown('LOT_SIZE missing'), step: lot ? value(amount(lot.stepSize)) : unknown('LOT_SIZE missing'), contractMultiplier: { status: 'not_applicable' } },
      volume: { realUnit: value(row.baseAsset), hasReal: true, hasTick: false }, timeBasis: { kind: 'utc' }, calendar: unknown('UTC continuous Spot market; no fixed calendar artifact'),
      features: { timeframes: Object.keys(intervals), priceBases: ['last'], adjustments: ['none'] }, native: { symbol: row.symbol, market: 'spot', environment: env, status: row.status, filters: row.filters, orderTypes: row.orderTypes, amendAllowed: row.amendAllowed === true } };
  }
  async describe(binding, query, signal) { const b = this.bound(binding, query.instrument), row = await this.row(b.environment, query.instrument.instrumentId, signal); this.bound(binding); return { items: [this.instrument(b.environment, row)], metadata: { connection: b.connection, meta: metadata(this.now()) } }; }
  spec(spec) { check(intervals[spec?.timeframe] && spec.priceBasis === 'last' && spec.adjustment === 'none' && ['all', 'default'].includes(spec.session) && spec.calendarRevision?.status === 'unknown', 'Binance supports unadjusted UTC Spot last-price bars', 'UNSUPPORTED_CAPABILITY'); return intervals[spec.timeframe]; }
  revise(item) {
    const key = item.id, hash = digest(item), previous = this.revisions.get(key);
    const revision = previous?.hash === hash ? previous.revision : String(++this.sequence);
    while (this.revisions.size >= 50000 && !this.revisions.has(key)) this.revisions.delete(this.revisions.keys().next().value);
    this.revisions.set(key, { hash, revision }); return { ...item, revision };
  }
  bar(env, symbol, spec, row, closed) {
    check(Array.isArray(row) && row.length >= 8 && Number.isSafeInteger(row[0]) && Number.isSafeInteger(row[6]) && row[6] >= row[0], 'Malformed Binance candle', 'INVALID_PROVIDER_DATA');
    const prices = Object.fromEntries(['open', 'high', 'low', 'close'].map((key, i) => [key, amount(row[i + 1])])), volume = amount(row[5]), turnover = amount(row[7]);
    check(Decimal.compare(prices.low, prices.high) <= 0 && ['open', 'close'].every(key => Decimal.compare(prices[key], prices.low) >= 0 && Decimal.compare(prices[key], prices.high) <= 0), 'Inconsistent Binance OHLC', 'INVALID_PROVIDER_DATA');
    const instrument = { sourceId: sourceId(env), instrumentId: symbol.symbol }, seriesId = digest([connection(env), instrument, spec]);
    return this.revise({ id: `${seriesId}:${row[0]}`, openTime: utc(row[0]), endTime: utc(row[6] + 1), ...prices, volume: { default: 'real', real: value({ value: volume, unit: symbol.baseAsset }), tick: { status: 'unsupported' } }, turnover: value({ value: turnover, currency: symbol.quoteAsset }), isClosed: closed, closure: closed ? 'source' : 'unknown' });
  }
  trimCache() {
    // Include records from earlier plugin lifetimes, not just the memory map.
    for (const id of this.records.trimByTimestamp('market-cache', MAX_SERIES)) this.cache.delete(id);
    while (this.cache.size > MAX_SERIES) this.cache.delete(this.cache.keys().next().value);
  }
  cacheEntry(key) {
    if (!this.cache.has(key)) {
      while (this.cache.size >= MAX_SERIES) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, this.records.get('market-cache', key) ?? { rows: [], spans: [], at: 0 });
    }
    return this.cache.get(key);
  }
  async load(env, symbol, spec, from, to, signal) {
    const key = digest([env, symbol.symbol, spec.timeframe]);
    // Several waiters can resume together; the first may already have started
    // another range load. Re-check the owner before reading its cache state.
    while (this.loads.has(key)) { await this.loads.get(key); signal?.throwIfAborted(); }
    const current = this.cacheEntry(key), coveredAt = Math.max(-Infinity, ...current.spans.filter(span => span.from <= from && span.to >= to).map(span => span.at ?? current.at));
    if (this.now() - coveredAt < 1000) return { ...current, at: coveredAt };
    const task = (async () => {
      const rows = []; let cursor = from;
      for (let page = 0; page < 14 && cursor < to; page++) {
        const data = await this.client.request(env, 'GET', '/api/v3/klines', { symbol: symbol.symbol, interval: nativeInterval(spec.timeframe), startTime: cursor, endTime: to - 1, limit: 1000 }, { signal });
        check(Array.isArray(data), 'Malformed Binance candles response', 'INVALID_PROVIDER_DATA');
        if (!data.length) break;
        for (const row of data) { this.bar(env, symbol, spec, row, false); check(row[0] >= cursor && row[0] < to, 'Binance returned an out-of-range candle', 'INVALID_PROVIDER_DATA'); }
        rows.push(...data); check(rows.length <= MAX_ROWS, 'Narrow the history request to at most 10000 candles', 'RESOURCE_EXHAUSTED');
        const next = data.at(-1)[6] + 1; check(next > cursor, 'Binance history pagination did not advance', 'INVALID_PROVIDER_DATA'); cursor = next;
        if (data.length < 1000) break;
      }
      check(cursor >= to || rows.length < 14000, 'History pagination budget exceeded', 'RESOURCE_EXHAUSTED');
      const merged = new Map(current.rows.map(row => [row[0], row])); for (const row of rows) merged.set(row[0], row);
      const all = [...merged.values()].sort((a, b) => a[0] - b[0]);
      const firstRequested = Math.max(0, all.findIndex(row => row[0] >= from));
      const start = all.length > MAX_ROWS ? Math.max(0, Math.min(firstRequested - 1000, all.length - MAX_ROWS)) : 0;
      const stored = { rows: all.slice(start, start + MAX_ROWS), spans: [...current.spans, { from, to, at: this.now() }].slice(-32), at: this.now() };
      // A successful unaligned/pre-listing/empty fetch still covers what was
      // requested. Clip only when actual cache eviction removed observations.
      if (all.length > MAX_ROWS && stored.rows.length) {
        const oldest = stored.rows[0][0], newest = stored.rows.at(-1)[6] + 1;
        stored.spans = stored.spans.filter(span => span.to > oldest && span.from < newest).map(span => ({ ...span, from: Math.max(span.from, oldest), to: Math.min(span.to, newest) }));
      }
      this.cache.set(key, stored); this.records.put('market-cache', key, stored); this.trimCache(); return stored;
    })();
    this.loads.set(key, task); try { return await task; } finally { if (this.loads.get(key) === task) this.loads.delete(key); }
  }
  async history(env, symbol, spec, from, to, signal) {
    const duration = this.spec(spec), key = digest([env, symbol.symbol, spec.timeframe]);
    check(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && from < to && (to - from) / duration <= 10000, 'Use ascending UTC bounds spanning at most 10000 bars', 'INVALID_ARGUMENT');
    const cached = this.cacheEntry(key), observedAt = Math.max(-Infinity, ...cached.spans.filter(span => span.from <= from && span.to >= to).map(span => span.at ?? cached.at)), covered = Number.isFinite(observedAt);
    const paddedFrom = Math.max(0, from - duration * 100), paddedTo = Math.min(to + duration * 100, this.now() + duration);
    if (covered) {
      const age = this.now() - observedAt, historical = to < this.now() - duration * 2;
      if ((historical && age >= SOFT_TTL || !historical && age >= 1000) && !this.loads.has(key)) void this.load(env, symbol, spec, paddedFrom, paddedTo, undefined).catch(() => {});
      return { ...cached, at: observedAt, stale: historical ? age >= SOFT_TTL : age >= 1000, cached: true };
    }
    return { ...await this.load(env, symbol, spec, paddedFrom, Math.max(paddedTo, to), signal), stale: false, cached: false };
  }
  coverage(range, bars) {
    const gaps = []; let cursor = range.from.unixMs;
    for (const bar of bars) { if (bar.openTime.unixMs > cursor) gaps.push({ range: { from: utc(cursor), to: bar.openTime }, reason: 'not_loaded' }); cursor = Math.max(cursor, bar.endTime.unixMs); }
    if (cursor < range.to.unixMs) gaps.push({ range: { from: utc(cursor), to: range.to }, reason: 'not_loaded' });
    return { requested: range, observedRange: bars.length ? { from: bars[0].openTime, to: bars.at(-1).endTime } : null, complete: !gaps.length, gaps };
  }
  async queryBars(binding, query, page, signal) {
    const b = this.bound(binding, query.instrument); this.spec(query.spec);
    check(query.range?.from?.basis === 'utc' && query.range?.to?.basis === 'utc', 'Binance history requires UTC milliseconds', 'INVALID_ARGUMENT');
    return this.pages.read(b.bindingId, query, page, async () => {
      const symbol = await this.row(b.environment, query.instrument.instrumentId, signal), data = await this.history(b.environment, symbol, query.spec, query.range.from.unixMs, query.range.to.unixMs, signal);
      this.bound(binding);
      // A subsequent source candle proves historical closure; local wall time does not.
      const lastOpen = data.rows.at(-1)?.[0], bars = data.rows.filter(row => row[0] >= query.range.from.unixMs && row[0] < query.range.to.unixMs).map(row => this.bar(b.environment, symbol, query.spec, row, row[6] < lastOpen)).filter(bar => query.includeForming !== false || bar.isClosed);
      return { items: bars, metadata: { seriesId: digest([b.connection, query.instrument, query.spec]), instrument: query.instrument, spec: query.spec, coverage: this.coverage(query.range, bars), connection: b.connection, cache: { hit: data.cached, stale: data.stale, observedAt: data.at }, meta: metadata(data.at, data.stale ? 'stale' : 'live') } };
    });
  }
  unbind(binding) { const b = this.bound(binding); this.pages.close(b.bindingId); this.bindings.delete(b.bindingId); }
  async dispose() { await Promise.allSettled([...this.loads.values(), ...this.catalogTasks.values(), ...this.symbolTasks.values()]); this.pages.close(); this.bindings.clear(); this.symbols.clear(); }
}
