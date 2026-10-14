// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze } from '../scripts/baseline.mjs';
import { envelope } from '../scripts/runtime.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('audits supplied replay evidence without acting as a backtester', () => {
  const out = envelope(fixture, analyze, new URL('../scripts/baseline.mjs', import.meta.url));
  assert.equal(out.observations.audit.issue_count, 0);
  assert.equal(out.observations.evidence_counts.orders, 2);
  assert.equal(out.observations.fills_by_symbol.XYZ.gross_quantity, 20);
  assert.equal(out.observations.fills_by_symbol.XYZ.buy_quantity, 10);
  assert.equal(out.observations.fills_by_symbol.XYZ.sell_quantity, 10);
  assert.equal(out.observations.fills_by_symbol.XYZ.net_quantity, 0);
  assert.equal(out.observations.native_engine_handoff.recommended, true);
});

test('flags fill chronology and unknown order problems', () => {
  const bad = structuredClone(fixture);
  bad.trades[0].time = '2026-01-02T20:04:00.000Z';
  bad.trades.push({ id: 'bad', order_id: 'missing', time: '2026-01-05T20:07:00.000Z', available_at: '2026-01-05T20:07:01.000Z', symbol: 'XYZ', quantity: 1, price: 105, cost: 0 });
  const out = analyze(bad);
  const codes = out.observations.audit.issues.map(x => x.code);
  assert.ok(codes.includes('fill_before_order'));
  assert.ok(codes.includes('unknown_order'));
});

test('flags limit price breaches and requires explicit costs', () => {
  const bad = structuredClone(fixture);
  bad.trades[0].price = 105;
  const out = analyze(bad);
  assert.ok(out.observations.audit.issues.map(x => x.code).includes('buy_limit_breached'));
  const missingCost = structuredClone(fixture);
  delete missingCost.trades[0].cost;
  assert.throws(() => analyze(missingCost), /cost/);
});
