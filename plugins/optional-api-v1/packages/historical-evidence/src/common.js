// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';

export const VERSION = '1.1.1';
export const MAX_ROWS = 5000;
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
export function check(ok, message, code = 'INVALID_HISTORICAL_EVIDENCE') {
  if (!ok) throw Object.assign(new Error(message), { code });
}
export function keys(value, allowed, name) {
  check(object(value) && Object.keys(value).every(key => allowed.includes(key)), `${name} contains unsupported fields.`);
}
const normalized = value => Array.isArray(value) ? value.map(normalized) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
export const digest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
export const clone = value => structuredClone(value);
export const iso = value => new Date(value).toISOString();
export function time(value, name, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value), `${name} needs an ISO timestamp with explicit timezone.`);
  const day = new Date(value.slice(0, 10) + 'T00:00:00Z'), [year, month, date] = value.slice(0, 10).split('-').map(Number);
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number), result = Date.parse(value);
  check(Number.isFinite(result) && hour < 24 && minute < 60 && second < 60 && day.getUTCFullYear() === year && day.getUTCMonth() + 1 === month && day.getUTCDate() === date, `${name} is not a real timestamp.`);
  return result;
}
export function dataRef(ref) {
  return object(ref) && Object.keys(ref).length === 5 && text(ref.id) && text(ref.revision)
    && ref.kind === 'data' && ref.schemaVersion === '1.0.0' && /^sha256:[a-f0-9]{64}$/.test(ref.digest);
}
export function refs(value) {
  check(Array.isArray(value) && value.length > 0 && value.length <= 64 && value.every(dataRef), 'source_refs needs 1..64 complete fixed DataRefs. Inline tools record these labels and do not read them.');
  return clone(value);
}
export function integer(value, low, high, name) {
  check(Number.isSafeInteger(value) && value >= low && value <= high, `${name} must be an integer in ${low}..${high}.`);
  return value;
}
export function context(input, operation) {
  check(object(input) && object(input.plan), 'Provide an explicit frozen analysis plan.');
  check(dataRef(input.plan.ref), 'plan.ref must identify the fixed plan; its date is a caller declaration, not certification.');
  const asOf = time(input.as_of, 'as_of'), frozenAt = time(input.plan.frozen_at, 'plan.frozen_at');
  check(frozenAt <= asOf, 'The analysis plan cannot be frozen after as_of.');
  const sourceRefs = refs(input.source_refs);
  check(object(input.plan.target) && text(input.plan.target.id), 'The target needs an explicit ID and horizon.');
  keys(input.plan.target, ['id', 'horizon_seconds', 'description'], 'plan.target');
  integer(input.plan.target.horizon_seconds, 1, 10 * 366 * 86400, 'target.horizon_seconds');
  check(text(input.plan.target.description), 'Describe the binary target label; labels must not silently change between rows.');
  check(object(input.plan.independence), 'Declare the nonoverlap gap and dependence assumptions.');
  keys(input.plan.independence, ['gap_seconds', 'assumption'], 'plan.independence');
  integer(input.plan.independence.gap_seconds, 0, 10 * 366 * 86400, 'independence.gap_seconds');
  check(text(input.plan.independence.assumption), 'Document remaining serial/cross-instrument dependence.');
  check(finite(input.plan.confidence_level) && Object.hasOwn(Z, input.plan.confidence_level), 'Choose confidence_level 0.8, 0.9, 0.95, 0.99 or 0.999.');
  for (const field of ['conditions', 'failure_conditions', 'monitoring']) check(Array.isArray(input.plan[field]) && input.plan[field].length <= 32 && input.plan[field].every(text), `${field} must be a bounded list of caller-selected conditions.`);
  return { asOf, frozenAt, sourceRefs, envelope: {
    type: `sesame.historical-evidence.${operation}`, schemaVersion: '1.0.0', method_version: VERSION,
    as_of: iso(asOf), input_digest: digest(input), plan_digest: digest(input.plan), source_refs: sourceRefs,
    plan_ref: clone(input.plan.ref), parameters: clone(input.plan),
    point_in_time_status: 'declared_timestamps_checked_not_source_certified',
    data_access: 'inline-input-only; source and plan refs are provenance labels, not dereferenced',
    application: { conditions: clone(input.plan.conditions), failure_conditions: clone(input.plan.failure_conditions), monitoring: clone(input.plan.monitoring),
      decision: 'Caller judges conditional usefulness; no universal all-tests-pass gate or trading authorization.' },
  } };
}
// Standard normal quantiles for explicitly supported two-sided confidence levels.
const Z = { '0.8': 1.2815515655446004, '0.9': 1.6448536269514722, '0.95': 1.959963984540054, '0.99': 2.5758293035489004, '0.999': 3.2905267314919255 };
export function wilson(successes, n, confidence) {
  if (!n) return null;
  const z = Z[confidence], p = successes / n, denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return { method: 'wilson-score', confidence_level: confidence, lower: Math.max(0, center - half), upper: Math.min(1, center + half),
    assumption: 'Binomial reference interval assumes independent comparable observations; filtering overlap does not establish that assumption.' };
}
export function summary(rows, confidence) {
  const success = rows.reduce((sum, row) => sum + row.label, 0), n = rows.length;
  return { n, successes: success, failures: n - success, empirical_frequency: n ? success / n : null,
    interval: wilson(success, n, confidence), earliest_at: n ? iso(Math.min(...rows.map(row => row.at))) : null,
    latest_at: n ? iso(Math.max(...rows.map(row => row.at))) : null,
    counterexample_ids: rows.filter(row => row.label === 0).map(row => row.id),
    interpretation: 'Empirical conditional frequency, not a calibrated forecast probability or causal effect.' };
}
export function uniqueRows(rows, name) {
  check(Array.isArray(rows) && rows.length <= MAX_ROWS && rows.every(object), `${name} must contain at most ${MAX_ROWS} object rows.`);
  const ids = new Set();
  for (const row of rows) { check(text(row.id) && row.id.length <= 128 && !ids.has(row.id), `${name} IDs must be present and unique.`); ids.add(row.id); }
}
/** Greedy time exclusion is independent of outcomes within one supplied group.
 * Callers retain other instruments/regimes separately and must never sum them
 * as independent corroborations merely because each group has this filter. */
export function nonoverlapping(rows, gapSeconds) {
  const chosen = [], excluded = [], intervals = [];
  for (const row of rows) {
    const start = row.at, end = row.end + gapSeconds * 1000;
    let lo = 0, hi = intervals.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (intervals[mid].start < start) lo = mid + 1; else hi = mid; }
    const previous = intervals[lo - 1], next = intervals[lo];
    const conflict = previous && previous.end >= start ? previous : next && next.start <= end ? next : null;
    if (conflict) excluded.push({ id: row.id, with_id: conflict.id, reason: 'overlap_or_gap', start_at: iso(start), end_at: iso(row.end) });
    else { intervals.splice(lo, 0, { id: row.id, start, end }); chosen.push(row); }
  }
  return { rows: chosen, excluded, status: 'nonoverlapping_subset_not_proof_of_independence', n_raw: rows.length, n_nonoverlapping: chosen.length };
}
export function outcome(raw, at, plan, asOf) {
  if (!object(raw)) return { reason: 'outcome_missing' };
  const end = time(raw.end_at, 'outcome.end_at', true), available = time(raw.available_at, 'outcome.available_at', true);
  if (raw.target_id !== plan.target.id || raw.horizon_seconds !== plan.target.horizon_seconds) return { reason: 'target_or_window_mismatch' };
  if (end === null || available === null) return { reason: 'outcome_time_unknown' };
  if (end !== at + plan.target.horizon_seconds * 1000 || available < end) return { reason: 'outcome_time_inconsistent' };
  if (end > asOf || available > asOf) return { reason: 'outcome_not_mature_or_available' };
  if (![0, 1].includes(raw.label)) return { reason: 'binary_label_missing' };
  return { label: raw.label, end, available };
}
