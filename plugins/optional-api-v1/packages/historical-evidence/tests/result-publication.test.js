import test from 'node:test';
import assert from 'node:assert/strict';
import { publishHistoricalResult, resultSummary } from '../src/result-publication.js';

const ref = id => ({ id, revision: 'fixed', digest: 'sha256:' + 'a'.repeat(64), kind: 'data', schemaVersion: '1.0.0' });
const request = { operation: 'match', input_ref: ref('input') };
const result = () => ({ type: 'historical-match', schemaVersion: '1.0.0', method_version: '1.1.1', status: 'computed', n_input: 0, n_eligible: 0,
  input_digest: 'sha256:' + 'b'.repeat(64), plan_digest: 'sha256:' + 'c'.repeat(64), excluded: [], cohorts: [], forecast_probability: null, calibration_status: 'not_calibrated' });
function fixture(kind = 'derived', dependencies = []) {
  const calls = [], manifest = { content: { provenance: { kind } }, dependencies };
  const host = { resources: { read: async () => ({ content: { provenance: { kind } } }), create: async (value, options) => { calls.push({ type: 'create', value, options }); return { id: 'resource-' + calls.length, kind: value.kind }; },
    publish: async (_root, value, options) => { calls.push({ type: 'publish', value, options }); return { ref: ref('complete-result') }; } } };
  return { calls, manifest, host };
}

test('publication preserves exact numerical JSON and deduplicates complete input dependencies without relabelling demo', async () => {
  const f = fixture('demo', [request.input_ref, ref('source'), ref('source')]);
  const input = result(); input.cohorts = [{ id: 'same_instrument_history', groups: [{ instrument: 'EXAMPLE', regime_id: 'calm', n_eligible: 3, n_matched: 2, n_retained: 2, statistics: { successes: 1, empirical_frequency: .5 }, rows: [{ precise: 0.12345678901234567 }] }] }];
  const before = structuredClone(input), delivery = await publishHistoricalResult(f.host, request, input, f.manifest);
  assert.deepEqual(input, before);
  assert.equal(f.calls[1].value.source.content, JSON.stringify([before]));
  assert.equal(f.calls[1].value.policy.readOnly, true);
  assert.deepEqual(f.calls[2].value.dependencies, [request.input_ref, ref('source')]);
  assert.equal(f.calls[2].value.content.provenance.kind, 'demo');
  assert.deepEqual(delivery.result_ref, ref('complete-result'));
  assert.equal(delivery.summary.groups[0].empirical_frequency, .5);
  assert.equal(delivery.forecast_probability, undefined);
  assert.equal(delivery.summary.forecast_probability, null);
});

test('verified demo dependency stays demo even when its input envelope calls itself derived', async () => {
  const f = fixture('derived', [ref('demo-source')]);
  f.host.resources.read = async () => ({ content: { provenance: { kind: 'demo' } } });
  await publishHistoricalResult(f.host, request, result(), f.manifest);
  assert.equal(f.calls[2].value.content.provenance.kind, 'demo');
  const actual = fixture('observed', [ref('observed-source')]);
  await publishHistoricalResult(actual.host, request, result(), actual.manifest);
  assert.equal(actual.calls[2].value.content.provenance.kind, 'derived');
});

test('oversize full result and excessive dependencies fail before any resource creation, without silent truncation', async () => {
  const f = fixture(), large = result(); large.detail = 'x'.repeat(32 * 1024 * 1024);
  await assert.rejects(publishHistoricalResult(f.host, request, large, f.manifest), /32 MiB/);
  assert.deepEqual(f.calls, []);
  f.manifest.dependencies = Array.from({ length: 256 }, (_, i) => ref('source-' + i));
  await assert.rejects(publishHistoricalResult(f.host, request, result(), f.manifest), /256-reference/);
  assert.deepEqual(f.calls, []);
});

test('compact preview caps groups and labels while complete result remains unchanged', () => {
  const input = result();
  input.cohorts = [{ id: 'same_instrument_history', groups: Array.from({ length: 20 }, (_, i) => ({ instrument: 'x'.repeat(1000), regime_id: String(i), n_eligible: 1, n_matched: 1, n_retained: 1, statistics: { successes: 0, empirical_frequency: 0 } })) }];
  const summary = resultSummary(input);
  assert.equal(summary.groups.length, 8); assert.equal(summary.group_count, 20); assert.equal(summary.summary_truncated, true);
  assert.equal(summary.groups[0].instrument.length, 128);
  assert.equal(input.cohorts[0].groups[0].instrument.length, 1000);
});

test('publication errors, missing fixed ref and cancellation never report a successful result_ref', async () => {
  const f = fixture(); f.host.resources.publish = async () => { throw Error('Publication interrupted'); };
  await assert.rejects(publishHistoricalResult(f.host, request, result(), f.manifest), /Publication interrupted/);
  f.host.resources.publish = async () => ({ ref: { id: 'incomplete' } });
  await assert.rejects(publishHistoricalResult(f.host, request, result(), f.manifest), /complete fixed result DataRef/);
  const controller = new AbortController(); controller.abort(); const canceled = fixture();
  await assert.rejects(publishHistoricalResult(canceled.host, request, result(), canceled.manifest, controller.signal), /abort/i);
  assert.deepEqual(canceled.calls, []);
});
