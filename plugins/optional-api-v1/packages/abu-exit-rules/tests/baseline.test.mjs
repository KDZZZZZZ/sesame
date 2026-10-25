import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyze } from '../scripts/baseline.mjs';

const load = () => JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('reports ATR exit observations without using pre-entry extrema', () => {
  const result = analyze(load());
  assert.ok(result.observations.first_exit.exit_reasons.length > 0);
  assert.ok(result.observations.latest.best_high_since_entry < 130);
  assert.equal(result.observations.position.entry_time, '2026-01-02T00:00:00.000Z');
});

test('excludes the entry close bar range from post-entry extrema', () => {
  const input = load();
  input.bars[1].high = 150;
  const result = analyze(input);
  assert.equal(result.observations.position.entry_bar_excluded_from_extrema, true);
  assert.ok(result.observations.latest.best_high_since_entry < 150);
});

test('period exit works while ATR is still warming up', () => {
  const input = load();
  input.parameters.atr_window = 10;
  input.parameters.max_holding_bars = 1;
  const firstExit = analyze(input).observations.first_exit;
  assert.equal(firstExit.atr, null);
  assert.deepEqual(firstExit.exit_reasons, ['max_holding_bars']);
});

test('initial ATR includes the first bar range and becomes available after N bars', () => {
  const input = load();
  input.position.entry_time = input.bars[0].time;
  input.position.entry_price = input.bars[0].close;
  input.parameters.atr_window = 3;
  const series = analyze(input).observations.series;
  assert.equal(series[0].atr, null);
  assert.equal(series[0].status, 'atr_warmup');
  assert.equal(series[1].atr, (41 + 11 + 7) / 3);
  assert.equal(series[1].status, 'ready');
});

test('ATR exit availability waits for delayed warmup history', () => {
  const input = load();
  input.parameters.stop_win_atr = 0.1;
  input.parameters.max_holding_bars = 20;
  input.bars[1].available_at = '2026-01-03T00:30:00.000Z';
  const firstExit = analyze(input).observations.first_exit;
  assert.ok(firstExit.exit_reasons.includes('atr_stop_win'));
  assert.equal(firstExit.earliest_action_available_at, '2026-01-03T00:30:00.000Z');
});

test('rejects unaligned entry time', () => {
  const input = load();
  input.position.entry_time = '2026-01-02T12:00:00.000Z';
  assert.throws(() => analyze(input), /align to a provided bar close/);
});

test('rejects future entry time', () => {
  const input = load();
  input.position.entry_time = '2026-02-01T00:00:00.000Z';
  assert.throws(() => analyze(input), /must not be after as_of/);
});

test('rejects invalid ATR units', () => {
  const input = load();
  input.parameters.stop_loss_atr = 0;
  assert.throws(() => analyze(input), /stop_loss_atr/);
});
