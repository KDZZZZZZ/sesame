import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '@sesame/plugin-sdk/protocol';
import { assessParameterTrial, evaluateTrialMeasure, fixedTrialExperiment, planParameterTrial } from '../revision-trial.js';

const ref = (id, kind = 'resource') => ({ id, revision: '1', digest: digest(id), schemaVersion: '1.0.0', kind });
const environment = (id, nativeResultRef) => ({ status: 'observed', ref: ref(id, 'environment'), nativeResultRef, fingerprint: digest('same packages and interpreter') });
const a = { projectRef: ref('baseline'), mandateRef: ref('mandate'), implementation: { nativeHash: digest('code') }, structure: {},
  protocol: { backend: 'backtrader', class_name: 'Forecast', development: ref('development'), config: { commission: '0.001' }, holdout: ref('used'),
    parameter_space: { forecast: [1, 2, 3, 4, 5], buffer: [0, .2, .4] }, selection: { method: 'neighborhood_worst' } },
  experiment: { selectionRef: ref('selection'), best: { parameters: { buffer: 0, forecast: 3 }, batchResultRef: ref('baseline-native', 'strategy.result') }, counts: { planned: 15, completed: 15 } } };
a.tradeEvidence = { environment: environment('a-env', a.experiment.best.batchResultRef) };
const terms = { parameter: 'buffer', to: .1, component: 'portfolio', hypothesis: 'Fewer small rebalances reduce turnover.', primary: 'turnover', direction: 'minimize' };

test('a planned intervention freezes source, class, one parameter and controls; an old holdout or optimizer cannot enter the new experiment', () => {
  const trial = planParameterTrial(a, a.projectRef, terms);
  assert.equal(trial.from, 0); assert.equal(trial.baselineWasSelected, true); assert.equal(trial.alreadyTestedOnBaselineGrid, false);
  assert.equal(planParameterTrial(a, a.projectRef, { ...terms, to: .2 }).alreadyTestedOnBaselineGrid, true);
  const protocol = fixedTrialExperiment(a, trial);
  assert.equal(protocol.holdout, undefined); assert.equal(protocol.selection, undefined);
  assert.deepEqual(protocol.parameters, { forecast: 3, buffer: .1 });
  const b = { ...a, projectRef: ref('candidate'), parameterTrial: trial, protocol,
    experiment: { selectionRef: ref('B'), best: { parameters: protocol.parameters, batchResultRef: ref('candidate-native', 'strategy.result') }, counts: { completed: 1 } } };
  b.tradeEvidence = { environment: environment('b-env', b.experiment.best.batchResultRef) };
  assert.equal(assessParameterTrial(a, b).verified, true);
  assert.equal(assessParameterTrial(a, { ...b, tradeEvidence: a.tradeEvidence }).environment.status, 'needs_evidence');
  assert.equal(assessParameterTrial({ ...a, projectRef: ref('other-control') }, b), null);
  assert.ok(assessParameterTrial(a, { ...b, protocol: { ...protocol, class_name: 'OtherStrategy' } }).issues.includes('class_name'));
  assert.throws(() => planParameterTrial(a, a.projectRef, { ...terms, parameter: 'omitted-default' }), /explicit value/);
});

test('a predicted reduction in turnover can succeed while the investment objective declines; unavailable evidence is identified', () => {
  const pair = { trial: { ...terms, verified: true, alreadyTestedOnBaselineGrid: false }, executionDelta: { turnoverOnInitialEquity: -4 }, objective: { outcome: 'declined' }, delta: { netReturn: -.01 } };
  const comparison = { status: 'compared', comparisons: { candidateMinusBaseline: pair }, arms: { A: { nativeResultRef: ref('A') }, B: { nativeResultRef: ref('B') } } };
  assert.equal(evaluateTrialMeasure(comparison).outcome, 'supported_on_development');
  assert.equal(evaluateTrialMeasure(comparison).mandateObjective.outcome, 'declined');
  pair.trial.alreadyTestedOnBaselineGrid = true;
  assert.equal(evaluateTrialMeasure(comparison).outcome, 'observed_on_grid_retest'); assert.equal(evaluateTrialMeasure(comparison).directionalObservation, 'matched');
  delete pair.trial.alreadyTestedOnBaselineGrid;
  assert.equal(evaluateTrialMeasure(comparison).outcome, 'prior_grid_exposure_unknown');
  pair.executionDelta = null;
  assert.equal(evaluateTrialMeasure(comparison).outcome, 'needs_evidence');
});
