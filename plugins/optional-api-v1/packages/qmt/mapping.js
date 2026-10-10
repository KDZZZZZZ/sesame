import { check, digest } from '@sesame/plugin-sdk/protocol';

export const value = value => ({ status: 'value', value });
export const unknown = reason => ({ status: 'unknown', reason });
export const na = () => ({ status: 'not_applicable' });
const validDecimal = x => typeof x === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(x);
const numberValue = x => validDecimal(x) ? value(x) : unknown('Native field absent');
export const money = x => validDecimal(x) ? value({ value: x, currency: 'CNY' }) : unknown('Native field absent');
export function quantity(x) { check(typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x), 'Native share quantity is not a nonnegative integer', 'SOURCE_DATA_INVALID'); return { value: x, unit: 'share' }; }
export const instrumentRef = (config, symbol) => ({ sourceId: `qmt:${config.connection_id}`, instrumentId: symbol });
export const accountRef = config => ({ connectionId: config.connection_id, accountId: config.account_id });
export function summary(config, row) { return { ref: instrumentRef(config, row.symbol), symbol: row.symbol, name: row.name ?? row.detail?.InstrumentName ?? row.symbol, assetClass: 'equity', venue: value(row.symbol.split('.').at(-1)) }; }
export function instrument(config, row) {
  const d = row.detail;
  return { ...summary(config, row), currency: value('CNY'), price: { tickSize: numberValue(d.PriceTick), displayDecimals: validDecimal(d.PriceTick) ? Math.min(10, d.PriceTick.split('.')[1]?.length ?? 0) : 2 },
    quantity: { unit: 'share', min: numberValue(d.MinLimitOrderVolume), max: numberValue(d.MaxLimitOrderVolume), step: unknown('No verified volume step'), contractMultiplier: numberValue(d.VolumeMultiple) },
    volume: { realUnit: unknown('Quote depth size units are not mapped'), hasReal: false, hasTick: false }, timeBasis: { kind: 'wall', authority: 'Asia/Shanghai', zone: 'Asia/Shanghai' }, calendar: unknown('No fixed calendar artifact'),
    features: { timeframes: ['1d'], priceBases: ['last'], adjustments: ['none'] }, native: { symbol: row.symbol, market: row.symbol.split('.').at(-1) } };
}
export function quoteTime(tick, config) {
  if (typeof tick.time === 'string' && /^\d{13}$/.test(tick.time) && Number.isSafeInteger(Number(tick.time))) return { basis: 'utc', unixMs: Number(tick.time), raw: tick.time };
  const match = /^(\d{4})(\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?$/.exec(tick.timetag ?? '');
  check(match, 'Quote has no supported native timestamp; reception time cannot replace it', 'SOURCE_DATA_INVALID');
  return { basis: 'wall', value: `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ?? ''}`, authority: 'Asia/Shanghai', zone: 'Asia/Shanghai' };
}
export function quote(config, row) {
  const { tick } = row;
  // Native zero bid/ask commonly denotes an absent level, not an executable zero price.
  const price = x => validDecimal(x) && !/^-?0(?:\.0+)?$/.test(x) ? value(x) : unknown('No quoted price at this level');
  return { instrument: instrumentRef(config, row.symbol), id: `${config.connection_id}:quote:${row.symbol}`, time: quoteTime(tick, config), bid: price(tick.bidPrice?.[0]), ask: price(tick.askPrice?.[0]), last: price(tick.lastPrice), bidSize: unknown('Native depth quantity unit not verified'), askSize: unknown('Native depth quantity unit not verified'), nativeId: unknown('Snapshot has no native event ID') };
}
export function accountSummary(config) { return { ref: accountRef(config), name: config.account_id, broker: config.broker ?? 'Configured MiniQMT broker', server: unknown('Not exposed'), nativeLogin: value(config.account_id), mode: 'unknown', baseCurrency: value('CNY'), positionMode: 'netting' }; }
export function accountSnapshot(config, asset, sample) {
  return { account: accountSummary(config), snapshotId: digest({ asset, sample }), asOf: { basis: 'utc', unixMs: sample.to }, balance: money(asset.current_balance), equity: money(asset.total_asset), available: money(asset.cash), buyingPower: unknown('Cash is not a broker buying-power guarantee'), unrealizedPnl: unknown('Not provided by the queried asset'), realizedPnl: unknown('Not provided by the queried asset'),
    margin: { used: na(), free: na(), levelRatio: na(), maintenance: na() }, restrictions: [], native: { asset, observationTimeOnly: true } };
}
export function position(config, row) {
  return { id: `${config.connection_id}:${config.account_id}:position:${row.stock_code}`, account: accountRef(config), instrument: instrumentRef(config, row.stock_code), nativeId: unknown('Net position keyed by account and symbol'), side: 'long', quantity: quantity(row.volume), availableQuantity: row.can_use_volume === undefined ? unknown('Native field absent') : value(quantity(row.can_use_volume)), averagePrice: numberValue(row.avg_price), markPrice: numberValue(row.last_price), unrealizedPnl: money(row.float_profit), realizedPnl: unknown('Not provided'), openedAt: unknown('Not provided'), strategyRunId: unknown('No trusted strategy correlation'), native: row };
}
export function metadata(receipt, warnings = []) {
  return { observedAt: receipt.sample.to, freshness: 'unknown', origin: 'observed', consistency: 'bounded', samplingWindow: receipt.sample, warnings: [{ code: 'NATIVE_FLOATS', message: 'SDK binary floating-point values are serialized as decimal text; decimal arithmetic equivalence is not asserted.' }, ...warnings] };
}

export const orderStatus = nativeStatus => ({48:'pending',49:'pending',50:'working',51:'cancel_pending',52:'cancel_pending',53:'cancelled',54:'cancelled',55:'partially_filled',56:'filled',57:'rejected'})[nativeStatus] ?? 'unknown';
export function order() { check(false,'Native order_time units are not verified; normalized orders are unsupported. Use raw current-day qmt_read.','UNSUPPORTED_CAPABILITY'); }
export function fill() { check(false,'Native traded_time units are not verified; normalized fills are unsupported. Use raw current-day qmt_read.','UNSUPPORTED_CAPABILITY'); }
export function dailyBar(row, seriesId, observedAt, { nextSourceTime } = {}) {
  const time = row.time;
  check(typeof time === 'string' && /^\d{13}$/.test(time), 'Daily row needs an epoch millisecond timestamp', 'SOURCE_DATA_INVALID');
  const date = new Date(Number(time)+8*3600000).toISOString().slice(0,10);
  const prices = Object.fromEntries(['open','high','low','close'].map(k => { check(validDecimal(row[k]) && Number(row[k]) > 0, 'Invalid native daily OHLC', 'SOURCE_DATA_INVALID'); return [k,row[k]]; }));
  check(Number(prices.high) >= Math.max(Number(prices.open),Number(prices.close),Number(prices.low)) && Number(prices.low) <= Math.min(Number(prices.open),Number(prices.close)), 'Native daily OHLC inconsistent', 'SOURCE_DATA_INVALID');
  return { id: `${seriesId}:${date}`, openTime: { basis:'wall',authority:'Asia/Shanghai',value:date+'T09:30:00' }, endTime:{basis:'wall',authority:'Asia/Shanghai',value:date+'T15:00:00'}, ...prices, isClosed: row.is_closed === true || (nextSourceTime !== undefined && new Date(Number(nextSourceTime)+8*3600000).toISOString().slice(0,10)>date), closure: row.is_closed === true || (nextSourceTime !== undefined && new Date(Number(nextSourceTime)+8*3600000).toISOString().slice(0,10)>date) ? 'source' : 'unknown', turnover:unknown('Native amount currency/coverage not verified'), volume:{default:'none',tick:{status:'unsupported'},real:unknown('Native daily volume unit is not verified; original volume preserved in native')}, native: { sourceTime: {basis:'utc',unixMs:Number(time)}, volume:row.volume ?? null } };
}
