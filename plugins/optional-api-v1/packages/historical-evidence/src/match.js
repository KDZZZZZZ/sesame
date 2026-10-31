// SPDX-License-Identifier: MIT
import { check, clone, context, dataRef, finite, integer, iso, keys, nonoverlapping, object, outcome, refs, summary, text, time, uniqueRows } from './common.js';

function featureDistance(query, row, features, method) {
  let squared = 0, weight = 0, rulesPass = true;
  const details = [];
  for (const feature of features) {
    const a = query[feature.key].value, b = row[feature.key].value;
    const distance = feature.kind === 'numeric' ? Math.abs(a - b) / feature.scale : a === b ? 0 : 1;
    const pass = method === 'rules' ? feature.kind === 'numeric' ? Math.abs(a - b) <= feature.tolerance : a === b : null;
    squared += feature.weight * distance ** 2; weight += feature.weight; if (method === 'rules') rulesPass &&= pass;
    check(finite(squared) && finite(weight), 'Feature scales/weights overflow binary64; normalize the fixed inputs explicitly.');
    details.push({ feature: feature.key, normalized_distance: distance, rule_pass: method === 'rules' ? pass : null });
  }
  return { distance: Math.sqrt(squared / weight), rules_pass: method === 'rules' ? rulesPass : null, details };
}
function knownFeatures(values, features, at, asOf) {
  if (!object(values)) return 'features_missing';
  for (const feature of features) {
    const cell = values[feature.key];
    if (!object(cell) || cell.value === null || cell.value === undefined) return `feature_missing:${feature.key}`;
    if (feature.kind === 'numeric' ? !finite(cell.value) : !text(cell.value)) return `feature_invalid:${feature.key}`;
    const available = time(cell.available_at, `${feature.key}.available_at`, true);
    if (available === null) return `feature_availability_unknown:${feature.key}`;
    if (available > at || available > asOf) return `feature_not_available_at_observation:${feature.key}`;
  }
  return null;
}

export function matchHistorical(input, signal) {
  keys(input, ['as_of', 'source_refs', 'plan', 'query', 'cases', 'origin', 'replay'], 'match input');
  const { asOf, frozenAt, envelope } = context(input, 'match'), plan = input.plan;
  keys(plan, ['ref', 'frozen_at', 'mode', 'target', 'features', 'matching', 'cohorts', 'independence', 'confidence_level', 'conditions', 'failure_conditions', 'monitoring', 'regime_definition'], 'match plan');
  check(['prospective', 'exploratory'].includes(plan.mode), 'mode must disclose prospective or exploratory feature selection.');
  const origin = input.origin ?? 'recorded_observation', historicalReplay = origin === 'historical_replay';
  check(['recorded_observation', 'historical_replay'].includes(origin), 'Use recorded_observation or explicit historical_replay matching; never disguise replay as an original observation.');
  let generatedAt, observedAt;
  if (historicalReplay) {
    check(plan.mode === 'exploratory', 'historical_replay matching is only allowed in exploratory mode.');
    keys(input.replay, ['generated_at', 'observed_at', 'code_ref', 'data_refs', 'source_vintage'], 'match replay provenance');
    check(dataRef(input.replay.code_ref) && input.replay.source_vintage === 'current_snapshot_not_point_in_time', 'Matching replay requires its fixed code_ref and explicit current_snapshot_not_point_in_time source vintage.');
    refs(input.replay.data_refs);
    generatedAt = time(input.replay.generated_at, 'replay.generated_at');
    observedAt = time(input.replay.observed_at, 'replay.observed_at');
    check(generatedAt >= frozenAt && generatedAt <= asOf && observedAt <= generatedAt,
      'Replay actual generation must follow the real plan and input observation, and not exceed as_of.');
  } else check(input.replay === undefined, 'Match replay provenance requires explicit origin:historical_replay.');
  check(text(plan.regime_definition), 'Describe how caller-selected regime_id is determined without outcome labels.');
  check(Array.isArray(plan.features) && plan.features.length > 0 && plan.features.length <= 32, 'Select 1..32 features before inspecting the evaluation outcomes.');
  const selected = new Set();
  for (const feature of plan.features) {
    keys(feature, ['key', 'kind', 'scale', 'weight', 'tolerance', 'definition'], 'feature definition');
    check(text(feature.key) && !selected.has(feature.key) && !Object.hasOwn(Object.prototype, feature.key) && ['numeric', 'categorical'].includes(feature.kind), 'Feature keys must be unique named input features, never outcome paths.');
    check(!/^(?:outcome|label)(?:[._]|$)/i.test(feature.key), 'Outcome/label fields cannot be matching features. Past-return features are allowed only when available at the observation.');
    check(text(feature.definition) && finite(feature.weight) && feature.weight > 0, 'Describe each feature and assign its explicit positive weight.');
    if (feature.kind === 'numeric') {
      check(finite(feature.scale) && feature.scale > 0, 'Numeric scale must be frozen and positive.');
      check(plan.matching?.method !== 'rules' && feature.tolerance === undefined || finite(feature.tolerance) && feature.tolerance >= 0,
        'Rules matching requires explicit nonnegative numeric tolerance; if supplied for distance it is checked but unused.');
    }
    selected.add(feature.key);
  }
  keys(plan.matching, ['method', 'max_distance', 'max_matches'], 'matching');
  check(['distance', 'rules'].includes(plan.matching.method) && finite(plan.matching.max_distance) && plan.matching.max_distance >= 0, 'Declare distance/rules and a nonnegative distance ceiling.');
  integer(plan.matching.max_matches, 1, 5000, 'matching.max_matches');
  keys(plan.cohorts, ['recent_seconds', 'minimum_samples', 'comparables'], 'cohorts');
  integer(plan.cohorts.recent_seconds, 1, 10 * 366 * 86400, 'cohorts.recent_seconds');
  integer(plan.cohorts.minimum_samples, 1, 5000, 'cohorts.minimum_samples');
  check(Array.isArray(plan.cohorts.comparables) && plan.cohorts.comparables.length <= 128, 'comparables is an explicit cross-instrument list, or [].');
  const comparable = new Map();
  for (const item of plan.cohorts.comparables) {
    keys(item, ['instrument', 'condition', 'available_at'], 'comparable');
    check(text(item.instrument) && text(item.condition) && !comparable.has(item.instrument), 'Cross-instrument inclusion requires a unique named instrument and a material comparability condition.');
    const at = time(item.available_at, 'comparability.available_at');
    check(at <= frozenAt, 'Comparability conditions must be fixed with the analysis plan.');
    comparable.set(item.instrument, item.condition);
  }
  keys(input.query, ['id', 'instrument', 'regime_id', 'regime_available_at', 'at', 'features', 'replay'], 'query');
  check(text(input.query.id) && text(input.query.instrument) && text(input.query.regime_id), 'Query needs identity, instrument and explicit regime_id.');
  const queryAt = time(input.query.at, 'query.at');
  check(queryAt <= asOf && (historicalReplay ? generatedAt > queryAt : frozenAt <= queryAt),
    historicalReplay ? 'Historical query must precede actual replay generation and as_of.' : 'Current query must be known by as_of and follow the frozen plan.');
  check(time(input.query.regime_available_at, 'query.regime_available_at') <= queryAt, 'Query regime must be known by its observation.');
  check(!knownFeatures(input.query.features, plan.features, queryAt, asOf), 'Query features must be present and available by query.at/as_of.');
  if (historicalReplay) {
    keys(input.query.replay, ['feature_cutoff'], 'query replay');
    const cutoff = time(input.query.replay.feature_cutoff, 'query.replay.feature_cutoff');
    check(cutoff <= queryAt && time(input.query.regime_available_at, 'query.regime_available_at') <= cutoff
      && !knownFeatures(input.query.features, plan.features, cutoff, asOf), 'Replay query feature/regime information must fit its declared prefix cutoff, no later than historical query.at.');
  } else check(input.query.replay === undefined, 'Query replay provenance requires explicit origin:historical_replay.');
  uniqueRows(input.cases, 'cases');
  const eligible = [], excluded = [];
  for (const raw of input.cases) {
    signal?.throwIfAborted();
    keys(raw, ['id', 'instrument', 'regime_id', 'regime_available_at', 'at', 'features', 'outcome', 'source_refs', 'replay'], 'case');
    check(text(raw.instrument) && text(raw.regime_id), 'Every case needs an instrument and explicit regime_id.');
    const at = time(raw.at, 'case.at');
    const regimeAt = time(raw.regime_available_at, 'case.regime_available_at', true);
    if (raw.source_refs !== undefined) refs(raw.source_refs);
    let reason = raw.id === input.query.id ? 'query_is_not_a_historical_case' : at >= queryAt || at > asOf ? 'not_before_query' : null;
    if (!reason && (regimeAt === null || regimeAt > at)) reason = 'regime_not_known_at_observation';
    if (!reason && plan.mode === 'prospective' && at < frozenAt) reason = 'before_frozen_feature_plan';
    if (!reason && raw.instrument !== input.query.instrument && !comparable.has(raw.instrument)) reason = 'cross_instrument_comparability_not_declared';
    reason ??= knownFeatures(raw.features, plan.features, at, asOf);
    // as_of is the computation snapshot; a reconstructed decision may only use
    // outcomes already available at that query's own decision time.
    // Replay checks actual observation against the real execution, then uses
    // the separately declared virtual outcome clock for historical eligibility.
    const result = outcome(raw.outcome, at, plan, historicalReplay ? generatedAt : queryAt);
    if (historicalReplay) {
      keys(raw.replay, ['feature_cutoff', 'outcome_available_at'], 'case replay');
      const cutoff = time(raw.replay.feature_cutoff, 'case.replay.feature_cutoff'), virtualAvailable = time(raw.replay.outcome_available_at, 'case.replay.outcome_available_at');
      reason ??= cutoff > at || regimeAt !== null && regimeAt > cutoff || knownFeatures(raw.features, plan.features, cutoff, asOf) ? 'replay_prefix_cutoff_after_observation' : null;
      if (!result.reason) {
        reason ??= result.available > observedAt || virtualAvailable < result.end || virtualAvailable > result.available ? 'replay_outcome_clock_inconsistent'
          : result.end > queryAt || virtualAvailable > queryAt ? 'replay_outcome_not_available_at_decision' : null;
        result.outcome_observed_at = iso(result.available);
        result.virtual_outcome_available_at = iso(virtualAvailable);
        result.replay = clone(raw.replay);
      }
    } else check(raw.replay === undefined, 'Case replay provenance requires explicit origin:historical_replay; do not mix observation origins.');
    reason ??= result.reason;
    if (reason) { excluded.push({ id: raw.id, instrument: raw.instrument, regime_id: raw.regime_id, at: iso(at), reason }); continue; }
    const match = featureDistance(input.query.features, raw.features, plan.features, plan.matching.method);
    eligible.push({ id: raw.id, instrument: raw.instrument, regime_id: raw.regime_id, at, ...result, ...match,
      matched: plan.matching.method === 'rules' ? match.rules_pass : match.distance <= plan.matching.max_distance,
      plan_fixed_before_case: at >= frozenAt, source_refs: clone(raw.source_refs ?? input.source_refs) });
  }
  const scopes = [
    { id: 'same_instrument_recent', instruments: [input.query.instrument], rows: eligible.filter(row => row.instrument === input.query.instrument && row.at >= queryAt - plan.cohorts.recent_seconds * 1000) },
    { id: 'same_instrument_history', instruments: [input.query.instrument], rows: eligible.filter(row => row.instrument === input.query.instrument) },
    { id: 'comparable_instruments', instruments: [...comparable.keys()].filter(instrument => instrument !== input.query.instrument), rows: eligible.filter(row => row.instrument !== input.query.instrument), conditions: [...comparable].map(([instrument, condition]) => ({ instrument, condition })) },
  ];
  const cohorts = scopes.map(scope => ({ id: scope.id, target: clone(plan.target), conditions: scope.conditions ?? [],
    groups: scope.instruments.flatMap(instrument => [...new Set([input.query.regime_id, ...scope.rows.filter(row => row.instrument === instrument).map(row => row.regime_id)])].sort().map(regime => {
      const population = scope.rows.filter(row => row.instrument === instrument && row.regime_id === regime);
      const matched = population.filter(row => row.matched).sort((a, b) => a.distance - b.distance || b.at - a.at || a.id.localeCompare(b.id));
      const independent = nonoverlapping(matched, plan.independence.gap_seconds);
      const rows = independent.rows.slice(0, plan.matching.max_matches);
      const baseline = nonoverlapping([...population].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)), plan.independence.gap_seconds);
      return { instrument, regime_id: regime, n_eligible: population.length, n_matched: matched.length, n_nonoverlapping: independent.rows.length,
        n_retained: rows.length, truncated_by_max_matches: independent.rows.length - rows.length,
        statistics: summary(rows, plan.confidence_level), baseline: { kind: 'eligible_population_same_scope_instrument_and_regime', ...summary(baseline.rows, plan.confidence_level) },
        dependence: { status: independent.status, excluded: independent.excluded, baseline_excluded: baseline.excluded, assumption: plan.independence.assumption },
        matches: rows.map(row => ({ ...row, at: iso(row.at), end: iso(row.end), available: iso(row.available) })),
        limitations: rows.length < plan.cohorts.minimum_samples ? ['below_caller_selected_sample_target; conditional descriptive evidence remains usable within stated limits'] : [],
      };
    })) }));
  const groups = cohorts.flatMap(cohort => cohort.groups.filter(group => group.regime_id === input.query.regime_id).map(group => ({ cohort: cohort.id, group })));
  const selectedScope = groups.find(({ group }) => group.n_retained >= plan.cohorts.minimum_samples) ?? groups.find(({ group }) => group.n_retained > 0);
  return { ...envelope, status: selectedScope ? 'computed' : 'insufficient_data', query: clone(input.query), decision_at: iso(queryAt),
    selection: selectedScope ? { cohort: selectedScope.cohort, instrument: selectedScope.group.instrument, regime_id: input.query.regime_id, meets_sample_target: selectedScope.group.n_retained >= plan.cohorts.minimum_samples,
      expansion: groups.slice(0, groups.indexOf(selectedScope)).map(({ cohort, group }) => ({ cohort, instrument: group.instrument, n: group.n_retained, reason: 'below_caller_sample_target' })) } : null,
    cohorts, excluded, n_input: input.cases.length, n_eligible: eligible.length,
    calibration_status: 'not_calibrated', forecast_probability: null,
    ...(historicalReplay ? { observation_origin: origin, evaluation_basis: 'historical_replay_matching_only_not_ex_ante_observation',
      point_in_time_status: 'current_snapshot_not_point_in_time; explicit_virtual_cutoffs_checked_not_source_certified',
      replay: clone(input.replay), clock: { decision_at: iso(queryAt), plan_frozen_at: iso(frozenAt), generated_at: iso(generatedAt), observed_at: iso(observedAt),
        feature_and_regime_availability: 'virtual_prefix_information_clock', outcome_available_at: 'actual_observation_time', historical_eligibility: 'case.replay.outcome_available_at' } } : {}),
    selection_status: plan.mode === 'prospective' ? 'declared_plan_precedes_retained_cases' : 'exploratory; known outcomes must not be used to tune features and present a prospective validation claim',
    limitations: [...(historicalReplay ? ['Explicit historical replay on a current snapshot; not an original ex-ante observation or source-certified point-in-time history. Actual observation/generation and virtual decision clocks are separate.'] : []),
      'No source or pre-registration certification; false availability declarations cannot be detected from supplied rows.', 'decision_at equals query.at; outcomes known after that instant are excluded even when already available by as_of.', 'Recent and full-history cohorts overlap and are not independent votes. Regimes and cross-instrument results are never pooled; simultaneous market events in separate groups are not independent corroborations.', 'Matching measures supplied feature similarity, not causal equivalence. Nonoverlap does not eliminate serial dependence.', 'Conditional frequency and its reference interval are not a calibrated current probability.'] };
}
