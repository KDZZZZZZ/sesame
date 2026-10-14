// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../scripts/baseline.mjs';

const bar = (i, close, availableMinute = i) => ({ time: `2026-10-13T1${i}:00:00.000Z`, available_at: `2026-10-13T1${availableMinute}:01:00.000Z`, open: close, high: close + 1, low: close - 1, close, volume: 1000 });
const inst = (id, closes) => ({ id, bars: closes.map((c, i) => bar(i, c)) });
const base = instruments => ({ schema_version: 1, source: { id: 'screen-test', kind: 'synthetic' }, as_of: '2026-10-13T16:30:00.000Z', parameters: { momentum_window: 3, trend_window: 4, efficiency_window: 4, price_window: 4, top_n: 2 }, instruments });

test('ranks bounded universe by transparent features', () => {
  const result = analyze(base([inst('UP', [100, 101, 102, 104, 107]), inst('DOWN', [50, 49, 48, 47, 46]), inst('CHOP', [20, 22, 19, 23, 21])]));
  assert.equal(result.observations.universe_size, 3);
  assert.equal(result.observations.top[0].id, 'UP');
  assert.equal(result.observations.top.length, 2);
  assert.ok(result.observations.top[0].metrics.momentum > 0);
});

test('rejects duplicate ids and future rows', () => {
  assert.throws(() => analyze(base([inst('A', [10, 11, 12, 13]), inst('A', [10, 11, 12, 13])])), /unique/);
  assert.throws(() => analyze({ ...base([inst('A', [10, 11, 12, 13]), inst('B', [10, 11, 12, 13])]), as_of: '2026-10-13T09:00:00.000Z' }), /not available/);
});

test('delayed availability is preserved in screen rows', () => {
  const delayed = { id: 'LATE', bars: [bar(0, 100), bar(1, 101), bar(2, 102, 4), bar(3, 103), bar(4, 104)] };
  const result = analyze(base([delayed, inst('NOW', [100, 100, 100, 100, 100])]));
  const late = result.observations.all.find(item => item.id === 'LATE');
  assert.equal(late.available_at, '2026-10-13T14:01:00.000Z');
});

test('ties use average rank and insufficient history is not selected', () => {
  const short = { id: 'SHORT', bars: [bar(2, 10), bar(3, 11), bar(4, 12)] };
  const result = analyze(base([inst('A', [10, 11, 12, 13, 14]), inst('B', [10, 11, 12, 13, 14]), short]));
  assert.deepEqual(result.observations.top.map(item => item.id), ['A', 'B']);
  assert.equal(result.observations.top[0].ranks.momentum, 1.5);
  assert.equal(result.observations.all.find(item => item.id === 'SHORT').status, 'insufficient_history');
});

test('rejects cross-sectional screens with different latest bar times', () => {
  const late = { id: 'LATE', bars: [bar(1, 10), bar(2, 11), bar(3, 12), bar(4, 13)] };
  assert.throws(() => analyze(base([inst('A', [10, 11, 12, 13]), late])), /latest bar times/);
});
