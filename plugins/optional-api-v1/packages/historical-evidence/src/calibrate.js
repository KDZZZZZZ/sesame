// SPDX-License-Identifier: MIT
import { check, clone, context, dataRef, finite, integer, iso, keys, nonoverlapping, outcome, refs, summary, text, time, uniqueRows, wilson } from './common.js';

/** Weighted PAVA on tied score groups. Original implementation of the monotone
 * least-squares objective; no third-party implementation is bundled. */
export function fitIsotonic(rows) {
  const points = [];
  for (const row of [...rows].sort((a, b) => a.probability - b.probability)) {
    if (points.at(-1)?.x === row.probability) { points.at(-1).n++; points.at(-1).sum += row.label; }
    else points.push({ x: row.probability, n: 1, sum: row.label });
  }
  const blocks = [];
  for (const [i, point] of points.entries()) {
    blocks.push({ first: i, last: i, n: point.n, sum: point.sum });
    while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).n > blocks.at(-1).sum / blocks.at(-1).n) {
      const right = blocks.pop(), left = blocks.pop();
      blocks.push({ first: left.first, last: right.last, n: left.n + right.n, sum: left.sum + right.sum });
    }
  }
  for (const block of blocks) for (let i = block.first; i <= block.last; i++) points[i].fitted = block.sum / block.n;
  return { points: points.map(point => ({ probability: point.x, calibrated_probability: point.fitted, n: point.n })),
    blocks: blocks.map(block => ({ lower_score: points[block.first].x, upper_score: points[block.last].x, n: block.n, calibrated_probability: block.sum / block.n })) };
}
export function predictIsotonic(model, score, outOfBounds) {
  const points = model.points, first = points[0], last = points.at(-1);
  const outside = score < first.probability || score > last.probability;
  if (outside && outOfBounds === 'unavailable') return { value: null, reason: 'outside_training_score_support' };
  if (score <= first.probability) return { value: first.calibrated_probability, clipped: outside };
  if (score >= last.probability) return { value: last.calibrated_probability, clipped: outside };
  let lo = 0, hi = points.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (points[mid].probability <= score) lo = mid; else hi = mid; }
  const left = points[lo], right = points[hi], t = (score - left.probability) / (right.probability - left.probability);
  return { value: left.calibrated_probability + t * (right.calibrated_probability - left.calibrated_probability), clipped: false };
}
const groupKey = row => JSON.stringify([row.instrument, row.regime_id]);
function metrics(rows, baseline, bins, confidence) {
  if (!rows.length) return null;
  const average = fn => rows.reduce((total, row) => total + fn(row), 0) / rows.length;
  const rawBrier = average(row => (row.probability - row.label) ** 2), calibratedBrier = average(row => (row.calibrated - row.label) ** 2), baselineBrier = average(row => (baseline - row.label) ** 2);
  const reliability = Array.from({ length: bins }, (_, index) => {
    const members = rows.filter(row => Math.min(bins - 1, Math.floor(row.calibrated * bins)) === index);
    const positive = members.reduce((sum, row) => sum + row.label, 0);
    return { bin: index, lower: index / bins, upper: (index + 1) / bins, upper_inclusive: index === bins - 1,
      n: members.length, mean_probability: members.length ? members.reduce((sum, row) => sum + row.calibrated, 0) / members.length : null,
      observed_frequency: members.length ? positive / members.length : null, observed_frequency_interval: wilson(positive, members.length, confidence),
      ids: members.map(row => row.id) };
  });
  return { n: rows.length, raw_brier: rawBrier, calibrated_brier: calibratedBrier, baseline_brier: baselineBrier,
    brier_skill_vs_baseline: baselineBrier > 0 ? 1 - calibratedBrier / baselineBrier : null,
    calibrated_minus_raw_brier: calibratedBrier - rawBrier,
    brier_interpretation: 'Mean squared binary probability error on the same fit-disjoint chronological evaluation rows; selection_status determines whether method selection was predeclared. Lower Brier alone does not prove better calibration.',
    reliability, expected_calibration_error: reliability.reduce((sum, bin) => sum + (bin.n ? bin.n / rows.length * Math.abs(bin.mean_probability - bin.observed_frequency) : 0), 0),
    reliability_note: 'Caller-selected equal-width bins, evaluated out of fit; the binomial intervals describe observed event frequencies, not model-parameter uncertainty.' };
}

export function calibrateHistorical(input, signal) {
  keys(input, ['as_of', 'source_refs', 'plan', 'records', 'queries'], 'calibration input');
  const { asOf, frozenAt, envelope } = context(input, 'calibration'), plan = input.plan;
  keys(plan, ['ref', 'frozen_at', 'mode', 'method', 'target', 'prediction_system', 'fit_end', 'evaluation_start', 'minimum_fit', 'minimum_evaluation', 'sample_policy', 'bins', 'out_of_bounds', 'independence', 'confidence_level', 'conditions', 'failure_conditions', 'monitoring', 'regime_definition'], 'calibration plan');
  check(['prospective', 'exploratory'].includes(plan.mode), 'mode must disclose a genuine prior plan or exploratory/unverified method selection.');
  check(plan.method === 'isotonic', 'This version implements isotonic only; an unimplemented method is never silently substituted.');
  check(text(plan.prediction_system) && text(plan.regime_definition), 'Name the fixed prediction system and the outcome-independent regime definition.');
  const fitEnd = time(plan.fit_end, 'fit_end'), evaluationStart = time(plan.evaluation_start, 'evaluation_start');
  check(plan.mode !== 'prospective' || frozenAt <= fitEnd,
    'Prospective evaluation requires a genuinely recorded plan before fit_end; do not invent an earlier frozen_at. Use exploratory for methods selected now or unknown prior selection.');
  check(fitEnd + plan.independence.gap_seconds * 1000 < evaluationStart && evaluationStart <= asOf,
    'evaluation_start must follow fit_end plus the declared gap and precede as_of.');
  integer(plan.minimum_fit, 2, 5000, 'minimum_fit'); integer(plan.minimum_evaluation, 1, 5000, 'minimum_evaluation'); integer(plan.bins, 2, 30, 'bins');
  const samplePolicy = clone(plan.sample_policy ?? { mode: 'advisory', source: 'agent', reason: 'The caller-selected sample targets are advisory; no explicit fixed user requirement was supplied.' });
  keys(samplePolicy, ['mode', 'source', 'reason'], 'sample_policy');
  check(['advisory', 'required'].includes(samplePolicy.mode) && ['agent', 'user'].includes(samplePolicy.source) && text(samplePolicy.reason), 'sample_policy requires a mode, declared source and reason.');
  check(samplePolicy.mode !== 'required' || samplePolicy.source === 'user', 'Only an explicit user requirement may make chosen sample targets required; never label an Agent preference as a user instruction.');
  check(['unavailable', 'clip'].includes(plan.out_of_bounds), 'Choose out_of_bounds unavailable or clip explicitly.');
  uniqueRows(input.records, 'records'); uniqueRows(input.queries, 'queries');
  const origins = new Set(input.records.map(row => row.origin ?? 'recorded_prediction'));
  check([...origins].every(origin => ['recorded_prediction', 'historical_replay'].includes(origin)) && origins.size <= 1, 'Use one explicit prediction origin; never mix recorded predictions with historical replay.');
  const historicalReplay = origins.has('historical_replay');
  check(!historicalReplay || plan.mode === 'exploratory', 'historical_replay is only allowed in exploratory mode, never prospective validation.');
  const recordIds = new Set(input.records.map(row => row.id));
  check(input.queries.every(query => !recordIds.has(query.id)), 'Current query IDs must not reuse any historical prediction record ID.');
  check(input.queries.length <= 128, 'At most 128 current queries are supported.');
  const eligible = [], excluded = [];
  for (const raw of input.records) {
    signal?.throwIfAborted();
    keys(raw, ['id', 'instrument', 'regime_id', 'regime_available_at', 'at', 'probability', 'prediction_system', 'prediction_available_at', 'model_trained_through', 'prediction_ref', 'outcome', 'origin', 'decision_at', 'replay'], 'prediction record');
    check(text(raw.instrument) && text(raw.regime_id) && finite(raw.probability) && raw.probability >= 0 && raw.probability <= 1 && dataRef(raw.prediction_ref), 'Historical probabilities need instrument, regime, bounded score and the original fixed prediction_ref.');
    const at = time(raw.at, 'prediction.at'), available = time(raw.prediction_available_at, 'prediction_available_at', true), trained = time(raw.model_trained_through, 'model_trained_through', true), regimeAt = time(raw.regime_available_at, 'regime_available_at', true);
    const measured = outcome(raw.outcome, at, plan, asOf);
    let historyReason, partitionAvailable = measured.available;
    if (historicalReplay) {
      keys(raw.replay, ['generated_at', 'feature_cutoff', 'training_label_cutoff', 'outcome_available_at', 'code_ref', 'data_refs', 'source_vintage'], 'replay provenance');
      check(time(raw.decision_at, 'replay decision_at') === at, 'Replay decision_at must equal its historical at; generation time is a separate actual timestamp.');
      check(dataRef(raw.replay.code_ref) && raw.replay.source_vintage === 'current_snapshot_not_point_in_time', 'Replay requires fixed code_ref and explicit current_snapshot_not_point_in_time source vintage.');
      refs(raw.replay.data_refs);
      const generated = time(raw.replay.generated_at, 'replay.generated_at'), featureCutoff = time(raw.replay.feature_cutoff, 'replay.feature_cutoff'), labelCutoff = time(raw.replay.training_label_cutoff, 'replay.training_label_cutoff'), virtualOutcomeAvailable = time(raw.replay.outcome_available_at, 'replay.outcome_available_at');
      historyReason = available === null || trained === null ? 'replay_generation_or_training_cutoff_unknown'
        : generated <= at || generated < frozenAt || generated > asOf || available < generated || available > asOf ? 'replay_actual_generation_time_inconsistent'
          : featureCutoff > at || labelCutoff > at || trained > featureCutoff || trained > labelCutoff ? 'replay_prefix_cutoff_after_decision'
            : virtualOutcomeAvailable < measured.end || virtualOutcomeAvailable > measured.available ? 'replay_outcome_clock_inconsistent' : null;
      partitionAvailable = virtualOutcomeAvailable;
    } else {
      check(raw.replay === undefined && raw.decision_at === undefined, 'Replay provenance requires explicit origin:historical_replay; recorded prediction timestamps must retain their original meaning.');
      historyReason = available === null || trained === null ? 'prediction_history_unknown' : available > at || trained >= at || trained > available ? 'prediction_or_model_not_pre_outcome' : null;
    }
    let reason = at > asOf ? 'prediction_after_as_of' : raw.prediction_system !== plan.prediction_system ? 'prediction_system_mismatch' : regimeAt === null || regimeAt > at ? 'regime_not_known_at_observation' : historyReason ?? measured.reason;
    let partition = null;
    if (!reason) {
      if (at <= fitEnd && partitionAvailable <= fitEnd && measured.end <= fitEnd) partition = 'fit';
      else if (at >= evaluationStart) partition = 'evaluation';
      else reason = 'gap_or_fit_outcome_unavailable_at_fit_end';
    }
    if (reason) excluded.push({ id: raw.id, instrument: raw.instrument, regime_id: raw.regime_id, at: iso(at), reason });
    else eligible.push({ id: raw.id, instrument: raw.instrument, regime_id: raw.regime_id, at, probability: raw.probability,
      prediction_ref: clone(raw.prediction_ref), prediction_available_at: iso(available), origin: historicalReplay ? 'historical_replay' : 'recorded_prediction',
      ...(historicalReplay ? { replay: clone(raw.replay), decision_at: iso(at) } : {}), ...measured, partition });
  }
  const queries = input.queries.map(raw => {
    keys(raw, ['id', 'instrument', 'regime_id', 'regime_available_at', 'at', 'probability'], 'current query');
    check(text(raw.instrument) && text(raw.regime_id) && finite(raw.probability) && raw.probability >= 0 && raw.probability <= 1, 'Queries need instrument, regime and a bounded probability, without a future label.');
    const at = time(raw.at, 'current query.at');
    check(at <= asOf && at >= evaluationStart, 'Current prediction must be available by as_of and after the fit/evaluation split.');
    check(time(raw.regime_available_at, 'current query.regime_available_at') <= at, 'Current regime cannot depend on future outcomes.');
    return { ...clone(raw), time: at };
  });
  const groupNames = [...new Set([...eligible, ...queries].map(groupKey))].sort();
  const groups = groupNames.map(key => {
    const [instrument, regime] = JSON.parse(key), population = eligible.filter(row => groupKey(row) === key);
    const byTime = (a, b) => a.at - b.at || a.id.localeCompare(b.id);
    const fit = nonoverlapping(population.filter(row => row.partition === 'fit').sort(byTime), plan.independence.gap_seconds);
    const evaluation = nonoverlapping(population.filter(row => row.partition === 'evaluation').sort(byTime), plan.independence.gap_seconds);
    const fitSummary = summary(fit.rows, plan.confidence_level), evaluationSummary = summary(evaluation.rows, plan.confidence_level);
    const reasons = [];
    if (fit.rows.length < 2) reasons.push('fit_has_fewer_than_two_nonoverlapping_records');
    if (new Set(fit.rows.map(row => row.label)).size < 2) reasons.push('fit_has_no_binary_class_variation');
    if (new Set(fit.rows.map(row => row.probability)).size < 2) reasons.push('fit_has_no_score_variation');
    const model = reasons.some(reason => reason.startsWith('fit_')) ? null : fitIsotonic(fit.rows);
    const scored = [], unscored = [];
    for (const row of evaluation.rows) {
      const prediction = model ? predictIsotonic(model, row.probability, plan.out_of_bounds) : { value: null, reason: 'fit_unavailable' };
      if (prediction.value === null) unscored.push({ id: row.id, reason: prediction.reason });
      else scored.push({ ...row, calibrated: prediction.value, clipped: prediction.clipped });
    }
    if (!scored.length) reasons.push('no_fit_disjoint_scored_evaluation');
    const shortfalls = [];
    if (fit.rows.length < plan.minimum_fit) shortfalls.push({ partition: 'fit', actual: fit.rows.length, target: plan.minimum_fit });
    if (scored.length < plan.minimum_evaluation) shortfalls.push({ partition: 'evaluation_scored', actual: scored.length, target: plan.minimum_evaluation });
    if (samplePolicy.mode === 'required') for (const shortfall of shortfalls) reasons.push(`${shortfall.partition}_below_required_user_minimum`);
    const sampleAssessment = { policy: samplePolicy, meets_targets: shortfalls.length === 0, shortfalls,
      minimum_fit: plan.minimum_fit, minimum_evaluation: plan.minimum_evaluation, actual_fit: fit.rows.length, actual_evaluation_scored: scored.length };
    const sufficient = reasons.length === 0, evaluated = sufficient && plan.mode === 'prospective';
    const observed = metrics(scored, fitSummary.empirical_frequency, plan.bins, plan.confidence_level);
    const warnings = [];
    if (observed && observed.calibrated_brier >= observed.raw_brier) warnings.push('calibration_did_not_improve_raw_brier');
    if (observed && observed.calibrated_brier >= observed.baseline_brier) warnings.push('calibration_did_not_improve_fixed_fit_prevalence_baseline');
    if (unscored.length) warnings.push('evaluation_has_out_of_support_or_unscored_predictions');
    if (shortfalls.length && samplePolicy.mode === 'advisory') warnings.push('below_advisory_sample_targets; limited_conditional_estimate_only');
    return { instrument, regime_id: regime, status: evaluated ? 'evaluated' : sufficient ? 'exploratory' : 'insufficient_data', insufficiency: reasons,
      sample_assessment: sampleAssessment,
      fit: { ...fitSummary, ids: fit.rows.map(row => row.id), end_at: iso(fitEnd), evaluations_on_fit: false },
      evaluation: { ...evaluationSummary, start_at: iso(evaluationStart), latest_available_at: evaluation.rows.length ? iso(Math.max(...evaluation.rows.map(row => row.available))) : null, ids: evaluation.rows.map(row => row.id), n_scored: scored.length,
        scored_coverage: evaluation.rows.length ? scored.length / evaluation.rows.length : 0, unscored,
        metrics_on_common_scored_rows: observed,
        rows: scored.map(row => ({ id: row.id, at: iso(row.at), end_at: iso(row.end), outcome_observed_at: iso(row.available), label: row.label, raw_probability: row.probability, calibrated_probability: row.calibrated, clipped: row.clipped,
          origin: row.origin, prediction_available_at: row.prediction_available_at, prediction_ref: clone(row.prediction_ref), ...(row.replay ? { decision_at: row.decision_at, replay: clone(row.replay) } : {}) })) },
      baseline: { method: 'constant_fit_partition_prevalence', probability: fitSummary.empirical_frequency, evaluated_on: 'same evaluation rows as calibrated scores', fit_ids: fit.rows.map(row => row.id) },
      calibrated_grid: evaluated ? model.points : null,
      fitted_model_diagnostic: model, probability_use_status: evaluated ? shortfalls.length ? 'limited_conditional_estimate_below_advisory_sample_targets; not_a_reliability_or_validation_claim' : 'estimated_mapping_with_declared_prior_plan_and_fit_disjoint_time_evaluation; usefulness_depends_on_conditions' : plan.mode === 'exploratory' ? 'retrospective_diagnostic_only; no_selection_independent_current_calibrated_probability' : 'no_current_calibrated_probability',
      dependence: { status: fit.status, fit_excluded: fit.excluded, evaluation_excluded: evaluation.excluded, assumption: plan.independence.assumption },
      warnings,
    };
  });
  const current = queries.map(query => {
    const group = groups.find(group => group.instrument === query.instrument && group.regime_id === query.regime_id);
    const prediction = plan.mode === 'exploratory' ? { value: null, reason: 'exploratory_method_selection_no_independent_calibration_claim' }
      : group?.status !== 'evaluated' ? { value: null, reason: 'insufficient_independent_fit_or_evaluation' }
      : query.time < Date.parse(group.evaluation.latest_available_at) ? { value: null, reason: 'evaluation_not_available_at_query_time' }
        : predictIsotonic(group.fitted_model_diagnostic, query.probability, plan.out_of_bounds);
    const evaluationBin = prediction.value === null ? null : group.evaluation.metrics_on_common_scored_rows.reliability[Math.min(plan.bins - 1, Math.floor(prediction.value * plan.bins))];
    const limited = prediction.value !== null && !group.sample_assessment.meets_targets;
    const { time: _time, ...request } = query;
    return { ...request, target: clone(plan.target), calibrated_probability: prediction.value, status: prediction.value === null ? 'unavailable' : limited ? 'limited' : 'estimated',
      reason: prediction.reason ?? (limited ? 'below_advisory_sample_targets' : null), clipped: prediction.clipped ?? false,
      sample_assessment: clone(group.sample_assessment),
      estimate_scope: { instrument: query.instrument, regime_id: query.regime_id, prediction_system: plan.prediction_system, fit_n: group.fit.n, evaluation_scored_n: group.evaluation.n_scored,
        interpretation: limited ? 'Limited conditional point estimate from the stated observed samples; below advisory targets, not a reliable or validated-probability claim.' : 'Estimated for this instrument, regime, target window and fixed prediction system; no reliability guarantee.' },
      probability_parameter_interval: null, probability_parameter_interval_reason: 'Model parameter uncertainty was not estimated. The separate evaluation-bin interval is an observed event-rate interval, not a confidence interval for this individual prediction.',
      evaluation_bin: evaluationBin ? clone(evaluationBin) : null, future_label_used: false };
  });
  return { ...envelope, method: 'isotonic-pava-linear-interpolation', status: groups.some(group => group.status === 'evaluated') ? 'computed' : groups.some(group => group.status === 'exploratory') ? 'exploratory' : 'insufficient_data',
    prediction_origin: historicalReplay ? 'historical_replay' : 'recorded_prediction',
    evaluation_basis: historicalReplay ? 'chronological_replay_split_only; not_original_ex_ante_predictions_or_independent_method_selection' : 'recorded_prediction_time_split; method_selection_status_is_separate',
    selection_status: plan.mode === 'prospective' ? 'declared_prior_plan; original_timestamp_evidence_required_not_certified' : 'exploratory_or_unverified_method_selection; no_independent_selection_validation',
    split: { fit_end: iso(fitEnd), evaluation_start: iso(evaluationStart), fit_and_evaluation_disjoint: true, thresholds_frozen_at: iso(frozenAt), method_selection: plan.mode, refit_after_evaluation: false,
      clock: historicalReplay ? 'explicit_virtual_decision_and_outcome_clock; actual_generation_and_observation_times_retained' : 'original_recorded_prediction_and_outcome_availability' },
    groups, current_predictions: current, excluded, n_input: input.records.length,
    limitations: [...(historicalReplay ? ['Historical replay is calculated now from a current historical snapshot. It is not an original ex-ante forecast log or verified historical data vintage. Virtual prefix cutoffs are checked as declarations; this calibration tool does not rerun or certify the supplied replay code. Actual generation, prediction availability and outcome observation times are retained separately from the virtual evaluation clock.'] : []), 'No cross-regime or cross-instrument pooled probability/score; a weak aggregate must not erase conditional performance.', 'Fixed prediction refs and declared timestamps are checked for consistency, not certified against their original publishing system. frozen_at must come from a real plan record, never a backfilled date.', 'Choosing a method now from historical records is exploratory even when the arithmetic uses disjoint periods. Unknown prior method selection is exploratory; only an untouched future evaluation can establish a new selection-independent claim.', 'Evaluation outcomes never fit the mapping, select bins or determine thresholds. Subsequent tuning requires a new untouched evaluation period.', 'Brier combines discrimination and reliability; inspect reliability bins, sample sizes and condition-specific failures.', 'Nonoverlap and time gaps do not prove independence or stability. Small-sample intervals are conditional references, not guaranteed forecast uncertainty.', 'Probabilities are estimated for the stated target, horizon, instrument, regime and prediction system; they do not authorize a trade.'] };
}
