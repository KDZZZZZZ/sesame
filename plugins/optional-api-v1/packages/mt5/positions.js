import { randomUUID } from 'node:crypto';
import { capability } from '@sesame/plugin-sdk/capabilities';
import { check, canonical, digest } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { records } from './backend/records.js';
import { accountIdentity, sourceIdentity, mapPosition, decimal, nativeId } from './backend/contract-mapping.js';

const locks = new Map();
const same = (a, b) => canonical(a) === canonical(b);
const pending = receipt => ['submitted', 'partially_filled', 'outcome_unknown'].includes(receipt.status);
const quantity = value => ({ value, unit: 'lot' });
const failure = error => ({ code: error.code ?? 'OUTCOME_UNKNOWN', message: String(error.message).slice(0, 4000) });
const successCodes = new Set([10008, 10009, 10010]);
// Timeout, generic error, locked and connection loss deliberately remain unknown.
const rejectedCodes = new Set([10004, 10006, 10007, 10013, 10014, 10015, 10016, 10017, 10018, 10019, 10020, 10021, 10022, 10024, 10026, 10027, 10029, 10030, 10032, 10033, 10034, 10035, 10036, 10038, 10039, 10040, 10041, 10042, 10043, 10044, 10045, 10046]);
const ticket = value => { const id = nativeId(value); check(/^[1-9]\d*$/.test(id) && BigInt(id) < 2n ** 64n, 'Native ticket is invalid', 'SOURCE_DATA_INVALID'); return id; };
const maybeTicket = value => value === undefined || value === null || String(value) === '0' ? null : ticket(value);
async function serial(host, fn) {
  const key = host.context.storageRoot, task = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  locks.set(key, task); try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
}

/** The account UI submits a fixed position reduction through the existing native guard and durable command journal. */
export function createPositionManager(host, mt5, { now = Date.now } = {}) {
  const db = records(host), official = mt5.official;
  function target(binding, execution) {
    check(execution?.provenance?.caller?.pluginId === 'host' && host.context.kind === 'main', 'Position management requires the confirmed host account UI', 'FORBIDDEN');
    const config = official.config, login = String(config.account?.login ?? ''), server = config.account?.server;
    check(login && server, 'Configure the native MT5 account first', 'PREREQUISITE_REQUIRED');
    check(same(binding?.connection, { id: 'mt5-terminal', revision: String(config.version) })
      && same(binding.account, { connectionId: 'mt5-terminal', accountId: accountIdentity(server, login) }), 'Account or connection changed after confirmation', 'CONNECTION_CHANGED');
    return { login, server, account: binding.account, sourceId: sourceIdentity(server) };
  }
  async function read(tool, args, binding, signal, execution) {
    target(binding, execution); signal?.throwIfAborted();
    const command = await official.call({ server: 'python', tool, arguments: args, command_id: `positions-read-${randomUUID()}` }, host.context.sessionId, signal);
    target(binding, execution); signal?.throwIfAborted();
    check(command.status === 'returned' && !command.result?.error && command.result?.result !== null && command.result?.result !== undefined, `MT5 ${tool} did not return a confirmed native result`, 'SOURCE_UNAVAILABLE');
    return command.result.result;
  }
  async function account(binding, signal, execution, trading = false) {
    const identity = target(binding, execution);
    const summary = await read('account_info', {}, binding, signal, execution), terminal = await read('terminal_info', {}, binding, signal, execution);
    check(nativeId(summary.login) === identity.login && summary.server === identity.server && terminal.connected === true, 'Connected native MT5 account differs from the confirmed account', 'ACCOUNT_MISMATCH');
    if (trading) check(summary.trade_allowed === true && summary.trade_expert === true && terminal.trade_allowed === true && terminal.tradeapi_disabled === false, 'Native MT5 trading is not permitted', 'FORBIDDEN');
    return identity;
  }
  async function positions(binding, signal, execution) {
    await account(binding, signal, execution);
    const rows = await read('positions_get', {}, binding, signal, execution);
    check(Array.isArray(rows) && rows.length <= 20000, 'Native position snapshot is missing or exceeds the close budget', 'SOURCE_DATA_INVALID');
    check(new Set(rows.map(row => ticket(row.ticket))).size === rows.length, 'Native position tickets are not unique', 'SOURCE_DATA_INVALID');
    await account(binding, signal, execution);
    return rows;
  }
  function save(record, receipt) { db.put('position_closes', { ...record, receipt }); return receipt; }
  function submission(record, command) {
    const result = command.result?.result, code = result?.retcode;
    const rejected = command.result?.submission_attempted === false || rejectedCodes.has(code);
    const orderId = maybeTicket(result?.order);
    return save(record, { operationId: record.id, positionId: record.positionId, requestedQuantity: record.requested,
      status: rejected ? 'rejected' : command.status === 'returned' && successCodes.has(code) ? 'submitted' : 'outcome_unknown',
      ...(orderId ? { orderIds: [orderId] } : {}), observedAt: now(),
      ...(rejected || !successCodes.has(code) ? { error: { code: command.result?.error ?? (code ? `MT5_RETCODE_${code}` : 'OUTCOME_UNKNOWN'), message: String(command.result?.message ?? command.error ?? result?.comment ?? 'Native dispatch has no confirmed execution result; do not resend').slice(0, 4000) } } : {}),
    });
  }
  return {
    close: (args, signal, execution) => serial(host, async () => {
      check(execution?.provenance?.caller?.pluginId === 'host' && host.context.kind === 'main', 'Position management requires the confirmed host account UI', 'FORBIDDEN');
      const fingerprint = digest(args), old = db.get('position_closes', args.operationId, true);
      if (old) { check(old.fingerprint === fingerprint, 'Position operation ID belongs to different input', 'IDEMPOTENCY_CONFLICT'); target(args.binding, execution); return old.receipt; }
      const requested = structuredClone(args.quantity ?? args.expected.quantity);
      const record = { id: args.operationId, fingerprint, binding: structuredClone(args.binding), positionId: args.positionId, requested, owner: host.context.sessionId, createdAt: now() };
      let dispatched = false;
      try {
        const identity = target(args.binding, execution);
        check(!db.list('position_closes').some(row => same(row.binding.account, args.binding.account) && row.positionId === args.positionId && pending(row.receipt)), 'An earlier close is unconfirmed; inspect its receipt', 'POSITION_OPERATION_PENDING');
        const rows = await positions(args.binding, signal, execution), matches = rows.filter(row => mapPosition(row, identity).id === args.positionId);
        check(matches.length === 1, 'Confirmed native position is no longer unique and open', 'POSITION_CHANGED');
        const raw = matches[0], actual = mapPosition(raw, identity), expected = args.expected;
        check(same(actual.instrument, expected.instrument) && actual.side === expected.side && same(actual.quantity, expected.quantity), 'Native position changed after host confirmation', 'POSITION_CHANGED');
        check(requested.unit === 'lot' && typeof requested.value === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(requested.value)
          && Decimal.compare(requested.value, '0') > 0 && Decimal.compare(requested.value, actual.quantity.value) <= 0, 'Close quantity must be positive native lots no larger than the position', 'INVALID_QUANTITY');
        // The official Python API accepts a double. Never silently round user text at that boundary.
        const volume = Number(requested.value);
        check(Number.isFinite(volume) && Decimal.compare(decimal(volume), requested.value) === 0, 'Close quantity cannot be represented by the native volume API', 'INVALID_QUANTITY');
        const symbol = raw.symbol, spec = await read('symbol_info', { symbol }, args.binding, signal, execution);
        check(Decimal.compare(requested.value, decimal(spec.volume_min)) >= 0 && Decimal.compare(requested.value, decimal(spec.volume_max)) <= 0
          && Decimal.compare(Decimal.quantize(requested.value, decimal(spec.volume_step), 'floor'), requested.value) === 0, 'Close quantity violates the native lot minimum, maximum or step', 'INVALID_QUANTITY');
        const mode = spec.trade_exemode, flags = spec.filling_mode;
        check(Number.isInteger(flags) && [0, 1, 2, 3].includes(mode), 'Native order execution and filling modes are missing', 'SOURCE_DATA_INVALID');
        const filling = [0, 1].includes(mode) || flags & 1 ? 'ORDER_FILLING_FOK' : flags & 2 ? 'ORDER_FILLING_IOC' : mode !== 2 ? 'ORDER_FILLING_RETURN' : null;
        check(filling, 'Native market execution has no supported fill policy', 'UNSUPPORTED_CAPABILITY');
        const tick = await read('symbol_info_tick', { symbol }, args.binding, signal, execution), observedAt = now(), side = actual.side === 'long' ? 'sell' : 'buy';
        const price = decimal(side === 'sell' ? tick.bid : tick.ask);
        check(Number.isSafeInteger(tick.time_msc) && tick.time_msc <= observedAt && observedAt - tick.time_msc <= 5000 && Decimal.compare(price, '0') > 0, 'A fresh native UTC executable quote is required', 'STALE_QUOTE');
        await account(args.binding, signal, execution, true); signal?.throwIfAborted();
        Object.assign(record, { ticket: ticket(raw.ticket), identifier: ticket(raw.identifier ?? raw.ticket), symbol, side,
          nativeOperationId: 'position-close-' + digest([args.binding, args.operationId]).slice(7) });
        const initial = { operationId: args.operationId, positionId: args.positionId, status: 'outcome_unknown', requestedQuantity: requested, observedAt };
        save(record, initial);
        dispatched = true;
        const command = await official.call({ server: 'python', tool: 'order_send', command_id: record.nativeOperationId, arguments: {
          request: { action: 'TRADE_ACTION_DEAL', position: record.ticket, symbol, volume, type: side === 'sell' ? 'ORDER_TYPE_SELL' : 'ORDER_TYPE_BUY',
            type_filling: filling, type_time: 'ORDER_TIME_GTC', deviation: 0, comment: 'sesame-close-' + fingerprint.slice(7, 23) },
          execution_guard: { observed_at: observedAt, expires_at: observedAt + 60000, max_quote_age_ms: 5000, max_quote_to_send_ms: 1000,
            price_limit: price, side, expected_account: identity.login, expected_server: identity.server,
            expected_positions: rows.filter(row => row.symbol === symbol).map(row => ({ ticket: ticket(row.ticket), type: row.type, volume: decimal(row.volume) })) },
        } }, record.owner, signal);
        return submission(record, command);
      } catch (error) {
        return save(record, { operationId: args.operationId, positionId: args.positionId, status: !dispatched || error.details?.submission_attempted === false ? 'rejected' : 'outcome_unknown',
          requestedQuantity: requested, observedAt: now(), error: failure(error) });
      }
    }),
    readReceipt: (args, signal, execution) => serial(host, async () => {
      target(args.binding, execution);
      const record = db.get('position_closes', args.operationId, true);
      check(record, 'Position close receipt was not found', 'NOT_FOUND');
      check(same(record.binding, args.binding), 'Receipt belongs to another configured account', 'ACCOUNT_MISMATCH');
      if (!pending(record.receipt)) return record.receipt;
      let command;
      try { command = official.command(record.nativeOperationId, record.owner); } catch (error) { if (error.code === 'NOT_FOUND') return record.receipt; throw error; }
      const native = command.result?.result;
      if (command.result?.submission_attempted === false || rejectedCodes.has(native?.retcode)) return submission(record, command);
      let orderId = maybeTicket(native?.order);
      if (!orderId && !maybeTicket(native?.deal)) return record.receipt; // No broker ID: no provable correlation, even if the position vanished.
      await account(args.binding, signal, execution);
      const deals = await read('history_deals_get', { position: record.identifier }, args.binding, signal, execution);
      check(Array.isArray(deals) && deals.length <= 20000, 'Native deal history is missing or truncated', 'SOURCE_DATA_INVALID');
      if (!orderId) {
        const matches = deals.filter(row => nativeId(row.ticket) === nativeId(native.deal));
        check(matches.length === 1, 'Native deal ID could not be correlated to one order', 'SOURCE_DATA_INVALID');
        orderId = ticket(matches[0].order);
      }
      const matched = deals.filter(row => nativeId(row.order) === orderId), seen = new Set();
      let filled = '0';
      for (const deal of matched) {
        check(!seen.has(ticket(deal.ticket)) && deal.symbol === record.symbol && nativeId(deal.position_id) === record.identifier
          && deal.type === (record.side === 'sell' ? 1 : 0) && [1, 3].includes(deal.entry), 'Native fill does not match the retained position reduction', 'SOURCE_DATA_INVALID');
        seen.add(ticket(deal.ticket));
        const volume = decimal(deal.volume); check(Decimal.compare(volume, '0') > 0, 'Native fill volume must be positive', 'SOURCE_DATA_INVALID'); filled = Decimal.add(filled, volume);
      }
      check(Decimal.compare(filled, record.requested.value) <= 0, 'Native fill exceeds the retained close quantity', 'SOURCE_DATA_INVALID');
      const [activeOrders, historyOrders, current] = await Promise.all([
        read('orders_get', { ticket: orderId }, args.binding, signal, execution),
        read('history_orders_get', { ticket: orderId }, args.binding, signal, execution),
        positions(args.binding, signal, execution),
      ]);
      check(Array.isArray(activeOrders) && Array.isArray(historyOrders), 'Native order history is unavailable', 'SOURCE_DATA_INVALID');
      const orders = [...activeOrders, ...historyOrders].filter(row => nativeId(row.ticket) === orderId);
      check(orders.length <= 1, 'Native order identity is ambiguous', 'SOURCE_DATA_INVALID');
      for (const order of orders) check(order.symbol === record.symbol && order.type === (record.side === 'sell' ? 1 : 0)
        && Decimal.compare(decimal(order.volume_initial), record.requested.value) === 0, 'Native order differs from the retained close', 'SOURCE_DATA_INVALID');
      const remainingRows = current.filter(row => nativeId(row.ticket) === record.ticket || nativeId(row.identifier ?? row.ticket) === record.identifier);
      check(remainingRows.length <= 1, 'Native position identity is ambiguous', 'SOURCE_DATA_INVALID');
      const remaining = remainingRows.length ? decimal(remainingRows[0].volume) : '0';
      let status = record.receipt.status;
      if (Decimal.compare(filled, record.requested.value) === 0) status = Decimal.compare(remaining, '0') === 0 ? 'closed' : 'filled';
      else if (Decimal.compare(filled, '0') > 0) status = 'partially_filled';
      else if (orders.length && [2, 5, 6].includes(orders[0].state)) status = 'rejected';
      else if (orders.length || successCodes.has(native?.retcode)) status = 'submitted';
      if (record.receipt.filledQuantity && Decimal.compare(filled, record.receipt.filledQuantity.value) < 0) return record.receipt;
      return save(record, { operationId: record.id, positionId: record.positionId, status, requestedQuantity: record.requested,
        filledQuantity: quantity(filled), remainingPositionQuantity: quantity(remaining), orderIds: [orderId], observedAt: now() });
    }),
  };
}

export function createPositionCapabilities(host, mt5) {
  return [capability('positions_close', (input, signal, execution) => createPositionManager(host, mt5).close(input, signal, execution)),
    capability('positions_read_receipt', (input, signal, execution) => createPositionManager(host, mt5).readReceipt(input, signal, execution))];
}
