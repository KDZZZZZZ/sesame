import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyze } from '../scripts/baseline.mjs';

const load = () => JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('reports finite dual moving averages and a bullish cross', () => {
  const result = analyze(load());
  assert.equal(result.parameters.fast_window, 2);
  assert.equal(result.observations.latest.signal, 'fast_crossed_above_slow');
  assert.equal(Number.isFinite(result.observations.latest.spread), true);
});

test('rejects invalid fast/slow window relationship', () => {
  const input = load();
  input.parameters.fast_window = 4;
  input.parameters.slow_window = 4;
  assert.throws(() => analyze(input), /fast_window must be less/);
});

test('cross availability waits for delayed source window data', () => {
  const input = load();
  input.bars[1].available_at = '2026-01-06T00:30:00.000Z';
  const latest = analyze(input).observations.latest;
  assert.equal(latest.signal, 'fast_crossed_above_slow');
  assert.equal(latest.earliest_action_available_at, '2026-01-06T00:30:00.000Z');
});

test('prefix observations are stable', () => {
  const input = load();
  const prefix = { ...input, bars: input.bars.slice(0, -1), as_of: '2026-01-05T01:00:00.000Z' };
  assert.deepEqual(analyze(prefix).observations.series, analyze(input).observations.series.slice(0, -1));
});
