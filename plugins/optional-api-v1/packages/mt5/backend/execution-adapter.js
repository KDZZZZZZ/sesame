import { randomUUID } from 'node:crypto';
import { capability } from '@sesame/plugin-sdk/capabilities';
import { check, canonical } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { assertTradingTask, createTradingContext, verifyExecutionAuthorization } from '../tools/trading-context.js';
import { tradingPrepare } from './trading-prepare.js';
import { EXECUTION_CONTRACT, amount, nativeTicket, pendingOrder, executionQuote, executionReceipt, pythonEnvelope, positionProjection, orderProjection, recoverOrderEvidence } from './execution-evidence.js';

const sameDomain = (a, b) => a?.accountId === b?.accountId && a?.server === b?.server;
const same = (a, b) => canonical(a) === canonical(b);
const result = value => ({ contract: EXECUTION_CONTRACT, backend: 'mt5', ...value });
const projection = (positions, orders, spec) => ({ positions: positionProjection(positions), orders: orderProjection(orders),
  ...(spec ? { priceStep: amount(spec.trade_tick_size || spec.point) } : {}) });

/** Broker-specific mechanics live here. Portfolio owns decisions and its ledger;
 * this service owns SDK selectors, quote/permission proof and guarded dispatch. */
export function createExecutionAdapter(host, mt5, { now = Date.now, prepare = tradingPrepare } = {}) {
  const official = mt5.official, trading = createTradingContext(host, mt5, { now });
  const delegated = () => host.context.kind !== 'main';
  async function identity(_args = {}, _signal, execution) {
    const settings = await official.settings();
    check(settings?.account?.login && settings.account.server, 'MT5 account must already be configured', 'PREREQUISITE_REQUIRED');
    const account = { accountId: String(settings.account.login), server: settings.account.server, revision: String(settings.version) };
    assertTradingTask(host, account, false, true, execution);
    return result({ account });
  }
  async function readEnvelope(method, args, signal) {
    signal?.throwIfAborted();
    const id = `execution-read-${randomUUID()}`;
    const command = await official.call({ server: 'python', tool: method, arguments: args, command_id: id }, host.context.sessionId, signal);
    signal?.throwIfAborted();
    return pythonEnvelope(command, method, id, value => official.redact ? official.redact(value) : value);
  }
  const read = async (...args) => (await readEnvelope(...args)).result;
  async function nativeAccount(account, signal) {
    const summary = await read('account_info', {}, signal);
    check(String(summary.login) === account.accountId && summary.server === account.server, 'MT5 current account differs from configured account', 'ACCOUNT_MISMATCH');
    return summary;
  }
  async function current(account, signal, execution) {
    check(same((await identity({}, signal, execution)).account, account), 'MT5 account configuration changed during the operation', 'CONNECTION_CHANGED');
  }
  function snapshotValue(value, startedAt, receivedAt, prepared = false) {
    const { account, summary, terminal, spec, positions, orders, tick, quote_clock: clock } = value;
    check(String(summary?.login) === account.accountId && summary?.server === account.server, 'MT5 prepared native account differs from its binding', 'ACCOUNT_MISMATCH');
    check(terminal?.connected === true, 'MT5 is not connected to its broker', 'SOURCE_UNAVAILABLE');
    check(spec?.name === value.symbol && Array.isArray(positions) && Array.isArray(orders) && [...positions, ...orders].every(row => row?.symbol === value.symbol), 'Native symbol/positions/orders omitted or differ from the requested symbol', 'SOURCE_DATA_INVALID');
    const permissionFlags = [summary.trade_allowed, summary.trade_expert, terminal.trade_allowed, typeof terminal.tradeapi_disabled === 'boolean' ? !terminal.tradeapi_disabled : undefined];
    const tradeAllowed = permissionFlags.every(value => value === true) ? true : permissionFlags.some(value => value === false) ? false : null;
    if (prepared) check(tradeAllowed, 'MT5 preparation did not establish native account and algorithmic trading permissions', 'TRADING_NOT_ALLOWED');
    return result({ account, symbol: value.symbol, spec, positions, orders,
      projection: projection(positions, orders, spec), permissions: { tradeAllowed },
      quote: executionQuote(tick, clock, account, { receivedAt, requestMs: prepared ? null : value.quoteRequestMs,
        ...(prepared ? { sourceReceivedAt: value.capturedAt, preparationRequestMs: receivedAt - startedAt } : {}) }),
      readStartedAt: value.readStartedAt ?? startedAt, capturedAt: receivedAt, captureMs: receivedAt - startedAt,
      accountSummary: { balance: summary.balance ?? null, equity: summary.equity ?? null, currency: summary.currency ?? null, tradeAllowed },
      raw: { summary, terminal, tick, quote_clock: clock },
      ...(prepared ? { backendCapturedAt: value.capturedAt, preparation: value.preparation } : {}),
    });
  }
  async function snapshot(args, signal, execution) {
    if (!args.symbol) {
      const value = await trading.context({ action: 'snapshot', ...(args.history_days === undefined ? {} : { history_days: args.history_days }) }, signal, execution);
      return result({ ...value, projection: projection(value.positions, value.orders) });
    }
    const startedAt = now(), { account } = await identity({}, signal, execution);
    const catalog = await official.catalog('python', 'order_send', signal, host.context.sessionId);
    const order = catalog.items?.find(row => row.server === 'python')?.tools?.find(row => row.name === 'order_send');
    check(order?.callable && order.inputSchema?.properties?.execution_guard, 'Use a connected MT5 Python SDK with execution_guard; a separate MCP quote connection does not establish Python readiness', 'PREREQUISITE_REQUIRED');
    const summary = await nativeAccount(account, signal), terminal = await read('terminal_info', {}, signal);
    check(terminal.connected === true, 'MT5 is not connected to its broker', 'SOURCE_UNAVAILABLE');
    const spec = await read('symbol_info', { symbol: args.symbol }, signal), positions = await read('positions_get', { symbol: args.symbol }, signal), orders = await read('orders_get', { symbol: args.symbol }, signal);
    const quoteStarted = now(), quote = await readEnvelope('symbol_info_tick', { symbol: args.symbol }, signal);
    await current(account, signal, execution);
    return snapshotValue({ account, symbol: args.symbol, summary, terminal, spec, positions, orders, tick: quote.result, quote_clock: quote.quote_clock, quoteRequestMs: now() - quoteStarted }, startedAt, now());
  }
  async function prepared(args, signal) {
    check(host.context.kind === 'main' && args.userAuthorized === true, 'Only the main conversation may prepare authorized manual trading', 'FORBIDDEN');
    const startedAt = now();
    const value = await prepare(host, mt5, { symbol: args.symbol, command_id: args.commandId, user_authorized: true, expected_account: args.account }, signal, { now });
    signal?.throwIfAborted(); const receivedAt = now();
    check(sameDomain(value?.account, args.account) && typeof value.account.revision === 'string' && value.account.revision.length > 0, 'MT5 preparation returned a different account', 'ACCOUNT_MISMATCH');
    check(value.preparation?.status === 'ready', 'MT5 preparation did not return a ready preparation receipt', 'SOURCE_DATA_INVALID');
    check(Number.isSafeInteger(value.readStartedAt) && Number.isSafeInteger(value.capturedAt) && value.capturedAt >= value.readStartedAt && value.capturedAt <= receivedAt, 'Prepared snapshot has invalid native capture timing', 'SOURCE_DATA_INVALID');
    return snapshotValue({ ...value, symbol: args.symbol }, startedAt, receivedAt, true);
  }
  function orderRequest(observation, args) {
    const { spec, symbol } = observation, volume = amount(args.quantity), limit = amount(args.price_limit);
    check(['buy', 'sell'].includes(args.side) && ['market', 'limit', 'close'].includes(args.action), 'Choose a supported order action and side', 'INVALID_ARGUMENT');
    check(args.action === 'limit' || args.limit_price === undefined, 'limit_price is only valid for limit orders', 'INVALID_ARGUMENT');
    check(args.action === 'close' || args.position_id === undefined, 'position_id is only valid for close', 'INVALID_ARGUMENT');
    if (args.action === 'close') check(nativeTicket(args.position_id), 'Close targets an exact MT5 position ticket', 'INVALID_ARGUMENT');
    if (args.action === 'limit') check(args.side === 'buy' ? Decimal.compare(amount(args.limit_price), limit) <= 0 : Decimal.compare(amount(args.limit_price), limit) >= 0, 'Limit price crossed authorized boundary', 'INVALID_ARGUMENT');
    check(observation.quote.clock?.status === 'verified' && typeof observation.quote.clock.ruleRevision === 'string' && observation.quote.clock.ruleRevision.length > 0, 'MT5 order requires verified quote-clock provenance', 'QUOTE_CLOCK_UNVERIFIED');
    check(Decimal.compare(volume, amount(spec.volume_min)) >= 0 && Decimal.compare(volume, amount(spec.volume_max)) <= 0 && Decimal.compare(Decimal.quantize(volume, amount(spec.volume_step), 'floor'), volume) === 0, 'Quantity violates native lot minimum, maximum or step', 'INVALID_ARGUMENT');
    check(Number.isFinite(Number(volume)) && Number(volume) > 0 && Decimal.compare(String(Number(volume)), volume) === 0, 'Native volume cannot represent this amount', 'INVALID_ARGUMENT');
    const fill = args.action === 'limit' ? 'ORDER_FILLING_RETURN' : Number(spec.filling_mode) & 2 ? 'ORDER_FILLING_IOC' : Number(spec.filling_mode) & 1 ? 'ORDER_FILLING_FOK' : Number(spec.trade_exemode) !== 2 ? 'ORDER_FILLING_RETURN' : null;
    check(fill, 'No supported native filling mode', 'UNSUPPORTED_CAPABILITY');
    const request = { action: args.action === 'limit' ? 'TRADE_ACTION_PENDING' : 'TRADE_ACTION_DEAL', symbol, volume: Number(volume),
      type: args.side === 'buy' ? args.action === 'limit' ? 'ORDER_TYPE_BUY_LIMIT' : 'ORDER_TYPE_BUY' : args.action === 'limit' ? 'ORDER_TYPE_SELL_LIMIT' : 'ORDER_TYPE_SELL',
      type_filling: fill, type_time: 'ORDER_TIME_GTC', deviation: 0, comment: args.remark };
    if (args.action === 'limit') request.price = Number(args.limit_price);
    if (args.action === 'close') request.position = args.position_id;
    if (args.stop_loss !== undefined) request.sl = Number(amount(args.stop_loss));
    if (args.take_profit !== undefined) request.tp = Number(amount(args.take_profit));
    const guard = { observed_at: observation.quote.sourceTimeMs, expires_at: observation.expiresAt, max_quote_age_ms: 5000, max_quote_to_send_ms: 1000, price_limit: args.price_limit,
      quote_clock_revision: observation.quote.clock.ruleRevision, side: args.side, expected_account: observation.account.accountId, expected_server: observation.account.server };
    if (delegated()) {
      const rows = observation.positions.filter(row => row.symbol === symbol);
      check(rows.length <= 1000, 'Position guard exceeds its bounded account snapshot', 'SOURCE_DATA_INVALID');
      guard.expected_positions = rows.map(row => { check(nativeTicket(row.ticket) && [0, 1].includes(Number(row.type)), 'Position guard needs exact MT5 tickets and sides', 'SOURCE_DATA_INVALID'); return { ticket: nativeTicket(row.ticket), type: Number(row.type), volume: amount(row.volume) }; });
    }
    return { server: 'python', tool: 'order_send', arguments: { request, execution_guard: guard }, command_id: args.backendCommandId };
  }
  async function dispatch(request, account, action, signal, execution) {
    const task = assertTradingTask(host, account, true, false, execution);
    verifyExecutionAuthorization(task, action, request, now(), execution);
    return delegated() ? trading.order(request, signal, execution, action) : official.call(request, host.context.sessionId, signal);
  }
  async function submit({ observation, intent }, signal, execution) {
    let request;
    try {
      check(intent.user_authorized === true && observation.backend === 'mt5', 'An explicit matching execution intent is required', 'FORBIDDEN');
      await current(observation.account, signal, execution); request = orderRequest(observation, intent);
      const task = assertTradingTask(host, observation.account, true, false, execution);
      verifyExecutionAuthorization(task, 'mt5_execution_submit', request, now(), execution);
    } catch (error) { error.details = { ...error.details, submission_attempted: false }; throw error; }
    return executionReceipt(await dispatch(request, observation.account, 'mt5_execution_submit', signal, execution));
  }
  async function command({ record }, signal, execution) {
    const { account } = await identity({}, signal, execution);
    check(sameDomain(account, record.account), 'Cannot recover against a different account or connection', 'CONNECTION_CHANGED');
    // A delegated task may never use a caller-supplied false planExecution to
    // escape its plan-bound command journal.
    check(!delegated() || record.planExecution === true, 'Delegated recovery requires a retained plan command', 'FORBIDDEN');
    const raw = record.planExecution ? await trading.command({ command_id: record.backendCommandId }, signal, execution) : await official.command(record.backendCommandId, host.context.sessionId);
    return executionReceipt(raw);
  }
  async function recover({ record, expectedCurrent }, signal, execution) {
    const { account } = await identity({}, signal, execution);
    check(sameDomain(account, record.account), 'Cannot recover against a different account or connection', 'CONNECTION_CHANGED');
    check(!expectedCurrent || same(account, expectedCurrent), 'Configuration changed before recovery reads', 'CONNECTION_CHANGED');
    check(!delegated() || record.planExecution === true, 'Delegated recovery requires a retained plan command', 'FORBIDDEN');
    const raw = record.planExecution ? await trading.command({ command_id: record.backendCommandId }, signal, execution) : await official.command(record.backendCommandId, host.context.sessionId);
    await nativeAccount(record.account, signal);
    const evidence = await recoverOrderEvidence(record, raw, (method, args) => read(method, args, signal), now);
    await nativeAccount(record.account, signal); await current(account, signal, execution);
    return result({ ...evidence, receipt: executionReceipt(raw) });
  }
  async function cancel({ record, operationId }, signal, execution) {
    let request, account;
    try {
      ({ account } = await identity({}, signal, execution));
      check(sameDomain(account, record.account), 'Cancellation account/connection changed', 'CONNECTION_CHANGED');
      check(record.action === 'limit', 'Cancellation requires a pending limit order', 'UNCONFIRMED_ORDER');
      check(!delegated() || record.planExecution === true, 'Delegated cancellation requires a retained plan command', 'FORBIDDEN');
      const original = record.planExecution ? await trading.command({ command_id: record.backendCommandId }, signal, execution) : await official.command(record.backendCommandId, host.context.sessionId);
      const [, orders] = await Promise.all([nativeAccount(record.account, signal), read('orders_get', { symbol: record.symbol }, signal)]);
      check(Array.isArray(orders), 'Native orders are missing', 'SOURCE_DATA_INVALID');
      const candidates = orders.filter(row => row.symbol === record.symbol && row.comment === record.remark && nativeTicket(row.ticket) !== null), knownId = nativeTicket(original.result?.result?.order);
      check(candidates.length === 1 && pendingOrder(candidates[0], record) && (knownId === null || nativeTicket(candidates[0].ticket) === knownId), 'A unique matching active pending order is required', 'UNCONFIRMED_ORDER');
      const ticket = nativeTicket(candidates[0].ticket);
      request = { server: 'python', tool: 'order_send', arguments: { request: { action: 'TRADE_ACTION_REMOVE', order: ticket }, cancellation_guard: {
        expected_account: record.account.accountId, expected_server: record.account.server, symbol: record.symbol, remark: record.remark, order: ticket, side: record.side } }, command_id: operationId };
      await current(account, signal, execution);
      verifyExecutionAuthorization(assertTradingTask(host, account, true, false, execution), 'mt5_execution_cancel', request, now(), execution);
    } catch (error) { error.details = { ...error.details, submission_attempted: false }; throw error; }
    return executionReceipt(await dispatch(request, account, 'mt5_execution_cancel', signal, execution));
  }
  return { identity, snapshot, prepare: prepared, submit, recover, command, cancel };
}

export function createExecutionCapabilities(host, mt5) {
  const service = createExecutionAdapter(host, mt5);
  return Object.entries(service).map(([operation, execute]) => capability(`mt5_execution_${operation}`, execute));
}
