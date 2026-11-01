import { randomUUID } from 'node:crypto';
import { amount, check, Decimal, digest, metadata, na, nativeId, same, sourceId, unknown, utc, value } from './common.js';
import { Pages } from './pages.js';
import { valueBalances } from './valuation.js';

const states = { NEW: 'working', PENDING_NEW: 'pending', PARTIALLY_FILLED: 'partially_filled', FILLED: 'filled', CANCELED: 'cancelled', PENDING_CANCEL: 'cancel_pending', REJECTED: 'rejected', EXPIRED: 'expired', EXPIRED_IN_MATCH: 'expired' };
export class Account {
  constructor(client, market, { now = Date.now } = {}) { this.client = client; this.market = market; this.now = now; this.bindings = new Map(); this.pages = new Pages(now); }
  async read(signal, expected) {
    const config = this.client.config(), identity = this.client.identity();
    check(!expected || same(expected, identity), 'Binance account configuration changed', 'CONNECTION_CHANGED');
    const from = this.now();
    const data = await this.client.request(config.environment, 'GET', '/api/v3/account', { omitZeroBalances: true }, { signed: true, expectedIdentity: identity, signal });
    const observedAt = this.now();
    this.client.assertIdentity(identity);
    check(Array.isArray(data.balances) && data.accountType === 'SPOT', 'Expected a Binance Spot account response', 'INVALID_PROVIDER_DATA');
    const balances = data.balances.map(row => ({ asset: String(row.asset), free: amount(row.free), locked: amount(row.locked) }));
    const account = { ...identity, accountId: data.uid === undefined ? `key:${identity.revision.slice(0, 20)}` : nativeId(data.uid) };
    return { account, environment: config.environment, balances, canTrade: data.canTrade === true, canWithdraw: data.canWithdraw === true, permissions: data.permissions ?? [], updateTime: Number.isSafeInteger(data.updateTime) ? data.updateTime : null, observedAt, samplingWindow: { from, to: observedAt } };
  }
  ref(account) { return { connectionId: account.connectionId, accountId: account.accountId }; }
  summary(read) { return { ref: this.ref(read.account), name: `Binance Spot ${read.environment} · ${read.account.accountId}`, broker: 'Binance', server: value(read.environment), nativeLogin: value(read.account.accountId), mode: read.environment === 'production' ? 'live' : 'demo', baseCurrency: value('USDT'), positionMode: 'netting' }; }
  async bind(input = {}, signal) {
    check(!input.configuration || Object.keys(input.configuration).length === 0, 'Account source uses the shared Binance credentials and environment', 'INVALID_ARGUMENT');
    const read = await this.read(signal), connection = { id: read.account.connectionId, revision: read.account.revision };
    check(!input.connection || same(input.connection, connection), 'Select the exact current Binance account connection', 'CONNECTION_CHANGED');
    const binding = { bindingId: randomUUID(), connection, account: read.account, environment: read.environment, sourceId: sourceId(read.environment), health: 'ready' };
    this.bindings.set(binding.bindingId, binding); return binding;
  }
  bound(binding, ref) {
    const current = this.bindings.get(binding?.bindingId);
    check(current && same(current.connection, binding.connection), 'Binance account binding closed or changed', 'CONNECTION_CHANGED');
    this.client.assertIdentity({ connectionId: current.account.connectionId, revision: current.account.revision });
    check(!ref || same(ref, this.ref(current.account)), 'Account belongs to another Binance connection', 'ACCOUNT_MISMATCH'); return current;
  }
  async list(binding, query, page, signal) {
    const b = this.bound(binding);
    return this.pages.read(b.bindingId, query, page, async () => { const read = await this.read(signal); this.bound(binding); check(same(read.account, b.account), 'Binance account changed', 'ACCOUNT_MISMATCH'); return { items: [this.summary(read)], metadata: { connection: b.connection, meta: metadata(read.observedAt, 'live', { samplingWindow: read.samplingWindow }) } }; });
  }
  async snapshot(binding, query, signal) {
    const b = this.bound(binding, query.account), read = await this.read(signal); this.bound(binding);
    check(same(read.account, b.account), 'Binance account changed', 'ACCOUNT_MISMATCH');
    const valuation = await valueBalances(this.client, this.market, read, signal); this.bound(binding);
    const observedAt = this.now();
    return { items: [{ account: this.summary(read), snapshotId: digest([read, valuation]), asOf: utc(observedAt), ...valuation, buyingPower: na(), unrealizedPnl: unknown('Spot balances do not supply acquisition costs, including deposits and testnet grants'), realizedPnl: unknown('Spot account does not supply realized PnL'), margin: { used: na(), free: na(), levelRatio: na(), maintenance: na() }, restrictions: read.canTrade ? [] : [{ code: 'BINANCE_TRADING_DISABLED', description: 'The Binance account reports canTrade=false', observedAt: read.observedAt }], native: { balances: read.balances, canTrade: read.canTrade, permissions: read.permissions, updateTime: read.updateTime, observationTimeOnly: true } }], metadata: { connection: b.connection, meta: metadata(observedAt, 'live', { origin: 'derived', samplingWindow: { from: read.samplingWindow.from, to: observedAt } }) } };
  }
  order(env, account, row, symbol) {
    const id = `${account.connectionId}:${account.accountId}:${row.symbol}:${nativeId(row.orderId)}`;
    const quantity = amount(row.origQty), filled = amount(row.executedQty);
    check(Decimal.compare(filled, quantity) <= 0 && ['BUY', 'SELL'].includes(row.side), 'Invalid Binance order quantity or side', 'INVALID_PROVIDER_DATA');
    return this.market.revise({ id, account: this.ref(account), instrument: { sourceId: sourceId(env), instrumentId: row.symbol }, nativeId: value(nativeId(row.orderId)), clientId: value(String(row.clientOrderId)), side: row.side.toLowerCase(), positionEffect: na(), orderType: ({ MARKET: 'market', LIMIT: 'limit', LIMIT_MAKER: 'limit', STOP_LOSS: 'stop', STOP_LOSS_LIMIT: 'stop_limit' })[row.type] ?? 'other', quantity: { value: quantity, unit: symbol.baseAsset }, filledQuantity: { value: filled, unit: symbol.baseAsset }, remainingQuantity: value({ value: Decimal.sub(quantity, filled), unit: symbol.baseAsset }), limitPrice: row.type.includes('LIMIT') ? value(amount(row.price)) : na(), stopPrice: row.stopPrice && Decimal.compare(amount(row.stopPrice), '0') > 0 ? value(row.stopPrice) : na(), timeInForce: row.timeInForce ? value(row.timeInForce) : na(), status: states[row.status] ?? 'unknown', nativeStatus: String(row.status), createdAt: utc(row.time ?? row.transactTime), updatedAt: utc(row.updateTime ?? row.transactTime ?? row.time), expiresAt: unknown('No expiry time supplied'), rejectReason: row.status === 'REJECTED' ? unknown('No rejection explanation in order state') : na(), correlation: unknown('No trusted strategy correlation supplied') });
  }
  fill(env, account, row, symbol) {
    const orderId = nativeId(row.orderId), id = nativeId(row.id);
    return this.market.revise({ id: `${account.connectionId}:${account.accountId}:${symbol.symbol}:fill:${id}`, account: this.ref(account), instrument: { sourceId: sourceId(env), instrumentId: symbol.symbol }, nativeId: id, orderId: value(`${account.connectionId}:${account.accountId}:${symbol.symbol}:${orderId}`), nativeOrderId: value(orderId), time: utc(row.time), side: row.isBuyer ? 'buy' : 'sell', quantity: { value: amount(row.qty), unit: symbol.baseAsset }, price: amount(row.price), positionEffect: na(), fees: value([{ value: amount(row.commission), currency: String(row.commissionAsset) }]), realizedPnl: unknown('Binance fills do not carry strategy cost-basis PnL'), correlation: unknown('No trusted strategy correlation supplied'), correction: na() });
  }
  refs(binding, refs, required) {
    check(!required || Array.isArray(refs) && refs.length >= 1, 'Select explicit Binance instruments for historical orders or fills', 'INVALID_ARGUMENT');
    check(!refs || Array.isArray(refs) && refs.length <= 5, 'Query at most five explicit instruments', 'INVALID_ARGUMENT');
    for (const ref of refs ?? []) check(ref.sourceId === binding.sourceId, 'Instrument belongs to another Binance environment', 'INSTRUMENT_MISMATCH');
    return refs?.map(ref => ref.instrumentId);
  }
  range(range) { check(range?.from?.basis === 'utc' && range?.to?.basis === 'utc' && Number.isSafeInteger(range.from.unixMs) && Number.isSafeInteger(range.to.unixMs) && range.from.unixMs < range.to.unixMs && range.to.unixMs - range.from.unixMs <= 86400000, 'Select an explicit UTC history window up to 24 hours', 'INVALID_ARGUMENT'); return { startTime: range.from.unixMs, endTime: range.to.unixMs - 1 }; }
  async orders(binding, query, page, signal) {
    const b = this.bound(binding, query.account), working = query.scope === 'working';
    check(['working', 'history', 'all'].includes(query.scope), 'Choose working, history or all order scope', 'INVALID_ARGUMENT');
    const symbols = this.refs(b, query.instruments, !working), range = working ? {} : this.range(query.range);
    return this.pages.read(b.bindingId, query, page, async () => {
      const from = this.now(), rows = []; let truncated = false;
      for (const symbol of symbols ?? [undefined]) {
        const native = await this.client.request(b.environment, 'GET', working ? '/api/v3/openOrders' : '/api/v3/allOrders', { symbol, ...range, ...(working ? {} : { limit: 1000 }) }, { signed: true, expectedIdentity: { connectionId: b.account.connectionId, revision: b.account.revision }, signal });
        check(Array.isArray(native) && native.length <= 20000, 'Invalid Binance order page', 'INVALID_PROVIDER_DATA');
        if (!working && native.length === 1000) truncated = true;
        for (const row of native) {
          if (query.range && (row.time < query.range.from.unixMs || row.time >= query.range.to.unixMs)) continue;
          if (query.scope === 'history' && ['NEW', 'PARTIALLY_FILLED', 'PENDING_NEW', 'PENDING_CANCEL'].includes(row.status)) continue;
          rows.push(this.order(b.environment, b.account, row, await this.market.row(b.environment, row.symbol, signal)));
        }
      }
      this.bound(binding); rows.sort((a, b) => a.createdAt.unixMs - b.createdAt.unixMs || a.id.localeCompare(b.id));
      const observedAt = this.now();
      return { items: rows, metadata: { connection: b.connection, meta: metadata(observedAt, 'live', { samplingWindow: { from, to: observedAt } }), ...(query.range ? { coverage: { requested: query.range, observedRange: rows.length ? { from: rows[0].createdAt, to: rows.at(-1).createdAt } : null, complete: !truncated, gaps: truncated ? [{ range: query.range, reason: 'not_loaded' }] : [] }, truncated } : {}) } };
    });
  }
  async fills(binding, query, page, signal) {
    const b = this.bound(binding, query.account), symbols = this.refs(b, query.instruments, true), range = this.range(query.range);
    return this.pages.read(b.bindingId, query, page, async () => {
      const from = this.now(), rows = []; let truncated = false;
      for (const symbol of symbols) {
        const definition = await this.market.row(b.environment, symbol, signal), native = await this.client.request(b.environment, 'GET', '/api/v3/myTrades', { symbol, ...range, limit: 1000 }, { signed: true, expectedIdentity: { connectionId: b.account.connectionId, revision: b.account.revision }, signal });
        check(Array.isArray(native), 'Invalid Binance fill page', 'INVALID_PROVIDER_DATA'); if (native.length === 1000) truncated = true;
        for (const row of native) { const mapped = this.fill(b.environment, b.account, row, definition); if (!query.orderIds || query.orderIds.includes(mapped.orderId.value) || query.orderIds.includes(mapped.nativeOrderId.value)) rows.push(mapped); }
      }
      this.bound(binding); rows.sort((a, b) => a.time.unixMs - b.time.unixMs || a.id.localeCompare(b.id));
      const observedAt = this.now();
      return { items: rows, metadata: { connection: b.connection, meta: metadata(observedAt, 'live', { samplingWindow: { from, to: observedAt } }), coverage: { requested: query.range, observedRange: rows.length ? { from: rows[0].time, to: rows.at(-1).time } : null, complete: !truncated, gaps: truncated ? [{ range: query.range, reason: 'not_loaded' }] : [] }, truncated } };
    });
  }
  unbind(binding) { this.pages.close(binding.bindingId); this.bindings.delete(binding.bindingId); }
  dispose() { this.pages.close(); this.bindings.clear(); }
}
