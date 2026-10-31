import { amount, check, Decimal, digest, nativeId, safeError, same } from './common.js';
import { symbolId } from './market.js';

export const EXECUTION_CONTRACT = 'sesame.execution-adapter/1';
const result = body => ({ contract: EXECUTION_CONTRACT, backend: 'binance', ...body });
const PENDING = new Set(['NEW', 'PARTIALLY_FILLED', 'PENDING_NEW', 'PENDING_CANCEL']);
const UNCERTAIN = new Set(['submitting', 'outcome_unknown']);
export class Execution {
  constructor(host, client, market, account, records, { now = Date.now, locks = new Map() } = {}) {
    this.host = host; this.client = client; this.market = market; this.account = account; this.records = records; this.now = now; this.locks = locks;
  }
  main() { check(this.host.context.kind === 'main', 'Binance trading is available to the authorized main conversation', 'FORBIDDEN'); }
  identityPart(account) { return { connectionId: account.connectionId, revision: account.revision }; }
  assertAccount(account) { this.client.assertIdentity(this.identityPart(account)); }
  async identity(_args = {}, signal) { return result({ account: (await this.account.read(signal)).account }); }
  async snapshot({ symbol } = {}, signal) {
    const began = this.now(), identity = this.client.identity(), env = this.client.config().environment;
    const [read, definition, ticker, orders] = await Promise.all([
      this.account.read(signal, identity), symbol ? this.market.row(env, symbol, signal) : null,
      symbol ? this.client.request(env, 'GET', '/api/v3/ticker/24hr', { symbol: symbolId(symbol) }, { signal }) : null,
      this.client.request(env, 'GET', '/api/v3/openOrders', { symbol }, { signed: true, expectedIdentity: identity, signal }),
    ]);
    this.assertAccount(read.account);
    check(Array.isArray(orders), 'Binance open orders response is invalid', 'INVALID_PROVIDER_DATA');
    const clock = await this.client.serverTime(env, signal), now = this.now();
    const quote = ticker ? { source: 'binance/spot/24hr-ticker', sourceTimeMs: ticker.closeTime, receivedAt: now, requestMs: now - began, bid: amount(ticker.bidPrice), ask: amount(ticker.askPrice), last: amount(ticker.lastPrice), clockOffsetMs: clock.offset, clockUncertaintyMs: clock.uncertaintyMs } : null;
    if (quote) check(Number.isSafeInteger(quote.sourceTimeMs), 'Binance ticker has no source timestamp', 'INVALID_PROVIDER_DATA');
    return result({ account: read.account, environment: env, ...(symbol ? { symbol, spec: this.market.instrument(env, definition), quote } : {}), balances: read.balances, orders, permissions: { tradeAllowed: read.canTrade }, accountSummary: this.account.summary(read), readStartedAt: began, capturedAt: now, captureMs: now - began, expiresAt: now + 5000,
      projection: { assets: read.balances, orders: orders.map(row => ({ id: nativeId(row.orderId), symbol: row.symbol, working: PENDING.has(row.status) })), positionSemantics: 'spot-asset-balances' } });
  }
  async prepare(args, signal) {
    this.main(); check(args.userAuthorized === true, 'An authorized manual trading request is required', 'FORBIDDEN');
    const snapshot = await this.snapshot({ symbol: args.symbol }, signal);
    check(same(snapshot.account, args.account), 'Binance account changed during preparation', 'CONNECTION_CHANGED');
    return { ...snapshot, preparation: { backend: 'binance', mode: 'read-only', permissionsChanged: false } };
  }
  operation(id) { check(typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(id), 'Use a stable operation_id of 1..128 safe characters', 'INVALID_ARGUMENT'); return id; }
  async exclusive(key, work) {
    const previous = this.locks.get(key) ?? Promise.resolve(), task = previous.catch(() => {}).then(work);
    this.locks.set(key, task); try { return await task; } finally { if (this.locks.get(key) === task) this.locks.delete(key); }
  }
  receipt(record) { return result({ status: record.status, submissionAttempted: record.submissionAttempted, raw: record }); }
  current(record) { this.assertAccount(record.account); check(record.environment === this.client.config().environment, 'Binance order belongs to another environment', 'CONNECTION_CHANGED'); return record; }
  readRecord(id) {
    const record = this.records.get('commands', this.operation(id)); check(record, 'Binance operation was not found', 'NOT_FOUND'); return this.current(record);
  }
  filters(snapshot, args) {
    check(snapshot.permissions.tradeAllowed, 'Binance account reports trading disabled', 'FORBIDDEN');
    check(['market', 'limit'].includes(args.action) && ['buy', 'sell'].includes(args.side), 'Use Spot market or limit and buy or sell', 'INVALID_ARGUMENT');
    check(args.position_id === undefined && args.stop_loss === undefined && args.take_profit === undefined, 'Spot orders do not support position tickets or attached MT5 stops', 'UNSUPPORTED_CAPABILITY');
    const native = snapshot.spec.native;
    check(native.status === 'TRADING' && native.orderTypes?.includes(args.action.toUpperCase()), 'The Binance symbol does not currently support this order', 'UNSUPPORTED_CAPABILITY');
    const quantity = amount(args.quantity, true), filters = native.filters ?? [], lot = filters.find(f => f.filterType === (args.action === 'market' ? 'MARKET_LOT_SIZE' : 'LOT_SIZE'));
    for (const filter of [filters.find(f => f.filterType === 'LOT_SIZE'), lot].filter(Boolean)) {
      check(Decimal.compare(quantity, amount(filter.minQty)) >= 0 && (Decimal.compare(amount(filter.maxQty), '0') === 0 || Decimal.compare(quantity, filter.maxQty) <= 0), 'Quantity is outside Binance lot bounds', 'INVALID_ARGUMENT');
      if (Decimal.compare(amount(filter.stepSize), '0') > 0) check(Decimal.compare(Decimal.quantize(quantity, filter.stepSize, 'floor'), quantity) === 0, 'Quantity does not match Binance lot step; no automatic rounding is applied', 'INVALID_ARGUMENT');
    }
    if (args.side === 'sell') {
      const available = snapshot.balances.find(row => row.asset === snapshot.spec.quantity.unit)?.free ?? '0';
      check(Decimal.compare(quantity, available) <= 0, 'Spot sell quantity exceeds the free base-asset balance', 'INVALID_ARGUMENT');
    }
    const request = { symbol: args.symbol, side: args.side.toUpperCase(), type: args.action.toUpperCase(), quantity, newOrderRespType: 'FULL' };
    if (args.action === 'limit') {
      const price = amount(args.limit_price, true), priceFilter = filters.find(f => f.filterType === 'PRICE_FILTER');
      check(['GTC', 'IOC', 'FOK'].includes(args.time_in_force ?? 'GTC'), 'Unsupported Spot time in force', 'INVALID_ARGUMENT');
      if (priceFilter) {
        for (const [key, direction] of [['minPrice', 1], ['maxPrice', -1]]) if (Decimal.compare(amount(priceFilter[key]), '0') > 0) check(Decimal.compare(price, priceFilter[key]) * direction >= 0, 'Limit price is outside Binance bounds', 'INVALID_ARGUMENT');
        if (Decimal.compare(amount(priceFilter.tickSize), '0') > 0) check(Decimal.compare(Decimal.quantize(price, priceFilter.tickSize, 'floor'), price) === 0, 'Limit price does not match Binance tick size', 'INVALID_ARGUMENT');
      }
      const notional = Decimal.mul(quantity, price);
      for (const filter of filters.filter(f => ['MIN_NOTIONAL', 'NOTIONAL'].includes(f.filterType))) {
        if (filter.minNotional) check(Decimal.compare(notional, amount(filter.minNotional)) >= 0, 'Order is below Binance minimum notional', 'INVALID_ARGUMENT');
        if (filter.maxNotional && Decimal.compare(filter.maxNotional, '0') > 0) check(Decimal.compare(notional, amount(filter.maxNotional)) <= 0, 'Order exceeds Binance maximum notional', 'INVALID_ARGUMENT');
      }
      request.price = price; request.timeInForce = args.time_in_force ?? 'GTC';
    }
    const age = this.now() + snapshot.quote.clockOffsetMs - snapshot.quote.sourceTimeMs;
    check(age >= -snapshot.quote.clockUncertaintyMs - 1000 && age <= 5000, 'Binance source ticker is stale; prepare again', 'SOURCE_UNAVAILABLE');
    if (args.price_limit !== undefined) {
      const boundary = amount(args.price_limit, true), observed = args.action === 'limit' ? request.price : args.side === 'buy' ? snapshot.quote.ask : snapshot.quote.bid;
      check(Decimal.compare(observed, '0') > 0 && (args.side === 'buy' ? Decimal.compare(observed, boundary) <= 0 : Decimal.compare(observed, boundary) >= 0), 'Latest quote or limit price exceeds the requested price boundary', 'INVALID_ARGUMENT');
    }
    return request;
  }
  async order(args, signal, testOnly = false) {
    this.main(); check(args.user_authorized === true || testOnly, 'The order must carry the user-authorized intent', 'FORBIDDEN');
    check(args.environment === this.client.config().environment, 'Select the configured Binance environment explicitly', 'CONNECTION_CHANGED');
    const id = this.operation(args.operation_id), fingerprint = digest({ ...args, testOnly });
    const configIdentity = this.client.identity();
    return this.exclusive(digest(configIdentity), async () => {
      const existing = this.records.get('commands', id);
      if (existing) { check(existing.fingerprint === fingerprint, 'operation_id already identifies a different intent', 'IDEMPOTENCY_CONFLICT'); return this.receipt(this.current(existing)); }
      this.client.assertIdentity(configIdentity);
      check(!this.records.list('commands').some(row => row.kind !== 'test' && UNCERTAIN.has(row.status) && same(this.identityPart(row.account), configIdentity)), 'Resolve the existing uncertain Binance operation with binance_order_status before another send', 'OPERATION_OUTCOME_UNKNOWN');
      const snapshot = await this.snapshot({ symbol: args.symbol }, signal), request = this.filters(snapshot, args);
      const clientOrderId = `ses${digest([configIdentity, id]).slice(7, 39)}`;
      request.newClientOrderId = clientOrderId;
      this.assertAccount(snapshot.account); signal?.throwIfAborted();
      let record = { id, kind: testOnly ? 'test' : 'order', fingerprint, account: snapshot.account, environment: args.environment, symbol: args.symbol, intent: { action: args.action, side: args.side, quantity: args.quantity, ...(args.limit_price ? { limit_price: args.limit_price } : {}) }, clientOrderId, status: 'submitting', submissionAttempted: false, createdAt: this.now(), ...(testOnly ? { createsOrder: false } : {}) };
      this.records.put('commands', id, record);
      let responseReceived = false;
      try {
        const response = await this.client.request(args.environment, 'POST', testOnly ? '/api/v3/order/test' : '/api/v3/order', request, { signed: true, expectedIdentity: configIdentity, signal });
        responseReceived = true;
        if (!testOnly) this.verifyOrder(response, record);
        record = { ...record, status: testOnly ? 'validated' : response.status === 'FILLED' ? 'execution_reported' : response.status === 'PARTIALLY_FILLED' ? 'partially_filled' : 'submitted', submissionAttempted: true, result: response, completedAt: this.now(), ...(testOnly ? { createsOrder: false } : {}) };
      } catch (error) {
        const uncertain = responseReceived || error.code === 'OPERATION_OUTCOME_UNKNOWN' || error.code === 'INVALID_PROVIDER_DATA';
        record = { ...record, status: uncertain ? testOnly ? 'validation_unknown' : 'outcome_unknown' : 'rejected', submissionAttempted: uncertain ? true : error.submissionAttempted === true, error: testOnly && uncertain ? { code: 'SOURCE_UNAVAILABLE', message: 'Binance order validation response was lost; no matching-engine order was created by the test endpoint' } : safeError(error), completedAt: this.now() };
      }
      this.records.put('commands', id, record); return this.receipt(record);
    });
  }
  verifyOrder(row, record) {
    const knownId = record.result?.orderId;
    check(row && row.symbol === record.symbol && ['BUY', 'SELL'].includes(row.side) && row.side.toLowerCase() === record.intent.side && (knownId === undefined ? row.clientOrderId === record.clientOrderId : nativeId(row.orderId) === nativeId(knownId)), 'Binance order response does not match its saved identity', 'INVALID_PROVIDER_DATA');
    nativeId(row.orderId); amount(row.origQty, true); amount(row.executedQty);
    check([...PENDING, 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(row.status) && row.type === record.intent.action.toUpperCase(), 'Binance order state or type is not recognized', 'INVALID_PROVIDER_DATA');
    check(Decimal.compare(row.origQty, record.intent.quantity) <= 0 && Decimal.compare(row.executedQty, row.origQty) <= 0, 'Binance order quantity differs from its recorded intent', 'INVALID_PROVIDER_DATA');
    return row;
  }
  async submit({ observation, intent }, signal) {
    this.main(); check(observation.backend === 'binance' && intent.user_authorized === true, 'A Binance observation and authorized intent are required', 'FORBIDDEN');
    this.assertAccount(observation.account);
    return this.order({ ...intent, symbol: observation.symbol, environment: this.client.config().environment }, signal);
  }
  async queryOriginal(record, signal) {
    this.current(record);
    // Cancellation may replace clientOrderId. Once an exchange order ID is
    // observed, it is the durable identity for recovery of that exact order.
    const selector = record.result?.orderId === undefined ? { origClientOrderId: record.clientOrderId } : { orderId: nativeId(record.result.orderId) };
    const row = await this.client.request(record.environment, 'GET', '/api/v3/order', { symbol: record.symbol, ...selector }, { signed: true, expectedIdentity: this.identityPart(record.account), signal });
    this.current(record); return this.verifyOrder(row, record);
  }
  async status({ operation_id }, signal) {
    const initial = this.readRecord(operation_id), original = initial.kind === 'order' ? initial : this.readRecord(initial.originalOperationId ?? initial.id);
    if (initial.kind === 'test' || initial.status === 'rejected' && !initial.submissionAttempted) return this.receipt(initial);
    return this.exclusive(digest(this.identityPart(initial.account)), async () => {
      const record = this.readRecord(operation_id);
      let row;
      try { row = await this.queryOriginal(original, signal); } catch (error) {
        // Absence after a timeout does not establish that the matching engine never accepted it.
        const retained = { ...record, recovery: { observedAt: this.now(), error: safeError(error), outcome: 'unconfirmed' } };
        this.records.put('commands', record.id, retained); return this.receipt(retained);
      }
      let status = row.status === 'FILLED' ? 'execution_reported' : row.status === 'PARTIALLY_FILLED' ? 'partially_filled' : ['CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(row.status) ? 'execution_reported' : 'submitted';
      if (record.kind === 'amend') status = Decimal.compare(row.origQty, record.newQuantity) === 0 ? 'execution_reported' : 'outcome_unknown';
      if (record.kind === 'cancel') status = PENDING.has(row.status) ? 'outcome_unknown' : 'execution_reported';
      const updated = { ...record, status, submissionAttempted: true, result: row, recovery: { observedAt: this.now(), outcome: 'observed', nativeStatus: row.status } };
      this.records.put('commands', record.id, updated); return this.receipt(updated);
    });
  }
  async mutate(kind, args, signal) {
    this.main(); check(args.user_authorized === true, 'An authorized cancellation or amendment is required', 'FORBIDDEN');
    const id = this.operation(args.operation_id), fingerprint = digest({ kind, ...args }), original = this.readRecord(args.original_operation_id);
    check(original.kind === 'order', 'Choose an original Binance order operation', 'INVALID_ARGUMENT');
    return this.exclusive(digest(this.identityPart(original.account)), async () => {
      const previous = this.records.get('commands', id);
      if (previous) { check(previous.fingerprint === fingerprint, 'operation_id already identifies a different intent', 'IDEMPOTENCY_CONFLICT'); return this.receipt(this.current(previous)); }
      check(!this.records.list('commands').some(row => row.kind !== 'test' && row.id !== original.id && UNCERTAIN.has(row.status) && same(this.identityPart(row.account), this.identityPart(original.account))), 'Resolve the existing uncertain Binance mutation first', 'OPERATION_OUTCOME_UNKNOWN');
      const row = await this.queryOriginal(original, signal);
      check(PENDING.has(row.status), 'The original Binance order is no longer working', 'INVALID_ARGUMENT');
      if (UNCERTAIN.has(original.status)) this.records.put('commands', original.id, { ...original, result: row, status: row.status === 'PARTIALLY_FILLED' ? 'partially_filled' : 'submitted', submissionAttempted: true, recovery: { outcome: 'observed', observedAt: this.now(), nativeStatus: row.status } });
      let params = { symbol: original.symbol, orderId: nativeId(row.orderId) };
      if (kind === 'amend') {
        const quantity = amount(args.quantity, true), symbol = await this.market.row(original.environment, original.symbol, signal);
        check(symbol.amendAllowed === true, 'This Binance symbol does not allow keep-priority amendment', 'UNSUPPORTED_CAPABILITY');
        check(Decimal.compare(quantity, row.origQty) < 0 && Decimal.compare(quantity, row.executedQty) >= 0, 'Amendment must reduce original quantity without going below the already filled amount', 'INVALID_ARGUMENT');
        const lot = symbol.filters?.find(row => row.filterType === 'LOT_SIZE');
        if (lot && Decimal.compare(lot.stepSize, '0') > 0) check(Decimal.compare(Decimal.quantize(quantity, lot.stepSize, 'floor'), quantity) === 0, 'Amended quantity does not match the Binance lot step', 'INVALID_ARGUMENT');
        params = { ...params, newQty: quantity, newClientOrderId: original.clientOrderId };
      }
      this.current(original); signal?.throwIfAborted();
      let record = { id, kind, fingerprint, account: original.account, environment: original.environment, symbol: original.symbol, originalOperationId: original.id, clientOrderId: original.clientOrderId, ...(kind === 'amend' ? { newQuantity: args.quantity } : {}), status: 'submitting', submissionAttempted: false, createdAt: this.now() };
      this.records.put('commands', id, record);
      let responseReceived = false;
      try {
        const response = await this.client.request(original.environment, kind === 'amend' ? 'PUT' : 'DELETE', kind === 'amend' ? '/api/v3/order/amend/keepPriority' : '/api/v3/order', params, { signed: true, expectedIdentity: this.identityPart(original.account), signal });
        responseReceived = true;
        const order = kind === 'amend' ? response.amendedOrder : response;
        check(order?.symbol === original.symbol && nativeId(order.orderId) === nativeId(row.orderId), 'Binance mutation response has another order identity', 'INVALID_PROVIDER_DATA');
        check(kind === 'amend' ? Decimal.compare(amount(order.origQty), args.quantity) === 0 && order.clientOrderId === original.clientOrderId : order.status === 'CANCELED', 'Binance did not confirm the requested order mutation', 'INVALID_PROVIDER_DATA');
        record = { ...record, status: kind === 'amend' ? 'execution_reported' : 'cancel_requested', submissionAttempted: true, result: response, completedAt: this.now() };
      } catch (error) {
        const uncertain = responseReceived || error.code === 'OPERATION_OUTCOME_UNKNOWN' || error.code === 'INVALID_PROVIDER_DATA';
        record = { ...record, status: uncertain ? 'outcome_unknown' : 'rejected', submissionAttempted: uncertain ? true : error.submissionAttempted === true, error: safeError(error), completedAt: this.now() };
      }
      this.records.put('commands', id, record); return this.receipt(record);
    });
  }
  async recover({ record, expectedCurrent }, signal) {
    const stored = this.readRecord(record.backendCommandId ?? record.id);
    check(same(stored.account, record.account) && (!expectedCurrent || same(stored.account, expectedCurrent)), 'Binance recovery account does not match the original command', 'ACCOUNT_MISMATCH');
    const receipt = await this.status({ operation_id: stored.id }, signal), row = receipt.raw.result?.amendedOrder ?? receipt.raw.result;
    return result({ command: receipt.raw, receipt, orders: row && PENDING.has(row.status) ? [row] : [], historicalOrders: row && !PENDING.has(row.status) ? [row] : [], deals: [], coverage: 'exact_order_identity', complete: false, historyCoverage: { fills: { status: 'unavailable', reason: 'Use account_queryFills with explicit symbol and time range' } } });
  }
  command({ record }) { const stored = this.readRecord(record.backendCommandId ?? record.id); check(same(stored.account, record.account), 'Binance command account changed', 'ACCOUNT_MISMATCH'); return this.receipt(stored); }
  cancel({ record, operationId }, signal) { const stored = this.readRecord(record.backendCommandId ?? record.id); check(same(stored.account, record.account), 'Binance cancellation account changed', 'ACCOUNT_MISMATCH'); return this.mutate('cancel', { operation_id: operationId, original_operation_id: stored.id, user_authorized: true }, signal); }
}
