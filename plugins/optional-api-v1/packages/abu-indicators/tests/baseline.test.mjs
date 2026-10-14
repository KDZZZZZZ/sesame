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
  volume: 1000 + i,
});

function input(bars) {
  return {
    schema_version: 1,
    source: { id: 'test-indicators', kind: 'synthetic' },
    as_of: '2026-10-13T16:30:00.000Z',
    parameters: { sma_window: 3, ema_span: 3, macd_fast: 3, macd_slow: 6, macd_signal: 3, rsi_window: 3, bollinger_window: 3, atr_window: 3 },
    bars,
  };
}

test('computes focused indicator baseline with null warmup', () => {
  const result = analyze(input([bar(0, 100), bar(1, 102), bar(2, 104), bar(3, 103), bar(4, 106), bar(5, 108)]));
  assert.equal(result.parameters.sma_window, 3);
  assert.equal(result.observations.series[0].sma, null);
  assert.equal(result.observations.series[2].sma, 102);
  assert.equal(result.observations.latest.close, 108);
  assert.ok(result.observations.latest.macd.line > 0);
  assert.ok(result.observations.latest.rsi > 50);
});

test('RSI uses window changes from window plus one closes', () => {
  const result = analyze(input([bar(0, 100), bar(1, 102), bar(2, 101), bar(3, 103), bar(4, 103)]));
  assert.equal(result.observations.series[2].rsi, null);
  assert.equal(result.observations.series[3].rsi, 80);
});

test('rejects invalid and future input', () => {
  assert.throws(() => analyze(input([bar(0, 100), { ...bar(1, 101), close: Number.NaN }])), /finite/);
  assert.throws(() => analyze({ ...input([bar(0, 100)]), as_of: '2026-10-13T09:30:00.000Z' }), /not available/);
});

test('prefix values are stable and delayed availability is explicit', () => {
  const rows = [bar(0, 100), bar(1, 101), bar(2, 102, 4), bar(3, 103), bar(4, 104)];
  const prefix = analyze({ ...input(rows.slice(0, 3)), as_of: '2026-10-13T14:30:00.000Z' });
  const full = analyze(input(rows));
  assert.deepEqual(prefix.observations.series, full.observations.series.slice(0, 3));
  assert.equal(prefix.observations.latest.available_at, '2026-10-13T14:01:00.000Z');
});
