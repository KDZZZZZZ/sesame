// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../scripts/baseline.mjs';

const bar = (i, close, availableMinute = i) => ({
  time: `2026-10-13T1${i}:00:00.000Z`,
  available_at: `2026-10-13T1${availableMinute}:01:00.000Z`,
  open: close - 0.5,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1000,
});
const base = rows => ({ schema_version: 1, source: { id: 'trend-test', kind: 'synthetic' }, as_of: '2026-10-13T16:30:00.000Z', parameters: { window: 4 }, bars: rows });

test('computes rolling trend features', () => {
  const result = analyze(base([bar(0, 100), bar(1, 102), bar(2, 104), bar(3, 106), bar(4, 108)]));
  assert.equal(result.observations.series[2].slope, null);
  assert.equal(result.observations.series[3].slope, 2);
  assert.ok(result.observations.latest.normalized_slope > 0);
  assert.equal(result.observations.latest.path_efficiency, 1);
});

test('rejects invalid parameters and future rows', () => {
  assert.throws(() => analyze({ ...base([bar(0, 100), bar(1, 101)]), parameters: { window: 2 } }), /window/);
  assert.throws(() => analyze({ ...base([bar(0, 100)]), as_of: '2026-10-13T09:00:00.000Z' }), /not available/);
});

test('prefix output remains stable with delayed availability marked', () => {
  const rows = [bar(0, 100), bar(1, 101), bar(2, 102, 4), bar(3, 103), bar(4, 104)];
  const prefix = analyze({ ...base(rows.slice(0, 4)), as_of: '2026-10-13T14:30:00.000Z' });
  const full = analyze(base(rows));
  assert.deepEqual(prefix.observations.series, full.observations.series.slice(0, 4));
  assert.equal(prefix.observations.latest.available_at, '2026-10-13T14:01:00.000Z');
});
