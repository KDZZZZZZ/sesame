import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchHistorical } from '../src/match.js';
import { createCapabilities } from '../index.js';

const fixture = (name = 'match-replay') => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url)));
const group = result => result.cohorts.find(row => row.id === 'same_instrument_history').groups.find(row => row.regime_id === 'calm');
const facts = result => result.cohorts.map(scope => ({ id: scope.id, groups: scope.groups.map(row => ({
  instrument: row.instrument, regime: row.regime_id, counts: [row.n_eligible, row.n_matched, row.n_nonoverlapping, row.n_retained],
  statistics: row.statistics, baseline: row.baseline, dependence: row.dependence,
  matches: row.matches.map(match => ({ id: match.id, distance: match.distance, label: match.label, at: match.at, end: match.end })),
})) }));

test('typed historical query retains real dates and exactly reproduces original distance/cohort mathematics', () => {
  const input = fixture(), original = structuredClone(input), result = matchHistorical(input), recorded = matchHistorical(fixture('match'));
  assert.equal(result.observation_origin, 'historical_replay');
  assert.equal(result.decision_at, '2026-01-01T00:00:00.000Z');
  assert.equal(result.clock.plan_frozen_at, '2026-10-29T00:00:00.000Z');
  assert.equal(result.clock.generated_at, '2026-10-29T01:00:00.000Z');
  assert.equal(result.clock.observed_at, '2026-10-29T00:30:00.000Z');
  assert.equal(result.forecast_probability, null);
  assert.match(result.selection_status, /exploratory/);
  assert.match(result.evaluation_basis, /not_ex_ante/);
  assert.deepEqual(facts(result), facts(recorded));
  assert.deepEqual(result.selection, recorded.selection);
  assert.equal(group(result).statistics.empirical_frequency, 2 / 3);
  const row = group(result).matches[0];
  assert.equal(row.outcome_observed_at, '2026-10-29T00:30:00.000Z');
  assert.equal(row.available, row.outcome_observed_at);
  assert.equal(row.virtual_outcome_available_at, '2025-12-21T00:00:00.000Z');
  assert.deepEqual(input, original);
});

test('distance tolerances are absent or ignored without changing numerical matches; rules still require explicit thresholds', () => {
  const input = fixture(), original = matchHistorical(input);
  for (const tolerance of [0, .05, 100]) {
    input.plan.features[0].tolerance = tolerance;
    const result = matchHistorical(input);
    assert.deepEqual(result.cohorts, original.cohorts);
    assert.ok(group(result).matches.every(row => row.rules_pass === null && row.details.every(detail => detail.rule_pass === null)));
  }
  input.plan.features[0].tolerance = -1;
  assert.throws(() => matchHistorical(input), /nonnegative/);
  delete input.plan.features[0].tolerance; input.plan.matching.method = 'rules';
  assert.throws(() => matchHistorical(input), /Rules matching requires/);
  input.plan.features[0].tolerance = .05;
  assert.deepEqual(group(matchHistorical(input)).matches.map(row => row.id), ['recent-positive', 'older-positive']);
});

test('recorded matching and prospective claims cannot opt into replay silently', () => {
  const prospective = fixture(); prospective.plan.mode = 'prospective';
  assert.throws(() => matchHistorical(prospective), /only allowed in exploratory/);
  const hidden = fixture(); delete hidden.origin;
  assert.throws(() => matchHistorical(hidden), /requires explicit origin/);
  const disguised = fixture(); delete disguised.origin; delete disguised.replay; delete disguised.query.replay;
  for (const row of disguised.cases) delete row.replay;
  assert.throws(() => matchHistorical(disguised), /follow the frozen plan/);
  const mixed = fixture(); delete mixed.cases[0].replay;
  assert.throws(() => matchHistorical(mixed), /case replay/);
  const recorded = fixture('match'); recorded.cases[0].replay = { feature_cutoff: recorded.cases[0].at, outcome_available_at: recorded.cases[0].outcome.available_at };
  assert.throws(() => matchHistorical(recorded), /do not mix/);
});

test('backfilled/future generation, future input observation and absent code/data identity fail before matching', () => {
  for (const [field, value] of [
    ['generated_at', '2026-01-01T00:00:00Z'],
    ['generated_at', '2026-10-30T00:00:00Z'],
    ['observed_at', '2026-10-29T02:00:00Z'],
    ['code_ref', undefined], ['data_refs', []], ['source_vintage', 'certified_historical'],
  ]) {
    const input = fixture(); input.replay[field] = value;
    assert.throws(() => matchHistorical(input), /generation|fixed code_ref|complete fixed DataRefs/);
  }
  const sameInstant = fixture(); sameInstant.query.at = sameInstant.replay.generated_at;
  assert.throws(() => matchHistorical(sameInstant), /Historical query must precede/);
});

test('query prefix may not contain future information or omit the actual maximum cutoff', () => {
  const later = fixture(); later.query.replay.feature_cutoff = '2026-01-02T00:00:00Z';
  assert.throws(() => matchHistorical(later), /prefix cutoff/);
  const hidden = fixture(); hidden.query.replay.feature_cutoff = '2025-12-30T00:00:00Z';
  assert.throws(() => matchHistorical(hidden), /prefix cutoff/);
  const absent = fixture(); delete absent.query.replay;
  assert.throws(() => matchHistorical(absent), /query replay/);
});

test('case prefix, actual observation and virtual maturity have independent checks', () => {
  const changes = [
    [row => { row.replay.feature_cutoff = '2025-12-21T00:00:00Z'; }, 'replay_prefix_cutoff_after_observation'],
    [row => { row.replay.feature_cutoff = '2025-12-19T00:00:00Z'; }, 'replay_prefix_cutoff_after_observation'],
    [row => { row.replay.outcome_available_at = row.at; }, 'replay_outcome_clock_inconsistent'],
    [row => { row.replay.outcome_available_at = '2026-01-02T00:00:00Z'; }, 'replay_outcome_not_available_at_decision'],
    [row => { row.outcome.available_at = '2026-10-29T00:45:00Z'; }, 'replay_outcome_clock_inconsistent'],
    [row => { row.outcome.available_at = '2026-10-29T03:00:00Z'; }, 'outcome_not_mature_or_available'],
    [row => { row.outcome.available_at = null; }, 'outcome_time_unknown'],
    [row => { row.outcome.end_at = '2025-12-22T00:00:00Z'; }, 'outcome_time_inconsistent'],
  ];
  for (const [change, reason] of changes) {
    const input = fixture(); change(input.cases[0]);
    const result = matchHistorical(input);
    assert.equal(result.excluded.find(row => row.id === 'recent-positive').reason, reason);
    assert.equal(group(result).matches.some(row => row.id === 'recent-positive'), false);
  }
});

test('later computation as_of never expands the historical decision cutoff', () => {
  const input = fixture(); input.cases[0].replay.outcome_available_at = '2026-01-02T00:00:00Z';
  const original = matchHistorical(input); input.as_of = '2027-01-01T00:00:00Z';
  assert.deepEqual(matchHistorical(input).cohorts, original.cohorts);
  assert.deepEqual(matchHistorical(input).excluded, original.excluded);
});

test('outcome mutations cannot select matches, hide counterexamples, merge regimes or double-count overlapping cases', () => {
  const input = fixture(), before = matchHistorical(input);
  for (const row of input.cases) row.outcome.label = 1 - row.outcome.label;
  const after = matchHistorical(input);
  assert.deepEqual(before.selection, after.selection);
  assert.deepEqual(group(before).matches.map(row => row.id), group(after).matches.map(row => row.id));
  assert.equal(group(after).statistics.successes, 1);
  const duplicate = structuredClone(input.cases[0]); duplicate.id = 'overlapping-copy'; input.cases.push(duplicate);
  const overlap = matchHistorical(input);
  assert.equal(group(overlap).n_matched, 4); assert.equal(group(overlap).n_nonoverlapping, 3);
  assert.equal(group(overlap).baseline.n, 4);
  assert.equal(overlap.cohorts.find(row => row.id === 'same_instrument_history').groups.length, 2);
});

test('zero matches stay insufficient and unknown chronology is not zero-filled', () => {
  const input = fixture(); input.query.features.custom_feature.value = 100;
  const result = matchHistorical(input);
  assert.equal(result.status, 'insufficient_data'); assert.equal(result.selection, null);
  assert.equal(group(result).statistics.empirical_frequency, null);
  assert.equal(group(result).baseline.n, 4);
  const unknown = fixture(); unknown.cases[0].features.custom_feature.available_at = null;
  assert.match(matchHistorical(unknown).excluded.find(row => row.id === 'recent-positive').reason, /availability_unknown/);
});

test('actual replay entrypoint remains input-only, cancelable and preserves the original timestamp parser', () => {
  const caps = createCapabilities(new Proxy({}, { get() { throw new Error('Host ports forbidden'); } }));
  assert.equal(caps[0].execute(fixture()).observation_origin, 'historical_replay');
  const controller = new AbortController(); controller.abort();
  assert.throws(() => caps[0].execute(fixture(), controller.signal), /abort/i);
  const precise = fixture(); precise.cases[0].outcome.available_at = '2026-10-29T00:30:00.415389+00:00';
  assert.throws(() => caps[0].execute(precise), /ISO timestamp/);
});
