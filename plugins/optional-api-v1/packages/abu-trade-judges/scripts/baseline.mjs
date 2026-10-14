// SPDX-License-Identifier: GPL-3.0-only
import { array, check, finite, instant, integer, parameters, runCli, text, validateInput } from './runtime.mjs';

const allowed = ['k', 'distance_floor'];
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
function vector(obj, names, prefix) {
  check(obj && typeof obj === 'object' && !Array.isArray(obj), `${prefix}: object required`);
  return names.map(n => finite(obj[n], `${prefix}.${n}`, -1e18, 1e18));
}

export function analyze(input) {
  validateInput(input);
  const p = parameters(input, allowed);
  const k = p.k === undefined ? 3 : integer(p.k, 'k', 1, 100);
  const floor = p.distance_floor === undefined ? 1e-9 : finite(p.distance_floor, 'distance_floor', Number.MIN_VALUE, 1);
  const featureNames = array(input.feature_names, 'feature_names', 1, 100).map((n, i) => text(n, `feature_names[${i}]`));
  check(new Set(featureNames).size === featureNames.length, 'feature_names: duplicates are not allowed');
  const q = input.query;
  check(q && typeof q === 'object' && !Array.isArray(q), 'query: object required');
  const queryTime = instant(q.time, 'query.time');
  const queryAvailable = instant(q.available_at, 'query.available_at');
  check(queryAvailable <= queryTime, 'query.available_at must be no later than query.time');
  check(queryTime <= Date.parse(input.as_of), 'query.time must be <= as_of');
  const queryVec = vector(q.features, featureNames, 'query.features');
  const history = array(input.completed_trades, 'completed_trades', 1, 10000).map((row, i) => {
    check(row && typeof row === 'object' && !Array.isArray(row), `completed_trades[${i}]: object required`);
    const featureAt = instant(row.feature_snapshot_at, `completed_trades[${i}].feature_snapshot_at`);
    const decisionAt = instant(row.decision_time, `completed_trades[${i}].decision_time`);
    const outcomeAt = instant(row.outcome_available_at, `completed_trades[${i}].outcome_available_at`);
    check(featureAt <= decisionAt && decisionAt <= outcomeAt && outcomeAt < queryTime, `completed_trades[${i}]: feature, decision and outcome chronology invalid or not known before query`);
    const outcome = row.outcome ?? {};
    return {
      id: row.id ?? `trade-${i}`,
      features: vector(row.features, featureNames, `completed_trades[${i}].features`),
      trade_return: finite(outcome.return, `completed_trades[${i}].outcome.return`, -1, 10),
    };
  });
  check(new Set(history.map(h => h.id)).size === history.length, 'completed_trades: duplicate id');
  const cols = featureNames.map((_, j) => history.map(h => h.features[j]));
  const centers = cols.map(mean);
  const scales = cols.map(c => sd(c) || 1);
  const scaledQuery = queryVec.map((v, j) => (v - centers[j]) / scales[j]);
  const neighbors = history.map(h => {
    const scaled = h.features.map((v, j) => (v - centers[j]) / scales[j]);
    const distance = Math.sqrt(scaled.reduce((a, v, j) => a + (v - scaledQuery[j]) ** 2, 0));
    return { id: h.id, distance, trade_return: h.trade_return, weight: 1 / Math.max(distance, floor) };
  }).sort((a, b) => a.distance - b.distance).slice(0, k);
  const weighted = neighbors.reduce((a, n) => a + n.trade_return * n.weight, 0) / neighbors.reduce((a, n) => a + n.weight, 0);
  return {
    parameters: { k, distance_floor: floor, feature_names: featureNames },
    observations: {
      query_time: q.time,
      neighbors,
      weighted_neighbor_return: weighted,
      score: Math.tanh(weighted / (mean(history.map(h => Math.abs(h.trade_return))) || 1)),
      decision_hint: weighted > 0 ? 'favorable_baseline_neighbor_vote' : weighted < 0 ? 'unfavorable_baseline_neighbor_vote' : 'neutral',
    },
    limitations: [
      'This is a transparent scaled-nearest-neighbor baseline, deliberately not equivalent to ABU UMP GMM/edge judges.',
      'Only completed trades with timestamped features, decisions and outcomes known before the query are eligible, preventing label leakage.',
      'The weighted neighbor return is a comparable historical label summary, not calibrated expected PnL.',
      'The score is a research diagnostic and does not block or approve execution by itself.',
    ],
  };
}

runCli(import.meta.url, analyze);
