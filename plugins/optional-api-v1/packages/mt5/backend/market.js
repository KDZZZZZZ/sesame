import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { digest, now, requireValue } from './support.js';
import { MarketCache } from './market-cache.js';

export const PERIODS = Object.fromEntries(Object.entries({ M1: 1, M2: 2, M3: 3, M4: 4, M5: 5, M6: 6, M10: 10, M12: 12, M15: 15, M20: 20, M30: 30, H1: 60, H2: 120, H3: 180, H4: 240, H6: 360, H8: 480, H12: 720, D1: 1440, W1: 10080, MN1: 43200 }).map(([key, minutes]) => [key, minutes * 60]));
export const TIME_BASIS = 'broker_server_unspecified';
// MT5's ISO strings have no offset. Preserve the broker's wall clock on the
// chart, rather than silently converting it using the desktop's timezone.
export function brokerTime(value) {
  const result = typeof value === 'number' ? value : Date.parse(String(value).replace(/\.(\d{3})\d+/, '.$1') + (/Z$|[+-]\d\d:\d\d$/.test(String(value)) ? '' : 'Z')) / 1000;
  requireValue(Number.isFinite(result) && result >= 0 && result < 4102444800, 'MT5 时间无效', 502);
  return Math.floor(result);
}
export const brokerISO = seconds => new Date(seconds * 1000).toISOString().slice(0, 19);
export const nativeData = result => {
  requireValue(!result.isError, result.content?.find(p => p.type === 'text')?.text || 'MT5 暂时无法提供数据', 502, 'mt5_read_unavailable');
  return result.structuredContent ?? JSON.parse(result.content?.find(p => p.type === 'text')?.text ?? '{}');
};
const accountKey = account => digest(`${account.server}\n${account.login}`).slice(7, 31);
const numeric = value => { const n = Number(value); requireValue(value !== null && value !== '' && Number.isFinite(n), 'MT5 返回了无效数值', 502); return n; };

/** One durable local database, independent of web sessions and chart instances. */
export class Market {
  constructor(mt5, options = mt5.options?.market ?? {}) {
    this.mt5 = mt5; this.official = mt5.official; this.storage = mt5.storage; this.pending = new Map(); this.activeRanges = new Map(); this.lifetime = new AbortController(); this.reads = new Set();
    this.databasePath = join(this.storage.directory, 'mt5', 'market.sqlite');
    this.db = new DatabaseSync(this.databasePath);
    if (this.db.prepare('PRAGMA auto_vacuum').get().auto_vacuum !== 2) this.db.exec('PRAGMA auto_vacuum=INCREMENTAL; VACUUM');
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS bars(server TEXT,symbol TEXT,period TEXT,time INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL,PRIMARY KEY(server,symbol,period,time));
      CREATE TABLE IF NOT EXISTS series(server TEXT,symbol TEXT,period TEXT,updated_at TEXT,PRIMARY KEY(server,symbol,period));
      CREATE TABLE IF NOT EXISTS ranges(server TEXT,symbol TEXT,period TEXT,start INTEGER,end INTEGER,downloaded_at TEXT,PRIMARY KEY(server,symbol,period,start,end));
      CREATE TABLE IF NOT EXISTS symbols(server TEXT PRIMARY KEY,body TEXT,updated_at TEXT);
      CREATE TABLE IF NOT EXISTS deals(id TEXT PRIMARY KEY,account TEXT,symbol TEXT,time INTEGER,body TEXT);
      CREATE INDEX IF NOT EXISTS deals_window ON deals(account,symbol,time);
      CREATE TABLE IF NOT EXISTS trade_sync(account TEXT PRIMARY KEY,updated_at TEXT,start INTEGER,end INTEGER);
      CREATE TABLE IF NOT EXISTS contract_bars(server TEXT,symbol TEXT,period TEXT,time INTEGER,body TEXT,observed_at INTEGER,PRIMARY KEY(server,symbol,period,time));
      CREATE INDEX IF NOT EXISTS contract_bars_age ON contract_bars(observed_at);`);
    this.cache = new MarketCache(this, options);
    this.liveWrites = new Map();
    this.queries = new Map(); this.tradeJobs = new Map(); this.symbolJobs = new Map();
    this.maintenance = setInterval(() => { try { if (!this.pending.size) this.cache.trim(); } catch { /* Retry maintenance later; reads remain available. */ } }, 60000); this.maintenance.unref();
  }
  scope() { const a = this.official.config.account; requireValue(a.server && a.login, '请先配置 MT5 账户', 409); return { server: a.server, login: String(a.login), key: accountKey(a) }; }
  cacheNativeBars(server, symbol, period, rows, observedAt = Date.now()) {
    const put = this.db.prepare('INSERT OR REPLACE INTO contract_bars VALUES(?,?,?,?,?,?)');
    this.db.exec('BEGIN');
    try {
      const ordered = [...rows].sort((a, b) => brokerTime(a.time) - brokerTime(b.time));
      const previous = this.db.prepare('SELECT body FROM contract_bars WHERE server=? AND symbol=? AND period=? AND time=?');
      for (const [index, row] of ordered.entries()) {
        const time = brokerTime(row.time), old = previous.get(server, symbol, period, time);
        const closed = brokerTime(ordered.at(-1).time) > time || old && JSON.parse(old.body)._successor_observed === true;
        put.run(server, symbol, period, time, JSON.stringify({ ...row, ...(closed ? { _successor_observed: true } : {}) }), observedAt);
      }
      const size = this.db.prepare('SELECT COUNT(*) count,COALESCE(SUM(length(body)),0) bytes FROM contract_bars').get();
      if (size.count > 200000 || size.bytes > 64 * 1024 * 1024) {
        const remove = Math.max(size.count - 200000, Math.ceil(size.count * (1 - 64 * 1024 * 1024 / Math.max(size.bytes, 1))), 1000);
        this.db.prepare('DELETE FROM contract_bars WHERE rowid IN (SELECT rowid FROM contract_bars ORDER BY observed_at,time LIMIT ?)').run(remove);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  nativeBars(server, symbol, period, from, to) {
    const rows = this.db.prepare('SELECT body,observed_at FROM contract_bars WHERE server=? AND symbol=? AND period=? AND time>=? AND time<? ORDER BY time').all(server, symbol, period, from, to);
    return { rows: rows.map(row => JSON.parse(row.body)), observedAt: rows.length ? rows.reduce((at, row) => Math.min(at, row.observed_at), Infinity) : null };
  }
  async read(tool, args = {}, signal) {
    requireValue(!this.mt5.terminalPreparing, '终端正在自动配置，本地历史仍可查看', 503, 'terminal_preparing');
    const blocked = this.official.access('terminal', tool, null).blocked_reason;
    requireValue(!blocked, blocked, 403, 'mt5_permission_denied');
    const promise = this.official.client('terminal').call(tool, args, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(25000), ...(signal ? [signal] : [])]));
    this.reads.add(promise);
    try { const data = nativeData(await promise); this.lifetime.signal.throwIfAborted(); return data; }
    finally { this.reads.delete(promise); }
  }
  async connected() {
    const scope = this.scope(), info = await this.read('get_trading_account_info');
    requireValue(info.terminal?.server_connected === true, '终端未连接交易服务器；本地已下载数据仍可查看', 503, 'mt5_offline');
    requireValue(String(info.account?.login) === scope.login && info.account?.server === scope.server, '终端账户与连接设置不一致', 409, 'mt5_account_mismatch');
    return { scope, info };
  }
  async symbols(refresh = false) {
    const { server } = this.scope(), cached = this.db.prepare('SELECT * FROM symbols WHERE server=?').get(server);
    if (cached && !refresh && Date.now() - Date.parse(cached.updated_at) < 86400_000) return { server, items: JSON.parse(cached.body), updated_at: cached.updated_at, cached: true };
    if (this.symbolJobs.has(server)) return this.symbolJobs.get(server);
    const job = this.loadSymbols(server, cached);
    this.symbolJobs.set(server, job);
    try { return await job; } finally { this.symbolJobs.delete(server); }
  }
  async loadSymbols(server, cached) {
    try {
      await this.connected();
      const data = await this.read('get_marketwatch_symbols', { include_hidden: true, limit: 10000 });
      requireValue(this.scope().server === server && (await this.connected()).scope.server === server, '下载期间券商服务器已更改', 409);
      requireValue(Array.isArray(data.symbols) && data.symbols.length < 10000, '品种目录不完整，请缩小券商目录范围', 502);
      const items = data.symbols.filter(s => typeof s.symbol === 'string').map(s => ({ symbol: s.symbol, description: s.description ?? '', digits: s.digits ?? 5, point: s.point ?? 0.00001, selected: !!s.selected, currency: s.currency_profit ?? '' }));
      const timestamp = now(); this.db.prepare('INSERT OR REPLACE INTO symbols VALUES(?,?,?)').run(server, JSON.stringify(items), timestamp);
      return { server, items, updated_at: timestamp, cached: false };
    } catch (error) { if (!cached) throw error; return { server, items: JSON.parse(cached.body), updated_at: cached.updated_at, cached: true, warning: this.official.redact(error.message) }; }
  }
  async searchSymbols({ q = '', offset = 0, limit = 50 } = {}) {
    requireValue(typeof q === 'string' && q.length <= 100 && !/[\x00-\x1f]/.test(q), '品种搜索内容无效');
    offset = Number(offset); limit = Number(limit);
    requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= 10000, '品种目录偏移无效');
    requireValue(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, '每页品种数量应为 1–100');
    const catalog = await this.symbols(), query = q.trim().toLowerCase();
    const rank = item => {
      const symbol = item.symbol.toLowerCase();
      return symbol === query ? 0 : symbol.startsWith(query) ? 1 : symbol.includes(query) ? 2 : 3;
    };
    const matches = catalog.items.filter(item => !query || item.symbol.toLowerCase().includes(query) || String(item.description).toLowerCase().includes(query))
      .sort((a, b) => (query ? rank(a) - rank(b) : Number(b.selected) - Number(a.selected)) || a.symbol.localeCompare(b.symbol));
    const items = matches.slice(offset, offset + limit), next = offset + items.length;
    return { ...catalog, items, total: matches.length, has_more: next < matches.length, next_offset: next < matches.length ? next : null };
  }
  validate(input) {
    const { symbol, period } = input;
    requireValue(typeof symbol === 'string' && symbol.length > 0 && symbol.length <= 100 && !/[\x00-\x1f]/.test(symbol) && Object.hasOwn(PERIODS, period), '品种或周期无效');
    const from = Number(input.from), to = Number(input.to);
    requireValue(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to > from && to < 4102444800, '需要有效的券商时间范围');
    return { symbol, period, from, to };
  }
  bars(input) {
    const { server } = this.scope(), { symbol, period, from, to } = this.validate(input), limit = Number(input.limit ?? 4000), offset = Number(input.offset ?? 0);
    requireValue(Number.isInteger(limit) && limit > 0 && limit <= 20000, '每页 K 线数量应为 1–20000');
    requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= 200000, 'K 线偏移应为 0–200000；更大范围请使用 next_before 分页');
    const rows = this.db.prepare('SELECT time,open,high,low,close,volume FROM bars WHERE server=? AND symbol=? AND period=? AND time>=? AND time<? ORDER BY time DESC LIMIT ? OFFSET ?').all(server, symbol, period, from, to, limit + 1, offset);
    const more = rows.length > limit; if (more) rows.pop(); rows.reverse();
    this.cache.accessed(server, symbol, period, from, to);
    const metadata = this.db.prepare('SELECT updated_at FROM series WHERE server=? AND symbol=? AND period=?').get(server, symbol, period);
    return { server, symbol, period, bars: rows, has_more: more, next_before: more ? rows[0].time : null, updated_at: metadata?.updated_at ?? null, time_basis: TIME_BASIS };
  }
  inventory() {
    const items = this.db.prepare(`SELECT b.server,b.symbol,b.period,COUNT(*) bar_count,MIN(b.time) first_time,MAX(b.time) last_time,s.updated_at
      FROM bars b LEFT JOIN series s USING(server,symbol,period) GROUP BY b.server,b.symbol,b.period ORDER BY s.updated_at DESC`).all();
    return { items, ...this.cache.stats(), typed_cache: this.db.prepare('SELECT COUNT(*) bar_count,COALESCE(SUM(length(body)),0) payload_bytes FROM contract_bars').get(), time_basis: TIME_BASIS };
  }
  remove(input) {
    const { server } = this.scope(), { symbol, period } = this.validate({ ...input, from: 0, to: 1 });
    requireValue(!this.pending.has(`${server}:${symbol}:${period}`), '正在下载此品种，请稍后清理', 409);
    this.db.exec('BEGIN');
    try { for (const table of ['bars', 'series', 'ranges', 'cache_blocks', 'contract_bars']) this.db.prepare(`DELETE FROM ${table} WHERE server=? AND symbol=? AND period=?`).run(server, symbol, period); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    this.db.exec('PRAGMA incremental_vacuum; PRAGMA wal_checkpoint(TRUNCATE)');
    return this.inventory();
  }
  async sync(input) {
    const range = this.validate(input), scope = this.scope(), key = `${scope.server}:${range.symbol}:${range.period}`;
    requireValue((range.to - range.from) / PERIODS[range.period] <= 200000, '单次最多下载 200000 根 K 线，请分段下载');
    if (this.pending.has(key)) { await this.pending.get(key); return this.sync(input); }
    const promise = this.download(scope, range, input.refresh === true);
    this.pending.set(key, promise); this.activeRanges.set(key, range);
    try { return await promise; } finally { this.pending.delete(key); this.activeRanges.delete(key); }
  }
  async query(input) {
    const range = this.validate(input), scope = this.scope();
    const key = JSON.stringify([scope.key, range]);
    if (this.queries.has(key)) { await this.queries.get(key); requireValue(this.scope().key === scope.key, '查询期间账户已更改', 409); return this.bars(input); }
    const task = (async () => {
      await this.sync(range);
      requireValue(this.scope().key === scope.key, '查询期间账户已更改', 409);
    })();
    this.queries.set(key, task);
    try { await task; return this.bars(input); } finally { this.queries.delete(key); }
  }
  normalize(rows, from = 0, to = 4102444800) {
    return rows.map(row => {
      const time = brokerTime(row.time), open = numeric(row.open), high = numeric(row.high), low = numeric(row.low), close = numeric(row.close), volume = numeric(row.tick_volume ?? row.real_volume ?? row.volume ?? 0);
      requireValue(time >= from && time < to && low <= Math.min(open, close) && high >= Math.max(open, close) && volume >= 0, 'MT5 K 线范围或价格无效', 502);
      return { time, open, high, low, close, volume };
    }).sort((a, b) => a.time - b.time);
  }
  async latest(input) {
    const { scope } = await this.connected(), { symbol, period } = this.validate(input);
    // A small latest-N read is deliberately not a history coverage certificate.
    const to = Math.floor(Date.now() / 1000) + 86400, from = Math.max(0, to - Math.max(PERIODS[period] * 8, 7 * 86400));
    const result = await this.read('get_chart_history', { symbol, period, datetime_from: brokerISO(from), datetime_to: brokerISO(to), limit: 4 });
    requireValue(this.scope().key === scope.key && (await this.connected()).scope.key === scope.key, '读取期间账户已更改', 409);
    requireValue(result.ok !== false && Array.isArray(result.history), 'MT5 历史数据尚未完整返回，请稍后重试', 503);
    return { server: scope.server, symbol, period, bars: this.normalize(result.history, from, to).slice(-4), updated_at: now(), time_basis: TIME_BASIS };
  }
  persistLive({ server, symbol, period, bars }) {
    const closed = bars.slice(0, -1), key = `${server}:${symbol}:${period}`, fingerprint = JSON.stringify(closed);
    if (!closed.length || this.liveWrites.get(key) === fingerprint || this.pending.has(key)) return;
    if (!this.cache.trim(32768).writable) return;
    const put = this.db.prepare('INSERT OR REPLACE INTO bars VALUES(?,?,?,?,?,?,?,?,?)');
    this.db.exec('BEGIN');
    try {
      for (const b of closed) put.run(server, symbol, period, b.time, b.open, b.high, b.low, b.close, b.volume);
      this.db.prepare('INSERT OR REPLACE INTO series VALUES(?,?,?,?)').run(server, symbol, period, now());
      this.cache.touch({ server, symbol, period, start: closed[0].time, end: bars.at(-1).time });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    if (this.liveWrites.size >= 128) this.liveWrites.delete(this.liveWrites.keys().next().value);
    this.liveWrites.set(key, fingerprint);
  }
  async download(scope, { symbol, period, from, to }, refresh) {
    const { scope: connected } = await this.connected(); requireValue(connected.key === scope.key, '下载期间账户已更改', 409);
    const upsert = this.db.prepare('INSERT OR REPLACE INTO bars VALUES(?,?,?,?,?,?,?,?,?)');
    let downloaded = 0, reused = 0;
    // Bound each native response by time, not by truncating the latest N bars.
    for (let start = from; start < to; start += PERIODS[period] * 2000) {
      const end = Math.min(to, start + PERIODS[period] * 2000);
      const covered = this.db.prepare('SELECT 1 FROM ranges WHERE server=? AND symbol=? AND period=? AND start<=? AND end>=? LIMIT 1').get(scope.server, symbol, period, start, end);
      if (!refresh && covered && end < to - PERIODS[period] * 2) { reused++; continue; }
      requireValue(this.cache.trim(512 * 1024).writable, '行情缓存空间不足，已暂停历史预取；实时图表仍可使用', 507, 'cache_full');
      const data = await this.read('get_chart_history', { symbol, period, datetime_from: brokerISO(start), datetime_to: brokerISO(end), limit: 5000 });
      requireValue(this.scope().key === scope.key, '下载期间账户配置已更改', 409);
      requireValue((await this.connected()).scope.key === scope.key, '下载期间终端账户已更改', 409);
      requireValue(data.ok !== false && Array.isArray(data.history) && data.history.length < 5000, 'MT5 历史数据尚未完整返回，请稍后重试', 503, 'mt5_history_pending');
      const values = this.normalize(data.history, start, end);
      requireValue(this.cache.trim(Math.max(128 * 1024, Buffer.byteLength(JSON.stringify(values)) * 4 + 65536)).writable, '行情缓存空间不足，请缩小查询范围；已保留引用证据', 507, 'cache_full');
      const bars = values.map(b => [scope.server, symbol, period, b.time, b.open, b.high, b.low, b.close, b.volume]);
      const timestamp = now(); this.db.exec('BEGIN');
      try {
        for (const bar of bars) upsert.run(...bar);
        this.db.prepare('INSERT OR REPLACE INTO series VALUES(?,?,?,?)').run(scope.server, symbol, period, timestamp);
        // Never certify future time or an unfinished candle as immutable history.
        const confirmedEnd = end < Date.now() / 1000 - 2 * 86400 ? end : Math.min(end, values.at(-1)?.time ?? start);
        if (confirmedEnd > start) this.recordRange(scope.server, symbol, period, start, confirmedEnd, timestamp);
        if (bars.length) this.cache.touch({ server: scope.server, symbol, period, start, end });
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
      downloaded += bars.length;
    }
    return { server: scope.server, symbol, period, downloaded, reused_chunks: reused, updated_at: now(), time_basis: TIME_BASIS };
  }
  recordRange(server, symbol, period, start, end, timestamp) {
    const overlap = this.db.prepare('SELECT MIN(start) start,MAX(end) end FROM ranges WHERE server=? AND symbol=? AND period=? AND start<=? AND end>=?').get(server, symbol, period, end, start);
    start = Math.min(start, overlap.start ?? start); end = Math.max(end, overlap.end ?? end);
    this.db.prepare('DELETE FROM ranges WHERE server=? AND symbol=? AND period=? AND start<=? AND end>=?').run(server, symbol, period, end, start);
    this.db.prepare('INSERT OR REPLACE INTO ranges VALUES(?,?,?,?,?,?)').run(server, symbol, period, start, end, timestamp);
  }
  async syncTrades(input) {
    const key = JSON.stringify([this.scope().key, input.from, input.to]);
    if (this.tradeJobs.has(key)) return this.tradeJobs.get(key);
    const task = this.downloadTrades(input); this.tradeJobs.set(key, task);
    try { return await task; } finally { this.tradeJobs.delete(key); }
  }
  async downloadTrades(input) {
    const from = Number(input.from), to = Number(input.to);
    requireValue(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to > from && to < 4102444800, '需要有效的成交同步时间范围');
    const { scope } = await this.connected();
    const rows = [];
    const readRange = async (start, end) => {
      const data = await this.read('get_trading_history_orders', { datetime_from: brokerISO(start), datetime_to: brokerISO(end), include_orders: false, include_deals: true, limit: 5000 });
      requireValue(Array.isArray(data.deals), 'MT5 未返回成交账本', 502);
      if (data.deals.length >= 5000) { requireValue(end - start > 1, '该秒成交超过接口上限，未标记同步完成', 502); const mid = Math.floor((start + end) / 2); await readRange(start, mid); await readRange(mid, end); return; }
      for (const d of data.deals) {
        const side = String(d.action ?? d.type ?? '').replace(/^DEAL_TYPE_/, '').toLowerCase();
        if (!['buy', 'sell'].includes(side) || !d.symbol) continue;
        const ticket = String(d.deal_id ?? d.ticket ?? ''); requireValue(/^\d+$/.test(ticket), '成交票据无效', 502);
        const time = brokerTime(d.open_time ?? d.time), gross = numeric(d.profit ?? 0), costs = numeric(d.commission ?? 0) + numeric(d.swap ?? 0) + numeric(d.fee ?? 0);
        rows.push({ id: `live_${scope.key}_deal_${ticket}`, ticket, order: String(d.order_id ?? d.order ?? '0'), position_id: String(d.position_id ?? '0'), symbol: d.symbol, side, entry: String(d.entry ?? ''), reason: String(d.reason ?? ''), time, volume: numeric(d.volume), price: numeric(d.price ?? d.open_price), pnl: gross + costs, gross_pnl: gross, cost: -costs, currency: d.currency ?? '', magic: String(d.magic ?? d.magic_number ?? '0'), time_basis: TIME_BASIS, raw: d });
      }
    };
    // Sparse accounts need only one native read, even across years. Dense ranges
    // are bisected above until every response is demonstrably below the cap.
    await readRange(from, to);
    requireValue(this.scope().key === scope.key, '同步期间账户配置已更改', 409);
    requireValue((await this.connected()).scope.key === scope.key, '同步期间终端账户已更改', 409);
    const put = this.db.prepare('INSERT OR REPLACE INTO deals VALUES(?,?,?,?,?)');
    this.db.exec('BEGIN');
    try {
      for (const row of rows) put.run(row.id, scope.key, row.symbol, row.time, JSON.stringify(row));
      this.db.prepare('INSERT OR REPLACE INTO trade_sync VALUES(?,?,?,?)').run(scope.key, now(), from, to); this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return { downloaded: rows.length, updated_at: now() };
  }
  trades(input) {
    const scope = this.scope(), { symbol, from, to } = this.validate({ ...input, period: input.period ?? 'M1' });
    const rows = this.db.prepare('SELECT body FROM deals WHERE account=? AND symbol=? AND time>=? AND time<? ORDER BY time,id').all(scope.key, symbol, from, to).map(r => JSON.parse(r.body));
    return { items: rows, sync: this.db.prepare('SELECT updated_at,start,end FROM trade_sync WHERE account=?').get(scope.key) ?? null, time_basis: TIME_BASIS };
  }
  trade(id) { const value = this.db.prepare('SELECT body FROM deals WHERE id=? AND account=?').get(id, this.scope().key); requireValue(value, '成交不存在于当前账户', 404); return JSON.parse(value.body); }
  close() {
    return this.closing ??= (async () => { clearInterval(this.maintenance); this.lifetime.abort(); await Promise.allSettled([...this.pending.values(), ...this.tradeJobs.values(), ...this.symbolJobs.values(), ...this.queries.values(), ...this.reads]); this.db.close(); })();
  }
}
