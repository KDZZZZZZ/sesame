// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../scripts/baseline.mjs';

const bar = (i, high, low, close, availableMinute = i) => ({ time: `2026-10-13T1${i}:00:00.000Z`, available_at: `2026-10-13T1${availableMinute}:01:00.000Z`, open: close, high, low, close, volume: 1000 });
const base = rows => ({ schema_version: 1, source: { id: 'structure-test', kind: 'synthetic' }, as_of: '2026-10-13T16:30:00.000Z', parameters: { left: 1, right: 1 }, bars: rows });

test('finds delayed confirmed pivots and levels', () => {
  const result = analyze(base([bar(0, 101, 99, 100), bar(1, 105, 100, 104), bar(2, 104, 98, 99), bar(3, 106, 99, 105), bar(4, 105, 97, 98)]));
  assert.equal(result.observations.pivots.length, 3);
  assert.equal(result.observations.pivots[0].side, 'resistance');
  assert.equal(result.observations.pivots[0].confirmed_at, '2026-10-13T12:01:00.000Z');
  assert.ok(result.observations.levels.length >= 2);
  assert.ok(result.observations.golden_levels.levels.length === 5);
});

test('rejects bad bars and bounded parameters', () => {
  assert.throws(() => analyze({ ...base([bar(0, 101, 99, 100)]), parameters: { left: 0, right: 1 } }), /left/);
  assert.throws(() => analyze(base([bar(0, 99, 101, 100)])), /invalid OHLC/);
});

test('prefix excludes unconfirmed future pivots and delayed data is visible', () => {
  const rows = [bar(0, 101, 99, 100), bar(1, 105, 100, 104), bar(2, 104, 98, 99, 4), bar(3, 106, 99, 105), bar(4, 105, 97, 98)];
  const prefix = analyze({ ...base(rows.slice(0, 3)), as_of: '2026-10-13T14:30:00.000Z' });
  const full = analyze(base(rows));
  const fullVisible = full.observations.pivots.filter(p => p.time <= rows[1].time);
  assert.deepEqual(prefix.observations.pivots, fullVisible);
  assert.equal(prefix.observations.pivots[0].confirmed_at, '2026-10-13T14:01:00.000Z');
});
