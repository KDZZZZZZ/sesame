// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze } from '../scripts/baseline.mjs';
import { envelope } from '../scripts/runtime.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));
const developmentFixture = JSON.parse(readFileSync(new URL('../examples/development.json', import.meta.url), 'utf8'));

test('development phase emits a frozen selection and rejects holdout trials', () => {
  const out = envelope(developmentFixture, analyze, new URL('../scripts/baseline.mjs', import.meta.url));
  assert.equal(out.parameters.phase, 'development');
  assert.deepEqual(out.observations.frozen_selection.parameters, { lookback: 20, threshold: 0.04 });
  assert.equal(out.observations.frozen_selection.selected_at, developmentFixture.as_of);
  assert.equal(out.observations.fixed_holdout_evidence.length, 0);
  const bad = structuredClone(developmentFixture);
  bad.trials.push({ split: 'holdout', available_at: '2026-01-04T01:00:00.000Z', parameters: { lookback: 20, threshold: 0.04 }, metrics: { net_return: 0.03 } });
  assert.throws(() => analyze(bad), /development phase rejects holdout/);
});

test('development phase rejects supplied frozen_selection instead of reusing it', () => {
  const bad = structuredClone(developmentFixture);
  bad.frozen_selection = {
    selected_at: '2026-01-06T00:00:00.000Z',
    parameters: { lookback: 10, threshold: 0.02 },
  };
  assert.throws(() => analyze(bad), /rejects incoming frozen_selection/);
});

test('holdout phase validates exact frozen selection and evaluates only selected holdout', () => {
  const out = envelope(fixture, analyze, new URL('../scripts/baseline.mjs', import.meta.url));
  assert.equal(out.parameters.phase, 'holdout');
  assert.equal(out.observations.grid_points, 4);
  assert.deepEqual(out.observations.frozen_selection.parameters, { lookback: 20, threshold: 0.04 });
  assert.equal(out.observations.fixed_holdout_evidence.length, 1);
  assert.ok(out.observations.development_sha256.startsWith('sha256:'));
  assert.ok(out.observations.frozen_selection.selection_sha256.startsWith('sha256:'));
});

test('rejects holdout evidence for non-selected parameters', () => {
  const input = structuredClone(fixture);
  input.trials.push({ split: 'holdout', available_at: '2026-01-08T00:00:00.000Z', parameters: { lookback: 10, threshold: 0.02 }, metrics: { net_return: 99 } });
  assert.throws(() => analyze(input), /non-selected/);
});

test('rejects trial parameters outside finite grid', () => {
  const bad = structuredClone(fixture);
  bad.trials[0].parameters.lookback = 30;
  assert.throws(() => analyze(bad), /outside declared grid/);
});

test('requires explicit selection before holdout evaluation', () => {
  const bad = structuredClone(fixture);
  delete bad.frozen_selection;
  assert.throws(() => analyze(bad), /requires frozen_selection/);
});

test('rejects frozen selection tampering across hashes, objective, grid and timing', () => {
  for (const [field, pattern] of [
    ['development_sha256', /development_sha256 mismatch/],
    ['grid_sha256', /grid_sha256 mismatch/],
    ['objective_sha256', /objective_sha256 mismatch/],
    ['selection_sha256', /selection_sha256 mismatch/],
  ]) {
    const bad = structuredClone(fixture);
    bad.frozen_selection[field] = 'sha256:bad';
    assert.throws(() => analyze(bad), pattern);
  }
  const gridChanged = structuredClone(fixture);
  gridChanged.grid.lookback.push(30);
  assert.throws(() => analyze(gridChanged), /grid_sha256 mismatch/);
  const objectiveChanged = structuredClone(fixture);
  objectiveChanged.parameters.direction = 'minimize';
  assert.throws(() => analyze(objectiveChanged), /objective_sha256 mismatch/);
  const beforeDevelopment = structuredClone(fixture);
  beforeDevelopment.frozen_selection.selected_at = '2026-01-03T23:00:00.000Z';
  assert.throws(() => analyze(beforeDevelopment), /selected_at/);
  const lateSelection = structuredClone(fixture);
  lateSelection.frozen_selection.selected_at = '2026-01-08T00:00:00.000Z';
  assert.throws(() => analyze(lateSelection), /before holdout availability/);
  const futureSelection = structuredClone(fixture);
  futureSelection.frozen_selection.selected_at = '2026-01-11T00:00:00.000Z';
  assert.throws(() => analyze(futureSelection), /no later than as_of/);
});

test('rejects frozen parameter override in parameters object', () => {
  const bad = structuredClone(fixture);
  bad.parameters.frozen_parameters = { lookback: 10, threshold: 0.02 };
  assert.throws(() => analyze(bad), /Unknown parameter/);
});
