import { randomUUID } from 'node:crypto';
import { ENVIRONMENTS, amount, check, digest, failure, metadata, unknown, utc, value } from './common.js';

/** One native connection per exact environment/topic, shared by all local consumers. */
export class Streams {
  constructor(market, { WebSocket: Socket = globalThis.WebSocket, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.market = market; this.Socket = Socket; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.connections = new Map(); this.cooldowns = new Map(); this.consumers = new Set();
  }
  attach(env, topic, emit) {
    const key = `${env}:${topic}`, prior = this.cooldowns.get(key);
    if (prior?.until > this.now()) throw failure('RATE_LIMITED', 'Binance stream is reconnecting after a transport interruption', { retryAt: prior.until });
    let item = this.connections.get(key);
    if (!item) {
      check(typeof this.Socket === 'function', 'This runtime does not provide WebSocket', 'DEPENDENCY_UNAVAILABLE');
      check(this.connections.size < 32, 'Binance stream budget exceeded', 'RESOURCE_EXHAUSTED');
      const socket = new this.Socket(`${ENVIRONMENTS[env].websocket}/ws/${encodeURIComponent(topic).replace('%40', '@')}`);
      item = { socket, listeners: new Set(), closed: false, opened: false, timer: null };
      const close = reason => {
        if (item.closed) return; item.closed = true;
        this.clearTimer(item.timer); this.connections.delete(key);
        if (reason) {
          const attempts = (this.cooldowns.get(key)?.attempts ?? 0) + 1;
          this.cooldowns.set(key, { attempts, until: this.now() + Math.min(60000, 1000 * 2 ** Math.min(6, attempts - 1)) });
          for (const listener of item.listeners) listener(null, reason);
        }
        item.listeners.clear();
        try { socket.close(); } catch { /* Transport was already closed. */ }
      };
      item.close = close;
      const watchdog = () => { this.clearTimer(item.timer); item.timer = this.setTimer(() => close('Binance stream stopped delivering data; obtain a fresh snapshot'), 75000); item.timer?.unref?.(); };
      socket.addEventListener('open', () => { if (item.closed) return; item.opened = true; watchdog(); });
      socket.addEventListener('message', event => {
        if (item.closed) return;
        try {
          check(typeof event.data === 'string' && event.data.length <= 256 * 1024, 'Invalid Binance stream payload', 'INVALID_PROVIDER_DATA');
          const data = JSON.parse(event.data), payload = data.data ?? data;
          if (payload.e === 'serverShutdown') { close('Binance is restarting the stream; obtain a fresh snapshot'); return; }
          watchdog(); this.cooldowns.delete(key);
          for (const listener of item.listeners) listener(payload);
        } catch { close('Binance stream delivered an invalid event; obtain a fresh snapshot'); }
      });
      socket.addEventListener('error', () => close('Binance stream transport failed; obtain a fresh snapshot'));
      socket.addEventListener('close', () => close('Binance stream disconnected; obtain a fresh snapshot'));
      item.timer = this.setTimer(() => close('Binance stream connection timed out'), 15000); item.timer?.unref?.();
      this.connections.set(key, item);
    }
    item.listeners.add(emit);
    return () => { item.listeners.delete(emit); if (!item.listeners.size) item.close(); };
  }
  quote(env, symbol, row, time = row.E ?? row.closeTime) {
    check(row.s === undefined || row.s === symbol.symbol, 'Quote symbol changed', 'INSTRUMENT_MISMATCH');
    const bid = row.b ?? row.bidPrice, ask = row.a ?? row.askPrice, last = row.c ?? row.lastPrice;
    return this.market.revise({ id: `${env}:quote:${symbol.symbol}`, instrument: { sourceId: `binance:${env}:spot`, instrumentId: symbol.symbol }, time: utc(time), bid: value(amount(bid)), ask: value(amount(ask)), last: value(amount(last)),
      bidSize: value({ value: amount(row.B ?? row.bidQty), unit: symbol.baseAsset }), askSize: value({ value: amount(row.A ?? row.askQty), unit: symbol.baseAsset }), nativeId: unknown('Ticker events have no stable event identifier') });
  }
  consumer(binding, signal) {
    const position = { streamId: randomUUID(), epoch: randomUUID(), seq: '0' }, queue = []; let seq = 0n, wake, ended = false, detach = () => {};
    const close = async () => { if (ended) return; ended = true; detach(); signal?.removeEventListener('abort', abort); this.consumers.delete(consumer); wake?.(); };
    const abort = () => { void close(); };
    const push = event => {
      if (ended) return;
      if (queue.length >= 256) {
        queue.splice(0); queue.push({ ...position, seq: String(++seq), eventId: randomUUID(), schemaVersion: '1.0.0', type: 'stream.gap', observedAt: this.now(), payload: { reason: { code: 'SUBSCRIPTION_OVERFLOW', message: 'Refresh the Binance source snapshot' }, recovery: 'snapshot' } }); void close(); return;
      }
      queue.push(event); wake?.();
    };
    const event = (type, payload) => push({ ...position, seq: String(++seq), eventId: randomUUID(), schemaVersion: '1.0.0', type, payload, observedAt: this.now() });
    const gap = reason => { event('stream.gap', { reason: { code: 'SOURCE_UNAVAILABLE', message: reason }, recovery: 'snapshot' }); void close(); };
    const consumer = { id: position.streamId, bindingId: binding.bindingId, close, event, gap, isClosed: () => ended, detach: fn => { detach = fn; if (ended) detach(); },
      snapshot: snapshot => queue.unshift({ type: 'snapshot', snapshot, position, consistency: snapshot.meta.consistency, recovery: 'snapshot' }),
      events: { async *[Symbol.asyncIterator]() { try { for (;;) { if (queue.length) yield queue.shift(); else if (ended) return; else await new Promise(resolve => { wake = resolve; }); } } finally { await close(); } } } };
    this.consumers.add(consumer); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); return consumer;
  }
  async bars(binding, query, signal) {
    const b = this.market.bound(binding, query.instrument), duration = this.market.spec(query.spec);
    check(!query.resumeToken && Number.isInteger(query.tailLimit) && query.tailLimit >= 1 && query.tailLimit <= 1000, 'Use a fresh snapshot with tailLimit 1..1000', 'INVALID_ARGUMENT');
    const symbol = await this.market.row(b.environment, query.instrument.instrumentId, signal), consumer = this.consumer(binding, signal);
    const seriesId = digest([b.connection, query.instrument, query.spec]), closed = new Set();
    try {
      consumer.detach(this.attach(b.environment, `${symbol.symbol.toLowerCase()}@kline_${query.spec.timeframe === '1mo' ? '1M' : query.spec.timeframe}`, (row, reason) => {
        if (reason) return consumer.gap(reason);
        try {
          check(row.e === 'kline' && row.s === symbol.symbol && row.k?.i === (query.spec.timeframe === '1mo' ? '1M' : query.spec.timeframe), 'Unexpected candle stream', 'INVALID_PROVIDER_DATA');
          const k = row.k, bar = this.market.bar(b.environment, symbol, query.spec, [k.t, k.o, k.h, k.l, k.c, k.v, k.T, k.q], k.x === true);
          if (query.includeForming !== false || bar.isClosed) consumer.event('bars.upsert', { seriesId, bars: [bar] });
          if (bar.isClosed && !closed.has(bar.id)) { closed.add(bar.id); if (closed.size > 2000) closed.delete(closed.values().next().value); consumer.event('bars.closed', { seriesId, barId: bar.id, revision: bar.revision, closureId: bar.id }); }
        } catch { consumer.gap('Binance candle event could not be interpreted; obtain a fresh snapshot'); }
      }));
      const clock = await this.market.client.serverTime(b.environment, signal), to = Math.floor(this.now() + clock.offset) + duration;
      const from = Math.max(0, to - duration * (query.tailLimit + 3));
      const snapshot = await this.market.queryBars(binding, { instrument: query.instrument, spec: query.spec, ...(query.includeForming === undefined ? {} : { includeForming: query.includeForming }), direction: 'backward', range: { from: utc(from), to: utc(to) } }, { limit: Math.min(1000, query.tailLimit + 1) }, signal);
      const bars = snapshot.items.slice(-query.tailLimit); for (const bar of bars) if (bar.isClosed) closed.add(bar.id);
      consumer.snapshot({ seriesId, instrument: query.instrument, spec: query.spec, bars, coverage: snapshot.metadata.coverage, meta: snapshot.metadata.meta }); return consumer;
    } catch (error) { await consumer.close(); throw error; }
  }
  async quotes(binding, query, signal) {
    signal?.throwIfAborted();
    const b = this.market.bound(binding);
    check(!query.resumeToken && Array.isArray(query.instruments) && query.instruments.length >= 1 && query.instruments.length <= 20, 'Subscribe to 1..20 explicit instruments with a fresh snapshot', 'INVALID_ARGUMENT');
    const consumer = this.consumer(binding, signal), disposers = [];
    consumer.detach(() => disposers.forEach(close => close()));
    try {
      const from = this.now(), quotes = [];
      for (const ref of query.instruments) {
        this.market.bound(binding, ref); const symbol = await this.market.row(b.environment, ref.instrumentId, signal);
        signal?.throwIfAborted(); check(!consumer.isClosed(), 'Binance quote subscription closed during initialization', 'SOURCE_UNAVAILABLE');
        const release = this.attach(b.environment, `${symbol.symbol.toLowerCase()}@ticker`, (row, reason) => {
          if (reason) return consumer.gap(reason);
          try { consumer.event('quotes.upsert', { quotes: [this.quote(b.environment, symbol, row)] }); } catch { consumer.gap('Binance ticker event could not be interpreted'); }
        });
        if (consumer.isClosed()) release(); else disposers.push(release);
        const row = await this.market.client.request(b.environment, 'GET', '/api/v3/ticker/24hr', { symbol: symbol.symbol }, { signal }); quotes.push(this.quote(b.environment, symbol, row));
        signal?.throwIfAborted(); check(!consumer.isClosed(), 'Binance quote subscription closed during initialization', 'SOURCE_UNAVAILABLE');
      }
      this.market.bound(binding); const observedAt = this.now();
      consumer.snapshot({ quotes, meta: metadata(observedAt, 'live', { samplingWindow: { from, to: observedAt } }) }); return consumer;
    } catch (error) { await consumer.close(); throw error; }
  }
  async unbind(binding) { await Promise.all([...this.consumers].filter(row => row.bindingId === binding.bindingId).map(row => row.close())); }
  async dispose() { await Promise.all([...this.consumers].map(row => row.close())); for (const item of this.connections.values()) item.close(); this.connections.clear(); }
}
