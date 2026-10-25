import { canonical, check } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { capability } from './execution.js';
import { assertTradingTask, tradingAccount, verifyExecutionAuthorization, createTradingContext } from './trading-context.js';
import { EXECUTION_CONTRACT, amount, nativeTicket, ownedOrder, pendingOrder, positiveFill, sameAccount, sameConnection, executionQuote, executionReceipt, executionProjection } from './execution-evidence.js';

const result = value => ({ contract: EXECUTION_CONTRACT, backend: 'qmt', ...value });
const same = (a, b) => canonical(a) === canonical(b);

export function createExecutionAdapter(host, service, { now = Date.now, account = () => tradingAccount(host) } = {}) {
  const delegated = () => host.context.kind !== 'main';
  async function identity() {
    const value = await account(); assertTradingTask(host, value, false, true);
    return result({ account: value });
  }
  const current = async expected => check(same((await identity()).account, expected), 'QMT account or configuration changed during the operation', 'CONNECTION_CHANGED');
  const connection = (read, expected) => check(sameConnection(read, expected), 'QMT connection changed during observation', 'CONNECTION_CHANGED');
  async function snapshot(args, signal) {
    if (!args.symbol) {
      const value = await createTradingContext(host, service, { now })( { action: 'snapshot', ...(args.history_days === undefined ? {} : { history_days: args.history_days }) }, signal);
      return result({ ...value, projection: executionProjection(value.positions, value.orders, value.account) });
    }
    const began = now(), { account: observedAccount } = await identity();
    const [description, asset, positions, orders] = await Promise.all([
      service.native('describe', { symbols: [args.symbol] }, signal), service.native('asset', {}, signal),
      service.native('positions', { page: { limit: 200 } }, signal), service.native('orders', { page: { limit: 200 } }, signal),
    ]);
    for (const read of [description, asset, positions, orders]) connection(read, observedAccount);
    check(description.items?.length === 1 && description.items[0].symbol === args.symbol && Array.isArray(positions.items) && !positions.nextCursor && Array.isArray(orders.items) && !orders.nextCursor, 'Incomplete native symbol/positions/orders snapshot; narrow the account before automated preflight', 'SOURCE_DATA_INVALID');
    check(String(asset.asset?.account_id) === observedAccount.accountId, 'QMT asset belongs to another account', 'ACCOUNT_MISMATCH');
    const quoteStarted = now(), quotes = await service.native('quotes', { symbols: [args.symbol] }, signal);
    connection(quotes, observedAccount); await current(observedAccount); signal?.throwIfAborted();
    const quote = executionQuote(quotes.items?.find(row => row.symbol === args.symbol)?.tick, { receivedAt: now(), requestMs: now() - quoteStarted });
    return result({ account: observedAccount, symbol: args.symbol, spec: description.items[0].detail, positions: positions.items, orders: orders.items, quote,
      projection: executionProjection(positions.items, orders.items, observedAccount, args.symbol),
      permissions: { tradeAllowed: null, reason: 'Native broker permission is checked at guarded dispatch; observation is not trading authorization' },
      readStartedAt: began, capturedAt: now(), captureMs: now() - began, accountSummary: asset.asset });
  }
  async function prepare(args, signal) {
    check(host.context.kind === 'main' && args.userAuthorized === true, 'Only the main conversation may prepare authorized manual trading', 'FORBIDDEN');
    const value = await snapshot({ symbol: args.symbol }, signal);
    check(same(value.account, args.account), 'QMT account or configuration changed during preparation', 'CONNECTION_CHANGED');
    return { ...value, preparation: { backend: 'qmt', mode: 'read-only', permissionsChanged: false } };
  }
  function orderRequest(observation, args) {
    const volume = amount(args.quantity), limit = amount(args.price_limit);
    check(['buy', 'sell'].includes(args.side), 'Choose buy or sell', 'INVALID_ARGUMENT');
    check(args.action === 'limit' && /^[1-9]\d*$/.test(volume), 'QMT supports only limit orders for positive integer STOCK shares', 'UNSUPPORTED_CAPABILITY');
    check(args.stop_loss === undefined && args.take_profit === undefined && args.position_id === undefined, 'QMT does not provide attached stops or ticket-based close through this service', 'UNSUPPORTED_CAPABILITY');
    check(args.side === 'buy' ? Decimal.compare(amount(args.limit_price), limit) <= 0 : Decimal.compare(amount(args.limit_price), limit) >= 0, 'Limit price crossed authorized boundary', 'INVALID_ARGUMENT');
    const guard = { observed_at: observation.quote.sourceTimeMs, expires_at: observation.expiresAt, max_quote_age_ms: 5000, max_quote_to_send_ms: 1000, price_limit: args.price_limit };
    if (delegated()) {
      const rows = observation.positions.filter(row => row.stock_code === observation.symbol);
      check(rows.length <= 1000, 'Position guard exceeds its bounded account snapshot', 'SOURCE_DATA_INVALID');
      executionProjection(rows, [], observation.account);
      guard.expected_positions = rows.map(row => ({ account_id: row.account_id, stock_code: row.stock_code, volume: String(row.volume), can_use_volume: String(row.can_use_volume) }));
    }
    return { operation_id: args.operation_id, user_authorized: true, account_id: observation.account.accountId, connection_revision: observation.account.revision,
      symbol: observation.symbol, side: args.side, shares: volume, price: args.limit_price, execution_guard: guard };
  }
  async function submit({ observation, intent }, signal) {
    let request;
    try {
      check(intent.user_authorized === true && observation.backend === 'qmt', 'An explicit matching execution intent is required', 'FORBIDDEN');
      await current(observation.account); request = orderRequest(observation, intent);
      verifyExecutionAuthorization(assertTradingTask(host, observation.account, true), 'qmt_execution_submit', request);
    } catch (error) { error.details = { ...error.details, submission_attempted: false }; throw error; }
    return executionReceipt(await service.command('order', request, signal, host.context, host, 'qmt_execution_submit'));
  }
  async function rawCommand(record) {
    const currentAccount = (await identity()).account;
    check(sameAccount(currentAccount, record.account), 'Cannot recover against a different account or connection', 'CONNECTION_CHANGED');
    return service.commandRecord(record.id, host.context, host);
  }
  async function command({ record }) { return executionReceipt(await rawCommand(record)); }
  async function recover({ record, expectedCurrent }, signal) {
    const currentAccount = (await identity()).account;
    check(sameAccount(currentAccount, record.account), 'Cannot recover against a different account or connection', 'CONNECTION_CHANGED');
    check(!expectedCurrent || same(currentAccount, expectedCurrent), 'Configuration changed before recovery reads', 'CONNECTION_CHANGED');
    const raw = await service.commandRecord(record.id, host.context, host);
    const reads = await Promise.all(['orders', 'fills'].map(action => service.native(action, { page: { limit: 200 } }, signal)));
    for (const read of reads) { connection(read, currentAccount); check(Array.isArray(read.items), 'Native order/fill snapshot is missing', 'SOURCE_DATA_INVALID'); }
    signal?.throwIfAborted(); await current(currentAccount);
    const knownId = nativeTicket(raw.result?.order_id);
    const owns = row => ownedOrder(row, record, raw.remark) && (knownId === null || nativeTicket(row.order_id) === knownId);
    return result({ command: raw, receipt: executionReceipt(raw), orders: reads[0].items.filter(row => owns(row) && pendingOrder(row)), historicalOrders: [],
      deals: reads[1].items.filter(row => owns(row) && positiveFill(row)), positions: [],
      coverage: reads.some(read => read.nextCursor) ? 'truncated_current_day' : 'current_trading_day_only', complete: false,
      historyCoverage: { historicalOrders: { status: 'unavailable', reason: 'native_current_day_only' } } });
  }
  async function cancel({ record, operationId }, signal) {
    let request, currentAccount;
    try {
      currentAccount = (await identity()).account;
      check(sameAccount(currentAccount, record.account), 'Cancellation account/connection changed', 'CONNECTION_CHANGED');
      check(record.action === 'limit', 'Cancellation requires a pending limit order', 'UNCONFIRMED_ORDER');
      const original = await rawCommand(record);
      check(original.status === 'submitted' || original.status === 'outcome_unknown' && original.intent?.symbol === record.symbol && original.intent?.side === record.side && original.intent?.shares === record.quantity, 'Stored QMT order intent cannot establish a recoverable cancellation', 'UNCONFIRMED_ORDER');
      const read = await service.native('orders', { page: { limit: 200 } }, signal); connection(read, currentAccount);
      check(Array.isArray(read.items) && !read.nextCursor, 'Cannot prove a unique pending order from a partial order page', 'SOURCE_DATA_INVALID');
      const candidates = read.items.filter(row => ownedOrder(row, record, original.remark)), knownId = nativeTicket(original.result?.order_id);
      check(candidates.length === 1 && pendingOrder(candidates[0]) && (knownId === null || nativeTicket(candidates[0].order_id) === knownId), 'A unique matching active QMT order is required', 'UNCONFIRMED_ORDER');
      request = { operation_id: operationId, user_authorized: true, account_id: record.account.accountId, connection_revision: currentAccount.revision,
        original_operation_id: record.id, order_id: nativeTicket(candidates[0].order_id) };
      await current(currentAccount);
      verifyExecutionAuthorization(assertTradingTask(host, currentAccount, true), 'qmt_execution_cancel', request);
    } catch (error) { error.details = { ...error.details, submission_attempted: false }; throw error; }
    return executionReceipt(await service.command('cancel', request, signal, host.context, host, 'qmt_execution_cancel'));
  }
  return { identity, snapshot, prepare, submit, recover, command, cancel };
}
export function createExecutionCapabilities(host, getService) {
  return ['identity', 'snapshot', 'prepare', 'submit', 'recover', 'command', 'cancel'].map(operation => capability(`qmt_execution_${operation}`, (args, signal) => createExecutionAdapter(host, getService())[operation](args, signal)));
}
