// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../scripts/baseline.mjs';

const bar = (i, close, availableMinute = i) => ({ time: `2026-10-13T1${i}:00:00.000Z`, available_at: `2026-10-13T1${availableMinute}:01:00.000Z`, open: close, high: close + 1, low: close - 1, close, volume: 1000 });
const inst = (id, closes, lag = 0) => ({ id, bars: closes.map((c, i) => bar(i + lag, c)) });
const base = instruments => ({ schema_version: 1, source: { id: 'similarity-test', kind: 'synthetic' }, as_of: '2026-10-13T16:30:00.000Z', parameters: { min_overlap: 3 }, instruments });

test('computes aligned return similarity', () => {
  const result = analyze(base([inst('AAA', [100, 102, 103, 105]), inst('BBB', [50, 51, 52, 53])]));
  const pair = result.observations.pairs[0];
  assert.equal(pair.overlap, 3);
  assert.equal(pair.status, 'ok');
  assert.ok(pair.pearson > 0);
  assert.equal(pair.sign_agreement, 1);
});

test('handles disjoint and constant series explicitly', () => {
  const disjoint = analyze(base([inst('AAA', [100, 101, 102, 103], 0), inst('CCC', [10, 11, 12, 13], 3)]));
  assert.equal(disjoint.observations.pairs[0].status, 'insufficient_overlap');
  const constant = analyze(base([inst('AAA', [100, 101, 102, 103]), inst('FLAT', [10, 10, 10, 10])]));
  assert.equal(constant.observations.pairs[0].status, 'constant_or_degenerate');
  assert.equal(constant.observations.pairs[0].pearson, null);
});

test('requires both return endpoints to match when bars have gaps', () => {
  const regular = inst('REG', [100, 101, 102, 103, 104]);
  const missingMiddle = { id: 'GAP', bars: [bar(0, 200), bar(1, 202), bar(3, 206), bar(4, 208)] };
  const result = analyze(base([regular, missingMiddle]));
  assert.equal(result.observations.pairs[0].overlap, 2);
});

test('rejects duplicate ids and future rows', () => {
  assert.throws(() => analyze(base([inst('AAA', [10, 11, 12, 13]), inst('AAA', [10, 11, 12, 13])])), /unique/);
  assert.throws(() => analyze({ ...base([inst('AAA', [10, 11, 12, 13]), inst('BBB', [10, 11, 12, 13])]), as_of: '2026-10-13T09:00:00.000Z' }), /not available/);
});
