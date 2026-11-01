import { createHmac } from 'node:crypto';
import { ENVIRONMENTS, environment, credentialIdentity, failure, settings, same, check, abortableDelay } from './common.js';

const sharedGates = new Map();
const WEIGHTS = { '/api/v3/exchangeInfo': 20, '/api/v3/account': 20, '/api/v3/myTrades': 20, '/api/v3/openOrders': 80, '/api/v3/allOrders': 20, '/api/v3/klines': 2, '/api/v3/order/amend/keepPriority': 4 };
const RESPONSE_BYTES = 8 * 1024 * 1024;
async function responseText(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > RESPONSE_BYTES) { await reader.cancel(); throw failure('RESOURCE_EXHAUSTED', 'Binance response exceeded the byte budget'); }
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally { reader.releaseLock(); }
}
function gateFor(origin) {
  if (!sharedGates.has(origin)) sharedGates.set(origin, { next: 0, blockedUntil: 0, minute: 0, weight: 0, limit: 1200 });
  return sharedGates.get(origin);
}
export class BinanceClient {
  constructor({ fetch: fetcher = globalThis.fetch, now = Date.now, sleep = abortableDelay, env = process.env, gates = sharedGates, timeoutMs = 12000 } = {}) {
    this.fetch = fetcher; this.now = now; this.sleep = sleep; this.env = env; this.gates = gates; this.timeoutMs = timeoutMs;
    this.clocks = new Map(); this.clockTasks = new Map();
  }
  config() { return settings(this.env); }
  identity() { return credentialIdentity(this.config()); }
  assertIdentity(expected) { check(!expected || same(expected, this.identity()), 'Binance credentials or environment changed; reselect the account', 'CONNECTION_CHANGED'); }
  gate(origin) { if (this.gates === sharedGates) return gateFor(origin); if (!this.gates.has(origin)) this.gates.set(origin, { next: 0, blockedUntil: 0, minute: 0, weight: 0, limit: 1200 }); return this.gates.get(origin); }
  async reserve(origin, weight, signal) {
    const gate = this.gate(origin), now = this.now();
    if (gate.blockedUntil > now) throw failure('RATE_LIMITED', 'Binance requested a retry delay', { retryAt: gate.blockedUntil });
    const minute = Math.floor(now / 60000);
    if (gate.minute !== minute) { gate.minute = minute; gate.weight = 0; }
    if (gate.weight + weight > gate.limit) throw failure('RATE_LIMITED', 'Binance request weight budget is cooling down', { retryAt: (minute + 1) * 60000 });
    const slot = Math.max(now, gate.next); gate.next = slot + 125; gate.weight += weight;
    check(slot - now < 30000, 'Binance request queue is full', 'RESOURCE_EXHAUSTED');
    if (slot > now) await this.sleep(slot - now, signal);
    signal?.throwIfAborted();
    if (gate.blockedUntil > this.now()) throw failure('RATE_LIMITED', 'Binance requested a retry delay', { retryAt: gate.blockedUntil });
  }
  async serverTime(env, signal, force = false) {
    environment(env);
    const previous = this.clocks.get(env);
    if (!force && previous && this.now() - previous.checkedAt < 30000) return previous;
    if (this.clockTasks.has(env)) return this.clockTasks.get(env);
    const task = (async () => {
      const start = this.now(), data = await this.request(env, 'GET', '/api/v3/time', {}, { signal });
      const end = this.now();
      check(Number.isSafeInteger(data.serverTime), 'Binance returned an invalid clock', 'INVALID_PROVIDER_DATA');
      const clock = { offset: data.serverTime - Math.floor((start + end) / 2), uncertaintyMs: Math.ceil((end - start) / 2), checkedAt: end };
      this.clocks.set(env, clock); return clock;
    })();
    this.clockTasks.set(env, task);
    try { return await task; } finally { this.clockTasks.delete(env); }
  }
  async request(env, method, path, params = {}, { signed = false, signal, expectedIdentity, clockRetry = true } = {}) {
    environment(env); signal?.throwIfAborted();
    let config, clock;
    if (signed) {
      config = this.config(); check(config.environment === env, 'Authenticated Binance environment changed', 'CONNECTION_CHANGED');
      credentialIdentity(config); this.assertIdentity(expectedIdentity);
      clock = await this.serverTime(env, signal);
      check(clock.uncertaintyMs < 2000, 'Binance clock round trip is too uncertain; retry the clock probe', 'SOURCE_UNAVAILABLE');
    }
    const origin = ENVIRONMENTS[env][signed ? 'signed' : 'public'];
    await this.reserve(origin, path === '/api/v3/openOrders' && params.symbol ? 6 : WEIGHTS[path] ?? 1, signal);
    this.assertIdentity(signed ? expectedIdentity ?? credentialIdentity(config) : undefined);
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    if (signed) {
      query.set('timestamp', String(Math.floor(this.now() + clock.offset))); query.set('recvWindow', '5000');
      query.set('signature', createHmac('sha256', config.secret).update(query.toString()).digest('hex'));
    }
    const controller = AbortSignal.timeout(this.timeoutMs), combined = signal ? AbortSignal.any([signal, controller]) : controller;
    let response, data, attempted = false;
    try {
      attempted = true;
      response = await this.fetch(`${origin}${path}${method === 'GET' ? `?${query}` : ''}`, { method, signal: combined, redirect: 'error', headers: { Accept: 'application/json', ...(signed ? { 'X-MBX-APIKEY': config.apiKey } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(method !== 'GET' ? { body: query.toString() } : {}) });
      const text = await responseText(response);
      // Binance UIDs/order IDs can exceed JavaScript's exact integer range.
      // JSON's source text preserves them as decimal strings before rounding.
      try { data = JSON.parse(text, (_key, value, context) => typeof value === 'number' && Number.isInteger(value)
        && !Number.isSafeInteger(value) && /^-?\d+$/.test(context.source) ? context.source : value); }
      catch { throw failure('SOURCE_UNAVAILABLE', 'Binance returned a non-JSON response'); }
    } catch (error) {
      if (signed && method !== 'GET' && attempted) throw failure('OPERATION_OUTCOME_UNKNOWN', 'Binance response was lost; query the saved order identity before another action', { submissionAttempted: true });
      if (signal?.aborted) throw signal.reason;
      if (error?.code === 'RESOURCE_EXHAUSTED') throw error;
      throw failure('SOURCE_UNAVAILABLE', 'Binance could not be reached or returned an invalid response');
    }
    const gate = this.gate(origin), used = Number(response.headers.get('x-mbx-used-weight-1m'));
    if (Number.isFinite(used) && used > gate.weight) gate.weight = used;
    if (response.status === 429 || response.status === 418) {
      const seconds = Number(response.headers.get('retry-after'));
      gate.blockedUntil = this.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : response.status === 418 ? 120000 : 5000);
      throw failure('RATE_LIMITED', 'Binance requested a retry delay', { nativeCode: data?.code, retryAt: gate.blockedUntil, submissionAttempted: signed && method !== 'GET' });
    }
    if (response.status >= 500 || data?.code === -1007 || data?.code === -1006) throw failure(signed && method !== 'GET' ? 'OPERATION_OUTCOME_UNKNOWN' : 'SOURCE_UNAVAILABLE', 'Binance did not confirm the operation outcome', { nativeCode: data?.code, submissionAttempted: signed && method !== 'GET' });
    if (data?.code === -1021 && signed && clockRetry) {
      await this.serverTime(env, signal, true);
      return this.request(env, method, path, params, { signed, signal, expectedIdentity, clockRetry: false });
    }
    if (!response.ok || typeof data?.code === 'number' && data.code < 0) {
      const code = data?.code === -2013 ? 'NOT_FOUND' : [-2014, -2015, -1022].includes(data?.code) ? 'AUTH_REQUIRED' : response.status === 451 || response.status === 403 ? 'FORBIDDEN' : 'INVALID_ARGUMENT';
      throw failure(code, `Binance rejected the request (${data?.code ?? response.status})`, { nativeCode: data?.code, submissionAttempted: signed && method !== 'GET' });
    }
    if (path === '/api/v3/exchangeInfo') {
      const limit = data.rateLimits?.find(row => row.rateLimitType === 'REQUEST_WEIGHT' && row.interval === 'MINUTE' && row.intervalNum === 1)?.limit;
      if (Number.isSafeInteger(limit) && limit > 0) gate.limit = Math.min(limit, 6000);
    }
    return data;
  }
}
