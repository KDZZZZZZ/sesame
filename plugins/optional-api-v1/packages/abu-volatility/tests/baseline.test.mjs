// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../scripts/baseline.mjs';

const bar = (i, open, close, availableMinute = i) => ({ time: `2026-10-13T1${i}:00:00.000Z`, available_at: `2026-10-13T1${availableMinute}:01:00.000Z`, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 + i });
const base = rows => ({ schema_version: 1, source: { id: 'vol-test', kind: 'synthetic' }, as_of: '2026-10-13T16:30:00.000Z', parameters: { return_window: 3, atr_window: 3, gap_threshold_pct: 0.02 }, bars: rows });

test('computes volatility, ATR, gap and VWAP', () => {
  const result = analyze(base([bar(0, 100, 100), bar(1, 101, 102), bar(2, 105, 104), bar(3, 104, 103), bar(4, 103, 106)]));
  assert.equal(result.observations.series[2].rolling_return_std, null);
  assert.ok(result.observations.latest.rolling_return_std > 0);
  assert.ok(result.observations.latest.atr > 0);
  assert.ok(result.observations.gaps.length >= 1);
  assert.ok(result.observations.latest.cumulative_vwap > 0);
});

test('rejects invalid values and future data', () => {
  assert.throws(() => analyze(base([bar(0, 100, 100), { ...bar(1, 101, 102), volume: -1 }])), /volume/);
  assert.throws(() => analyze({ ...base([bar(0, 100, 100)]), as_of: '2026-10-13T09:00:00.000Z' }), /not available/);
});

test('prefix values stable and delayed availability explicit', () => {
  const rows = [bar(0, 100, 100), bar(1, 101, 102), bar(2, 102, 104, 4), bar(3, 104, 103), bar(4, 103, 106)];
  const prefix = analyze({ ...base(rows.slice(0, 4)), as_of: '2026-10-13T14:30:00.000Z' });
  const full = analyze(base(rows));
  assert.deepEqual(prefix.observations.series, full.observations.series.slice(0, 4));
  assert.equal(prefix.observations.latest.available_at, '2026-10-13T14:01:00.000Z');
});
