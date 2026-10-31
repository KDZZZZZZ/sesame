import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvaluationPlan, assessCandidate, planDigest } from '../evaluation-plan.js';
import { DIAGNOSTICS } from '../diagnostics.js';

const plan = options => normalizeEvaluationPlan(options, Object.keys(DIAGNOSTICS));
const metrics = { validation: { rankIC: -.3, coverage: .4, meanNetReturn: null, portfolioPeriods: 0 }, diagnostics: {} };
const threshold = extra => ({ metric: 'validation.rankIC', operator: 'gte', value: 0, reason: 'Task-specific association criterion', ...extra });

test('legacy thresholds and all Agent-sourced preferences are advisory, even if labeled required', () => {
  const legacy = plan({ minRankIC: .5, minCoverage: .9, maxCorrelation: .1 });
  assert.equal(legacy.thresholds.length, 3);
  const result = assessCandidate(metrics, legacy);
  assert.equal(result.eligible, true); assert.equal(result.advisoryFindings.length, 2);
  assert.deepEqual(result.hardRequirementFailures, []);
  const agent = assessCandidate(metrics, plan({ evaluationPlan: { thresholds: [threshold({ mode: 'required', source: 'agent' })] } }));
  assert.equal(agent.eligible, true); assert.equal(agent.thresholdResults[0].hard, false);
});

test('only explicit user required thresholds gate; unavailable requirements cannot pass as success', () => {
  const required = plan({ evaluationPlan: { thresholds: [threshold({ mode: 'required', source: 'user' })] } });
  const result = assessCandidate(metrics, required);
  assert.equal(result.eligible, false); assert.equal(result.hardRequirementFailures[0].status, 'unmet');
  const unavailable = assessCandidate({ ...metrics, validation: { rankIC: null, meanNetReturn: .01, portfolioPeriods: 5 } }, required);
  assert.equal(unavailable.status, 'conditional'); assert.equal(unavailable.eligible, false);
  assert.equal(unavailable.hardRequirementFailures[0].status, 'unavailable');
  const advisoryUser = assessCandidate(metrics, plan({ evaluationPlan: { thresholds: [threshold({ mode: 'advisory', source: 'user' })] } }));
  assert.equal(advisoryUser.eligible, true);
});

test('subpopulation evidence supports conditional consideration with exact scope, never an invented global score', () => {
  const result = assessCandidate({ validation: { rankIC: null }, diagnostics: { regimes: {
    status: 'partial', field: 'state', thresholdFitEnd: '2024-01-01T00:00:00.000Z',
    strata: [{ status: 'completed', bin: 1, rankIC: .4, observations: 20 }, { status: 'unavailable', bin: 2, rankIC: null, observations: 2 }],
  } } }, plan({}));
  assert.equal(result.status, 'conditional'); assert.equal(result.eligible, true);
  assert.equal(result.measuredEvidence.length, 1);
  assert.equal(result.conditions[0].condition.bin, 1);
  assert.equal(result.measuredEvidence[0].metric, 'diagnostics.regimes.strata.0.rankIC');
  assert.equal(result.score, undefined);
  const none = assessCandidate({ validation: { rankIC: null, coverage: 1 }, diagnostics: { regimes: { status: 'unavailable' } } }, plan({}));
  assert.equal(none.status, 'not-evaluable'); assert.equal(none.eligible, false);
});

test('search and pairwise hard requirements defer until selection, then resolve without borrowing holdout', () => {
  const selectedPlan = plan({ evaluationPlan: { tests: { pbo: true }, thresholds: [threshold({ metric: 'diagnostics.pbo.probability', operator: 'lte', value: .2, source: 'user', mode: 'required' })] } });
  const pending = assessCandidate({ ...metrics, diagnostics: { pbo: { status: 'deferred' } } }, selectedPlan);
  assert.equal(pending.eligible, true); assert.equal(pending.pendingHardRequirements.length, 1);
  const selected = assessCandidate(metrics, selectedPlan, { phase: 'select', searchDiagnostics: { pbo: { status: 'completed', probability: .1 } } });
  assert.equal(selected.eligible, true); assert.equal(selected.pendingHardRequirements.length, 0);
  const absent = assessCandidate(metrics, selectedPlan, { phase: 'select', searchDiagnostics: { pbo: { status: 'unavailable' } } });
  assert.equal(absent.eligible, false);
  const pair = plan({ evaluationPlan: { thresholds: [threshold({ metric: 'redundancy.absoluteCorrelation', operator: 'lte', value: .5, mode: 'required', source: 'user' })] } });
  assert.equal(assessCandidate(metrics, pair).pendingHardRequirements.length, 1);
  assert.equal(assessCandidate(metrics, pair, { phase: 'select', redundancy: { pairCount: 0 } }).eligible, true);
  assert.equal(assessCandidate(metrics, pair, { phase: 'select', redundancy: { pairCount: 1, absoluteCorrelation: null } }).eligible, false);
});

test('plans preserve task reasons, explicit test overrides, stable digest and user requirements', () => {
  const chosen = plan({ diagnostics: { placebo: true, pbo: true }, evaluationPlan: { tests: { placebo: false, dsr: true }, reasons: { dsr: 'Assess multiple search trials' } } });
  assert.deepEqual(chosen.tests, { placebo: false, pbo: true, dsr: true });
  const reordered = { thresholds: [], reasons: chosen.reasons, tests: { dsr: true, pbo: true, placebo: false } };
  assert.equal(planDigest(chosen), planDigest(reordered));
  assert.equal(assessCandidate(metrics, chosen).planDigest, planDigest(chosen));
});

test('invalid/holdout/prototype plans are rejected before evaluation and cannot masquerade as user requirements', () => {
  for (const evaluationPlan of [{ tests: { invented: true } }, { reasons: { dsr: '' } }, { tests: [] }, { magic: true },
    { thresholds: [threshold({ source: 'model' })] }, { thresholds: [threshold({ mode: 'mandatory' })] },
    { thresholds: [threshold({ metric: 'holdout.rankIC' })] }, { thresholds: [threshold({ metric: 'diagnostics.outOfSample.holdout.rankIC' })] },
    { thresholds: [threshold({ metric: 'validation.__proto__.bad' })] }, { thresholds: [threshold({ reason: '' })] },
    { thresholds: [threshold({ value: Infinity })] }]) assert.throws(() => plan({ evaluationPlan }), /plan|threshold|diagnostic|reason/i);
});
