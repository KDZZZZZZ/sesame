import { check, canonical, digest } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { capability, currentExecution } from './execution.js';
import { configuration } from './configuration.js';
import { accountRef, position } from './mapping.js';
import { records } from './records.js';
import { readAccountRows } from './execution-evidence.js';

const locks = new Map(), active = new Set();
const same = (a, b) => canonical(a) === canonical(b);
const uncertain = receipt => ['submitted', 'partially_filled', 'outcome_unknown'].includes(receipt.status);
const quantity = value => ({ value, unit: 'share' });
const failure = error => ({ code: error.code ?? 'OUTCOME_UNKNOWN', message: error.message });
async function serial(host, fn) {
  const key = host.context.storageRoot, task = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  locks.set(key, task); try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
}

/** Fixed UI close operation. Native service and execution_guard.py own final-mile checks and durable dispatch. */
export function createPositionManager(host, service, { now = Date.now } = {}) {
  const db = records(host);
  function target(binding) {
    check(currentExecution()?.provenance?.caller?.pluginId === 'host' && host.context.kind === 'main', 'Position management requires the confirmed host account UI', 'FORBIDDEN');
    const config = configuration(host), connection = { id: config.connection_id, revision: String(config.version) };
    check(same(binding?.connection, connection) && same(binding.account, accountRef(config)), 'Account or connection changed after confirmation', 'CONNECTION_CHANGED');
    return config;
  }
  async function readAll(action, binding, signal) {
    const account = { accountId: binding.account.accountId, connectionId: binding.connection.id, revision: binding.connection.revision };
    return readAccountRows(service, action, account, signal, () => target(binding));
  }
  function save(record, receipt) { db.put('position_closes', { ...record, receipt }); return receipt; }
  function retained(args) {
    target(args.binding);
    const record = db.get('position_closes', args.operationId, true);
    check(record, 'Position close receipt was not found', 'NOT_FOUND');
    check(same(record.binding, args.binding), 'Receipt belongs to another configured account', 'ACCOUNT_MISMATCH');
    return record;
  }
  return {
    close: (args, signal) => serial(host, async () => {
      const config = target(args.binding), fingerprint = digest(args), existing = db.get('position_closes', args.operationId, true);
      if (existing) { check(existing.fingerprint === fingerprint, 'Position operation ID belongs to different input', 'IDEMPOTENCY_CONFLICT'); return existing.receipt; }
      const blocking = db.list('position_closes').find(row => same(row.binding.account, args.binding.account) && row.positionId === args.positionId && uncertain(row.receipt));
      check(!blocking, 'An earlier close is unconfirmed; inspect its receipt', 'POSITION_OPERATION_PENDING');
      const rows = await readAll('positions', args.binding, signal), candidates = rows.filter(row => position(config, row).id === args.positionId);
      check(candidates.length === 1, 'Confirmed native position is no longer unique and open', 'POSITION_CHANGED');
      const raw = candidates[0], actual = position(config, raw), expected = args.expected;
      check(actual.side === 'long' && same(actual.instrument, expected.instrument) && actual.side === expected.side && same(actual.quantity, expected.quantity), 'Native position changed after host confirmation', 'POSITION_CHANGED');
      const requested = args.quantity ?? expected.quantity;
      check(requested?.unit === 'share' && typeof requested.value === 'string' && /^[1-9]\d*$/.test(requested.value) && BigInt(requested.value) <= 2147483647n
        && Decimal.compare(requested.value, actual.quantity.value) <= 0 && typeof raw.can_use_volume === 'string' && Decimal.compare(requested.value, raw.can_use_volume) <= 0,
      'Close quantity exceeds native sellable shares; T+1 restrictions apply', 'INVALID_QUANTITY');
      const quote = await service.native('quotes', { symbols: [raw.stock_code] }, signal);
      check(same(quote.connection, args.binding.connection), 'Quote connection changed', 'CONNECTION_CHANGED');
      const tick = quote.items?.find(row => row.symbol === raw.stock_code)?.tick, price = tick?.bidPrice?.[0], observedAt = now();
      check(typeof tick?.time === 'string' && /^\d{13}$/.test(tick.time) && Number(tick.time) <= observedAt && observedAt - Number(tick.time) <= 5000, 'Fresh native UTC quote is required', 'STALE_QUOTE');
      check(typeof price === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(price) && Decimal.compare(price, '0') > 0, 'Native best bid is unavailable', 'SOURCE_UNAVAILABLE');
      target(args.binding); signal?.throwIfAborted();
      const record = { id: args.operationId, fingerprint, binding: structuredClone(args.binding), positionId: args.positionId, symbol: raw.stock_code, requested: structuredClone(requested),
        nativeOperationId: 'position-close-' + digest([args.binding, args.operationId]).slice(7), createdAt: observedAt };
      const initial = { operationId: args.operationId, positionId: args.positionId, status: 'outcome_unknown', requestedQuantity: record.requested, observedAt };
      save(record, initial); active.add(host.context.storageRoot + ':' + args.operationId);
      try {
        const receipt = await service.command('order', { operation_id: record.nativeOperationId, user_authorized: true, account_id: config.account_id, connection_revision: String(config.version),
          symbol: raw.stock_code, side: 'sell', shares: requested.value, price, execution_guard: { observed_at: observedAt, expires_at: observedAt + 60000,
            max_quote_age_ms: 5000, max_quote_to_send_ms: 1000, price_limit: price,
            expected_positions: rows.filter(row => row.stock_code === raw.stock_code).map(row => ({ account_id: row.account_id, stock_code: row.stock_code, volume: row.volume, can_use_volume: row.can_use_volume })) } }, signal, host.context);
        return save(record, { ...initial, status: receipt.status === 'submitted' ? 'submitted' : receipt.status === 'rejected' ? 'rejected' : 'outcome_unknown',
          ...(receipt.result?.order_id ? { orderIds: [receipt.result.order_id] } : {}), ...(receipt.error ? { error: receipt.error } : {}), observedAt: now() });
      } catch (error) {
        let native; try { native = service.commandRecord(record.nativeOperationId, host.context); } catch { /* The retained intent remains uncertain. */ }
        return save(record, { ...initial, status: native?.status === 'rejected' || error.details?.submission_attempted === false ? 'rejected' : 'outcome_unknown', error: failure(error), observedAt: now() });
      } finally { active.delete(host.context.storageRoot + ':' + args.operationId); }
    }).catch(error => {
      if (currentExecution()?.provenance?.caller?.pluginId !== 'host' || host.context.kind !== 'main' || db.get('position_closes', args.operationId, true)) throw error;
      const requested = args.quantity ?? args.expected.quantity;
      return save({ id: args.operationId, fingerprint: digest(args), binding: structuredClone(args.binding), positionId: args.positionId, requested: structuredClone(requested), createdAt: now() },
        { operationId: args.operationId, positionId: args.positionId, status: 'rejected', requestedQuantity: structuredClone(requested), observedAt: now(), error: failure(error) });
    }),
    async readReceipt(args, signal) {
      const record = retained(args);
      if (active.has(host.context.storageRoot + ':' + args.operationId) || ['closed', 'filled', 'rejected'].includes(record.receipt.status)) return record.receipt;
      let native;
      try { native = service.commandRecord(record.nativeOperationId, host.context); } catch { return record.receipt; }
      if (native.status === 'rejected') return save(record, { ...record.receipt, status: 'rejected', ...(native.error ? { error: native.error } : {}), observedAt: now() });
      const orderId = native.result?.order_id;
      if (!orderId) return record.receipt; // No native ID means no provable correlation; never infer a fill from position changes.
      const [orders, positions] = await Promise.all([readAll('orders', args.binding, signal), readAll('positions', args.binding, signal)]);
      const matches = orders.filter(row => row.order_id === orderId);
      if (matches.length !== 1) return save(record, { ...record.receipt, status: 'outcome_unknown', error: { code: 'RECEIPT_UNAVAILABLE', message: 'Current-day orders cannot confirm this native order; no replacement order was sent' }, observedAt: now() });
      const order = matches[0];
      check(order.stock_code === record.symbol && order.order_volume === record.requested.value && typeof order.traded_volume === 'string' && /^(0|[1-9]\d*)$/.test(order.traded_volume)
        && Decimal.compare(order.traded_volume, record.requested.value) <= 0, 'Native order receipt differs from the retained close', 'SOURCE_DATA_INVALID');
      const current = positions.filter(row => row.stock_code === record.symbol);
      check(current.length <= 1, 'Native net position is ambiguous', 'SOURCE_DATA_INVALID');
      const remaining = current[0]?.volume ?? '0', filled = order.traded_volume;
      let status = order.order_status === '57' ? 'rejected' : 'submitted';
      if (Decimal.compare(filled, record.requested.value) === 0) status = remaining === '0' ? 'closed' : 'filled';
      else if (Decimal.compare(filled, '0') > 0) status = 'partially_filled';
      else if (['53', '54'].includes(order.order_status)) status = 'rejected';
      return save(record, { operationId: args.operationId, positionId: record.positionId, status, requestedQuantity: record.requested, filledQuantity: quantity(filled), remainingPositionQuantity: quantity(remaining), orderIds: [orderId], observedAt: now() });
    },
  };
}

export function createPositionCapabilities(host, getService) {
  return [capability('positions_close', (input, signal) => createPositionManager(host, getService()).close(input, signal)),
    capability('positions_read_receipt', (input, signal) => createPositionManager(host, getService()).readReceipt(input, signal))];
}
