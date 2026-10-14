import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyze } from '../scripts/baseline.mjs';

const load = () => JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('labels an uptrend pullback rebound from visible bars only', () => {
  const result = analyze(load());
  assert.match(result.observations.latest.signal, /^trend_pullback_rebound/);
  assert.equal(result.observations.latest.earliest_action_available_at, '2026-01-09T00:05:00.000Z');
  assert.ok(result.observations.latest.trend_return > 0);
});

test('rejects unknown parameters', () => {
  const input = load();
  input.parameters.future_peek = true;
  assert.throws(() => analyze(input), /Unknown parameter/);
});

test('pullback signal availability waits for delayed trend-window data', () => {
  const input = load();
  input.bars[3].available_at = '2026-01-09T00:30:00.000Z';
  const latest = analyze(input).observations.latest;
  assert.match(latest.signal, /^trend_pullback_rebound/);
  assert.equal(latest.earliest_action_available_at, '2026-01-09T00:30:00.000Z');
});

test('prefix observations are stable', () => {
  const input = load();
  const prefix = { ...input, bars: input.bars.slice(0, -1), as_of: '2026-01-08T01:00:00.000Z' };
  assert.deepEqual(analyze(prefix).observations.series, analyze(input).observations.series.slice(0, -1));
});
