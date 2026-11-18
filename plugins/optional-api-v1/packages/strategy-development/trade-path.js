// Backtrader's order notifications contain signed cumulative size, average fill
// price and cumulative commission. A trade row has no order IDs or direction.
const numeric = raw => typeof raw === 'number' || typeof raw === 'string' && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw) ? Number(raw) : NaN;
const utc = raw => raw?.basis === 'utc' && Number.isSafeInteger(raw.unixMs) ? raw.unixMs
  : typeof raw === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(raw) ? Date.parse(raw) : NaN;
const near = (a, b, scale = 0) => Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(scale)
  && Math.abs(a - b) <= 128 * Number.EPSILON * Math.max(Number.MIN_VALUE, Math.abs(a), Math.abs(b), Math.abs(scale));

function lowerBound(rows, time) {
  let left = 0, right = rows.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (rows[mid].time < time) left = mid + 1;
    else right = mid;
  }
  return left;
}

function orderLedger(rows, closedCount) {
  if (!Array.isArray(rows)) return { issue: 'missing_order_table' };
  const orders = new Map(), fills = [];
  for (const row of rows) {
    const size = numeric(row?.executedSize), requested = numeric(row?.size), price = numeric(row?.executedPrice);
    if (!row?.orderId || !Number.isFinite(size) || !Number.isFinite(requested) || !requested) return { issue: 'invalid_signed_order_size' };
    const old = orders.get(row.orderId);
    if (size && (Math.sign(size) !== Math.sign(requested) || Math.abs(size) > Math.abs(requested) && !near(size, requested))
      || old && (requested !== old.requested || Math.abs(size) < Math.abs(old.size))) return { issue: 'inconsistent_cumulative_order' };
    const delta = size - (old?.size ?? 0);
    if (size && (!Number.isFinite(price) || price <= 0)) return { issue: 'missing_positive_fill_price' };
    if (size && !delta && !near(old.price, price)) return { issue: 'inconsistent_cumulative_price' };
    if (delta) {
      const time = utc(row.executedTime);
      if (!Number.isFinite(time)) return { issue: 'missing_execution_time' };
      fills.push({ time, id: row.orderId, delta, price,
        simple: row.status === 'Completed' && !old?.size && near(size, requested) });
    }
    orders.set(row.orderId, { size, requested, price, commission: numeric(row.commission) });
  }
  if (!fills.length && closedCount) return { issue: 'trades_without_fills' };
  fills.sort((a, b) => a.time - b.time);
  let position = 0;
  for (const fill of fills) {
    fill.before = position; position += fill.delta; fill.after = position;
    if (near(position, 0, fill.delta)) position = 0;
  }
  let notional = 0, commission = 0, feesKnown = true;
  for (const order of orders.values()) {
    if (!order.size) continue;
    notional += Math.abs(order.size) * order.price;
    if (Number.isFinite(order.commission)) commission += order.commission;
    else feesKnown = false;
  }
  if (!Number.isFinite(notional) || !Number.isFinite(commission)) return { issue: 'nonfinite_order_totals' };
  return { fills, executedOrders: [...orders.values()].filter(order => order.size).length, notional, commission: feesKnown ? commission : null };
}

function marketBars(rows, columns) {
  if (!Array.isArray(rows) || !rows.length) return { issue: 'missing_development_bars' };
  const bars = [];
  for (const row of rows) {
    const time = utc(row?.[columns?.datetime ?? 'datetime']), low = numeric(row?.[columns?.low ?? 'low']), high = numeric(row?.[columns?.high ?? 'high']);
    if (!Number.isFinite(time) || bars.length && time <= bars.at(-1).time) return { issue: 'ambiguous_development_bar_times' };
    bars.push({ time, low, high, valid: Number.isFinite(low) && Number.isFinite(high) && low <= high });
  }
  return { bars };
}

function activity(ledger, equity, market, initial, finalEquity, currency) {
  if (ledger.issue) return { status: 'unavailable', gaps: [ledger.issue] };
  const gaps = [];
  let average = null;
  if (market.bars && Array.isArray(equity) && equity.length === market.bars.length && equity.length
    && equity.every((row, i) => utc(row.time) === market.bars[i].time && numeric(row.value) > 0 && Number.isFinite(numeric(row.value)))
    && near(numeric(equity.at(-1).value), finalEquity)) {
    average = equity.reduce((sum, row) => sum + numeric(row.value) / equity.length, 0);
  } else gaps.push('unreconciled_bar_equity');
  if (ledger.commission === null) gaps.push('missing_order_commission');
  const capital = numeric(initial);
  if (!Number.isFinite(capital) || capital <= 0) gaps.push('missing_initial_equity');
  return { status: 'observed', currency, executedOrders: ledger.executedOrders, grossTradedNotional: ledger.notional,
    commission: ledger.commission, turnoverOnInitialEquity: capital > 0 && Number.isFinite(capital) ? ledger.notional / capital : null,
    averageBarEquity: average, turnoverOnAverageEquity: average > 0 ? ledger.notional / average : null,
    slippageCost: null, gaps: [...gaps, 'slippage_needs_independent_order_benchmark'] };
}

function tradeDetail(trade, ambiguity, ledger, market) {
  const begin = utc(trade.openTime), end = utc(trade.closeTime);
  const item = { tradeId: trade.tradeId ?? null, openTime: trade.openTime, closeTime: trade.closeTime, grossPnl: trade.gross, netPnl: trade.net };
  const missing = reason => ({ ...item, status: 'unavailable', gaps: [reason] });
  if (!Number.isFinite(begin) || !Number.isFinite(end) || begin > end) return missing('invalid_trade_times');
  item.holdingMs = end - begin;
  if (begin === end) return missing('same_bar_event_sequence_unknown');
  if (ambiguity) return missing(ambiguity);
  if (ledger.issue) return missing(ledger.issue);
  const { fills } = ledger, first = lowerBound(fills, begin), after = lowerBound(fills, end + 1);
  if (after - first > 2) return missing('scaled_partial_or_interleaved_position');
  const entry = fills[first], exit = fills[after - 1];
  if (after - first !== 2 || entry.time !== begin || exit.time !== end) return missing('missing_matching_boundary_fills');
  if (!entry.simple || !exit.simple || entry.id === exit.id) return missing('partial_or_unresolved_fill');
  if (!near(entry.before, 0) || !near(exit.after, 0, entry.delta) || !near(entry.delta, -exit.delta)) return missing('unmatched_position_or_reversal');
  const qty = Math.abs(entry.delta), side = Math.sign(entry.delta), realized = side * (exit.price - entry.price);
  if (!Number.isFinite(trade.gross)) return missing('missing_trade_gross_pnl');
  if (!near(realized * qty, trade.gross, qty * Math.max(entry.price, exit.price)))
    return missing('gross_pnl_does_not_match_linear_fills');
  let best = Math.max(0, realized), worst = Math.min(0, realized), interiorBars = 0;
  const gaps = [];
  if (!Number.isFinite(trade.net)) gaps.push('missing_net_trade_pnl');
  const bars = market.bars;
  if (market.issue) gaps.push(market.issue);
  else {
    const start = lowerBound(bars, begin), stop = lowerBound(bars, end);
    if (bars[start]?.time !== begin || bars[stop]?.time !== end) gaps.push('boundary_fills_not_on_frozen_bars');
    else {
      // No assumption about whether a fill occurred before or after a boundary bar's extreme.
      for (let i = start + 1; i < stop; i++) {
        if (!bars[i].valid) { if (!gaps.includes('missing_interior_extrema')) gaps.push('missing_interior_extrema'); continue; }
        best = Math.max(best, side * ((side > 0 ? bars[i].high : bars[i].low) - entry.price));
        worst = Math.min(worst, side * ((side > 0 ? bars[i].low : bars[i].high) - entry.price)); interiorBars++;
      }
      if (stop === start + 1) gaps.push('no_strictly_interior_bar');
    }
  }
  const mae = Math.max(0, -worst);
  if (![mae / entry.price, best / entry.price, mae * qty, best * qty].every(Number.isFinite)) return missing('nonfinite_excursion_units');
  return { ...item, status: interiorBars ? 'interior_bars_and_fills' : 'fills_only', gaps, interiorBars,
    direction: side > 0 ? 'long' : 'short', quantity: qty, entryOrderId: entry.id, exitOrderId: exit.id, entryPrice: entry.price, exitPrice: exit.price,
    maePrice: mae, mfePrice: best, maeFraction: mae / entry.price, mfeFraction: best / entry.price,
    maePnl: mae * qty, mfePnl: best * qty, exitPriceMove: realized, givebackPriceLowerBound: best - realized };
}

export function analyzeTradePath({ trades, orders, development, columns, equity, initialCapital, finalEquity, currency = null, sourceRefs = [], readGaps = [] }, page = {}) {
  const offset = page?.offset ?? 0, limit = page?.limit ?? 25;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError('Trade detail page requires a nonnegative offset and a limit of 1 to 100.');
  const ledger = orderLedger(orders, trades.length), market = marketBars(development, columns);
  const byTime = trades.map((t, i) => ({ i, start: utc(t.openTime), end: utc(t.closeTime) })).sort((a, b) => a.start - b.start);
  const overlap = new Set(), seenIds = new Set(), duplicateIds = new Set();
  const incompleteIntervals = byTime.some(item => !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start > item.end);
  for (const trade of trades) {
    if (!trade.tradeId) continue;
    if (seenIds.has(trade.tradeId)) duplicateIds.add(trade.tradeId);
    seenIds.add(trade.tradeId);
  }
  let maxEnd = -Infinity;
  for (const [i, interval] of byTime.entries()) {
    if (maxEnd >= interval.start || byTime[i + 1]?.start <= interval.end) overlap.add(interval.i);
    maxEnd = Math.max(maxEnd, interval.end);
  }
  const details = [], reasons = {};
  let measured = 0, withBars = 0, gaveBackToEntry = 0, positive = 0, largest = 0;
  for (const [i, trade] of trades.entries()) {
    const ambiguity = duplicateIds.has(trade.tradeId) ? 'duplicate_native_trade_id' : incompleteIntervals ? 'other_closed_trade_time_unknown'
      : overlap.has(i) ? 'overlapping_trade_intervals' : null;
    const d = tradeDetail(trade, ambiguity, ledger, market);
    for (const reason of d.gaps) reasons[reason] = (reasons[reason] ?? 0) + 1;
    if (d.status !== 'unavailable') {
      measured++;
      if (d.interiorBars) withBars++;
      if (d.mfePrice > 0 && d.exitPriceMove <= 0) gaveBackToEntry++;
    }
    if (trade.net > 0) { positive += trade.net; largest = Math.max(largest, trade.net); }
    if (i >= offset && i - offset < limit) details.push(d);
  }
  return {
    status: !trades.length ? 'no_closed_trades' : !measured ? 'unavailable' : measured === trades.length ? 'observed_lower_bounds' : 'partial',
    basis: 'Single-feed native fills and strictly interior development OHLC bars. MAE/MFE are observed lower bounds.',
    units: { price: 'quote-price units per traded unit', fraction: 'positive magnitude / entry fill price',
      pnl: 'linear price change × absolute quantity, before commission', currency, holdingMs: 'elapsed UTC milliseconds',
      turnover: 'two-sided gross traded notional / indicated equity denominator' },
    coverage: { total: trades.length, measured, withInteriorBars: withBars, fillsOnly: measured - withBars, unavailable: trades.length - measured, reasons },
    favorableThenExitedWithoutGrossGain: gaveBackToEntry,
    largestWinnerShareOfPositiveNetPnl: positive > 0 && trades.every(t => Number.isFinite(t.net)) ? largest / positive : null,
    activity: activity(ledger, equity, market, initialCapital, finalEquity, currency), sourceRefs, readGaps,
    page: { offset, limit, nextOffset: offset + details.length < trades.length ? offset + details.length : null },
    trades: details,
  };
}
