import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyze } from '../scripts/baseline.mjs';

const load = () => JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('uses only prior completed UTC weekday return samples', () => {
  const result = analyze(load());
  assert.equal(result.observations.latest.utc_weekday, 'Thu');
  assert.equal(result.observations.latest.sample_count, 2);
  assert.equal(result.observations.latest.signal, 'positive_prior_utc_weekday_edge');
});

test('does not include the current bar future return in its own weekday sample', () => {
  const input = load();
  input.bars.push({ time: '2026-01-16T00:00:00.000Z', available_at: '2026-01-16T00:05:00.000Z', open: 104, high: 105, low: 80, close: 82, volume: 1000 });
  input.as_of = '2026-01-16T01:00:00.000Z';
  const latestBeforeFriday = analyze(load()).observations.latest;
  assert.equal(latestBeforeFriday.sample_count, 2);
  assert.equal(analyze(input).observations.series.at(-2).sample_count, latestBeforeFriday.sample_count);
});

test('weekday signal availability waits for delayed prior completed pair', () => {
  const input = load();
  input.bars[3].available_at = '2026-01-15T00:30:00.000Z';
  const latest = analyze(input).observations.latest;
  assert.equal(latest.signal, 'positive_prior_utc_weekday_edge');
  assert.equal(latest.earliest_action_available_at, '2026-01-15T00:30:00.000Z');
});

test('rejects noncanonical timestamps', () => {
  const input = load();
  input.bars[0].time = '2026-01-01';
  assert.throws(() => analyze(input), /canonical UTC timestamp/);
});
