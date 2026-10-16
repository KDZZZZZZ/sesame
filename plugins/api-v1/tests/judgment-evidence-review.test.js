import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, judgmentHost } from './judgment-host.js';
import { JudgmentService } from '../../optional-api-v1/packages/judgment-evolution/service.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mt5agent-judgment-evidence-review-')), store = new Store(directory);
  store.put('conversation', { id: 'conv_main', scope: 'main', active_response_message_id: null });
  let time = new Date('2026-01-01T00:00:00Z');
  const host = judgmentHost(store);
  const service = new JudgmentService(host, { clock: () => time }).init();
  const args = { command_id: 'prediction-A', claim: 'Asset A exceeds 10 at the registered observation', topic: 'asset-price', regime: 'trend', rationale: 'Source validation regression fixture', probability: 0.8,
    due_at: '2026-01-02T00:00:00Z', verification: { provider: 'https://quotes.example/prices?symbol=A', metric: 'value', observed_at_field: 'observed', op: 'gt', target: 10 } };
  const data = (key, value, { provider = args.verification.provider, observed = args.due_at, as_of = time.toISOString() } = {}) => store.put('dataset', { id: key, rows: [{ value, observed }], provenance: { source_kind: 'external', provider, as_of } });
  t.after(async () => { await service.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { service, store, args, data, setTime: value => { time = new Date(value); } };
}

test('frozen source URL query cannot be replaced with another asset query', t => {
  const f = fixture(t), prediction = f.service.record('conv_main', f.args);
  f.setTime(prediction.due_at);
  const other = f.data('data_other_asset', 12, { provider: 'https://quotes.example/prices?symbol=B' });
  assert.throws(() => f.service.resolve('conv_main', { judgment_id: prediction.id, dataset_id: other.id }), /来源|证据/);
  assert.equal(f.service.get('prediction', prediction.id).status, 'pending');
});

test('conflicting same-time evidence across snapshots blocks both manual and batch resolution', async t => {
  const f = fixture(t), prediction = f.service.record('conv_main', f.args);
  f.setTime(prediction.due_at);
  f.data('data_loss', 8); const newest = f.data('data_win', 12);
  assert.throws(() => f.service.resolve('conv_main', { judgment_id: prediction.id, dataset_id: newest.id }), /冲突|证据/);
  await f.service.reviewDue('conv_main');
  assert.equal(f.service.get('prediction', prediction.id).status, 'pending');
  assert.equal(f.service.statistics().resolved, 0);
});

test('a source captured before its asserted observation time is not outcome evidence', t => {
  const f = fixture(t), prediction = f.service.record('conv_main', { ...f.args, verification: { ...f.args.verification, window_start: '2026-01-01T12:00:00Z' } });
  f.setTime(prediction.due_at);
  const sourceForecast = f.data('data_source_forecast', 12, { as_of: '2026-01-01T13:00:00Z', observed: prediction.due_at });
  assert.throws(() => f.service.resolve('conv_main', { judgment_id: prediction.id, dataset_id: sourceForecast.id }), /来源|获取|观察|时间|证据/);
});

test('explicit review publishes probation immediately when a deferred due sample invalidates an active rule', async t => {
  const f = fixture(t), origin = f.service.record('conv_main', f.args);
  f.setTime(origin.due_at); f.service.resolve('conv_main', { judgment_id: origin.id, dataset_id: f.data('data_origin', 12).id });
  f.setTime('2026-01-02T01:00:00Z');
  const candidate = f.service.proposeRule('conv_main', { command_id: 'rule-A', title: 'Previously active rule', guideline: 'Only active when all due outcomes are verified', topic: f.args.topic, regime: f.args.regime, limitations: 'Fixture', evidence_ids: [origin.id] });
  // Seed an already validated state; this regression concerns export invalidation,
  // while judgment.test.js separately exercises full forward promotion.
  f.service.put('rule', { ...candidate, status: 'active', evaluation: { independent_blocks: 31, lower_bound: 0.01, baseline_lower_bound: 0.005 } }); f.service.refreshFiles();
  const next = f.service.record('conv_main', { ...f.args, command_id: 'prediction-B', due_at: '2026-01-03T00:00:00Z', rule_predictions: [{ rule_id: candidate.id, probability: 0.9 }] });
  assert.ok(readFileSync(join(f.service.directory, 'CRITERIA.md'), 'utf8').includes(candidate.id));
  f.setTime(next.due_at); f.service.defer('conv_main', { judgment_id: next.id, reason: 'Source has not published the outcome' });
  await f.service.reviewDue('conv_main');
  assert.equal(f.service.get('rule', candidate.id).status, 'probation');
  assert.ok(!readFileSync(join(f.service.directory, 'CRITERIA.md'), 'utf8').includes(candidate.id), 'subagents must not read a stale active criterion after its core state changes');
});

test('a shadow rule worse than the preregistered baseline cannot be promoted by beating a poor main forecast', t => {
  const f = fixture(t), origin = f.service.record('conv_main', f.args);
  f.setTime(origin.due_at); f.service.resolve('conv_main', { judgment_id: origin.id, dataset_id: f.data('data_origin', 12).id });
  const rule = f.service.proposeRule('conv_main', { command_id: 'rule-baseline', title: 'Weak relative improvement', guideline: 'This rule improves the main forecast but loses to the preregistered baseline', topic: f.args.topic, regime: f.args.regime, limitations: 'Fixture', evidence_ids: [origin.id] });
  for (let i = 0; i < 31; i++) {
    const created = new Date(Date.UTC(2026, 0, 3 + i)).toISOString(), due = new Date(Date.UTC(2026, 0, 3 + i, 12)).toISOString();
    f.setTime(created);
    const prediction = f.service.record('conv_main', { ...f.args, command_id: `baseline-${i}`, due_at: due, probability: 0, baseline_probability: 1, rule_predictions: [{ rule_id: rule.id, probability: 0.9 }] });
    f.setTime(due); f.service.resolve('conv_main', { judgment_id: prediction.id, dataset_id: f.data(`data_baseline_${i}`, 12, { observed: due }).id });
  }
  const current = f.service.get('rule', rule.id);
  assert.equal(current.evaluation.independent_blocks, 31);
  assert.ok(current.evaluation.mean_brier_improvement > 0.9);
  assert.ok(current.evaluation.lower_bound > 0, 'main comparison alone would have accepted this rule');
  assert.equal(current.evaluation.accepted, false);
  assert.notEqual(current.status, 'active');
});

test('inspection alpha is spent on changed material evidence, not repeated rendering or polling', t => {
  const f = fixture(t), origin = f.service.record('conv_main', f.args);
  f.setTime(origin.due_at); f.service.resolve('conv_main', { judgment_id: origin.id, dataset_id: f.data('data_origin', 12).id });
  const rule = f.service.proposeRule('conv_main', { command_id: 'rule-inspection', title: 'Sequential inspection', guideline: 'Every changed sample set needs a distinct error allocation', topic: f.args.topic, regime: f.args.regime, limitations: 'Fixture', evidence_ids: [origin.id] });
  const evaluate = () => { f.service.evaluateRules(); return f.service.get('rule', rule.id).evaluation; };
  const first = evaluate(), same = evaluate();
  assert.equal(same.evidence_fingerprint, first.evidence_fingerprint); assert.equal(same.inspection_index, first.inspection_index); assert.equal(same.adjusted_alpha, first.adjusted_alpha);
  f.setTime('2026-01-02T01:00:00Z');
  const prediction = f.service.record('conv_main', { ...f.args, command_id: 'new-inspection', due_at: '2026-01-03T00:00:00Z', probability: 0, rule_predictions: [{ rule_id: rule.id, probability: 1 }] });
  const future = evaluate();
  assert.equal(future.evidence_fingerprint, first.evidence_fingerprint, 'an unresolved future sample contributes no outcome evidence');
  assert.equal(future.inspection_index, first.inspection_index);
  f.setTime(prediction.due_at); const due = evaluate();
  assert.notEqual(due.evidence_fingerprint, first.evidence_fingerprint); assert.equal(due.inspection_index, first.inspection_index + 1); assert.ok(due.adjusted_alpha < first.adjusted_alpha);
  assert.equal(evaluate().inspection_index, due.inspection_index);
  f.service.resolve('conv_main', { judgment_id: prediction.id, dataset_id: f.data('data_inspection', 12, { observed: prediction.due_at }).id });
  const resolved = f.service.get('rule', rule.id).evaluation;
  assert.notEqual(resolved.evidence_fingerprint, due.evidence_fingerprint); assert.equal(resolved.inspection_index, due.inspection_index + 1);
  const repeated = evaluate(); assert.equal(repeated.inspection_index, resolved.inspection_index); assert.equal(repeated.adjusted_alpha, resolved.adjusted_alpha);
});

test('missing evidence at the front of an offline review queue does not starve later resolvable judgments', async t => {
  const f = fixture(t);
  for (let i = 0; i < 12; i++) f.service.record('conv_main', { ...f.args, command_id: `missing-${i}`, verification: { ...f.args.verification, provider: `https://quotes.example/prices?symbol=MISSING_${i}` } });
  const ready = f.service.record('conv_main', { ...f.args, command_id: 'ready-after-batch' });
  f.setTime(ready.due_at); f.data('data_ready', 12);
  for (let i = 0; i < 3; i++) await f.service.reviewDue('conv_main');
  assert.equal(f.service.get('prediction', ready.id).status, 'resolved', 'core scoring must progress without a configured model when outcome evidence already exists');
});
