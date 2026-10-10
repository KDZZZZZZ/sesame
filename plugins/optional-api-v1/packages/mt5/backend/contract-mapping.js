import { createHash } from 'node:crypto';

export const value = value => ({ status: 'value', value });
export const unknown = reason => ({ status: 'unknown', ...(reason ? { reason } : {}) });
export const unsupported = reason => ({ status: 'unsupported', ...(reason ? { reason } : {}) });
export const notApplicable = reason => ({ status: 'not_applicable', ...(reason ? { reason } : {}) });
const hash = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const present = input => input !== undefined && input !== null && input !== '';
const first = (...inputs) => inputs.find(present);
const fail = (message, code = 'INVALID_NATIVE_DATA') => { const error = new Error(message); error.code = code; throw error; };

/** Preserve textual decimals. A numeric native response has already passed through
 * binary floating point; callers must retain that limitation in ReadMeta. */
export function decimal(input) {
  if (!present(input) || typeof input === 'boolean') fail('Native decimal is missing');
  let text = String(input);
  if (typeof input === 'number' && !Number.isFinite(input)) fail('Native decimal is not finite');
  if (/e/i.test(text)) {
    const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
    if (!match) fail('Invalid native decimal');
    const [, sign, whole, fraction = '', power] = match;
    const point = whole.length + Number(power), digits = whole + fraction;
    if (Math.abs(Number(power)) > 1000) fail('Native decimal exponent exceeds the adapter budget');
    text = sign + (point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`);
  }
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) fail('Invalid native decimal');
  return text;
}
export const decimalValue = input => present(input) ? value(decimal(input)) : unknown('The native source did not report this field');
export const textValue = input => present(input) ? value(String(input)) : unknown('The native source did not report this field');
export const moneyValue = (input, currency) => !present(input) ? unknown('The native source did not report this amount') : !present(currency) ? unknown('The currency of the native amount is unknown') : value({ value: decimal(input), currency: String(currency) });
export const quantity = (input, unit = 'lot') => ({ value: decimal(input), unit });
const quantityValue = (input, unit = 'lot') => present(input) ? value(quantity(input, unit)) : unknown('The native source did not report this quantity');

export function nativeId(input) {
  if (!present(input) || typeof input === 'number' && !Number.isSafeInteger(input)) fail('A native identifier is missing or exceeds JSON integer precision');
  return String(input);
}
export const accountIdentity = (server, login) => `mt5-${hash([String(server), nativeId(login)]).slice(0, 24)}`;
export const sourceIdentity = server => `mt5-${hash(String(server)).slice(0, 24)}`;
export const instrumentIdentity = (sourceId, symbol) => ({ sourceId, instrumentId: String(symbol) });
const scopedId = (kind, account, ticket) => `${kind}-${hash([account.connectionId, account.accountId, nativeId(ticket)]).slice(0, 32)}`;

/** MT5's native chart/history timestamps are broker wall time. Numeric values
 * are encoded wall-clock seconds, not proof of a UTC conversion. */
export function sourceTime(input, authority) {
  if (!present(input)) fail('The native source omitted an event timestamp');
  let text;
  if (typeof input === 'number' || /^\d{9,13}$/.test(String(input))) {
    const numeric = Number(input);
    if (!Number.isFinite(numeric)) fail('Invalid native timestamp');
    const date = new Date(numeric < 100000000000 ? numeric * 1000 : numeric);
    if (!Number.isFinite(date.getTime())) fail('Invalid native timestamp');
    text = date.toISOString().replace(/Z$/, '');
  } else {
    text = String(input).replace(' ', 'T');
    if (/(?:Z|[+-]\d\d:\d\d)$/.test(text)) {
      const unixMs = Date.parse(text);
      if (!Number.isFinite(unixMs)) fail('Invalid native UTC timestamp');
      return { basis: 'utc', unixMs, raw: String(input) };
    }
  }
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?$/.test(text) || !Number.isFinite(Date.parse(`${text}Z`))) fail('Invalid native wall timestamp');
  return { basis: 'wall', value: text, authority: String(authority) };
}
export function timeKey(time) { return time.basis === 'utc' ? time.unixMs : Date.parse(`${time.value}Z`); }
export const TIMEFRAMES = Object.freeze({ M1: '1m', M2: '2m', M3: '3m', M4: '4m', M5: '5m', M6: '6m', M10: '10m', M12: '12m', M15: '15m', M20: '20m', M30: '30m', H1: '1h', H2: '2h', H3: '3h', H4: '4h', H6: '6h', H8: '8h', H12: '12h', D1: '1d', W1: '1w', MN1: '1mo' });
export const nativeTimeframe = timeframe => Object.keys(TIMEFRAMES).find(key => TIMEFRAMES[key] === timeframe) ?? fail(`MT5 does not support timeframe ${timeframe}`, 'UNSUPPORTED_CAPABILITY');
export function barEnd(openTime, timeframe) {
  const match = /^(\d+)(m|h|d|w|mo)$/.exec(timeframe);
  if (!match) fail(`Unsupported timeframe ${timeframe}`, 'UNSUPPORTED_CAPABILITY');
  const count = Number(match[1]), unit = match[2], date = new Date(timeKey(openTime));
  if (unit === 'mo') date.setUTCMonth(date.getUTCMonth() + count);
  else date.setTime(date.getTime() + count * { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[unit]);
  return openTime.basis === 'utc' ? { basis: 'utc', unixMs: date.getTime() } : { basis: 'wall', value: date.toISOString().replace(/Z$/, ''), authority: openTime.authority, ...(openTime.zone ? { zone: openTime.zone } : {}) };
}

function decimalCompare(left, right) {
  const parts = input => { const text = decimal(input), [whole, fraction = ''] = text.replace(/^-/, '').split('.'); return { negative: text.startsWith('-'), whole, fraction }; };
  const a = parts(left), b = parts(right), scale = Math.max(a.fraction.length, b.fraction.length);
  const integer = p => (p.negative ? -1n : 1n) * BigInt(p.whole + p.fraction.padEnd(scale, '0'));
  return integer(a) < integer(b) ? -1 : integer(a) > integer(b) ? 1 : 0;
}
const nonNegative = input => { const text = decimal(input); if (decimalCompare(text, '0') < 0) fail('A native quantity is negative'); return text; };
const typeName = input => String(input ?? '').toLowerCase().replace(/^(?:position|order|deal)_type_/, '').replaceAll(' ', '_');
function side(input) { const type = typeName(input); if (type.startsWith('buy') || type === '0') return 'buy'; if (type.startsWith('sell') || type === '1') return 'sell'; fail('The native trade direction is unknown'); }
const assetClass = input => ['equity', 'future', 'option', 'fx', 'crypto', 'index', 'fund'].includes(input) ? input : 'other';

export function mapInstrument(row, { sourceId, server, priceBasis = 'bid' }) {
  const symbol = String(row.symbol ?? '');
  if (!symbol) fail('The native instrument has no symbol');
  const result = {
    ref: instrumentIdentity(sourceId, symbol), symbol, name: String(first(row.description, row.name, symbol)), assetClass: assetClass(row.asset_class),
    venue: textValue(first(row.exchange, row.market)), currency: textValue(first(row.currency_profit, row.currency)),
    price: { tickSize: decimalValue(first(row.trade_tick_size, row.tick_size)), displayDecimals: Number.isInteger(row.digits) && row.digits >= 0 ? row.digits : 0 },
    quantity: { unit: 'lot', min: decimalValue(row.volume_min), step: decimalValue(row.volume_step), max: decimalValue(row.volume_max), contractMultiplier: decimalValue(row.trade_contract_size) },
    volume: { realUnit: row.has_real_volume === true ? textValue(row.real_volume_unit) : unknown('Native real-volume availability is not declared'), hasReal: row.has_real_volume === true, hasTick: row.has_tick_volume !== false },
    timeBasis: { kind: 'wall', authority: server }, calendar: unknown('No frozen broker calendar has been published'),
    features: { timeframes: Object.values(TIMEFRAMES), priceBases: [priceBasis], adjustments: ['none'] }, native: { symbol, ...(row.market ? { market: String(row.market) } : {}) },
  };
  return result;
}

export class Revisions {
  constructor() { this.values = new Map(); }
  apply(key, body) {
    const old = this.values.get(key);
    if (old?.closed && body.isClosed === false) body = { ...body, isClosed: true, closure: old.closure };
    const fingerprint = hash(body);
    const revision = old ? old.fingerprint === fingerprint ? old.revision : old.revision + 1n : 1n;
    this.values.set(key, { fingerprint, revision, closed: body.isClosed === true, closure: body.closure });
    return { ...body, revision: String(revision) };
  }
}

export function mapBar(row, { seriesId, server, spec, nextOpenTime, realVolumeSupported, realVolumeUnit, revisions = new Revisions() }) {
  const openTime = sourceTime(row.time, server), id = `${seriesId}:${timeKey(openTime)}`;
  const prices = Object.fromEntries(['open', 'high', 'low', 'close'].map(key => [key, decimal(row[key])]));
  if (decimalCompare(prices.low, prices.open) > 0 || decimalCompare(prices.low, prices.close) > 0 || decimalCompare(prices.high, prices.open) < 0 || decimalCompare(prices.high, prices.close) < 0) fail('The native OHLC range is invalid');
  const tickRaw = row.tick_volume, realRaw = first(row.real_volume, row.volume_real);
  const hasReal = realVolumeSupported === true || present(realRaw) && decimalCompare(realRaw, '0') > 0;
  const real = hasReal && present(realRaw) && realVolumeUnit ? value({ value: nonNegative(realRaw), unit: realVolumeUnit }) : realVolumeSupported === false ? unsupported('The broker does not provide real traded volume') : unknown('Real-volume availability or unit is not known');
  const tick = present(tickRaw) ? value(nonNegative(tickRaw)) : unknown('The native source did not report tick volume');
  if (tick.status === 'value' && !/^\d+$/.test(tick.value)) fail('Tick volume must be an integer count');
  const successor = nextOpenTime && timeKey(sourceTime(nextOpenTime, server)) > timeKey(openTime);
  const isClosed = row.is_closed === true || row.closed === true || row._successor_observed === true || Boolean(successor);
  return revisions.apply(id, { id, openTime, endTime: barEnd(openTime, spec.timeframe), ...prices,
    volume: { real, tick, default: real.status === 'value' ? 'real' : tick.status === 'value' ? 'tick' : 'none' },
    turnover: moneyValue(row.turnover, row.currency), isClosed, closure: isClosed ? 'source' : 'unknown' });
}

function accountMode(row) {
  // Official MCP reports account.type; the native Python API uses trade_mode.
  // Conflicting or unrecognized supplied values remain unknown. Broker/server
  // labels cannot establish whether an account is safe for demo execution.
  const modes = [row.type, row.trade_mode, row.mode].filter(present).map(input => {
    const mode = String(input).trim().toLowerCase().replace(/^account_trade_mode_/, '');
    return ['real', 'live', '2'].includes(mode) ? 'live' : ['demo', '0', 'contest', '1'].includes(mode) ? 'demo' : 'unknown';
  });
  return modes.length && modes.every(mode => mode === modes[0]) ? modes[0] : 'unknown';
}

export function mapAccountSummary(row, { connectionId, server = row.server }) {
  const login = nativeId(row.login);
  const marginMode = String(row.margin_mode ?? '').trim().toLowerCase().replace(/^account_margin_mode_/, '');
  return {
    ref: { connectionId, accountId: accountIdentity(server, login) }, name: String(first(row.name, login)), broker: String(first(row.company, row.broker, server)), server: textValue(server), nativeLogin: value(login),
    mode: accountMode(row),
    baseCurrency: textValue(row.currency), positionMode: ['retail_hedging', '2', 'hedging'].includes(marginMode) ? 'hedging' : ['retail_netting', 'exchange', '0', '1', 'netting'].includes(marginMode) ? 'netting' : 'unknown',
  };
}
function percentRatio(input) {
  const text = decimal(input), [whole, fraction = ''] = text.replace(/^-/, '').split('.'), digits = whole.padStart(3, '0') + fraction;
  const result = `${text.startsWith('-') ? '-' : ''}${digits.slice(0, whole.padStart(3, '0').length - 2)}.${digits.slice(whole.padStart(3, '0').length - 2)}`;
  return result.replace(/\.0+$/, '');
}
export function mapAccountSnapshot(row, context) {
  const account = mapAccountSummary(row, context), currency = row.currency;
  return {
    account, snapshotId: context.snapshotId, asOf: context.asOf ?? { basis: 'utc', unixMs: context.observedAt },
    balance: moneyValue(row.balance, currency), equity: moneyValue(row.equity, currency), available: moneyValue(first(row.margin_free, row.free_margin), currency),
    buyingPower: unsupported('MT5 does not expose a standardized buying-power amount'), unrealizedPnl: moneyValue(row.profit, currency), realizedPnl: unknown('No realized-PnL period was reported by the account snapshot'),
    margin: { used: moneyValue(row.margin, currency), free: moneyValue(first(row.margin_free, row.free_margin), currency), levelRatio: present(row.margin_level) ? value(percentRatio(row.margin_level)) : unknown('The native source did not report margin level'), maintenance: moneyValue(row.margin_maintenance, currency) },
    restrictions: [
      ...(row.read_only === true ? [{ code: 'MT5_READ_ONLY', description: 'The native account reports read_only=true', observedAt: context.observedAt }] : []),
      ...['trade_allowed', 'trade_expert'].flatMap(key => row[key] === false ? [{ code: `MT5_${key.toUpperCase()}`, description: `The native account reports ${key}=false`, observedAt: context.observedAt }] : []),
      ...['experts_trade_allowed', 'mcp_trade_allowed'].flatMap(key => context.terminal?.[key] === false ? [{ code: `MT5_TERMINAL_${key.toUpperCase()}`, description: `The connected native terminal reports ${key}=false`, observedAt: context.observedAt }] : []),
    ],
  };
}

export function mapPosition(row, { account, sourceId, server, currency, revisions = new Revisions() }) {
  const ticket = nativeId(first(row.position_id, row.ticket, row.identifier)), id = scopedId('position', account, ticket);
  return revisions.apply(id, {
    id, account, instrument: instrumentIdentity(sourceId, row.symbol), nativeId: value(ticket), side: side(first(row.type, row.action, row.side)) === 'buy' ? 'long' : 'short',
    quantity: quantity(nonNegative(first(row.volume, row.open_volume))), availableQuantity: unknown('MT5 does not report a separate available position quantity'),
    averagePrice: decimalValue(first(row.price_open, row.open_price)), markPrice: decimalValue(first(row.price_current, row.current_price)),
    unrealizedPnl: moneyValue(row.profit, currency), realizedPnl: unknown('The position snapshot is not a realized-PnL ledger'),
    openedAt: present(first(row.time, row.open_time)) ? value(sourceTime(first(row.time, row.open_time), server)) : unknown('The native source did not report the opening time'),
    strategyRunId: unknown('No verified run-to-native-position mapping exists'),
  });
}

const orderStates = { started: 'pending', placed: 'working', canceled: 'cancelled', cancelled: 'cancelled', partial: 'partially_filled', filled: 'filled', rejected: 'rejected', expired: 'expired', request_add: 'pending', request_modify: 'working', request_cancel: 'cancel_pending', 0: 'pending', 1: 'working', 2: 'cancelled', 3: 'partially_filled', 4: 'filled', 5: 'rejected', 6: 'expired', 7: 'pending', 8: 'working', 9: 'cancel_pending' };
function subtract(left, right) {
  const [a, af = ''] = decimal(left).split('.'), [b, bf = ''] = decimal(right).split('.'), scale = Math.max(af.length, bf.length);
  const result = BigInt(a + af.padEnd(scale, '0')) - BigInt(b + bf.padEnd(scale, '0'));
  if (result < 0n) fail('The native order has more remaining quantity than initial quantity');
  const digits = String(result).padStart(scale + 1, '0'); return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}
export function mapOrder(row, { account, sourceId, server, revisions = new Revisions() }) {
  const ticket = nativeId(first(row.order_id, row.ticket)), id = scopedId('order', account, ticket), nativeStatus = String(first(row.state, row.status, 'unknown'));
  const nativeType = typeName(first(row.type, row.action)), orderType = ({ 0: 'buy', 1: 'sell', 2: 'buy_limit', 3: 'sell_limit', 4: 'buy_stop', 5: 'sell_stop', 6: 'buy_stop_limit', 7: 'sell_stop_limit' })[nativeType] ?? nativeType;
  const initial = nonNegative(first(row.volume_initial, row.volume)), remaining = first(row.volume_current, row.volume_remaining);
  const createdAt = sourceTime(first(row.time_setup, row.open_time, row.time), server), updatedAt = present(first(row.time_done, row.done_time, row.update_time)) && !/^0+$/.test(String(first(row.time_done, row.done_time, row.update_time))) ? sourceTime(first(row.time_done, row.done_time, row.update_time), server) : createdAt;
  const kind = orderType.includes('stop_limit') ? 'stop_limit' : orderType.includes('limit') ? 'limit' : orderType.includes('stop') ? 'stop' : ['buy', 'sell', '0', '1'].includes(orderType) ? 'market' : 'other';
  const filled = present(remaining) ? subtract(initial, nonNegative(remaining)) : present(row.volume_filled) ? nonNegative(row.volume_filled) : fail('The native source omitted filled and remaining order quantities');
  return revisions.apply(id, { id, account, instrument: instrumentIdentity(sourceId, row.symbol), nativeId: value(ticket), clientId: unknown('No verified client request ID was reported'), side: side(orderType), positionEffect: unknown('MT5 order type alone does not establish position effect'), orderType: kind,
    quantity: quantity(initial), filledQuantity: quantity(filled), remainingQuantity: quantityValue(remaining),
    limitPrice: ['limit', 'stop_limit'].includes(kind) ? decimalValue(first(row.price_stoplimit, row.price_open, row.open_price)) : notApplicable(), stopPrice: ['stop', 'stop_limit'].includes(kind) ? decimalValue(first(row.price_open, row.open_price)) : notApplicable(), timeInForce: textValue(first(row.type_time, row.time_in_force)),
    status: orderStates[nativeStatus.toLowerCase().replace('order_state_', '')] ?? 'unknown', nativeStatus, createdAt, updatedAt,
    expiresAt: present(row.time_expiration) && String(row.time_expiration) !== '0' ? value(sourceTime(row.time_expiration, server)) : notApplicable(), rejectReason: textValue(row.reject_reason), correlation: unknown('No verified intent-to-native-order mapping exists'),
  });
}

export function mapFill(row, { account, sourceId, server, currency, revisions = new Revisions() }) {
  const ticket = nativeId(first(row.deal_id, row.ticket)), id = scopedId('fill', account, ticket), order = first(row.order_id, row.order), moneyCurrency = first(row.currency, currency);
  const costs = ['commission', 'swap', 'fee'];
  const fees = moneyCurrency && costs.every(key => present(row[key])) ? value(costs.map(key => ({ value: decimal(row[key]), currency: String(moneyCurrency) }))) : unknown('The native source did not report all fee components and their currency');
  return revisions.apply(id, { id, account, instrument: instrumentIdentity(sourceId, row.symbol), nativeId: ticket,
    orderId: present(order) && String(order) !== '0' ? value(scopedId('order', account, order)) : unknown('The native source did not report an order ID'), nativeOrderId: present(order) && String(order) !== '0' ? value(nativeId(order)) : unknown(),
    time: sourceTime(first(row.time_msc, row.open_time, row.time), server), side: side(first(row.action, row.type)), quantity: quantity(nonNegative(row.volume)), price: decimal(first(row.price, row.price_open, row.open_price)), positionEffect: textValue(row.entry),
    fees, realizedPnl: moneyValue(row.profit, moneyCurrency), correlation: unknown('Manual and external trades have no verified strategy trace'), correction: notApplicable('No native correction relationship was reported'),
  });
}

export function mapLedgerEntry(row, { account, server, currency, revisions = new Revisions() }) {
  const type = typeName(first(row.action, row.type)), ticket = nativeId(first(row.deal_id, row.ticket)), id = scopedId('ledger', account, ticket), amount = decimal(row.profit);
  if (['buy', 'sell', '0', '1'].includes(type)) return null;
  const kind = ['balance', '2'].includes(type) ? decimalCompare(amount, '0') >= 0 ? 'deposit' : 'withdrawal' : type.includes('commission') || type.includes('fee') ? 'fee' : type.includes('dividend') ? 'dividend' : type.includes('interest') ? 'funding' : ['credit', 'correction', 'bonus', '3', '5', '6'].includes(type) ? 'adjustment' : 'other';
  if (!first(row.currency, currency)) fail('The native ledger amount has no known currency');
  return revisions.apply(id, { id, account, time: sourceTime(first(row.time_msc, row.open_time, row.time), server), kind, amount: { value: amount, currency: String(first(row.currency, currency)) }, description: String(first(row.comment, row.reason, type)), nativeId: ticket, relatedFillIds: [] });
}
