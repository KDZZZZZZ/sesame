// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze } from '../scripts/baseline.mjs';
import { envelope } from '../scripts/runtime.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('scores with transparent nearest neighbors', () => {
  const out = envelope(fixture, analyze, new URL('../scripts/baseline.mjs', import.meta.url));
  assert.equal(out.observations.neighbors.length, 3);
  assert.equal(out.observations.decision_hint, 'favorable_baseline_neighbor_vote');
  assert.ok(out.limitations.some(x => x.includes('not equivalent')));
});

test('rejects completed trade outcome that is not known before query', () => {
  const bad = structuredClone(fixture);
  bad.completed_trades[0].outcome_available_at = '2026-01-09T16:00:00.000Z';
  assert.throws(() => analyze(bad), /known before query/);
});

test('rejects query features unavailable at query time', () => {
  const bad = structuredClone(fixture);
  bad.query.available_at = '2026-01-09T15:00:01.000Z';
  assert.throws(() => analyze(bad), /query.available_at/);
});

test('rejects zero distance floor to avoid infinite exact-match weights', () => {
  const bad = structuredClone(fixture);
  bad.parameters.distance_floor = 0;
  assert.throws(() => analyze(bad), /distance_floor/);
});
