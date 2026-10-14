// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze } from '../scripts/baseline.mjs';
import { envelope } from '../scripts/runtime.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/input.json', import.meta.url), 'utf8'));

test('fits train-only scaler and evaluates chronological rows', () => {
  const out = envelope(fixture, analyze, new URL('../scripts/baseline.mjs', import.meta.url));
  assert.equal(out.observations.train_rows, 3);
  assert.equal(out.observations.eval_rows, 2);
  assert.equal(out.observations.chronological_eval.predictions.length, 2);
  assert.ok(Number.isFinite(out.observations.chronological_eval.mse));
});

test('rejects evaluation rows interleaved before training rows', () => {
  const bad = structuredClone(fixture);
  bad.rows[1].split = 'eval';
  assert.throws(() => analyze(bad), /chronologically after training/);
});

test('rejects training labels unavailable before first eval decision', () => {
  const bad = structuredClone(fixture);
  bad.rows[2].label_available_at = '2026-01-06T16:00:00.000Z';
  assert.throws(() => analyze(bad), /training labels/);
});

test('rejects features unavailable at row decision time', () => {
  const bad = structuredClone(fixture);
  bad.rows[3].available_at = '2026-01-06T15:00:01.000Z';
  assert.throws(() => analyze(bad), /feature available_at/);
});

test('rejects excessive synchronous training budget', () => {
  const bad = structuredClone(fixture);
  bad.parameters.iterations = 10000;
  bad.rows = [];
  for (let i = 0; i < 200; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const hour = String(Math.floor(i / 28)).padStart(2, '0');
    bad.rows.push({
      time: `2026-01-${day}T${hour}:00:00.000Z`,
      available_at: `2026-01-${day}T${hour}:00:00.000Z`,
      label_available_at: '2026-01-29T00:00:00.000Z',
      split: 'train',
      features: { momentum: i / 100, volatility: 0.2 + i / 1000 },
      label: i / 1000,
    });
  }
  bad.rows.push({
    time: '2026-02-01T00:00:00.000Z',
    available_at: '2026-02-01T00:00:00.000Z',
    label_available_at: '2026-02-02T00:00:00.000Z',
    split: 'eval',
    features: { momentum: 0.5, volatility: 0.3 },
    label: 0.01,
  });
  bad.as_of = '2026-02-03T00:00:00.000Z';
  assert.throws(() => analyze(bad), /Training budget/);
});
