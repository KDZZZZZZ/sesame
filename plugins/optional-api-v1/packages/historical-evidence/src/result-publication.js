// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { check, clone, dataRef, digest } from './common.js';

const DELIVERY_VERSION = '1.1.2';
const MAX_RESULT_BYTES = 32 * 1024 * 1024, MAX_DEPENDENCIES = 256, SUMMARY_GROUPS = 8;
const bytesDigest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const uniqueRefs = refs => [...new Map(refs.map(ref => [digest(ref), ref])).values()];

/** Display projection only. Every original value and row remains in result_ref. */
export function resultSummary(result) {
  let shortened = false;
  const label = value => {
    if (typeof value !== 'string' || value.length <= 128) return value;
    shortened = true; return value.slice(0, 127) + '…';
  };
  const groups = result.cohorts
    ? result.cohorts.flatMap(cohort => cohort.groups.map(group => ({
      cohort: cohort.id, instrument: label(group.instrument), regime_id: label(group.regime_id),
      n_eligible: group.n_eligible, n_matched: group.n_matched, n_retained: group.n_retained,
      successes: group.statistics.successes, empirical_frequency: group.statistics.empirical_frequency,
      baseline: group.baseline ? { n: group.baseline.n, empirical_frequency: group.baseline.empirical_frequency } : null,
    })))
    : result.groups.map(group => ({
      instrument: label(group.instrument), regime_id: label(group.regime_id), status: group.status,
      fit_n: group.fit.n, evaluation_n: group.evaluation.n, scored_n: group.evaluation.n_scored,
      baseline_probability: group.baseline?.probability ?? null,
      metrics: group.evaluation.metrics_on_common_scored_rows
        ? Object.fromEntries(['n','raw_brier','calibrated_brier','baseline_brier','calibrated_minus_raw_brier'].map(key => [key, group.evaluation.metrics_on_common_scored_rows[key]])) : null,
      warnings: group.warnings ?? [],
    }));
  return {
    n_input: result.n_input, ...(result.n_eligible === undefined ? {} : { n_eligible: result.n_eligible }),
    excluded_count: result.excluded.length,
    ...(result.selection ? { selection: { cohort: result.selection.cohort, instrument: label(result.selection.instrument), regime_id: label(result.selection.regime_id), meets_sample_target: result.selection.meets_sample_target } } : {}),
    ...(result.forecast_probability === undefined ? {} : { forecast_probability: result.forecast_probability, calibration_status: result.calibration_status }),
    ...(result.current_predictions ? { current_predictions_count: result.current_predictions.length } : {}),
    observation_origin: result.observation_origin ?? result.prediction_origin ?? 'recorded_observation',
    evaluation_basis: result.evaluation_basis ?? null,
    groups: groups.slice(0, SUMMARY_GROUPS), group_count: groups.length,
    summary_truncated: shortened || groups.length > SUMMARY_GROUPS,
    interpretation: 'Summary only; read the complete fixed result for samples, reliability, per-row outcomes, conditions and counterexamples. Empirical frequency is not a calibrated current probability.',
  };
}

/** Host resource operations provide durable idempotency and atomic publication.
 * No plugin state collection: the two inline capabilities retain input-only use.
 * No revision update: an exact request creates one immutable result, never edits it.
 */
export async function publishHistoricalResult(host, input, result, inputManifest, signal) {
  const dependencies = uniqueRefs([input.input_ref, ...(inputManifest.dependencies ?? [])]);
  check(dependencies.length <= MAX_DEPENDENCIES, 'Result exceeds the 256-reference publication budget; input dependencies were not dropped.', 'RESOURCE_EXHAUSTED');
  const content = JSON.stringify([result]);
  const size = Buffer.byteLength(content), contentDigest = bytesDigest(content);
  check(size <= MAX_RESULT_BYTES, 'Complete result exceeds the 32 MiB publication budget; no truncated result was published.', 'RESOURCE_EXHAUSTED');
  let demo = inputManifest.content.provenance.kind === 'demo';
  for (const dependency of dependencies.slice(1)) {
    signal?.throwIfAborted();
    const manifest = await host.resources.read(dependency, { part: 'manifest' });
    // A derived envelope cannot promote a verified demo dependency to real data.
    demo ||= manifest.content?.provenance?.kind === 'demo' || manifest.provenance?.kind === 'demo';
  }
  const request = { version: DELIVERY_VERSION, operation: input.operation, input_ref: input.input_ref };
  const requestDigest = digest(request);
  const operation = 'historical-result:' + DELIVERY_VERSION + ':' + digest(input.operation_id === undefined ? request : { operation_id: input.operation_id }).slice(7);
  signal?.throwIfAborted();
  // Name binds an explicit operation ID to its exact request. A reused ID with a
  // different input fails at host idempotency, before a second result is created.
  const root = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: 'history-' + digest([operation, requestDigest]).slice(7) }, { operationId: operation + ':root', signal });
  const file = await host.resources.create({ kind: 'file', lifetime: 'durable', parent: root, name: 'rows.json', source: { content }, policy: { readOnly: true } }, { operationId: operation + ':rows', signal });
  check(file, 'Host did not create the complete result resource.');
  const provenance = { kind: demo ? 'demo' : 'derived', references: dependencies,
    operation: input.operation, method_version: result.method_version, delivery_version: DELIVERY_VERSION, input_digest: result.input_digest, plan_digest: result.plan_digest };
  const published = await host.resources.publish(root, { kind: 'data', schemaVersion: '1.0.0', content: {
    format: 'json-rows', path: 'rows.json', rowCount: 1, columns: Object.keys(result), provenance,
  }, dependencies, provenance, blobs: [{ entry: 'rows.json', path: 'rows.json', mediaType: 'application/json' }] }, { operationId: operation + ':publish', signal });
  check(dataRef(published?.ref), 'Host did not return a complete fixed result DataRef.');
  // Ref comes first so even a host's bounded tool preview exposes the durable handoff.
  return {
    result_ref: clone(published.ref), type: result.type, schemaVersion: result.schemaVersion,
    method_version: result.method_version, status: result.status, operation: input.operation,
    input_ref: clone(input.input_ref), input_digest: result.input_digest, plan_digest: result.plan_digest,
    source_refs: [clone(input.input_ref)],
    result_data: { format: 'json-rows', path: 'rows.json', rowCount: 1, content_bytes: size, content_digest: contentDigest, complete: true },
    summary: resultSummary(result),
    data_access: 'reads one exact fixed input and publishes its complete result; not input-only',
  };
}
