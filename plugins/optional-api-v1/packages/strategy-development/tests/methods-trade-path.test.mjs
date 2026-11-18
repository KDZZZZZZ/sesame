import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeTradePath } from '../trade-path.js';

const time = day => new Date(Date.UTC(2024, 0, day)).toISOString();
const trade = (id, first, last, gross, net) => ({ tradeId: id, openTime: time(first), closeTime: time(last), gross, net });
const order = (id, day, size, price, commission, status = 'Completed', executed = size) => ({ orderId: id, status,
  size: String(size), executedSize: String(executed), executedPrice: String(price), commission: String(commission), executedTime: time(day) });
const bar = (day, low, high) => ({ t: { basis: 'utc', unixMs: Date.parse(time(day)) }, L: String(low), H: String(high) });
function sample() {
  const development = [bar(1, 1, 999), bar(2, 96, 112), bar(3, 2, 550), bar(4, 5, 700), bar(5, 85, 110), bar(6, 1, 850)];
  const trades = [trade('long', 1, 3, 10, 8), trade('short', 4, 6, -6, -8)];
  return { trades, development, columns: { datetime: 't', low: 'L', high: 'H' }, initialCapital: '1000', finalEquity: 1000, currency: 'USD',
    equity: development.map(row => ({ time: new Date(row.t.unixMs).toISOString(), value: '1000' })),
    orders: [order('buy', 1, 2, 0, 0, 'Accepted', 0), order('buy', 1, 2, 100, 1), order('sell', 3, -2, 105, 1),
      order('short', 4, -3, 100, 1), order('cover', 6, 3, 102, 1)], sourceRefs: ['development', 'passes'] };
}
test('long and short excursions use actual signed fills and exclude both boundary-bar extremes', () => {
  const result = analyzeTradePath(sample());
  const [long, short] = result.trades;
  assert.deepEqual([long.direction, long.entryPrice, long.exitPrice, long.quantity], ['long', 100, 105, 2]);
  assert.deepEqual([long.maePrice, long.mfePrice, long.maeFraction, long.mfeFraction, long.maePnl, long.mfePnl], [4, 12, .04, .12, 8, 24]);
  assert.deepEqual([short.direction, short.maePrice, short.mfePrice, short.maeFraction, short.mfeFraction, short.maePnl, short.mfePnl], ['short', 10, 15, .1, .15, 30, 45]);
  assert.equal(long.givebackPriceLowerBound, 7); assert.equal(short.givebackPriceLowerBound, 17);
  assert.equal(short.holdingMs, 2 * 86400000);
  assert.equal(result.favorableThenExitedWithoutGrossGain, 1); assert.equal(result.largestWinnerShareOfPositiveNetPnl, 1);
  assert.equal(result.activity.grossTradedNotional, 1016); assert.equal(result.activity.turnoverOnInitialEquity, 1.016);
  assert.equal(result.activity.turnoverOnAverageEquity, 1.016); assert.equal(result.activity.commission, 4);
  assert.equal(result.activity.slippageCost, null); assert.equal(result.coverage.measured, 2);
  const second = analyzeTradePath(sample(), { offset: 1, limit: 1 });
  assert.deepEqual(second.trades, [short]); assert.deepEqual(second.coverage, result.coverage);
  assert.equal(second.page.nextOffset, null); assert.equal(analyzeTradePath(sample(), { offset: 0, limit: 1 }).page.nextOffset, 1);
});

test('missing or adjacent bars keep verified fill-only bounds and explicit gaps', () => {
  const s = sample(); s.development = [s.development[0], s.development[2], s.development[5]];
  let result = analyzeTradePath(s);
  assert.deepEqual([result.trades[0].mfePrice, result.trades[0].maePrice], [5, 0]);
  assert.equal(result.trades[0].gaps[0], 'no_strictly_interior_bar');
  assert.equal(result.trades[1].gaps[0], 'boundary_fills_not_on_frozen_bars');
  assert.equal(result.coverage.fillsOnly, 2);
  assert.equal(result.activity.turnoverOnAverageEquity, null);
  result = analyzeTradePath({ ...s, development: null });
  assert.equal(result.trades[1].status, 'fills_only');
  assert.deepEqual(result.trades[1].gaps, ['missing_development_bars']);
  const other = sample(); other.development[4].L = null;
  assert.deepEqual(analyzeTradePath(other).trades[1].gaps, ['missing_interior_extrema']);
});

test('partial cumulative notifications and scales do not invent a simple entry, turnover sums each order once', () => {
  const s = sample();
  s.trades = [trade('mixed', 1, 3, 10, 8)]; s.orders = [order('buy', 1, 2, 98, .5, 'Partial', 1),
    order('buy', 2, 2, 100, 1), order('buy', 2, 2, 100, 1), order('sell', 3, -2, 105, 1)];
  const result = analyzeTradePath(s);
  assert.equal(result.trades[0].status, 'unavailable'); assert.equal(result.trades[0].maePrice, undefined);
  assert.deepEqual(result.trades[0].gaps, ['scaled_partial_or_interleaved_position']);
  assert.equal(result.activity.grossTradedNotional, 410); assert.equal(result.activity.commission, 2);
  s.orders[1].executedSize = '-2';
  assert.equal(analyzeTradePath(s).activity.gaps[0], 'inconsistent_cumulative_order');
});

test('same-bar, overlapping trades, unrelated P&L and absent orders report why they cannot be attributed', () => {
  const s = sample();
  const overlap = analyzeTradePath({ ...s, trades: [trade('a', 1, 4, 10, 9), trade('b', 3, 6, 5, 4)] });
  assert.equal(overlap.coverage.reasons.overlapping_trade_intervals, 2);
  const same = analyzeTradePath({ ...s, trades: [trade('same', 1, 1, 0, -1)] });
  assert.equal(same.coverage.reasons.same_bar_event_sequence_unknown, 1);
  s.trades[0].gross = 1000;
  assert.equal(analyzeTradePath(s).trades[0].gaps[0], 'gross_pnl_does_not_match_linear_fills');
  const missing = analyzeTradePath({ ...s, orders: null });
  assert.equal(missing.activity.status, 'unavailable'); assert.equal(missing.coverage.reasons.missing_order_table, 2);
  const none = analyzeTradePath({ ...s, orders: [], trades: [] });
  assert.equal(none.activity.grossTradedNotional, 0); assert.equal(none.coverage.total, 0);
});

test('absent P&L, time and commission retain only the independent measurements they support', () => {
  const s = sample();
  s.trades[0].net = null; s.orders[1].commission = null;
  const result = analyzeTradePath(s);
  assert.equal(result.coverage.measured, 2); assert.equal(result.largestWinnerShareOfPositiveNetPnl, null);
  assert.deepEqual(result.trades[0].gaps, ['missing_net_trade_pnl']);
  assert.equal(result.activity.commission, null); assert.equal(result.activity.grossTradedNotional, 1016);
  assert.ok(result.activity.gaps.includes('missing_order_commission'));
  s.trades[0].gross = null;
  assert.deepEqual(analyzeTradePath(s).trades[0].gaps, ['missing_trade_gross_pnl']);
  s.trades[0].openTime = null;
  const unknown = analyzeTradePath(s);
  assert.deepEqual(unknown.coverage.reasons, { invalid_trade_times: 1, other_closed_trade_time_unknown: 1 });
  assert.equal(unknown.activity.grossTradedNotional, 1016);
});
