// Portable data-only primitives. No host imports, account access or dependency installs.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
export const HOUR = 3600000;
export const PREPARE_TIMEOUT_MS = 25 * 60 * 1000;
export const LIMIT = 1024 * 1024 * 1024;
export const OWNED = 'kurumi-data-v1';
export const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export class DataPausedError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'DataPausedError'; this.code = code;
    this.paused = true; this.details = details;
  }
}
export const fail = (code, message, details) => { throw new DataPausedError(code, message, details); };
export const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
export function abort(signal) {
  if (signal?.aborted) fail('CANCELLED', '准备已取消；没有发布半份数据。');
}
export async function config() {
  const bytes = await fs.readFile(path.join(PACKAGE, 'data-windows.json'));
  const value = JSON.parse(bytes), profiles = [['500','0.2'],['25','0.5'],['25','0.3']];
  if (value.preparation?.timeoutMs !== PREPARE_TIMEOUT_MS || value.preparation?.downloadConcurrency !== 1 || value.chapters?.length !== 3 || value.chapters.some((ch,i) => ch.leverage !== profiles[i][0] || ch.stopout !== profiles[i][1])) fail('CONFIG_MISMATCH', '冻结章节杠杆/强平比例或prepare期限不符；不采用全程25/50默认值。');
  return { value, digest: hash(bytes) };
}
export function relative(rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /[\\\x00]/.test(rel)
      || rel.split('/').some(x => !x || x === '.' || x === '..')) {
    fail('UNSAFE_PATH', '只允许存储目录内的普通相对路径。');
  }
  return rel;
}
export async function storage(directory, create = false) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('UNSAFE_PATH', 'storageDirectory 必须是绝对路径。');
  const requested = path.resolve(directory);
  // Never put a dependency or price file in this package, including via an alias.
  if (requested === PACKAGE || requested.startsWith(PACKAGE + path.sep)) fail('UNSAFE_PATH', '行情和依赖不能写入包目录。');
  // Check each existing component before mkdir; an ancestor alias (e.g. /tmp) is
  // canonicalised, but the caller's final directory itself may not be a symlink.
  try { if ((await fs.lstat(requested)).isSymbolicLink()) fail('UNSAFE_PATH', 'storageDirectory 不能是符号链接。'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; if (!create) fail('NOT_PREPARED', '数据尚未准备；loadData 不会安装依赖。'); }
  if (create) await fs.mkdir(requested, { recursive: true });
  const base = await fs.realpath(requested);
  if (base === PACKAGE || base.startsWith(PACKAGE + path.sep)) fail('UNSAFE_PATH', '存储目录解析到了包目录。');
  const root = path.join(base, OWNED);
  try {
    const s = await fs.lstat(root);
    if (!s.isDirectory() || s.isSymbolicLink()) fail('UNSAFE_PATH', '数据目录必须是普通目录。');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!create) fail('NOT_PREPARED', '数据尚未准备；请显式调用 prepareData。');
    await fs.mkdir(root);
  }
  return root;
}
export async function safePath(root, rel, createParents = false) {
  relative(rel);
  const parts = rel.split('/');
  let p = root;
  for (let i = 0; i < parts.length; i++) {
    p = path.join(p, parts[i]);
    try {
      const s = await fs.lstat(p);
      if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile())
          || (i < parts.length - 1 && !s.isDirectory())) fail('UNSAFE_PATH', '拒绝链接、设备或非普通目录。', { path: rel });
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (createParents && i < parts.length - 1) await fs.mkdir(p);
    }
  }
  return p;
}
export async function scan(root, prefix = '', enforceLimit = true) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  let bytes = 0; const files = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    const p = path.join(root, e.name); const s = await fs.lstat(p);
    if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile())) fail('UNSAFE_PATH', '缓存含链接或特殊文件；暂停。', { path: rel });
    if (s.isDirectory()) { const r = await scan(p, rel, enforceLimit); bytes += r.bytes; files.push(...r.files); }
    else { bytes += s.size; files.push({ path: rel, bytes: s.size }); }
    if (enforceLimit && bytes > LIMIT) fail('CACHE_LIMIT', '缓存总额超过 1 GiB；不会继续下载或读取。', { bytes, limit: LIMIT });
  }
  return { bytes, files };
}
export async function readBounded(root, rel, max = 16 * 1024 * 1024) {
  const p = await safePath(root, rel); const s = await fs.stat(p);
  if (!s.isFile() || s.size > max) fail('CACHE_LIMIT', '单文件超过读取预算或不是普通文件。', { path: rel, bytes: s.size });
  return fs.readFile(p);
}
export class Budget {
  static async create(root) { const b = new Budget(); b.root = root; b.bytes = (await scan(root)).bytes; return b; }
  async write(rel, bytes) {
    bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const p = await safePath(this.root, rel, true);
    let old = 0, existed = false;
    try { old = (await fs.stat(p)).size; existed = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (this.bytes - old + bytes.length > LIMIT) fail('CACHE_LIMIT', '写入会超过 1 GiB；暂停。', { bytes: this.bytes, additionalBytes: bytes.length, limit: LIMIT });
    // No symlinks, scripts or uncontrolled third-party file writers are used.
    await fs.writeFile(p, bytes, { flag: existed ? 'w' : 'wx' });
    this.bytes += bytes.length - old;
    return { path: rel, bytes: bytes.length, digest: hash(bytes) };
  }
  async json(rel, value) { return this.write(rel, JSON.stringify(value) + '\n'); }
}
export const NETWORK_POLICY = Object.freeze({ maxAttempts: 4, timeoutMs: 30000, baseDelayMs: 1000, maxDelayMs: 30000, maxRetryAfterMs: 120000 });
export function retryAfterMilliseconds(value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Math.min(8.64e15, Math.ceil(Number(value.trim()) * 1000));
  const t = Date.parse(value); return Number.isFinite(t) ? Math.max(0, t - now) : null;
}
export async function backoffDelay(ms, signal) {
  abort(signal);
  try { await wait(ms, undefined, { signal }); } catch (e) { abort(signal); throw e; }
  abort(signal);
}
export function assertEnvironmentProxyActive() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('TLS_VALIDATION_DISABLED', '拒绝在关闭 TLS 验证的环境下载；没有修改 TLS 或全局代理配置。');
  const configured = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (configured && !process.execArgv.includes('--use-env-proxy') && process.env.NODE_USE_ENV_PROXY !== '1') {
    fail('PROXY_NOT_ACTIVE', '存在标准环境代理，但当前 Node fetch 未启用 --use-env-proxy；暂停，不能悄悄直连。');
  }
}
/** Bounded GET retries. Test-only injection is for deterministic local tests,
 * never used by prepare/worker. Network failure does not select M1 or ticks.
 */
export async function fetchBounded(url, maxBytes, signal, options = {}) {
  abort(signal);
  const { fetchImpl = globalThis.fetch, sleep = backoffDelay, now = Date.now } = options;
  if (fetchImpl === globalThis.fetch) assertEnvironmentProxyActive();
  const policy = { ...NETWORK_POLICY, ...options.policy };
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 4 || policy.maxRetryAfterMs > 120000 || policy.timeoutMs > 30000) fail('INVALID_NETWORK_POLICY', '网络重试不能超过固定预算。');
  const history = [], redirectHistory = []; let transferredBytes = 0, requestUrl = url;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    abort(signal);
    const timeout = AbortSignal.timeout(policy.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response, failure, serverWait = null, retryable = true, size = 0;
    try {
      response = await fetchImpl(requestUrl, { signal: combined, redirect: 'manual' });
      if ([301, 302, 307, 308].includes(response.status) && options.allowHttpsRedirect && attempt < policy.maxAttempts && !redirectHistory.length && new URL(requestUrl).protocol === 'http:') {
        const next = new URL(response.headers.get('location') || '', requestUrl); const prev = new URL(requestUrl);
        if (next.protocol === 'https:' && next.host === prev.host && next.pathname === prev.pathname && !next.username && !next.password && !next.search && !next.hash) {
          await response.body?.cancel(); redirectHistory.push({ from: requestUrl, to: next.href, status: response.status });
          history.push({ attempt, url: requestUrl, status: response.status, redirectedTo: next.href, receivedBytes: 0 });
          requestUrl = next.href; continue; // one explicit same-file HTTPS GET; no repeated TLS failure retry
        }
      }
      serverWait = retryAfterMilliseconds(response.headers.get('retry-after'), now());
      if (response.status !== 200) {
        retryable = !redirectHistory.length && (response.status === 429 || (response.status >= 500 && response.status <= 599));
        await response.body?.cancel();
        failure = { url: requestUrl, requestedUrl: url, redirectHistory, phase: 'HTTP', status: response.status, location: response.headers.get('location') || undefined, responseHeaders: Object.fromEntries(['server','via','x-cache','retry-after','content-type','location'].map(k => [k, response.headers.get(k)]).filter(([, v]) => v !== null)) };
      } else {
        const length = response.headers.get('content-length'), declared = length === null ? null : Number(length);
        if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes)) {
          await response.body?.cancel(); fail('CACHE_LIMIT', 'HTTP 响应超过单次下载预算。', { url, bytes: declared });
        }
        const parts = [];
        for await (const chunk of response.body) {
          abort(signal); size += chunk.length; transferredBytes += chunk.length;
          if (size > maxBytes) fail('CACHE_LIMIT', '流式下载超过预算。', { url, bytes: size });
          parts.push(chunk);
        }
        if (declared !== null && !response.headers.get('content-encoding') && size !== declared) throw new Error('TRUNCATED_BODY');
        history.push({ attempt, url: requestUrl, status: 200, receivedBytes: size });
        return { bytes: Buffer.concat(parts), observedAt: new Date(now()).toISOString(), status: 200, url: requestUrl, requestedUrl: url, redirectHistory,
          attempts: attempt, networkBytes: transferredBytes, history, transport: new URL(requestUrl).protocol.slice(0, -1), tlsAuthenticated: new URL(requestUrl).protocol === 'https:',
          responseHeaders: Object.fromEntries(['last-modified', 'etag', 'date', 'content-type', 'content-length'].map(k => [k, response.headers.get(k)]).filter(([, v]) => v !== null)) };
      }
    } catch (e) {
      abort(signal);
      if (e instanceof DataPausedError) throw e;
      retryable = !redirectHistory.length;
      failure = { url: requestUrl, requestedUrl: url, redirectHistory, phase: response ? 'body' : 'DNS/TCP/TLS/fetch', cause: timeout.aborted ? 'REQUEST_TIMEOUT' : (e.cause?.code || e.code || e.name), diagnostic: e.message === 'TRUNCATED_BODY' ? 'TRUNCATED_BODY' : undefined };
    }
    history.push({ attempt, ...failure, receivedBytes: size });
    const details = { ...failure, attempts: attempt, networkBytes: transferredBytes, history,
      ...(serverWait !== null ? { retryAfterMs: serverWait, retryAt: new Date(Math.min(8.64e15, now() + serverWait)).toISOString() } : {}) };
    if (!retryable || attempt === policy.maxAttempts || (serverWait !== null && serverWait > policy.maxRetryAfterMs)) {
      fail('NETWORK_PAUSED', `GET 暂停：${requestUrl}；${failure.status ? 'HTTP ' + failure.status : failure.cause}；有限重试结束，没有发布数据。`, details);
    }
    // Server delay is a MINIMUM, never clipped down to our local cap. A larger
    // Retry-After pauses above rather than making an early retry.
    const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
    const delay = Math.max(serverWait || 0, exponential);
    await sleep(delay, signal); abort(signal);
  }
}
export function decimal(n, digits) {
  const scaled = Math.round(n * 10 ** digits);
  if (!Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(scaled) || Math.abs(n * 10 ** digits - scaled) > 0.000001) {
    fail('INVALID_PRICE', '源价格不能无损投影到声明精度。');
  }
  return (BigInt(scaled) / 10n ** BigInt(digits)).toString() + '.' +
    (BigInt(scaled) % 10n ** BigInt(digits)).toString().padStart(digits, '0');
}
function price(s, digits) {
  if (typeof s !== 'string' || !new RegExp(`^[0-9]+\\.[0-9]{${digits}}$`).test(s)) fail('INVALID_PRICE', '价格必须是声明精度的 Decimal 字符串。');
  const n = BigInt(s.replace('.', '')); if (n <= 0n) fail('INVALID_PRICE', '源价格必须大于零。'); return n;
}
export function validateRows(rows, ch, digits) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) fail('MISSING_DATA', 'H1 数据缺失或超出窗口预算；暂停。');
  let previous = -Infinity; const byTime = new Map();
  for (const row of rows) {
    const t = row.time;
    if (!Number.isSafeInteger(t) || t % HOUR || t <= previous || t < Date.parse(ch.from) || t > Date.parse(ch.to)) fail('TIME_MISMATCH', '时间必须按 UTC 整小时严格升序，且在闭区间内。', { time: t });
    const [o, h, l, c] = ['open', 'high', 'low', 'close'].map(k => price(row[k], digits));
    if (h < l || o > h || o < l || c > h || c < l) fail('INVALID_PRICE', 'OHLC 不满足高低边界。', { time: t });
    previous = t; byTime.set(t, row);
  }
  return byTime;
}
export function closedHour(t, ch) {
  const d = new Date(t); const day = d.getUTCDay(), hour = d.getUTCHours();
  return day === 6 || (day === 5 && hour >= ch.weekendCloseHourUtc) || (day === 0 && hour < ch.weekendOpenHourUtc);
}
export function joinChapter(ch, series) {
  const symbols = ch.fxSymbol ? [ch.symbol, ch.fxSymbol] : [ch.symbol];
  const maps = new Map();
  for (const symbol of symbols) for (const side of ['bid', 'ask']) {
    const key = `${symbol}-${side}`;
    if (!series[key]) fail('MISSING_DATA', '缺少报价侧或同步 FX 文件；暂停。', { key });
    maps.set(key, validateRows(series[key], ch, symbol === ch.symbol ? ch.digits : ch.fxDigits));
  }
  const frames = [], closedHours = []; let startIndex = -1;
  for (let t = Date.parse(ch.from); t <= Date.parse(ch.to); t += HOUR) {
    const found = [...maps].filter(([, map]) => map.has(t));
    if (found.length === 0 && closedHour(t, ch)) { closedHours.push(t); continue; }
    if (found.length !== maps.size) fail('MISSING_DATA', `UTC ${new Date(t).toISOString()} 缺少报价；暂停，绝不插值或沿用前值。`, { time: t, missing: [...maps].filter(([, m]) => !m.has(t)).map(([key]) => key) });
    const candle = key => { const { open, high, low, close } = maps.get(key).get(t); return { open, high, low, close }; };
    const frame = { time: t, bid: candle(`${ch.symbol}-bid`), ask: candle(`${ch.symbol}-ask`) };
    if (ch.fxSymbol) frame.fx = { time: t, bid: candle(`${ch.fxSymbol}-bid`), ask: candle(`${ch.fxSymbol}-ask`) };
    frame.source = { bid: maps.get(`${ch.symbol}-bid`).get(t).source, ask: maps.get(`${ch.symbol}-ask`).get(t).source };
    if (ch.fxSymbol) frame.source.fx = { bid: maps.get(`${ch.fxSymbol}-bid`).get(t).source, ask: maps.get(`${ch.fxSymbol}-ask`).get(t).source };
    if (t === Date.parse(ch.playFrom)) startIndex = frames.length;
    frames.push(frame);
  }
  if (startIndex < 0) fail('MISSING_DATA', '玩法起点没有真实同步报价；暂停。', { time: ch.playFrom });
  return {
    frames,
    chapter: { id: ch.id, symbol: ch.symbol, leverage: ch.leverage, stopout: ch.stopout, stopoutUnit: ch.stopoutUnit, ...(ch.fxSymbol ? { fxSymbol: ch.fxSymbol } : {}), startIndex, endIndex: frames.length - 1,
      weekendGaps: frames.slice(1).flatMap((f, i) => {
        const previous = frames[i].time, hours = (f.time - previous) / HOUR;
        if (hours === 1) return [];
        if (new Date(previous).getUTCDay() !== 5 || new Date(f.time).getUTCDay() !== 0 || hours < 48 || hours > 50) fail('TIME_MISMATCH', '只有真实周五到周日 48..50h 缺口可标为 FX 休市。', { from: previous, to: f.time });
        return [{ from: previous, to: f.time }];
      }),
      from: new Date(frames[0].time).toISOString(), to: new Date(frames.at(-1).time).toISOString(), playFrom: ch.playFrom,
      requestedFrom: ch.from, requestedTo: ch.to, indexConvention: 'zero-based; endIndex inclusive; startIndex = playable first hour',
      timeBasis: 'UTC', timeframe: 'H1', closedHours, unknownGapPolicy: 'pause; never fill',
      boundaryAdjustment: frames.at(-1).time === Date.parse(ch.to) ? null : 'Requested final hour is closed; actual last quoted hour retained.' }
  };
}

/** Source claim must match actual transport; local hashes are not authentication. */
export function validMarketSource(ref, requestedUrl, allowHttpsRedirect = false) {
  if ((ref.requestedUrl || ref.url) !== requestedUrl) return false;
  const direct = ref.url === requestedUrl;
  const target = requestedUrl.replace(/^http:/, 'https:');
  const redirected = allowHttpsRedirect && requestedUrl.startsWith('http:') && ref.url === target &&
    ref.redirectHistory?.length === 1 && ref.redirectHistory[0].from === requestedUrl && ref.redirectHistory[0].to === target && [301, 302, 307, 308].includes(ref.redirectHistory[0].status);
  return (direct || redirected) && ref.transportScheme === new URL(ref.url).protocol.slice(0, -1) && ref.tlsAuthenticated === (new URL(ref.url).protocol === 'https:');
}
