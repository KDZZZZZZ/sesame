import { requireValue, now } from './support.js';
import { PERIODS } from './market.js';

/** Shared, ephemeral feeds. No quote passes through the durable application event log. */
export class LiveMarket {
  constructor(mt5, { intervalMs = 1000, accountIntervalMs = 2000 } = {}) {
    this.mt5 = mt5; this.intervalMs = intervalMs; this.accountIntervalMs = accountIntervalMs;
    this.entries = new Map(); this.jobs = new Set(); this.sequence = 0; this.closed = false;
  }
  scope() { const c = this.mt5.official.config; return JSON.stringify([c.account?.server, c.account?.login, c.version ?? 0]); }
  track(promise) { this.jobs.add(promise); promise.finally(() => this.jobs.delete(promise)).catch(() => {}); return promise; }
  async account() {
    const scope = this.scope();
    if (this.accountCache?.scope === scope && Date.now() - this.accountCache.at < this.accountIntervalMs) return this.accountCache.value;
    if (this.accountJob?.scope === scope) return this.accountJob.promise;
    const promise = this.track((async () => {
      const value = await this.mt5.official.account(undefined, { historyAgeMs: 30000 });
      requireValue(scope === this.scope(), '读取期间账户已更改', 409, 'account_changed');
      this.accountCache = { scope, value, at: Date.now() }; return value;
    })());
    const job = { scope, promise }; this.accountJob = job;
    try { return await promise; } finally { if (this.accountJob === job) this.accountJob = null; }
  }
  validate(input) {
    requireValue(!this.closed, '行情服务已关闭', 503);
    const accountOnly = input.account === 'true', scope = this.scope();
    const range = accountOnly ? null : this.mt5.market.validate(input);
    if (!accountOnly) this.mt5.market.scope();
    const key = JSON.stringify([scope, accountOnly ? 'account' : [range.symbol, range.period]]);
    requireValue(this.entries.has(key) || this.entries.size < 64, '实时订阅数量已达上限', 429);
    return { accountOnly, scope, range, key };
  }
  validateBatch(inputs) {
    requireValue(Array.isArray(inputs) && inputs.length > 0 && inputs.length <= 33, '每条行情连接允许 1–33 个订阅');
    const keys = new Set(this.entries.keys());
    for (const input of inputs) {
      requireValue(input && typeof input === 'object' && !Array.isArray(input), '行情订阅参数无效');
      keys.add(this.validate(input).key);
    }
    requireValue(keys.size <= 64, '实时订阅数量已达上限', 429);
  }
  subscribeBatch(inputs, send) {
    this.validateBatch(inputs);
    const stops = [];
    try { inputs.forEach((input, channel) => stops.push(this.subscribe(input, event => send({ ...event, channel })))); }
    catch (error) { stops.forEach(stop => stop()); throw error; }
    return () => stops.forEach(stop => stop());
  }
  subscribe(input, send) {
    const { accountOnly, scope, range, key } = this.validate(input);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, scope, range, accountOnly, listeners: new Set(), stopped: false, failures: 0, latest: null, timer: null };
      this.entries.set(key, entry);
    }
    const listener = { send, range }; entry.listeners.add(listener);
    const publish = (type, data) => { if (entry.listeners.has(listener) && scope === this.scope()) send({ type, data, scope, seq: ++this.sequence }); };
    if (!accountOnly) publish('snapshot', this.mt5.market.bars({ ...range, limit: 2000 }));
    // A cold history download must not delay the live tail.
    if (!entry.started) { entry.started = true; this.poll(entry); }
    this.track((async () => {
      try {
        if (accountOnly) publish('account', await this.account());
        else {
          publish('status', { state: 'loading', checked_at: now() });
          publish('snapshot', await this.mt5.market.query({ ...range, limit: 2000 }));
        }
      } catch (error) { publish('status', { state: 'stale', message: this.mt5.official.redact(error.message), checked_at: now() }); }
    })());
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) { entry.stopped = true; clearTimeout(entry.timer); this.entries.delete(key); }
    };
  }
  emit(entry, type, data) {
    if (entry.stopped) return;
    const event = { type, data, scope: entry.scope, seq: ++this.sequence };
    for (const { send } of entry.listeners) send(event);
  }
  poll(entry) {
    if (entry.stopped || this.closed) return;
    if (entry.scope !== this.scope()) {
      this.emit(entry, 'status', { state: 'scope_changed', checked_at: now() });
      entry.stopped = true; this.entries.delete(entry.key); return;
    }
    const started = Date.now();
    this.track((async () => {
      try {
        if (entry.accountOnly) this.emit(entry, 'account', await this.account());
        else {
          const value = await this.mt5.market.latest(entry.range);
          if (entry.scope !== this.scope() || entry.stopped) return;
          const fingerprint = JSON.stringify(value.bars);
          const needsRecovery = entry.failures > 0 || entry.lastTime && value.bars[0]?.time > entry.lastTime + PERIODS[entry.range.period];
          if (needsRecovery && !entry.recovery) {
            entry.recovery = this.track((async () => {
              for (const listener of entry.listeners) {
                try {
                  const data = await this.mt5.market.query({ ...listener.range, limit: 20000 });
                  if (!entry.stopped && entry.scope === this.scope() && entry.listeners.has(listener)) listener.send({ type: 'snapshot', data, scope: entry.scope, seq: ++this.sequence });
                } catch { /* Keep live values; the next reconnect retries missing history. */ }
              }
            })()).finally(() => { entry.recovery = null; });
          }
          if (fingerprint !== entry.latest) {
            this.emit(entry, 'bars', value); entry.latest = fingerprint;
            // Only completed candles/corrections are persisted, not every quote.
            this.mt5.market.persistLive(value);
          }
          entry.lastTime = value.bars.at(-1)?.time;
          this.emit(entry, 'status', { state: 'live', checked_at: value.updated_at, source_time: value.bars.at(-1)?.time ?? null, interval_ms: this.intervalMs });
        }
        entry.failures = 0;
      } catch (error) {
        entry.failures++;
        this.emit(entry, 'status', { state: 'stale', message: this.mt5.official.redact(error.message), checked_at: now() });
      } finally {
        if (!entry.stopped && !this.closed) {
          const interval = entry.accountOnly ? this.accountIntervalMs : this.intervalMs;
          const delay = entry.failures ? Math.min(30000, 1000 * 2 ** Math.min(5, entry.failures - 1)) : Math.max(20, interval - (Date.now() - started));
          entry.timer = setTimeout(() => this.poll(entry), delay); entry.timer.unref();
        }
      }
    })());
  }
  async close() {
    this.closed = true;
    for (const entry of this.entries.values()) { entry.stopped = true; clearTimeout(entry.timer); entry.listeners.clear(); }
    this.entries.clear(); await Promise.allSettled([...this.jobs]);
  }
}
