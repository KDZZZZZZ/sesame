import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyze } from '../scripts/baseline.mjs';

const load = () => JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('computes ATR risk budget, capped Kelly and price rank without lot conversion', () => {
  const result = analyze(load());
  assert.equal(result.observations.account.equity, 100000);
  assert.equal(result.observations.account.currency, 'USD');
  assert.equal(result.observations.account.scenario, 'constant_equity_hypothetical_not_historical_account_trajectory');
  assert.equal(result.observations.latest.sizing_output_unit, 'USD_cash_per_USD_price_point');
  assert.ok(result.observations.latest.cash_per_price_point_estimate > 0);
  assert.equal(result.observations.latest.quantity_estimate, null);
  assert.ok(result.observations.latest.effective_kelly_fraction <= result.observations.latest.capped_kelly_fraction);
  assert.ok(result.observations.latest.price_rank <= 1);
});

test('rejects invalid probability inputs', () => {
  const input = load();
  input.parameters.kelly_win_probability = 1.5;
  assert.throws(() => analyze(input), /kelly_win_probability/);
});

test('initial ATR uses N bar ranges while sizing waits for the price-rank window', () => {
  const series = analyze(load()).observations.series;
  assert.equal(series[1].atr, null);
  assert.equal(series[2].atr, (3 + 4 + 4) / 3);
  assert.equal(series[2].status, 'warmup');
  assert.equal(series[2].price_rank, null);
  assert.equal(series[3].status, 'ready');
});

test('sizing availability waits for delayed ATR or price-rank window data', () => {
  const input = load();
  input.bars[1].available_at = '2026-01-05T00:30:00.000Z';
  const latest = analyze(input).observations.latest;
  assert.equal(latest.used_available_at, '2026-01-05T00:30:00.000Z');
});

test('returns undefined risk instead of Infinity when ATR is zero', () => {
  const input = load();
  input.bars = input.bars.map(row => ({ ...row, open: 100, high: 100, low: 100, close: 100 }));
  const latest = analyze(input).observations.latest;
  assert.equal(latest.status, 'undefined_price_risk');
  assert.equal(latest.cash_per_price_point_estimate, null);
  assert.equal(latest.quantity_estimate, null);
});

test('computes declared quantity only when point value and unit are supplied', () => {
  const input = load();
  input.instrument.quantity_unit = 'CONTRACT';
  input.instrument.point_value = 10;
  const latest = analyze(input).observations.latest;
  assert.equal(latest.sizing_output_unit, 'CONTRACT');
  assert.equal(latest.quantity_estimate, latest.cash_per_price_point_estimate / 10);
});

test('rejects missing account currency', () => {
  const input = load();
  delete input.account.currency;
  assert.throws(() => analyze(input), /account.currency/);
});

test('prefix observations are stable', () => {
  const input = load();
  const prefix = { ...input, bars: input.bars.slice(0, -1), as_of: '2026-01-04T01:00:00.000Z' };
  assert.deepEqual(analyze(prefix).observations.series, analyze(input).observations.series.slice(0, -1));
});
