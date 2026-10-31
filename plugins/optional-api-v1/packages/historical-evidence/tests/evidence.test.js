import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchHistorical } from '../src/match.js';
import { calibrateHistorical, fitIsotonic, predictIsotonic } from '../src/calibrate.js';
import { wilson } from '../src/common.js';
import { createCapabilities } from '../index.js';

const fixture = name => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url)));
const group = (result, scope = 'same_instrument_history', regime = 'calm') => result.cohorts.find(item => item.id === scope).groups.find(item => item.regime_id === regime);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('same-instrument recent expands to history, retaining counterexample/baseline and separate conditions', () => {
  const result = matchHistorical(fixture('match'));
  assert.equal(result.selection.cohort, 'same_instrument_history');
  assert.deepEqual(result.selection.expansion, [{ cohort: 'same_instrument_recent', instrument: 'SYNTHETIC', n: 2, reason: 'below_caller_sample_target' }]);
  const selected = group(result);
  assert.equal(selected.statistics.n, 3); near(selected.statistics.empirical_frequency, 2 / 3);
  assert.deepEqual(selected.statistics.counterexample_ids, ['recent-counterexample']);
  assert.equal(selected.baseline.n, 4); near(selected.baseline.empirical_frequency, .5);
  assert.equal(group(result, 'same_instrument_history', 'shock').statistics.empirical_frequency, 0);
  assert.equal(group(result, 'comparable_instruments').statistics.n, 1);
  assert.equal(result.excluded.find(row => row.id === 'undeclared-cross').reason, 'cross_instrument_comparability_not_declared');
  assert.equal(result.forecast_probability, null); assert.equal(result.calibration_status, 'not_calibrated');
});

test('changing outcomes cannot change matching or cohort selection; arbitrary lagged features remain selectable', () => {
  const input = fixture('match'), before = matchHistorical(input);
  for (const row of input.cases) row.outcome.label = 1 - row.outcome.label;
  const after = matchHistorical(input);
  assert.deepEqual(before.selection, after.selection);
  assert.deepEqual(group(before).matches.map(row => row.id), group(after).matches.map(row => row.id));
  near(group(after).statistics.empirical_frequency, 1 / 3);
  input.plan.features[0].key = 'return_prior_window';
  for (const row of [input.query, ...input.cases]) { row.features.return_prior_window = row.features.custom_feature; delete row.features.custom_feature; }
  assert.equal(matchHistorical(input).status, 'computed');
});

test('features/regimes must have been available at each observation; unknown or immature outcomes are excluded', () => {
  const input = fixture('match');
  input.cases[0].features.custom_feature.available_at = '2025-12-21T00:00:00Z';
  input.cases[1].regime_available_at = null;
  input.cases[2].outcome.available_at = '2026-01-02T00:00:00Z';
  input.cases[3].outcome.end_at = '2025-06-03T00:00:00Z';
  const excluded = Object.fromEntries(matchHistorical(input).excluded.map(row => [row.id, row.reason]));
  assert.match(excluded['recent-positive'], /feature_not_available/);
  assert.equal(excluded['recent-counterexample'], 'regime_not_known_at_observation');
  assert.equal(excluded['unmatched-baseline'], 'outcome_not_mature_or_available');
  assert.equal(excluded['older-positive'], 'outcome_time_inconsistent');
});

test('a reconstructed decision cannot use outcomes learned after query.at but before computation as_of', () => {
  const input = fixture('match');
  input.query.at = '2025-12-21T00:00:00Z'; input.query.regime_available_at = input.query.at;
  for (const feature of Object.values(input.query.features)) feature.available_at = input.query.at;
  input.cases[0].outcome.available_at = '2025-12-22T00:00:00Z';
  const result = matchHistorical(input);
  assert.equal(result.decision_at, '2025-12-21T00:00:00.000Z');
  assert.equal(result.as_of, '2026-01-01T00:00:00.000Z');
  assert.equal(result.excluded.find(row => row.id === 'recent-positive').reason, 'outcome_not_mature_or_available');
  assert.equal(group(result).matches.some(row => row.id === 'recent-positive'), false);
});

test('explicitly comparable instruments remain separate even in the same regime and market window', () => {
  const input = fixture('match'), second = structuredClone(input.cases.find(row => row.id === 'cross-positive'));
  second.id = 'second-cross-negative'; second.instrument = 'SECOND'; second.outcome.label = 0; input.cases.push(second);
  input.plan.cohorts.comparables.push({ ...input.plan.cohorts.comparables[0], instrument: 'SECOND' });
  const result = matchHistorical(input), groups = result.cohorts.find(row => row.id === 'comparable_instruments').groups;
  assert.deepEqual(groups.map(row => [row.instrument, row.statistics.n, row.statistics.empirical_frequency]), [['COMPARABLE', 1, 1], ['SECOND', 1, 0]]);
  assert.ok(groups.every(row => row.baseline.n === 1));
  assert.match(result.limitations.join(' '), /not independent corroborations/);
});

test('post-hoc features cannot claim prospective validation; exploratory evidence remains labeled and uncalibrated', () => {
  const input = fixture('match'); input.plan.frozen_at = '2025-12-25T00:00:00Z';
  const prospective = matchHistorical(input);
  assert.equal(prospective.status, 'insufficient_data');
  assert.ok(prospective.excluded.some(row => row.reason === 'before_frozen_feature_plan'));
  input.plan.mode = 'exploratory'; const exploratory = matchHistorical(input);
  assert.equal(exploratory.status, 'computed'); assert.match(exploratory.selection_status, /exploratory/);
  assert.equal(exploratory.forecast_probability, null);
});

test('overlapping/nearby observations are not counted twice and weak samples can be conditionally described', () => {
  const input = fixture('match'), duplicate = structuredClone(input.cases[0]);
  duplicate.id = 'same-window'; input.cases.push(duplicate);
  const result = matchHistorical(input), selected = group(result);
  assert.equal(selected.n_matched, 4); assert.equal(selected.n_nonoverlapping, 3);
  assert.equal(selected.dependence.excluded.length, 1);
  input.plan.cohorts.minimum_samples = 100;
  const limited = matchHistorical(input);
  assert.equal(limited.status, 'computed'); assert.equal(limited.selection.meets_sample_target, false);
  assert.ok(limited.application.conditions.length); assert.ok(limited.application.monitoring.length);
});

test('explicit rules, not similarity distance, determine rule matches and no undeclared cross population is pooled', () => {
  const input = fixture('match'); input.plan.matching.method = 'rules'; input.plan.features[0].tolerance = .05;
  const result = matchHistorical(input);
  assert.deepEqual(group(result).matches.map(row => row.id), ['recent-positive', 'older-positive']);
  assert.equal(group(result).statistics.empirical_frequency, 1);
  input.plan.cohorts.comparables = [];
  assert.deepEqual(matchHistorical(input).cohorts.find(row => row.id === 'comparable_instruments').groups, []);
});

test('malformed time, duplicate identities, label-feature requests and binary64 overflow fail explicitly', () => {
  const input = fixture('match'); input.query.at = '2025-02-30T00:00:00Z';
  assert.throws(() => matchHistorical(input), /real timestamp/);
  const duplicate = fixture('match'); duplicate.cases.push(structuredClone(duplicate.cases[0]));
  assert.throws(() => matchHistorical(duplicate), /unique/);
  const leak = fixture('match'); leak.plan.features[0].key = 'outcome.label';
  assert.throws(() => matchHistorical(leak), /cannot be matching/);
  const overflow = fixture('match'); overflow.plan.features[0].scale = 1e-300;
  assert.throws(() => matchHistorical(overflow), /overflow/);
});

test('Wilson interval reproduces a known 50/100 binomial score interval and empty samples stay null', () => {
  const interval = wilson(50, 100, .95);
  near(interval.lower, .4038315303659956); near(interval.upper, .5961684696340044);
  assert.equal(wilson(0, 0, .95), null);
  assert.equal(wilson(0, 10, .95).lower, 0);
});

test('PAVA handles violations and ties with actual sample weights; predictions interpolate only within declared support', () => {
  const model = fitIsotonic([{ probability: .1, label: 0 }, { probability: .3, label: 1 }, { probability: .3, label: 0 }, { probability: .5, label: 0 }, { probability: .9, label: 1 }]);
  assert.deepEqual(model.points.map(point => point.calibrated_probability), [0, 1 / 3, 1 / 3, 1]);
  near(predictIsotonic(model, .7, 'unavailable').value, 2 / 3);
  assert.equal(predictIsotonic(model, .99, 'unavailable').value, null);
  assert.equal(predictIsotonic(model, .99, 'clip').clipped, true);
});

test('isotonic uses past fit and separately scores four future records; poorer raw-score performance remains visible', () => {
  const result = calibrateHistorical(fixture('calibration')), g = result.groups[0];
  assert.equal(g.fit.n, 4); assert.equal(g.evaluation.n, 4);
  assert.ok(g.fit.ids.every(id => !g.evaluation.ids.includes(id)));
  const metrics = g.evaluation.metrics_on_common_scored_rows;
  near(metrics.raw_brier, .1325); near(metrics.calibrated_brier, .14453125); near(metrics.baseline_brier, .25);
  assert.ok(g.warnings.includes('calibration_did_not_improve_raw_brier'));
  assert.equal(g.status, 'evaluated'); near(result.current_predictions[0].calibrated_probability, .5);
  assert.equal(result.current_predictions[0].future_label_used, false);
  assert.equal(result.current_predictions[0].probability_parameter_interval, null);
  assert.equal(result.current_predictions[0].evaluation_bin.n, 2);
});

test('poisoning evaluation outcomes changes scores but never the mapping or fit-prevalence baseline', () => {
  const input = fixture('calibration'), before = calibrateHistorical(input);
  for (const row of input.records.filter(row => row.id.startsWith('evaluation'))) row.outcome.label = 1 - row.outcome.label;
  const after = calibrateHistorical(input);
  assert.deepEqual(after.groups[0].calibrated_grid, before.groups[0].calibrated_grid);
  assert.deepEqual(after.groups[0].baseline, before.groups[0].baseline);
  assert.equal(after.current_predictions[0].calibrated_probability, before.current_predictions[0].calibrated_probability);
  assert.notEqual(after.groups[0].evaluation.metrics_on_common_scored_rows.calibrated_brier, before.groups[0].evaluation.metrics_on_common_scored_rows.calibrated_brier);
});

test('future availability, post-outcome predictions and changing model identities cannot enter fit or evaluation', () => {
  const input = fixture('calibration');
  input.records[0].outcome.available_at = '2025-07-01T00:00:00Z';
  input.records[1].prediction_available_at = '2025-03-01T00:00:00Z';
  input.records[2].prediction_system = 'other-model';
  input.records[4].outcome.available_at = '2026-01-02T00:00:00Z';
  const result = calibrateHistorical(input), reasons = result.excluded.map(row => row.reason);
  for (const reason of ['gap_or_fit_outcome_unavailable_at_fit_end', 'prediction_or_model_not_pre_outcome', 'prediction_system_mismatch', 'outcome_not_mature_or_available']) assert.ok(reasons.includes(reason));
  assert.equal(result.current_predictions[0].calibrated_probability, null);
});

test('no fit-data evaluation: missing independent period, single-class fit or future current label makes no valid probability', () => {
  const input = fixture('calibration'); input.records = input.records.slice(0, 4);
  const result = calibrateHistorical(input);
  assert.equal(result.status, 'insufficient_data'); assert.equal(result.groups[0].calibrated_grid, null);
  assert.equal(result.current_predictions[0].calibrated_probability, null);
  const single = fixture('calibration'); for (const row of single.records.slice(0, 4)) row.outcome.label = 1;
  assert.equal(calibrateHistorical(single).current_predictions[0].calibrated_probability, null);
  const leak = fixture('calibration'); leak.queries[0].label = 1;
  assert.throws(() => calibrateHistorical(leak), /unsupported fields/);
});

test('split/threshold chronology is mandatory and historical queries cannot use later evaluation evidence', () => {
  const input = fixture('calibration'); input.plan.frozen_at = '2025-08-01T00:00:00Z';
  assert.throws(() => calibrateHistorical(input), /genuinely recorded plan/);
  const overlap = fixture('calibration'); overlap.plan.evaluation_start = overlap.plan.fit_end;
  assert.throws(() => calibrateHistorical(overlap), /evaluation_start/);
  const past = fixture('calibration'); past.queries[0].at = '2025-07-03T00:00:00Z'; past.queries[0].regime_available_at = past.queries[0].at;
  assert.equal(calibrateHistorical(past).current_predictions[0].reason, 'evaluation_not_available_at_query_time');
});

test('a method selected today can retain exploratory diagnostics without inventing a historical freeze or independent prediction', () => {
  const input = fixture('calibration'); input.plan.frozen_at = input.as_of; input.plan.mode = 'exploratory';
  const result = calibrateHistorical(input), g = result.groups[0];
  assert.equal(result.status, 'exploratory'); assert.equal(g.status, 'exploratory');
  assert.equal(result.split.thresholds_frozen_at, '2026-01-01T00:00:00.000Z');
  assert.equal(result.split.fit_and_evaluation_disjoint, true);
  near(g.evaluation.metrics_on_common_scored_rows.calibrated_brier, .14453125);
  assert.ok(g.fitted_model_diagnostic); assert.equal(g.calibrated_grid, null);
  assert.equal(result.current_predictions[0].calibrated_probability, null);
  assert.equal(result.current_predictions[0].reason, 'exploratory_method_selection_no_independent_calibration_claim');
  assert.match(result.selection_status, /no_independent_selection_validation/);
  input.plan.frozen_at = '2025-01-01T00:00:00Z';
  assert.equal(calibrateHistorical(input).status, 'exploratory', 'Unknown selection stays exploratory even with an old declared timestamp');
});

test('current query identity cannot reuse either a fit record or an evaluation record', () => {
  for (const index of [0, 4]) {
    const input = fixture('calibration'); input.queries[0].id = input.records[index].id;
    assert.throws(() => calibrateHistorical(input), /must not reuse/);
  }
});

test('typed replay retains actual generation/observation dates and only produces time-split diagnostic calibration', () => {
  const input = fixture('calibration-replay'), result = calibrateHistorical(input), g = result.groups[0];
  assert.equal(result.prediction_origin, 'historical_replay');
  assert.match(result.evaluation_basis, /chronological_replay_split_only/);
  assert.equal(result.status, 'exploratory'); assert.equal(g.fit.n, 4); assert.equal(g.evaluation.n, 4);
  near(g.evaluation.metrics_on_common_scored_rows.calibrated_brier, .14453125);
  assert.equal(g.evaluation.rows[0].prediction_available_at, '2026-10-29T00:00:00.000Z');
  assert.equal(g.evaluation.rows[0].outcome_observed_at, '2026-10-29T00:00:00.000Z');
  assert.equal(g.evaluation.rows[0].decision_at, '2025-08-02T00:00:00.000Z');
  assert.equal(result.current_predictions[0].calibrated_probability, null); assert.equal(g.calibrated_grid, null);
  assert.match(result.limitations[0], /not an original ex-ante forecast log/);
  for (const row of input.records.filter(row => row.id.startsWith('evaluation'))) row.outcome.label = 1 - row.outcome.label;
  const changed = calibrateHistorical(input);
  assert.deepEqual(changed.groups[0].fitted_model_diagnostic, g.fitted_model_diagnostic);
  assert.deepEqual(changed.groups[0].baseline, g.baseline);
});

test('replay cannot claim prospective publication or mix with original records', () => {
  const prospective = fixture('calibration-replay'); prospective.plan.mode = 'prospective'; prospective.plan.frozen_at = '2025-01-01T00:00:00Z';
  assert.throws(() => calibrateHistorical(prospective), /only allowed in exploratory/);
  const mixed = fixture('calibration-replay'); mixed.records[0].origin = 'recorded_prediction';
  assert.throws(() => calibrateHistorical(mixed), /never mix/);
  const disguised = fixture('calibration-replay');
  for (const row of disguised.records) { delete row.origin; delete row.replay; delete row.decision_at; }
  const rejected = calibrateHistorical(disguised);
  assert.ok(rejected.excluded.every(row => row.reason === 'prediction_or_model_not_pre_outcome'));
  assert.equal(rejected.groups[0].fit.n, 0);
});

test('replay still rejects future prefix information, backfilled generation and premature outcome clocks', () => {
  const input = fixture('calibration-replay');
  input.records[0].replay.feature_cutoff = '2025-01-03T00:00:00Z';
  input.records[1].replay.training_label_cutoff = '2025-01-05T00:00:00Z';
  input.records[2].prediction_available_at = input.records[2].at;
  input.records[3].replay.outcome_available_at = input.records[3].at;
  const result = calibrateHistorical(input), reasons = Object.fromEntries(result.excluded.map(row => [row.id, row.reason]));
  assert.equal(reasons['fit-0'], 'replay_prefix_cutoff_after_decision');
  assert.equal(reasons['fit-1'], 'replay_prefix_cutoff_after_decision');
  assert.equal(reasons['fit-2'], 'replay_actual_generation_time_inconsistent');
  assert.equal(reasons['fit-3'], 'replay_outcome_clock_inconsistent');
  assert.equal(result.current_predictions[0].calibrated_probability, null);
  const noPlan = fixture('calibration-replay'); noPlan.records[0].replay.generated_at = '2026-10-28T00:00:00Z';
  assert.equal(calibrateHistorical(noPlan).excluded.find(row => row.id === 'fit-0').reason, 'replay_actual_generation_time_inconsistent');
});

test('separate regimes preserve conditional success/failure without an invented pooled probability', () => {
  const input = fixture('calibration');
  for (const row of structuredClone(input.records)) { row.id += '-shock'; row.regime_id = 'shock'; if (row.id.startsWith('evaluation')) row.outcome.label = 0; input.records.push(row); }
  input.queries.push({ ...input.queries[0], id: 'shock-query', regime_id: 'shock' });
  const result = calibrateHistorical(input);
  assert.equal(result.groups.length, 2); assert.equal(result.current_predictions.length, 2);
  assert.notEqual(result.groups[0].evaluation.empirical_frequency, result.groups[1].evaluation.empirical_frequency);
  assert.equal(result.pooled_probability, undefined); assert.equal(result.pooled_brier, undefined);
});

test('out-of-support records are counted, coverage shown, and clipping is only explicit', () => {
  const input = fixture('calibration'); input.records[4].probability = .99;
  const result = calibrateHistorical(input);
  assert.equal(result.groups[0].evaluation.n_scored, 3); near(result.groups[0].evaluation.scored_coverage, .75);
  assert.equal(result.current_predictions[0].status, 'limited');
  assert.equal(result.current_predictions[0].calibrated_probability, .5);
  assert.equal(result.current_predictions[0].sample_assessment.actual_evaluation_scored, 3);
  input.plan.out_of_bounds = 'clip';
  assert.equal(calibrateHistorical(input).groups[0].evaluation.rows.find(row => row.id === 'evaluation-0').clipped, true);
});

test('caller sample targets default to advisory and limited estimates preserve actual sample size and scope', () => {
  const input = fixture('calibration'); input.plan.minimum_fit = 100; input.plan.minimum_evaluation = 100;
  const original = structuredClone(input), result = calibrateHistorical(input), prediction = result.current_predictions[0];
  assert.equal(prediction.status, 'limited'); near(prediction.calibrated_probability, .5);
  assert.equal(prediction.reason, 'below_advisory_sample_targets');
  assert.deepEqual(prediction.sample_assessment.shortfalls, [{ partition: 'fit', actual: 4, target: 100 }, { partition: 'evaluation_scored', actual: 4, target: 100 }]);
  assert.equal(prediction.sample_assessment.policy.source, 'agent');
  assert.equal(prediction.estimate_scope.fit_n, 4); assert.equal(prediction.estimate_scope.evaluation_scored_n, 4);
  assert.match(prediction.estimate_scope.interpretation, /not a reliable or validated/);
  assert.deepEqual(input, original);
});

test('an explicit user hard sample minimum blocks current output without lowering the plan or erasing diagnostics', () => {
  const input = fixture('calibration'); input.plan.minimum_evaluation = 100;
  input.plan.sample_policy = { mode: 'required', source: 'user', reason: 'The synthetic user explicitly requires 100 scored evaluation records.' };
  const original = structuredClone(input), result = calibrateHistorical(input), g = result.groups[0];
  assert.equal(result.current_predictions[0].calibrated_probability, null);
  assert.ok(g.insufficiency.includes('evaluation_scored_below_required_user_minimum'));
  near(g.evaluation.metrics_on_common_scored_rows.calibrated_brier, .14453125);
  assert.ok(g.fitted_model_diagnostic); assert.equal(g.calibrated_grid, null);
  assert.deepEqual(result.parameters, original.plan); assert.deepEqual(input, original);
});

test('an Agent cannot mark its own preference required, and advisory cannot create zero-sample estimates', () => {
  const required = fixture('calibration'); required.plan.sample_policy = { mode: 'required', source: 'agent', reason: 'Agent preference' };
  assert.throws(() => calibrateHistorical(required), /Only an explicit user requirement/);
  const empty = fixture('calibration'); empty.records = [];
  const result = calibrateHistorical(empty);
  assert.equal(result.status, 'insufficient_data'); assert.equal(result.current_predictions[0].calibrated_probability, null);
  assert.equal(result.groups[0].evaluation.metrics_on_common_scored_rows, null);
});

test('actual inline capability entrypoints do not touch host ports, do not mutate inputs, and honor cancellation', async () => {
  const host = new Proxy({}, { get() { throw new Error('Unexpected host access'); } });
  const caps = createCapabilities(host), input = fixture('match'), original = structuredClone(input);
  assert.equal(await caps[0].execute(input).status, 'computed'); assert.deepEqual(input, original);
  assert.equal(caps[1].execute(fixture('calibration')).status, 'computed');
  const controller = new AbortController(); controller.abort();
  assert.throws(() => caps[0].execute(input, controller.signal), /abort/i);
  const declaration = JSON.parse(readFileSync(new URL('../capabilities.json', import.meta.url)));
  assert.deepEqual(declaration.capabilities.slice(0, 2).map(cap => cap.effects), [[], []]);
  assert.ok(declaration.capabilities.slice(0, 2).every(cap => cap.researchDataAccess.reads === 'input-only'));
  assert.deepEqual(declaration.capabilities[2].effects, ['resources.read', 'resources.create', 'resources.publish']);
  assert.equal(declaration.capabilities[2].researchDataAccess, undefined);
  assert.deepEqual(declaration.stateCollections ?? [], []);
});
