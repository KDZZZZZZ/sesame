import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyze } from '../scripts/baseline.mjs';
import { envelope } from '../scripts/runtime.mjs';

const load = () => JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('detects prior-window close breakout with next-interval availability', () => {
  const result = analyze(load());
  assert.equal(result.observations.latest.signal, 'prior_high_close_breakout');
  assert.equal(result.observations.latest.earliest_action_available_at, '2026-01-07T00:05:00.000Z');
  assert.equal(result.observations.latest.lookback_high, 106);
});

test('rejects unavailable future bars', () => {
  const input = load();
  input.bars.at(-1).available_at = '2026-01-12T02:00:00.000Z';
  assert.throws(() => analyze(input), /observation is not available/);
});

test('signal availability waits for delayed prior-window data', () => {
  const input = load();
  input.bars[3].available_at = '2026-01-07T00:30:00.000Z';
  const latest = analyze(input).observations.latest;
  assert.equal(latest.signal, 'prior_high_close_breakout');
  assert.equal(latest.earliest_action_available_at, '2026-01-07T00:30:00.000Z');
});

test('prefix observations are stable before the added bar', () => {
  const input = load();
  const prefix = { ...input, bars: input.bars.slice(0, -1), as_of: '2026-01-06T01:00:00.000Z' };
  assert.deepEqual(analyze(prefix).observations.series, analyze(input).observations.series.slice(0, -1));
});

test('envelope marks editable research baseline', () => {
  const output = envelope(load(), analyze, new URL('../scripts/baseline.mjs', import.meta.url));
  assert.equal(output.baseline, true);
  assert.match(output.guidance, /基线/);
});
