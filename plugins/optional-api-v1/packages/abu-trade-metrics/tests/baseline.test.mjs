// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze } from '../scripts/baseline.mjs';
import { envelope } from '../scripts/runtime.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('computes equity and closed-trade metrics', () => {
  const out = envelope(fixture, analyze, new URL('../scripts/baseline.mjs', import.meta.url));
  assert.equal(out.baseline, true);
  assert.ok(Math.abs(out.observations.equity.total_return - 0.04) < 1e-12);
  assert.equal(out.observations.closed_trades.count, 2);
  assert.equal(out.observations.closed_trades.win_rate, 0.5);
  assert.equal(out.observations.closed_trades.attribution_by_strategy.breakout.net_pnl, 1200);
  assert.equal(out.observations.equity.currency, 'USD');
  assert.ok(out.observations.equity.max_drawdown.value < 0);
  assert.equal(out.observations.equity.max_drawdown.peak_time, '2026-01-02T00:00:00.000Z');
  assert.equal(out.observations.equity.max_drawdown.trough_time, '2026-01-05T00:00:00.000Z');
});

test('rejects closed trade outcome unavailable at as_of', () => {
  const bad = structuredClone(fixture);
  bad.closed_trades[0].available_at = '2026-01-11T00:00:00.000Z';
  assert.throws(() => analyze(bad), /chronology invalid/);
});

test('requires portfolio flow declaration and exact cost attribution', () => {
  const missing = structuredClone(fixture);
  delete missing.portfolio;
  assert.throws(() => analyze(missing), /portfolio/);
  const badCost = structuredClone(fixture);
  badCost.closed_trades[0].cost = 1;
  assert.throws(() => analyze(badCost), /cost must equal/);
});
