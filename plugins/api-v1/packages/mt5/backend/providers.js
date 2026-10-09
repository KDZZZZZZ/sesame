import { randomUUID, createHash } from 'node:crypto';
import { accountIdentity, sourceIdentity, instrumentIdentity, mapInstrument, mapBar, mapAccountSummary, mapAccountSnapshot, mapPosition, mapOrder, mapFill, mapLedgerEntry, nativeTimeframe, sourceTime, timeKey, Revisions } from './contract-mapping.js';
import { brokerISO, PERIODS } from './market.js';

const error = (code, message) => { throw Object.assign(new Error(message), { code }); };
const fingerprint = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const clone = input => structuredClone(input);
const check = (condition, code, message) => { if (!condition) error(code, message); };
const within = (time, range) => timeKey(time) >= timeKey(range.from) && timeKey(time) < timeKey(range.to);
const meta = (from, warnings = [], freshness = 'live') => ({ observedAt: Date.now(), freshness, origin: 'observed', consistency: 'bounded', samplingWindow: { from, to: Date.now() }, warnings });
const nativeWarnings = [{ code: 'NATIVE_JSON_PRECISION', message: 'MT5 numeric JSON fields may already contain binary floating-point rounding; textual decimals are preserved.' }, { code: 'BROKER_WALL_TIME', message: 'Broker timestamps without offsets remain wall time; the adapter does not infer UTC.' }];

/** A cursor points into a retained immutable adapter snapshot. It never means an
 * offset into whatever the terminal happens to return on the next request. */
export class SnapshotPages {
  constructor({ ttlMs = 300000, maxSnapshots = 32, clock = Date.now } = {}) { this.ttlMs = ttlMs; this.maxSnapshots = maxSnapshots; this.clock = clock; this.snapshots = new Map(); }
  read(input, bindingId, load) {
    const { page = {}, ...filters } = input, limit = page.limit ?? 100;
    check(Number.isSafeInteger(limit) && limit > 0 && limit <= 2000, 'INVALID_ARGUMENT', 'Page limit must be between 1 and 2000');
    const key = fingerprint([bindingId, filters]);
    if (page.cursor) {
      let cursor; try { cursor = JSON.parse(Buffer.from(page.cursor, 'base64url').toString()); } catch { error('INVALID_CURSOR', 'The cursor is invalid'); }
      const snapshot = this.snapshots.get(cursor.id);
      check(snapshot && snapshot.expiresAt > this.clock(), 'CURSOR_EXPIRED', 'The retained native snapshot has expired');
      check(snapshot.key === key && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0 && cursor.offset <= snapshot.items.length, 'INVALID_CURSOR', 'The cursor belongs to different filters or a different binding');
      return this.page(snapshot, cursor.offset, limit);
    }
    return Promise.resolve(load()).then(({ items, ...extra }) => {
      check(Array.isArray(items) && Buffer.byteLength(JSON.stringify(items)) <= 32 * 1024 * 1024, 'RESOURCE_EXHAUSTED', 'The native snapshot exceeds the adapter memory budget; use a smaller range');
      for (const [id, snapshot] of this.snapshots) if (snapshot.expiresAt <= this.clock()) this.snapshots.delete(id);
      while (this.snapshots.size >= this.maxSnapshots) this.snapshots.delete(this.snapshots.keys().next().value);
      const snapshot = { id: randomUUID(), key, items: clone(items), extra: clone(extra), expiresAt: this.clock() + this.ttlMs };
      this.snapshots.set(snapshot.id, snapshot); return this.page(snapshot, 0, limit);
    });
  }
  page(snapshot, offset, limit) {
    const end = Math.min(snapshot.items.length, offset + limit);
    return { ...clone(snapshot.extra), page: { items: clone(snapshot.items.slice(offset, end)), snapshotId: snapshot.id, consistency: 'snapshot', nextCursor: end < snapshot.items.length ? Buffer.from(JSON.stringify({ id: snapshot.id, offset: end })).toString('base64url') : null } };
  }
}

class NativeProvider {
  constructor(mt5) { this.mt5 = mt5; this.bindings = new Map(); this.pages = new SnapshotPages(); this.revisions = new Revisions(); this.reads = new Map(); this.readSequence = 0; this.closed = false; }
  bind(input, context) {
    const config = this.mt5.official.config, server = config.account?.server, login = config.account?.login;
    check(server && login, 'CONNECTION_UNAVAILABLE', 'Configure the MT5 terminal account before binding data');
    context.signal?.throwIfAborted();
    const connection = { id: 'mt5-terminal', revision: String(config.version) };
    check(!input.connection || input.connection.id === connection.id && input.connection.revision === connection.revision, 'CONNECTION_CHANGED', 'The requested MT5 connection is not the current configured revision; bind the current connection');
    const binding = { connection, server, login: String(login), version: config.version, sourceId: sourceIdentity(server), account: { connectionId: connection.id, accountId: accountIdentity(server, login) } };
    this.bindings.set(context.bindingId, binding);
    return { connection: binding.connection, sourceIds: [binding.sourceId], accounts: [binding.account], health: 'connecting', timeBasis: { kind: 'wall', authority: server } };
  }
  binding(context, account, instrument) {
    context.signal?.throwIfAborted();
    const binding = this.bindings.get(context.bindingId), config = this.mt5.official.config;
    check(binding && !this.closed && binding.version === config.version && binding.server === config.account?.server && binding.login === String(config.account?.login), 'CONNECTION_CHANGED', 'The MT5 connection changed; create a new binding');
    if (account) check(account.connectionId === binding.account.connectionId && account.accountId === binding.account.accountId, 'ACCOUNT_MISMATCH', 'The requested account is not bound to this connection');
    if (instrument) check(instrument.sourceId === binding.sourceId, 'INSTRUMENT_MISMATCH', 'The instrument belongs to a different source');
    return binding;
  }
  async read(tool, args, context, ageMs = 0) {
    const binding = this.binding(context), key = fingerprint([context.bindingId, tool, args]);
    // Large moving history windows belong only to the current read, never a cache.
    // Pending requests are consumer-owned: one stream's abort cannot cancel another.
    const cacheable = tool !== 'get_chart_history' && ageMs > 0;
    const prior = cacheable && this.reads.get(key);
    if (prior && prior.binding === binding && Date.now() - prior.at < ageMs) return clone(prior.value);
    if (prior) { clearTimeout(prior.timer); this.reads.delete(key); }
    const sequence = ++this.readSequence, controller = new AbortController();
    binding.readControllers ??= new Set(); binding.readControllers.add(controller);
    const signal = AbortSignal.any([controller.signal, ...(context.signal ? [context.signal] : [])]);
    try {
      const result = await this.mt5.market.read(tool, args, signal);
      signal.throwIfAborted(); this.binding(context);
      check(this.bindings.get(context.bindingId) === binding, 'CONNECTION_CHANGED', 'The binding changed while reading');
      if (cacheable && (this.reads.get(key)?.sequence ?? 0) < sequence && Buffer.byteLength(JSON.stringify(result)) <= 64 * 1024) {
        const old = this.reads.get(key); if (old) clearTimeout(old.timer);
        while (this.reads.size >= 16) { const [id, entry] = this.reads.entries().next().value; clearTimeout(entry.timer); this.reads.delete(id); }
        const entry = { binding, bindingId: context.bindingId, sequence, at: Date.now(), value: clone(result) };
        entry.timer = setTimeout(() => { if (this.reads.get(key) === entry) this.reads.delete(key); }, Math.min(ageMs, 1000)); entry.timer.unref?.();
        this.reads.set(key, entry);
      }
      return clone(result);
    } finally { binding.readControllers.delete(controller); }
  }
  async accountInfo(context) {
    const binding = this.binding(context), data = await this.read('get_trading_account_info', {}, context, 1000);
    check(data.terminal?.server_connected === true, 'SOURCE_UNAVAILABLE', 'MT5 is not connected to the broker');
    check(String(data.account?.login) === binding.login && data.account?.server === binding.server, 'ACCOUNT_MISMATCH', 'The terminal account differs from the bound account');
    return data;
  }
  range(range, binding) {
    check(range?.from?.basis === 'wall' && range?.to?.basis === 'wall' && range.from.authority === binding.server && range.to.authority === binding.server, 'UNSUPPORTED_CAPABILITY', 'MT5 history requires the bound broker wall-clock range');
    const from = timeKey(range.from), to = timeKey(range.to);
    check(Number.isFinite(from) && Number.isFinite(to) && from < to, 'INVALID_ARGUMENT', 'The history range is invalid');
    return { from: Math.floor(from / 1000), to: Math.ceil(to / 1000) };
  }
  coverage(range, rows, time = row => row.openTime) {
    const sorted = rows.map(time).sort((a, b) => timeKey(a) - timeKey(b));
    return { requested: range, observedRange: sorted.length ? { from: sorted[0], to: sorted.at(-1) } : null, complete: false, gaps: [{ range, reason: 'not_available' }] };
  }
  unbind({ bindingId }) {
    const binding = this.bindings.get(bindingId); this.bindings.delete(bindingId);
    for (const controller of binding?.readControllers ?? []) controller.abort(Object.assign(new Error('Binding was closed'), { code: 'CONNECTION_CHANGED' }));
    for (const [key, entry] of this.reads) if (entry.bindingId === bindingId) { clearTimeout(entry.timer); this.reads.delete(key); }
  }
  dispose() { this.closed = true; for (const bindingId of [...this.bindings.keys()]) this.unbind({ bindingId }); this.pages.snapshots.clear(); }
}

function pollSubscription({ snapshot, read, events, intervalMs, context }) {
  const position = { streamId: randomUUID(), epoch: randomUUID(), seq: '0' };
  let closed = false, started = false, timer, seq = 0n, previous = snapshot, pending = Promise.resolve();
  const close = async () => { closed = true; clearTimeout(timer); context.signal?.removeEventListener('abort', abort); await pending.catch(() => {}); };
  const abort = () => { closed = true; clearTimeout(timer); };
  context.signal?.addEventListener('abort', abort, { once: true });
  return { snapshot, position, consistency: 'best_effort', recovery: 'snapshot', resumeToken: null, close,
    ready(emit) {
      if (started || closed) return; started = true;
      const send = (type, payload) => { if (!closed) emit({ ...position, seq: String(++seq), eventId: `${position.epoch}:${seq}`, type, schemaVersion: '1.0.0', observedAt: Date.now(), payload }); };
      const poll = () => {
        if (closed || context.signal?.aborted) return;
        pending = (async () => {
          try { const next = await read(); if (closed) return; for (const event of events(previous, next)) send(event.type, event.payload); previous = next; }
          catch (cause) { send('stream.gap', { code: cause.code ?? 'SOURCE_UNAVAILABLE', message: cause.message, recovery: 'snapshot' }); closed = true; }
          finally { if (!closed) { timer = setTimeout(poll, intervalMs); timer.unref?.(); } }
        })();
      };
      poll();
    },
  };
}

export class MT5MarketProvider extends NativeProvider {
  async catalog(context) {
    await this.accountInfo(context);
    const data = await this.read('get_marketwatch_symbols', { include_hidden: true, limit: 10000 }, context, 30000);
    check(Array.isArray(data.symbols) && data.symbols.length < 10000, 'RESOURCE_EXHAUSTED', 'The broker symbol catalog is missing or truncated');
    return data.symbols;
  }
  async searchInstruments(input, context) {
    const from = Date.now(), binding = this.binding(context);
    const result = await this.pages.read(input, context.bindingId, async () => {
      const text = String(input.query ?? '').trim().toLowerCase(); check(text.length <= 200, 'INVALID_ARGUMENT', 'Instrument query is too long');
      const all = (await this.catalog(context)).map(row => mapInstrument(row, binding));
      const items = all.filter(row => (!text || `${row.symbol} ${row.name}`.toLowerCase().includes(text)) && (!input.assetClasses?.length || input.assetClasses.includes(row.assetClass)) && (!input.venues?.length || row.venue.status === 'value' && input.venues.includes(row.venue.value)))
        .sort((a, b) => Number(b.symbol.toLowerCase() === text) - Number(a.symbol.toLowerCase() === text) || a.symbol.localeCompare(b.symbol))
        .map(({ ref, symbol, name, assetClass, venue }) => ({ ref, symbol, name, assetClass, venue }));
      return { items, observedAt: Date.now() };
    });
    return { data: result.page, meta: { ...meta(from), observedAt: result.observedAt } };
  }
  async describeInstrument(input, context) {
    const from = Date.now(), binding = this.binding(context, null, input.instrument);
    const row = (await this.catalog(context)).find(row => row.symbol === input.instrument.instrumentId);
    check(row, 'NOT_FOUND', 'The bound broker did not return the requested instrument');
    return { data: mapInstrument(row, binding), meta: meta(from, !Number.isInteger(row.digits) ? [{ code: 'DISPLAY_PRECISION_UNKNOWN', message: 'The broker did not report a display precision; no tick size is inferred.' }] : []) };
  }
  validateSpec(spec) {
    check(spec && spec.priceBasis === 'bid' && spec.adjustment === 'none' && spec.session === 'all', 'UNSUPPORTED_CAPABILITY', 'This MT5 adapter supports broker bid bars, no adjustment, and the broker all-session history');
    check(!spec.calendarRevision || spec.calendarRevision.status !== 'value', 'UNSUPPORTED_CAPABILITY', 'The adapter has no fixed broker calendar');
    return nativeTimeframe(spec.timeframe);
  }
  async bars(input, context, tail = false) {
    const binding = this.binding(context, null, input.instrument), period = this.validateSpec(input.spec);
    const range = tail ? { from: Math.max(0, Math.floor(Date.now() / 1000) - Math.max(PERIODS[period] * (input.tailLimit + 2), 7 * 86400)), to: Math.floor(Date.now() / 1000) + 86400 } : this.range(input.range, binding);
    const limit = tail ? input.tailLimit + 1 : Math.ceil((range.to - range.from) / PERIODS[period]);
    check(Number.isSafeInteger(limit) && limit > 0 && limit <= 200000, 'RESOURCE_EXHAUSTED', 'Use a smaller native history range');
    const rows = []; let observedAt = Date.now(), freshness = 'live', warnings = [];
    try {
    await this.accountInfo(context);
    for (let start = range.from; start < range.to; start += tail ? range.to - range.from : PERIODS[period] * 2000) {
      const end = tail ? range.to : Math.min(range.to, start + PERIODS[period] * 2000);
      // Native latest-N truncation omits the current bar. Read the whole bounded
      // window, then select the requested tail; a truncated response is not live evidence.
      const nativeLimit = tail ? Math.ceil((end - start) / PERIODS[period]) + 2 : 5000;
      const data = await this.read('get_chart_history', { symbol: input.instrument.instrumentId, period, datetime_from: brokerISO(start), datetime_to: brokerISO(end), limit: nativeLimit }, context, tail ? 1000 : 0);
      check(data.ok !== false && Array.isArray(data.history) && data.history.length < nativeLimit, 'SOURCE_UNAVAILABLE', 'MT5 history is missing or truncated');
      rows.push(...data.history);
    }
    this.binding(context);
    this.mt5.market.cacheNativeBars?.(binding.server, input.instrument.instrumentId, period, rows, observedAt);
    } catch (cause) {
      this.binding(context);
      if (tail || ['ACCOUNT_MISMATCH', 'CONNECTION_CHANGED', 'INSTRUMENT_MISMATCH'].includes(cause.code) || context.signal?.aborted) throw cause;
      const cached = this.mt5.market.nativeBars?.(binding.server, input.instrument.instrumentId, period, range.from, range.to);
      if (!cached?.rows.length) throw cause;
      rows.push(...cached.rows); observedAt = cached.observedAt; freshness = 'stale'; warnings = [{ code: 'OFFLINE_CACHE', message: 'Returning the retained native observations; the current terminal read failed and coverage is incomplete.' }];
    }
    const unique = [...new Map(rows.map(row => [timeKey(sourceTime(row.time, binding.server)), row])).values()].sort((a, b) => timeKey(sourceTime(a.time, binding.server)) - timeKey(sourceTime(b.time, binding.server)));
    const seriesId = `mt5-series-${fingerprint([binding.sourceId, input.instrument, input.spec]).slice(0, 24)}`;
    const bars = unique.map((row, i) => mapBar(row, { ...binding, seriesId, spec: input.spec, nextOpenTime: unique[i + 1]?.time, revisions: this.revisions })).filter(row => (input.includeForming !== false || row.isClosed) && (tail || within(row.openTime, input.range)));
    return { seriesId, instrument: input.instrument, spec: input.spec, bars: tail ? bars.slice(-input.tailLimit) : bars, coverage: this.coverage(input.range ?? { from: sourceTime(range.from, binding.server), to: sourceTime(range.to, binding.server) }, bars), _meta: { observedAt, freshness, warnings } };
  }
  async queryBars(input, context) {
    this.binding(context, null, input.instrument); const from = Date.now();
    check(['forward', 'backward'].includes(input.direction ?? 'forward'), 'INVALID_ARGUMENT', 'Bars direction must be forward or backward');
    const result = await this.pages.read(input, context.bindingId, async () => {
      const { bars, _meta, ...data } = await this.bars(input, context);
      return { ...data, items: input.direction === 'backward' ? bars.toReversed() : bars, observedAt: _meta.observedAt, freshness: _meta.freshness, warnings: _meta.warnings };
    });
    const { observedAt, freshness, warnings, ...data } = result; data.page.items.sort((a, b) => timeKey(a.openTime) - timeKey(b.openTime));
    return { data, meta: { ...meta(from, [...nativeWarnings, ...warnings], freshness), observedAt } };
  }
  async subscribeBars(input, context) {
    check(!input.resumeToken, 'RESUME_EXPIRED', 'MT5 polling resumes with a new snapshot');
    check(Number.isSafeInteger(input.tailLimit) && input.tailLimit > 0 && input.tailLimit <= 2000, 'INVALID_ARGUMENT', 'Live tail must contain between 1 and 2000 bars');
    const read = async () => { const { _meta, ...data } = await this.bars(input, context, true); return data; }, snapshot = await read();
    return pollSubscription({ snapshot, read, intervalMs: this.mt5.options?.market?.intervalMs ?? 1000, context,
      events: (old, next) => {
        const prior = new Map(old.bars.map(bar => [bar.id, bar]));
        const changed = next.bars.filter(bar => bar.revision !== prior.get(bar.id)?.revision);
        const closed = changed.filter(bar => bar.isClosed && prior.get(bar.id)?.isClosed === false);
        return [...(changed.length ? [{ type: 'bars.upsert', payload: { seriesId: next.seriesId, bars: changed } }] : []), ...closed.map(bar => ({ type: 'bars.closed', payload: { seriesId: next.seriesId, barId: bar.id, revision: bar.revision, closureId: `${next.seriesId}:${bar.id}:closed` } }))];
      } });
  }
}

export class MT5AccountProvider extends NativeProvider {
  async listAccounts(input, context) {
    const from = Date.now(), binding = this.binding(context);
    const result = await this.pages.read(input, context.bindingId, async () => ({ items: [mapAccountSummary((await this.accountInfo(context)).account, { ...binding, connectionId: binding.connection.id })], observedAt: Date.now() }));
    return { data: result.page, meta: { ...meta(from), observedAt: result.observedAt } };
  }
  async snapshot(input, context) {
    const from = Date.now(), binding = this.binding(context, input.account), { account, terminal } = await this.accountInfo(context);
    return { data: mapAccountSnapshot(account, { ...binding, terminal, connectionId: binding.connection.id, observedAt: Date.now(), snapshotId: randomUUID() }), meta: meta(from, nativeWarnings) };
  }
  async open(input, context) {
    const binding = this.binding(context, input.account), info = await this.accountInfo(context), data = await this.read('get_trading_open_positions', { include_orders: true }, context, 1000);
    check(Array.isArray(data.positions) && Array.isArray(data.orders), 'SOURCE_UNAVAILABLE', 'The native account response omitted positions or working orders');
    return { binding: { ...binding, currency: info.account.currency, revisions: this.revisions }, info, data };
  }
  async queryPositions(input, context) {
    const from = Date.now(); this.binding(context, input.account);
    const result = await this.pages.read(input, context.bindingId, async () => {
      const { data, binding } = await this.open(input, context);
      return { items: data.positions.map(row => mapPosition(row, binding)).filter(row => !input.instruments?.length || input.instruments.some(ref => ref.sourceId === row.instrument.sourceId && ref.instrumentId === row.instrument.instrumentId)), observedAt: Date.now() };
    });
    return { data: result.page, meta: { ...meta(from, nativeWarnings), observedAt: result.observedAt } };
  }
  async nativeHistory(input, context) {
    const binding = this.binding(context, input.account), { account } = await this.accountInfo(context), range = this.range(input.range, binding);
    const orders = [], deals = [];
    const read = async (from, to) => {
      const data = await this.read('get_trading_history_orders', { datetime_from: brokerISO(from), datetime_to: brokerISO(to), include_orders: true, include_deals: true, limit: 5000 }, context);
      check(Array.isArray(data.orders) && Array.isArray(data.deals), 'SOURCE_UNAVAILABLE', 'The native source omitted historical orders or deals');
      if (data.orders.length >= 5000 || data.deals.length >= 5000) { check(to - from > 1, 'RESOURCE_EXHAUSTED', 'A native history second exceeds the source limit'); const middle = Math.floor((from + to) / 2); await read(from, middle); await read(middle, to); return; }
      orders.push(...data.orders); deals.push(...data.deals);
      check(orders.length + deals.length <= 200000, 'RESOURCE_EXHAUSTED', 'Use a smaller account-history range');
    };
    await read(range.from, range.to); this.binding(context, input.account);
    return { binding: { ...binding, currency: account.currency, revisions: this.revisions }, orders, deals };
  }
  async queryOrders(input, context) {
    check(['working', 'history', 'all'].includes(input.scope), 'INVALID_ARGUMENT', 'Order scope must be working, history or all');
    const from = Date.now(); this.binding(context, input.account);
    check(['working', 'history', 'all'].includes(input.scope), 'INVALID_ARGUMENT', 'An order scope is required');
    const result = await this.pages.read(input, context.bindingId, async () => {
      const rows = [];
      if (input.scope !== 'history') { const { data, binding } = await this.open(input, context); rows.push(...data.orders.map(row => mapOrder(row, binding))); }
      if (input.scope !== 'working') { const { orders, binding } = await this.nativeHistory(input, context); rows.push(...orders.map(row => mapOrder(row, binding)).filter(row => within(row.createdAt, input.range))); }
      const items = [...new Map(rows.map(row => [row.id, row])).values()].filter(row => !input.instruments?.length || input.instruments.some(ref => ref.sourceId === row.instrument.sourceId && ref.instrumentId === row.instrument.instrumentId)).sort((a, b) => timeKey(a.createdAt) - timeKey(b.createdAt) || a.id.localeCompare(b.id));
      return { items, ...(input.range ? { coverage: this.coverage(input.range, items, row => row.createdAt) } : {}), observedAt: Date.now() };
    });
    const { observedAt, ...data } = result; return { data, meta: { ...meta(from, nativeWarnings), observedAt } };
  }
  async history(input, context, ledger) {
    const from = Date.now(); this.binding(context, input.account);
    const result = await this.pages.read(input, context.bindingId, async () => {
      const { deals, binding } = await this.nativeHistory(input, context);
      const traded = row => ['buy', 'sell', '0', '1', 'deal_type_buy', 'deal_type_sell'].includes(String(row.action ?? row.type).toLowerCase());
      const mapped = deals.filter(row => ledger ? !traded(row) : traded(row)).map(row => ledger ? mapLedgerEntry(row, binding) : mapFill(row, binding)).filter(Boolean).filter(row => within(row.time, input.range));
      const items = [...new Map(mapped.map(row => [row.id, row])).values()].filter(row => ledger ? !input.kinds?.length || input.kinds.includes(row.kind) : (!input.instruments?.length || input.instruments.some(ref => ref.sourceId === row.instrument.sourceId && ref.instrumentId === row.instrument.instrumentId)) && (!input.orderIds?.length || row.orderId.status === 'value' && input.orderIds.includes(row.orderId.value))).sort((a, b) => timeKey(a.time) - timeKey(b.time) || a.id.localeCompare(b.id));
      return { items, coverage: this.coverage(input.range, items, row => row.time), observedAt: Date.now() };
    });
    const { observedAt, ...data } = result; return { data, meta: { ...meta(from, [...nativeWarnings, { code: 'NATIVE_RETENTION_UNKNOWN', message: 'The terminal returned this bounded history; broker retention and internal gaps cannot be certified.' }]), observedAt } };
  }
  queryFills(input, context) { return this.history(input, context, false); }
  queryHistory(input, context) { return this.history(input, context, true); }
  async subscribeAccount(input, context) {
    check(!input.resumeToken, 'RESUME_EXPIRED', 'MT5 account polling resumes with a new snapshot');
    check(Array.isArray(input.topics) && input.topics.length > 0 && input.topics.every(topic => ['snapshot', 'positions', 'orders'].includes(topic)), 'UNSUPPORTED_CAPABILITY', 'Live account topics are snapshot, positions and orders; fills and history use bounded historical queries');
    const read = async () => {
      const { data, binding, info } = await this.open(input, context), state = { account: input.account, coverage: input.topics.map(topic => ({ topic, complete: false })) };
      if (input.topics.includes('snapshot')) state.snapshot = mapAccountSnapshot(info.account, { ...binding, terminal: info.terminal, connectionId: binding.connection.id, observedAt: Date.now(), snapshotId: randomUUID() });
      if (input.topics.includes('positions')) state.positions = data.positions.map(row => mapPosition(row, binding));
      if (input.topics.includes('orders')) state.orders = data.orders.map(row => mapOrder(row, binding));
      return state;
    };
    const snapshot = await read();
    return pollSubscription({ snapshot, read, intervalMs: this.mt5.options?.account?.intervalMs ?? 2000, context, events: (old, next) => {
      for (const topic of ['positions', 'orders']) if (old[topic]?.some(row => !next[topic].some(current => current.id === row.id))) {
        error('SNAPSHOT_REQUIRED', 'A native current position/order disappeared. Refresh the current snapshot; one missing poll does not prove a close or cancellation.');
      }
      return [
      ...(next.snapshot ? [{ type: 'account.snapshot', payload: next.snapshot }] : []),
      ...(next.positions ? [{ type: 'positions.upsert', payload: { items: next.positions } }] : []),
      ...(next.orders ? [{ type: 'orders.upsert', payload: { items: next.orders } }] : []),
    ]; } });
  }
}

export const marketDescriptor = { id: 'market', contract: 'sesame.market', versions: ['1.0.0'], capabilities: ['instruments.search', 'instruments.describe', 'bars.history', 'bars.subscribe'], connection: { required: false }, transportMode: 'poll', minPollIntervalMs: 1000, priceBases: ['bid'], adjustments: ['none'], sessions: ['all'] };
export const accountDescriptor = { id: 'account', contract: 'sesame.account', versions: ['1.0.0'], capabilities: ['accounts.list', 'account.snapshot', 'positions.query', 'orders.query', 'fills.query', 'history.query', 'account.subscribe'], connection: { required: false }, transportMode: 'poll', minPollIntervalMs: 2000, liveTopics: ['snapshot', 'positions', 'orders'] };
