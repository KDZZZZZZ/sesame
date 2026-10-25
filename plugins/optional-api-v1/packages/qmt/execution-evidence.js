import { check } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';

export const EXECUTION_CONTRACT = 'sesame.execution-adapter/1';
export const nativeTicket = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
export const amount = value => { const text = String(value); check(text.length <= 40 && /^(0|[1-9]\d*)(\.\d+)?$/.test(text) && Decimal.compare(text, '0') > 0, 'Expected a positive decimal amount', 'SOURCE_DATA_INVALID'); return text; };
const positive = value => ['string', 'number'].includes(typeof value) && Number.isFinite(Number(value)) && Number(value) > 0;
export const ownedOrder = (row, record, remark) => typeof remark === 'string' && remark.length > 0 && row.account_id === record.account.accountId && row.stock_code === record.symbol && row.order_remark === remark && nativeTicket(row.order_id) !== null && String(row.order_type) === (record.side === 'buy' ? '23' : '24');
export const pendingOrder = row => ['48', '49', '50', '55'].includes(String(row.order_status)) && positive(row.order_volume) && Number(row.traded_volume) >= 0 && Number(row.traded_volume) < Number(row.order_volume);
export const positiveFill = row => typeof row.traded_id === 'string' && row.traded_id.length > 0 && positive(row.traded_volume);
export const sameAccount = (a, b) => a?.accountId === b?.accountId && a?.connectionId === b?.connectionId;
export const sameConnection = (read, account) => read?.connection?.id === account.connectionId && read.connection.revision === account.revision;
export function executionReceipt(raw) {
  const status = ['submitted', 'cancel_requested', 'rejected'].includes(raw?.status) ? raw.status : 'outcome_unknown';
  return { contract: EXECUTION_CONTRACT, backend: 'qmt', status, submissionAttempted: status === 'submitted' || status === 'cancel_requested' ? true : raw?.error?.details?.submission_attempted === false ? false : null, raw };
}
export function executionQuote(tick, timing) {
  const sourceTimeMs = Number(tick?.time);
  if (!Number.isSafeInteger(sourceTimeMs) || sourceTimeMs < 1000000000000) throw Object.assign(new Error('Quote has no valid source epoch milliseconds; reception time is not source time'), {
    code: 'SOURCE_DATA_INVALID', details: { reason: 'invalid_source_time', source: 'qmt/quotes', sourceTimeMs: tick?.time ?? null, receivedAt: timing.receivedAt },
  });
  return { source: 'qmt/quotes', sourceTimeMs, ...timing, bid: amount(tick?.bidPrice?.[0]), ask: amount(tick?.askPrice?.[0]) };
}
export function executionProjection(positions, orders, account, symbol) {
  check([positions, orders].every(Array.isArray), 'Native positions and orders are missing', 'SOURCE_DATA_INVALID');
  const projectedPositions = positions.map(row => {
    check(row?.account_id === account.accountId && typeof row.stock_code === 'string' && [row.volume, row.can_use_volume].every(value => /^(0|[1-9]\d*)$/.test(String(value))), 'Position guard needs exact QMT account and share amounts', 'SOURCE_DATA_INVALID');
    return { id: row.stock_code, symbol: row.stock_code, side: 'buy', quantity: String(row.volume), availableQuantity: String(row.can_use_volume) };
  });
  const projectedOrders = orders.map(row => {
    check(row?.account_id === account.accountId && typeof row.stock_code === 'string' && nativeTicket(row.order_id), 'Order requires an exact QMT account, symbol and ID', 'SOURCE_DATA_INVALID');
    // Unrecognized native states are outstanding, not a fabricated terminal state.
    return { id: nativeTicket(row.order_id), symbol: row.stock_code, working: !['53', '54', '56', '57'].includes(String(row.order_status)) };
  });
  return { positions: projectedPositions, orders: projectedOrders, ...(symbol ? { priceStep: '0.01' } : {}) };
}
export function historyCoverage(requestedDays = 7) {
  return { scope: 'current_native_trading_day', complete: false, requestedDays,
    orders: { status: 'partial', scope: 'current_native_trading_day' }, fills: { status: 'partial', scope: 'current_native_trading_day' },
    historicalOrders: { status: 'unavailable', reason: 'native_current_day_only' },
    limitations: ['XtQuant orders and fills are current-day only; historicalOrders is unavailable, not an observed empty historical ledger. No managed EA mounts are provided.'] };
}
/** Frozen native pagination, bounded and account checked; no authorization here. */
export async function readAccountRows(service, action, account, signal, assertCurrent = () => {}) {
  const rows = [], cursors = new Set(); let cursor;
  do {
    signal?.throwIfAborted(); await assertCurrent();
    const result = await service.native(action, { page: { limit: 200, ...(cursor ? { cursor } : {}) } }, signal);
    signal?.throwIfAborted();
    check(sameConnection(result, account) && Array.isArray(result.items), 'Incomplete or changed QMT snapshot', 'CONNECTION_CHANGED');
    check(result.items.every(row => row?.account_id === account.accountId), 'Native row belongs to another account', 'ACCOUNT_MISMATCH');
    rows.push(...result.items); cursor = result.nextCursor;
    check(rows.length <= 20000 && (!cursor || !cursors.has(cursor)), 'QMT account snapshot exceeds budget or repeats a cursor', 'RESOURCE_EXHAUSTED');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  await assertCurrent(); return rows;
}
