// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze } from '../scripts/baseline.mjs';
import { envelope } from '../scripts/runtime.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('generates prior-visible features', () => {
  const out = envelope(fixture, analyze, new URL('../scripts/baseline.mjs', import.meta.url));
  const row = out.observations[0];
  assert.equal(row.source_until, '2026-01-09T20:01:00.000Z');
  assert.equal(row.close, 110);
  assert.ok(row.close_regression_slope > 0);
  assert.ok(row.atr > 0);
});

test('does not use a bar whose available_at is after decision time', () => {
  const input = structuredClone(fixture);
  input.decision_times = ['2026-01-09T20:00:30.000Z'];
  const out = analyze(input);
  assert.equal(out.observations[0].source_until, '2026-01-08T20:01:00.000Z');
});

test('source_until records latest availability among all used rows', () => {
  const input = structuredClone(fixture);
  input.bars[3].available_at = '2026-01-09T20:30:00.000Z';
  const out = analyze(input);
  assert.equal(out.observations[0].source_until, '2026-01-09T20:30:00.000Z');
});

test('rejects future bar availability at runtime validation', () => {
  const bad = structuredClone(fixture);
  bad.bars[5].available_at = '2026-01-11T00:00:00.000Z';
  assert.throws(() => analyze(bad), /not available at as_of/);
});
