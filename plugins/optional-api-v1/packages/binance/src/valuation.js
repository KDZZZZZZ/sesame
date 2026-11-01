import { amount, Decimal, sourceId, unknown, value } from './common.js';

const currency = 'USDT';
const money = n => value({ value: n, currency });

// Only real pairs in the selected environment may convert an asset. Stablecoins
// are not assumed to equal USDT. Prefer a direct pair, then one liquid bridge.
export function valuationPath(asset, symbols) {
  if (asset === currency) return [];
  const edge = (from, to) => {
    const row = symbols.find(row => row.status === 'TRADING' && row.baseAsset === from && row.quoteAsset === to)
      ?? symbols.find(row => row.status === 'TRADING' && row.quoteAsset === from && row.baseAsset === to);
    return row ? { symbol: row.symbol, inverse: row.quoteAsset === from } : undefined;
  };
  const direct = edge(asset, currency);
  if (direct) return [direct];
  for (const bridge of ['BTC', 'ETH', 'BNB', 'USDC']) {
    if (bridge === asset) continue;
    const first = edge(asset, bridge), second = edge(bridge, currency);
    if (first && second) return [first, second];
  }
  return undefined;
}

export async function valueBalances(client, market, read, signal) {
  const balances = read.balances.filter(row => Decimal.compare(Decimal.add(row.free, row.locked), '0') > 0);
  let symbols = [], quoteFailure;
  try { symbols = (await market.catalog(read.environment, signal)).rows; }
  catch (error) { if (signal?.aborted) throw error; quoteFailure = error.code ?? 'SOURCE_UNAVAILABLE'; }
  const paths = balances.map(row => valuationPath(row.asset, symbols));
  const requested = [...new Set(paths.flatMap(path => path?.map(edge => edge.symbol) ?? []))];
  const prices = new Map();
  // Bound both request and response size; never download every ticker.
  for (let i = 0; i < requested.length; i += 100) {
    const batch = requested.slice(i, i + 100);
    try {
      const rows = await client.request(read.environment, 'GET', '/api/v3/ticker/price', { symbols: JSON.stringify(batch) }, { signal });
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!batch.includes(row.symbol)) continue;
        const price = amount(row.price);
        if (Decimal.compare(price, '0') > 0) prices.set(row.symbol, price);
      }
    } catch (error) { if (signal?.aborted) throw error; quoteFailure = error.code ?? 'SOURCE_UNAVAILABLE'; }
  }
  let total = '0', available = '0';
  const assets = balances.map((row, index) => {
    const quantity = Decimal.add(row.free, row.locked), path = paths[index];
    const priced = path !== undefined && path.every(edge => prices.has(edge.symbol));
    let rate = '1';
    if (priced) for (const edge of path) rate = edge.inverse ? Decimal.div(rate, prices.get(edge.symbol)) : Decimal.mul(rate, prices.get(edge.symbol));
    const marketValue = priced ? money(Decimal.mul(quantity, rate)) : unknown('No current conversion price in this Binance environment');
    if (priced) { total = Decimal.add(total, marketValue.value.value); available = Decimal.add(available, Decimal.mul(row.free, rate)); }
    return { asset: row.asset, quantity, available: row.free, reserved: row.locked, marketValue,
      conversion: priced ? value({ rate, currency, instruments: path.map(edge => ({ sourceId: sourceId(read.environment), instrumentId: edge.symbol })) }) : unknown('Conversion price unavailable') };
  });
  const unpricedAssets = assets.filter(row => row.marketValue.status !== 'value').map(row => row.asset), complete = !unpricedAssets.length;
  const missing = unknown('Some assets have no conversion price; see assets and valuation.pricedValue');
  // These are suggestions for explicitly scoped history, not an assertion that
  // these pairs cover all past trades (sold-out assets may have other pairs).
  const historyInstruments = [...new Set([...requested, ...['BTCUSDT', 'ETHUSDT'].filter(id => symbols.some(row => row.symbol === id))])].map(instrumentId => ({ sourceId: sourceId(read.environment), instrumentId }));
  return { assets, historyInstruments, historySourceId: sourceId(read.environment), balance: complete ? money(total) : missing, equity: complete ? money(total) : missing, available: complete ? money(available) : missing,
    valuation: { currency, method: 'last', complete, pricedValue: { value: total, currency }, pricedAvailable: { value: available, currency }, unpricedAssets, ...(quoteFailure ? { quoteFailure } : {}) } };
}
