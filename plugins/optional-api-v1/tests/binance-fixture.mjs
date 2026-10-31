import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createService } from '../packages/binance/src/service.js';

export const SYMBOL = { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', quoteAssetPrecision: 8, isSpotTradingAllowed: true, amendAllowed: true, orderTypes: ['MARKET', 'LIMIT'], filters: [
  { filterType: 'PRICE_FILTER', tickSize: '0.01000000', minPrice: '0.01000000', maxPrice: '1000000.00000000' },
  { filterType: 'LOT_SIZE', stepSize: '0.00001000', minQty: '0.00001000', maxQty: '100.00000000' },
  { filterType: 'MARKET_LOT_SIZE', stepSize: '0.00000000', minQty: '0.00000000', maxQty: '100.00000000' },
  { filterType: 'MIN_NOTIONAL', minNotional: '5.00000000', applyToMarket: true, avgPriceMins: 5 },
] };
export const spec = { timeframe: '1m', priceBasis: 'last', adjustment: 'none', session: 'all', calendarRevision: { status: 'unknown', reason: 'fixture' } };
export const utc = unixMs => ({ basis: 'utc', unixMs });
export const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
export class FakeSocket extends EventTarget {
  static instances = [];
  constructor(url) { super(); this.url = url; this.closed = false; FakeSocket.instances.push(this); queueMicrotask(() => { if (!this.closed) this.dispatchEvent(new Event('open')); }); }
  message(payload) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) })); }
  close() { if (this.closed) return; this.closed = true; this.dispatchEvent(new Event('close')); }
}
export async function fixture(t, { publicOnly = false, context = 'main' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sesame-binance-fixture-'));
  let current = 2000000000000;
  const env = { BINANCE_ENVIRONMENT: 'testnet', ...(publicOnly ? {} : { BINANCE_API_KEY: 'fixture-key-not-real', BINANCE_API_SECRET: 'fixture-secret-not-real' }) };
  const calls = [], orders = new Map(), overrides = [], timers = new Set(); let orderNumber = 700;
  const now = () => current;
  const clock = { now, set: n => { current = n; }, advance: n => { current += n; } };
  const fetcher = async (url, options) => {
    const parsed = new URL(url), params = new URLSearchParams(options.method === 'GET' ? parsed.search : options.body), call = { origin: parsed.origin, path: parsed.pathname, method: options.method, params: Object.fromEntries(params), headers: options.headers };
    calls.push(call);
    if (params.has('signature')) { const actual = params.get('signature'); params.delete('signature'); assert.equal(actual, createHmac('sha256', env.BINANCE_API_SECRET).update(params.toString()).digest('hex')); assert.equal(options.headers['X-MBX-APIKEY'], env.BINANCE_API_KEY); }
    for (let i = 0; i < overrides.length; i++) { const override = overrides[i]; if (override.match(call)) { if (override.once !== false) overrides.splice(i, 1); return override.run(call, options); } }
    const p = call.params;
    if (call.path === '/api/v3/time') return response({ serverTime: now() });
    if (call.path === '/api/v3/exchangeInfo') return response({ rateLimits: [{ rateLimitType: 'REQUEST_WEIGHT', interval: 'MINUTE', intervalNum: 1, limit: 6000 }], symbols: [SYMBOL] });
    if (call.path === '/api/v3/account') return response({ uid: 12345, accountType: 'SPOT', canTrade: true, canWithdraw: false, permissions: ['SPOT'], updateTime: now(), balances: [{ asset: 'BTC', free: '1.00000000', locked: '0.00000000' }, { asset: 'USDT', free: '10000.00000000', locked: '0.00000000' }] });
    if (call.path === '/api/v3/ticker/24hr') return response({ symbol: p.symbol, bidPrice: '49999.99', askPrice: '50000.00', lastPrice: '50000.00', bidQty: '1.5', askQty: '2.5', closeTime: now() });
    if (call.path === '/api/v3/klines') {
      const duration = 60000, from = Math.ceil(Number(p.startTime) / duration) * duration, end = Math.min(Number(p.endTime), now()), rows = [];
      for (let time = from; time <= end && rows.length < Number(p.limit); time += duration) rows.push([time, '50000.00', '50002.00', '49999.00', '50001.00', '1.23456789', time + duration - 1, '61729.99999999', 3]);
      return response(rows);
    }
    if (call.path === '/api/v3/openOrders') return response([...orders.values()].filter(row => ['NEW', 'PARTIALLY_FILLED'].includes(row.status)));
    if (call.path === '/api/v3/allOrders') return response([...orders.values()]);
    if (call.path === '/api/v3/myTrades') return response([]);
    if (call.path === '/api/v3/order/test') return response({});
    if (call.path === '/api/v3/order' && call.method === 'POST') {
      const row = { symbol: p.symbol, orderId: ++orderNumber, clientOrderId: p.newClientOrderId, side: p.side, type: p.type, origQty: p.quantity, executedQty: p.type === 'MARKET' ? p.quantity : '0.00000000', price: p.price ?? '0.00000000', status: p.type === 'MARKET' ? 'FILLED' : 'NEW', timeInForce: p.timeInForce ?? 'GTC', time: now(), updateTime: now(), transactTime: now() };
      orders.set(row.clientOrderId, row); return response(row);
    }
    if (call.path === '/api/v3/order' && call.method === 'GET') { const row = p.orderId ? [...orders.values()].find(row => String(row.orderId) === p.orderId) : orders.get(p.origClientOrderId); return row ? response(row) : response({ code: -2013, msg: 'Order does not exist' }, 400); }
    if (call.path === '/api/v3/order' && call.method === 'DELETE') { const row = [...orders.values()].find(row => String(row.orderId) === p.orderId); if (!row) return response({ code: -2013 }, 400); row.status = 'CANCELED'; row.updateTime = now(); return response(row); }
    if (call.path === '/api/v3/order/amend/keepPriority') { const row = [...orders.values()].find(row => String(row.orderId) === p.orderId); row.origQty = p.newQty; row.clientOrderId = p.newClientOrderId; row.updateTime = now(); return response({ transactTime: now(), executionId: 1, amendedOrder: row }); }
    throw new Error(`Unhandled fixture route ${call.method} ${call.path}`);
  };
  const host = { context: { kind: context, sessionId: 'fixture-main', storageRoot: root } };
  const options = { fetch: fetcher, now, env, WebSocket: FakeSocket, gates: new Map(), sleep: async (ms, signal) => { signal?.throwIfAborted(); current += ms; }, setTimer: (fn, delay) => { const timer = setTimeout(fn, delay); timer.unref(); timers.add(timer); return timer; }, clearTimer: timer => { clearTimeout(timer); timers.delete(timer); } };
  const service = createService(host, options);
  t.after(async () => { await service.dispose(); for (const timer of timers) clearTimeout(timer); await rm(root, { recursive: true, force: true }); });
  return { root, host, options, service, calls, orders, overrides, env, clock, timers, latestSocket: () => FakeSocket.instances.at(-1), order: overrides => ({ operation_id: 'order-001', environment: 'testnet', symbol: 'BTCUSDT', action: 'limit', side: 'buy', quantity: '0.00100', limit_price: '50000.00', user_authorized: true, ...overrides }) };
}
