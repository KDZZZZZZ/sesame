import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeBreakoutStudy } from '../breakout-study.js';

const options = { lookback: 1, horizon: 1, side: 'long' };
const stamp = day => new Date(Date.UTC(2024, 0, day)).toISOString();
const series = values => values.map(([open, high, low, close], i) => ({ datetime: stamp(i + 1), open, high, low, close }));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 1e-12, 'Expected ' + expected + ', received ' + actual);
const gapSeries = () => series([[98, 100, 96, 99], [99, 105, 96, 100], [100, 110, 99, 108], [120, 123, 117, 118]]);

test('a long breakout gains on the gap but loses from next open, against all eligible long decisions', () => {
  const result = analyzeBreakoutStudy(gapSeries(), {}, options);
  assert.equal(result.method, 'breakout_continuation');
  assert.deepEqual(Object.keys(result.sides), ['long']);
  const { opportunities, allDecisions, differenceVsAll, examples } = result.sides.long;
  assert.deepEqual([result.coverage.warmupBars, result.coverage.decisions, result.coverage.labeled, result.coverage.rightCensored], [1, 3, 2, 1]);
  // Jan 2 closes exactly at the prior high and is only in the all-decisions group.
  assert.deepEqual([opportunities.count, opportunities.labeled, opportunities.rightCensored], [2, 1, 1]);
  assert.deepEqual([allDecisions.count, allDecisions.labeled, allDecisions.rightCensored], [3, 2, 1]);
  near(opportunities.meanGapOnSignalClose, 12 / 108);
  near(opportunities.meanContinuationOnSignalClose, -2 / 108);
  near(opportunities.meanTotalOnSignalClose, 10 / 108);
  near(opportunities.meanGapOnSignalClose + opportunities.meanContinuationOnSignalClose, opportunities.meanTotalOnSignalClose);
  near(opportunities.meanContinuationOnNextOpen, -2 / 120);
  assert.equal(opportunities.continuationWinRate, 0); assert.equal(allDecisions.continuationWinRate, .5);
  near(allDecisions.meanContinuationOnNextOpen, (.08 - 2 / 120) / 2);
  assert.equal(differenceVsAll.continuationWinRate, -.5);
  const [labeled] = examples.labeled, [tail] = examples.rightCensored;
  assert.deepEqual([labeled.signalBarTime, labeled.priorExtreme, labeled.signalClose, labeled.nextOpenBarTime, labeled.nextOpen,
    labeled.horizonBarTime, labeled.horizonClose], [stamp(3), '105', '108', stamp(4), '120', stamp(4), '118']);
  assert.equal(tail.signalBarTime, stamp(4)); assert.equal(tail.labels, null); assert.equal(tail.availableFollowingBars, 0);
});

test('two-bar short returns use the signal close and entry separately, with incomplete tail opportunities counted', () => {
  const values = [[105, 110, 100, 105], [103, 108, 99, 101], [100, 102, 95, 98],
    [96, 101, 94, 99], [99, 100, 91, 92], [90, 93, 89, 90]];
  const both = analyzeBreakoutStudy(series(values), null, { lookback: 2, horizon: 2, side: 'both' });
  assert.deepEqual([both.coverage.warmupBars, both.coverage.decisions, both.coverage.labeled, both.coverage.rightCensored], [2, 4, 2, 2]);
  const { opportunities, allDecisions, examples } = both.sides.short;
  assert.deepEqual([opportunities.count, opportunities.labeled, opportunities.rightCensored], [3, 1, 2]);
  near(opportunities.meanGapOnSignalClose, 2 / 98); near(opportunities.meanContinuationOnSignalClose, 4 / 98);
  near(opportunities.meanTotalOnSignalClose, 6 / 98); near(opportunities.meanContinuationOnNextOpen, 4 / 96);
  assert.equal(opportunities.continuationWins, 1); assert.equal(opportunities.continuationWinRate, 1);
  near(allDecisions.meanContinuationOnNextOpen, (4 / 96 + 9 / 99) / 2);
  assert.equal(examples.labeled[0].priorExtreme, '99'); assert.equal(examples.labeled[0].horizonBarTime, stamp(5));
  assert.deepEqual(examples.rightCensored.map(row => [row.availableFollowingBars, row.nextOpen, row.horizonBarTime, row.labels]), [[1, '90', null, null], [0, null, null, null]]);
  assert.equal(both.sides.long.opportunities.count, 0); assert.equal(both.sides.long.opportunities.continuationWinRate, null);
  near(both.sides.long.allDecisions.meanContinuationOnNextOpen, -allDecisions.meanContinuationOnNextOpen);
  assert.deepEqual(analyzeBreakoutStudy(series(values), {}, { lookback: 2, horizon: 2, side: 'short' }).sides, { short: both.sides.short });
});

test('opportunity timing is prefix-invariant and decimal threshold comparisons retain strict small differences', () => {
  const rows = gapSeries(), full = analyzeBreakoutStudy(rows, {}, options);
  const truncated = analyzeBreakoutStudy(rows.slice(0, 3), {}, options).sides.long;
  assert.equal(truncated.examples.rightCensored[0].signalBarTime, full.sides.long.examples.labeled[0].signalBarTime);
  assert.equal(truncated.examples.rightCensored[0].priorExtreme, full.sides.long.examples.labeled[0].priorExtreme);
  assert.equal(truncated.examples.rightCensored[0].labels, null);
  const [p, q, r] = ['10000000000000000', '10000000000000001', '10000000000000002'];
  const tiny = analyzeBreakoutStudy(series([[p, p, p, p], [p, q, p, q], [q, r, q, r]]), {}, options).sides.long;
  assert.equal(tiny.opportunities.labeled, 1); near(tiny.opportunities.meanContinuationOnNextOpen, 1e-16);
  const flat = analyzeBreakoutStudy(series([[1e-7, 1e-7, 1e-7, 1e-7], [1e-7, 2e-7, 1e-7, 2e-7], [2e-7, 2e-7, 2e-7, 2e-7]]), {}, options);
  assert.equal(flat.sides.long.opportunities.continuationWinRate, 0); assert.equal(flat.sides.long.opportunities.meanContinuationOnNextOpen, 0);
});

test('column mappings, explicit UTC offsets and stable native instruments preserve source identity', () => {
  const rows = gapSeries().map((r, i) => ({ t: i ? { basis: 'utc', unixMs: Date.parse(r.datetime) } : '2023-12-31T19:00:00-05:00',
    o: r.open, h: r.high, l: r.low, c: r.close, symbol: 'ABC', instrument: { instrumentId: 'ABC', sourceId: 'feed' } }));
  const columns = { datetime: 't', open: 'o', high: 'h', low: 'l', close: 'c' };
  const result = analyzeBreakoutStudy(rows, columns, options);
  assert.deepEqual(result.coverage.instrument, { basis: 'row_identifiers', identifiers: { symbol: 'ABC', instrument: { sourceId: 'feed', instrumentId: 'ABC' } } });
  assert.equal(result.coverage.firstBarTime, stamp(1)); assert.equal(result.coverage.lastBarTime, stamp(4));
  rows[2].symbol = 'XYZ'; assert.throws(() => analyzeBreakoutStudy(rows, columns, options), /Row 2 changes the symbol/);
  delete rows[2].symbol; assert.throws(() => analyzeBreakoutStudy(rows, columns, options), /Row 2 .*missing symbol/);
  rows[2].symbol = 'ABC'; rows[2].instrument.sourceId = 'other'; assert.throws(() => analyzeBreakoutStudy(rows, columns, options), /Row 2 changes the instrument/);
  const laterId = gapSeries(); laterId[2].instrumentId = 'ABC';
  assert.throws(() => analyzeBreakoutStudy(laterId, {}, options), /Row 2 .*missing instrumentId/);
  assert.equal(analyzeBreakoutStudy(gapSeries(), {}, options).coverage.instrument.basis, 'caller_declared_single_series');
});

test('malformed data and unsupported inputs fail at the row, without silently reordering or skipping', () => {
  for (const [field, value, message] of [
    ['open', null, /positive finite open/], ['high', Infinity, /positive finite high/], ['low', 0, /positive finite low/],
    ['close', '', /positive finite close/], ['open', '1e2', /invalid open/], ['high', 98, /outside its low\/high range/],
    ['datetime', stamp(1), /strictly increasing/], ['datetime', '2024-02-30T00:00:00Z', /timezone-qualified/],
    ['datetime', '2024-01-02T10:00:00', /timezone-qualified/], ['datetime', '2024-01-02T00:00:00.00001Z', /millisecond/],
  ]) {
    const rows = gapSeries(); rows[1][field] = value;
    assert.throws(() => analyzeBreakoutStudy(rows, {}, options), error => /Row 1/.test(error.message) && message.test(error.message));
  }
  assert.throws(() => analyzeBreakoutStudy(gapSeries().toReversed(), {}, options), /strictly increasing/);
  assert.throws(() => analyzeBreakoutStudy(gapSeries(), { low: 'close' }, options), /distinct/);
  for (const bad of [{ lookback: 0 }, { horizon: 1.5 }, { lookback: 501 }, { side: 'either' }])
    assert.throws(() => analyzeBreakoutStudy(gapSeries(), {}, { ...options, ...bad }), /integer lookback|directions/);
  for (const rows of [[gapSeries()[0]], new Array(100001)]) assert.throws(() => analyzeBreakoutStudy(rows, {}, options), /2–100000/);
  assert.throws(() => analyzeBreakoutStudy(gapSeries(), {}, options, AbortSignal.abort()), { name: 'AbortError' });
  const short = analyzeBreakoutStudy(gapSeries().slice(0, 2), {}, { lookback: 500, horizon: 500, side: 'both' });
  assert.equal(short.coverage.decisions, 0); assert.equal(short.sides.short.allDecisions.meanTotalOnSignalClose, null);
});

test('rolling highs expire and examples stay bounded across long runs', () => {
  const rows = series(Array.from({ length: 40 }, (_, i) => [100 + i, 101 + i, 99 + i, 101 + i]));
  rows[0].high = 200;
  const { opportunities, examples } = analyzeBreakoutStudy(rows, {}, { lookback: 3, horizon: 3, side: 'long' }).sides.long;
  assert.deepEqual([opportunities.count, opportunities.labeled, opportunities.rightCensored], [36, 33, 3]);
  assert.equal(examples.labeled.length, 4); assert.equal(examples.rightCensored.length, 2);
  assert.equal(examples.labeled[0].decisionIndex, 4);
});
