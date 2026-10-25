import { check } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { verifiedQuoteClock } from './quote-clock-proof.js';

export const EXECUTION_CONTRACT = 'sesame.execution-adapter/1';
export const nativeTicket = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
export const positive = value => ['string', 'number'].includes(typeof value) && Number.isFinite(Number(value)) && Number(value) > 0;
export const amount = value => { const text = String(value); check(text.length <= 40 && /^(0|[1-9]\d*)(\.\d+)?$/.test(text) && Decimal.compare(text, '0') > 0, 'Expected a positive native decimal', 'SOURCE_DATA_INVALID'); return text; };
export const pendingOrder = (row, record) => String(row.type) === (record.side === 'buy' ? '2' : '3') && ['1', '3'].includes(String(row.state)) && positive(row.volume_current);
export const acceptedRetcodes = new Set([10008, 10009, 10010]);
// Shared with exact-position reduction. The pre-existing reduction adapter did
// NOT classify 10025 or 10028 as a confirmed rejection. Neither has a verified
// no-submission fixture here: retain uncertainty rather than unblock a resend.
// Timeout, generic error and connection loss likewise remain unknown.
export const rejectedRetcodes = new Set([10004, 10006, 10007, 10013, 10014, 10015, 10016, 10017, 10018, 10019, 10020, 10021, 10022, 10024, 10026, 10027, 10029, 10030, 10032, 10033, 10034, 10035, 10036, 10038, 10039, 10040, 10041, 10042, 10043, 10044, 10045, 10046]);

export function executionReceipt(raw) {
  const native = raw?.result, code = native?.result?.retcode;
  const returned = raw?.status === 'returned' && native?.result != null;
  const status = native?.submission_attempted === false ? 'rejected' : !returned ? 'outcome_unknown'
    : acceptedRetcodes.has(code) ? code === 10010 ? 'partially_filled' : code === 10009 ? 'execution_reported' : 'submitted'
      : rejectedRetcodes.has(code) ? 'rejected' : 'outcome_unknown';
  return { contract: EXECUTION_CONTRACT, backend: 'mt5', status, submissionAttempted: native?.submission_attempted === false ? false : returned ? true : null,
    raw, ...(native?.execution_timing ? { timing: native.execution_timing } : {}) };
}

/** A failed SDK read remains a failed read, including its raw native diagnostics. */
export function pythonEnvelope(command, method, commandId, redact = value => value) {
  if (command?.status === 'returned' && !command.result?.error && command.result?.result !== null && command.result?.result !== undefined) return command.result;
  const native = command?.result?.last_error, failure = command?.error ?? command?.result?.error;
  const nativeCode = Array.isArray(native) ? native[0] : command?.result?.error ?? null;
  const message = Array.isArray(native) ? native[1] : command?.result?.message ?? failure?.message;
  const nativeMessage = message == null ? null : redact(String(message).slice(0, 1500));
  const disconnected = nativeCode === -10004;
  throw Object.assign(new Error(`MT5 ${method}: ${redact(String(failure?.message ?? nativeMessage ?? 'did not return a confirmed result'))}`), {
    code: disconnected ? 'MT5_PYTHON_UNAVAILABLE' : failure?.code ?? 'SOURCE_UNAVAILABLE',
    details: { transport: 'python', requiredTransport: 'python', method, commandId: command?.id ?? commandId ?? null, commandStatus: command?.status ?? null,
      nativeCode, nativeMessage, ...(disconnected ? { retryable: false, recovery: 'Reconnect the configured MetaTrader 5 Python terminal, verify the same account, then start a new workflow run. Terminal MCP connectivity alone does not establish Python IPC.' } : {}) },
  });
}

export function executionQuote(tick, clock, account, timing) {
  if (clock?.status !== 'verified') throw Object.assign(new Error('MT5 quote clock is not verified for this server and period; inspect the native clock evidence'), {
    code: 'QUOTE_CLOCK_UNVERIFIED', details: { submission_attempted: false, reason: clock?.reason ?? 'missing_quote_clock', source: 'mt5/python/symbol_info_tick', rawTimeMs: tick?.time_msc ?? null, receivedAt: timing.receivedAt },
  });
  verifiedQuoteClock(tick, clock, account);
  check(clock.sourceTimeMs >= 1000000000000, 'Quote has no valid source epoch milliseconds; reception time is not source time', 'SOURCE_DATA_INVALID');
  return { source: 'mt5/python/symbol_info_tick', sourceTimeMs: clock.sourceTimeMs, clock: structuredClone(clock), ...timing, bid: amount(tick?.bid), ask: amount(tick?.ask) };
}

export function positionProjection(rows) {
  check(Array.isArray(rows), 'Native positions are missing', 'SOURCE_DATA_INVALID');
  return rows.map(row => {
    const id = nativeTicket(row?.ticket), side = Number(row?.type);
    check(id && [0, 1].includes(side) && typeof row.symbol === 'string', 'Position requires an exact ticket, symbol and side', 'SOURCE_DATA_INVALID');
    return { id, symbol: row.symbol, side: side === 0 ? 'buy' : 'sell', quantity: amount(row.volume), availableQuantity: amount(row.volume) };
  });
}
export function orderProjection(rows) {
  check(Array.isArray(rows), 'Native orders are missing', 'SOURCE_DATA_INVALID');
  return rows.map(row => { check(nativeTicket(row?.ticket) && typeof row.symbol === 'string', 'Order requires an exact ticket and symbol', 'SOURCE_DATA_INVALID'); return { id: nativeTicket(row.ticket), symbol: row.symbol, working: true }; });
}

/** Active-order lookup must precede history(ticket): the observed SDK rejects
 * that history selector while an order is live. Authorization stays in callers. */
export async function exactOrderEvidence(read, orderId, active, symbol) {
  check(Array.isArray(active), 'Native current orders are missing', 'SOURCE_DATA_INVALID');
  const current = active.filter(row => nativeTicket(row?.ticket) === orderId);
  check(current.length <= 1 && current.every(row => row.symbol === symbol), 'Native current order does not identify the exact requested order and symbol', 'SOURCE_DATA_INVALID');
  const history = current.length ? [] : await read('history_orders_get', { ticket: orderId });
  check(Array.isArray(history) && history.length <= 1 && history.every(row => row?.symbol === symbol && nativeTicket(row.ticket) === orderId), 'Native order history does not identify the exact requested order and symbol', 'SOURCE_DATA_INVALID');
  return { current, history };
}

/** Native evidence correlation only, not permission to execute or reduce. */
export async function recoverOrderEvidence(record, command, read, now) {
  const orderId = nativeTicket(command.result?.result?.order), dealId = nativeTicket(command.result?.result?.deal);
  const ownSymbol = row => row?.symbol === record.symbol;
  const ownRemark = row => typeof record.remark === 'string' && record.remark.length > 0 && row.comment === record.remark;
  let orders, deals, positions, resolvedPositionId = null, historicalOrders = [], coverage = 'Native queried range; missing matches do not prove no order was sent';
  if (orderId !== null) {
    [orders, positions] = await Promise.all([read('orders_get', { symbol: record.symbol }), read('positions_get', { symbol: record.symbol })]);
    check([orders, positions].every(Array.isArray), 'Native current order or position snapshot is missing', 'SOURCE_DATA_INVALID');
    const { current, history } = await exactOrderEvidence(read, orderId, orders, record.symbol);
    check(record.action !== 'limit' || current.every(row => pendingOrder(row, record)), 'Native current order is not the expected active pending order', 'SOURCE_DATA_INVALID');
    historicalOrders = history;
    const sources = current.length ? current : history;
    check(sources.every(row => row.position_id == null || String(row.position_id) === '0' || nativeTicket(row.position_id) !== null), 'Native order has an invalid position identifier', 'SOURCE_DATA_INVALID');
    const positionId = nativeTicket(sources[0]?.position_id);
    if (positionId !== null) {
      resolvedPositionId = positionId;
      deals = await read('history_deals_get', { position: positionId });
      coverage = 'Native position history filtered to the confirmed order; missing matches do not prove no order was sent';
    } else {
      deals = []; coverage = 'Native order position_id is unverified; deal history was not queried. Missing records do not prove no order was sent';
    }
  } else {
    const history = { date_from: new Date(record.createdAt - 60000).toISOString(), date_to: new Date(now() + 1000).toISOString() };
    [orders, deals, positions] = await Promise.all([read('orders_get', { symbol: record.symbol }), read('history_deals_get', history), read('positions_get', { symbol: record.symbol })]);
  }
  check([orders, deals, positions].every(Array.isArray), 'Native order, deal or position snapshot is missing', 'SOURCE_DATA_INVALID');
  const matchesDeal = row => ownSymbol(row) && ['0', '1'].includes(String(row.type)) && nativeTicket(row.ticket) !== null && nativeTicket(row.order) !== null
    && (resolvedPositionId === null || nativeTicket(row.position_id) === resolvedPositionId)
    && (orderId !== null ? nativeTicket(row.order) === orderId : ownRemark(row) || dealId !== null && nativeTicket(row.ticket) === dealId);
  return { command, orders: orders.filter(row => ownSymbol(row) && nativeTicket(row.ticket) !== null && (ownRemark(row) || orderId !== null && nativeTicket(row.ticket) === orderId) && (record.action !== 'limit' || pendingOrder(row, record))),
    historicalOrders, deals: deals.filter(matchesDeal), positions: positions.filter(row => ownSymbol(row) && nativeTicket(row.ticket) !== null && ownRemark(row)), coverage, complete: false };
}
