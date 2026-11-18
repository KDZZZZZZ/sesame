import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.SESAME_HOST_ROOT, python = process.env.SESAME_QUANT_PYTHON;
const packages = fileURLToPath(new URL('../packages/', import.meta.url));

function publishBars(artifacts, id, rows) {
  const origin = { kind: 'demo', references: [] };
  return artifacts.publish({ id: 'fixture/development-bars', version: '1.0.0' }, {
    operationId: id, manifest: { kind: 'data', schemaVersion: '1.0.0', dependencies: [], provenance: origin,
      content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: Object.keys(rows[0]), provenance: origin },
      blobs: [{ path: 'rows.json', mediaType: 'application/json', ...artifacts.blob(JSON.stringify(rows)) }] },
  });
}

function demoBars(artifacts, month, slope) {
  const rows = Array.from({ length: 8 }, (_, i) => {
    const price = 100 + slope * i;
    return { datetime: new Date(Date.UTC(2025, month, i + 1)).toISOString(),
      open: String(price), high: String(price + 2), low: String(price - 2), close: String(price), volume: '100000' };
  });
  return publishBars(artifacts, 'development-demo-' + month, rows);
}

test('strategy development runs the native parameter sweep and independent confirmation as separate host workflows', { skip: !root || !python, timeout: 180000 }, async t => {
  const { fixture } = await import(pathToFileURL(join(root, 'tests/fixture-provider.js')));
  const { createHostContextV2 } = await import(pathToFileURL(join(root, 'modules/plugins/host-v2/context.js')));
  const app = await fixture(); t.after(() => app.dispose());
  const runtime = app.runtime, session = 'conv_main', work = runtime.workspaces.root(session);
  for (const name of ['backtrader', 'strategy-development']) {
    const path = join(work, name);
    await cp(join(packages, name), path, { recursive: true });
    const checked = await runtime.plugins.manager.test(session, { path });
    assert.equal(checked.passed, true, JSON.stringify(checked));
    const installed = await runtime.plugins.manager.install(session, { path, digest: checked.digest });
    assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
    runtime.plugins.activate(session, installed.id);
  }
  const main = createHostContextV2(runtime, runtime.capabilities.hostEntry, session);
  const runs = [];
  async function call(name, input) {
    const result = await main.capabilities.invoke('sesame/strategy-development#strategy_development_' + name, input);
    if (name !== 'backtest') { assert.equal(result.type, 'result'); return result.value; }
    assert.equal(result.type, 'run'); runs.push(result.run.id);
    for (;;) {
      const { run, reason } = await main.runs.wait(result.run, { until: 'settled', timeoutMs: 30000 });
      if (reason === 'timeout') continue;
      assert.equal(run.status, 'completed', JSON.stringify(run.error));
      return run.output;
    }
  }
  const plan = await call('plan', { operation_id: 'workflow-plan', goal: '标的为 DEMO。只做多。最大回撤不超过 20%。',
    mandate: { context: [{ source: 'project', evidence: 'Explicit simulation assumptions for the fixture.', fields: {
      capital: { amount: '10000', currency: 'USD' }, costs: { commission: '0.001', slippage: '0.0001' } } }] },
    design: { strategyId: 'fixture.native.sweep' } });
  assert.deepEqual(plan.questions, []);
  const studyBars = publishBars(runtime.contractArtifacts, 'three-breakout-study-bars', [
    { datetime: '2026-01-05T00:00:00Z', open: 96, high: 99, low: 95, close: 97 },
    { datetime: '2026-01-06T00:00:00Z', open: 98, high: 102, low: 97, close: 100 },
    { datetime: '2026-01-07T00:00:00Z', open: 110, high: 112, low: 104, close: 105 },
  ]);
  const study = await call('study', { operation_id: 'breakout-at-design', project_ref: plan.projectRef, development: studyBars,
    study: { method: 'breakout_continuation', side: 'long', lookback: 1, horizon: 1 } });
  const labels = study.evidence.assessment.sides.long.opportunities;
  assert.equal(labels.labeled, 1); assert.equal(labels.rightCensored, 1);
  assert.ok(Math.abs(labels.meanGapOnSignalClose - .10) < 1e-10);
  assert.ok(Math.abs(labels.meanContinuationOnNextOpen + 5 / 110) < 1e-10);
  assert.equal(study.evidence.interpretation.long.observation, 'favorable_gap_without_positive_mean_continuation');
  assert.equal(study.stage, 'strategy_design'); assert.ok(study.next.includes(study.evidence.interpretation.long.nextTest));
  const reopenedStudy = await call('read', { project_ref: study.projectRef });
  assert.deepEqual(reopenedStudy.designEvidence, study.evidence);
  assert.deepEqual(reopenedStudy.project.designStudy.recordedFrom, plan.projectRef);
  assert.equal(reopenedStudy.validation.strategy.nativeSelectionRef, null);
  const source = 'import backtrader as bt\nclass RoundTrip(bt.Strategy):\n    params = (("lots", 1),)\n    def next(self):\n        if len(self) == 1:\n            self.buy(size=self.p.lots)\n        elif len(self) == 5:\n            self.close()\n';
  const strategyPath = join(work, 'authored-round-trip.py');
  await writeFile(strategyPath, source);
  const built = await call('build', { operation_id: 'workflow-build', project_ref: plan.projectRef, native_source_path: 'authored-round-trip.py' });
  assert.equal(built.implementation.nativeSourceRef.kind, 'resource');
  // Only the persisted source may travel from the main workspace into a new workflow.
  await writeFile(strategyPath, 'raise RuntimeError("stale mutable source")\n');
  const development = demoBars(runtime.contractArtifacts, 0, 2);
  const base = await call('backtest', { operation_id: 'workflow-development', project_ref: built.projectRef,
    experiment: { backend: 'backtrader', class_name: 'RoundTrip', development, python_path: python,
      config: { feed: { timeframe: 'days', compression: 1 } }, parameter_space: { lots: [1, 2, 3] }, max_trials: 3 } });
  assert.equal(base.experiment.status, 'selected', JSON.stringify(base.experiment.gaps));
  assert.equal(base.experiment.counts.completed, 3); assert.equal(base.experiment.holdout, null);
  assert.deepEqual(base.experiment.best.parameters, { lots: 3 }); assert.ok(base.experiment.best.metrics.netReturn > 0);
  const observed = await call('read', { project_ref: base.projectRef, trade_page: { limit: 1 } });
  const original = observed.project;
  assert.equal(observed.diagnostics.tradePath.coverage.measured, 1);
  assert.equal(observed.diagnostics.tradePath.trades[0].direction, 'long');
  assert.ok(observed.diagnostics.tradePath.activity.commission > 0);
  assert.equal(original.protocol.config.capital, '10000'); assert.equal(original.protocol.config.commission, '0.001'); assert.equal(original.protocol.config.slippage, '0.0001');
  assert.deepEqual(original.protocol.constraints, [{ metric: 'maxDrawdown', op: '<=', value: .2 }]);
  assert.deepEqual(original.protocol.objective, { metric: 'netReturn', direction: 'maximize' });
  assert.deepEqual(original.mandateRef, plan.mandateRef);
  const holdout = demoBars(runtime.contractArtifacts, 2, -2);
  const confirmed = await call('backtest', { operation_id: 'workflow-confirmation', project_ref: base.projectRef,
    experiment: { backend: 'backtrader', selection_ref: base.experiment.selectionRef, holdout, python_path: python } });
  assert.equal(confirmed.experiment.holdout?.status, 'completed', JSON.stringify(confirmed.experiment.gaps));
  assert.equal(confirmed.stage, 'review'); assert.equal(confirmed.validation.strategy.holdout, 'completed');
  assert.deepEqual(confirmed.experiment.selectionRef, base.experiment.selectionRef);
  assert.deepEqual(confirmed.experiment.best, base.experiment.best);
  assert.ok(confirmed.experiment.holdout.metrics.netReturn < 0);
  assert.equal(new Set(runs).size, 2);
  const retained = (await call('read', { project_ref: confirmed.projectRef })).project;
  assert.deepEqual(retained.previousRef, base.projectRef); assert.deepEqual(retained.consumedHoldouts.map(item => item.ref), [holdout]);
  const compared = await call('compare', { baseline: base.projectRef, candidate: confirmed.projectRef });
  assert.equal(compared.status, 'compared'); assert.equal(compared.partition, 'development');
  assert.deepEqual(compared.arms.B.metrics, base.experiment.best.metrics);
  assert.equal(compared.comparisons.candidateMinusBaseline.delta.netReturn, 0);
  assert.equal(compared.opportunityCost.status, 'observed_entry_time_difference');
  const reused = await call('backtest', { operation_id: 'workflow-stale-branch', project_ref: base.projectRef,
    experiment: { backend: 'backtrader', selection_ref: base.experiment.selectionRef, holdout, python_path: python } });
  assert.equal(reused.stage, 'diagnosis'); assert.equal(reused.experiment.status, 'blocked');
  assert.equal(reused.experiment.gaps[0].code, 'PARTITION_ALREADY_OBSERVED');
  assert.equal(reused.experiment.holdout, null);
  const studiedHoldout = await call('backtest', { operation_id: 'previously-studied-holdout', project_ref: base.projectRef,
    experiment: { backend: 'backtrader', selection_ref: base.experiment.selectionRef, holdout: studyBars, python_path: python } });
  assert.equal(studiedHoldout.experiment.gaps[0].code, 'PARTITION_ALREADY_OBSERVED');
  const fixed = await call('backtest', { operation_id: 'workflow-fixed-rule', project_ref: built.projectRef,
    experiment: { backend: 'backtrader', class_name: 'RoundTrip', development, python_path: python,
      config: { feed: { timeframe: 'days', compression: 1 } }, parameters: { lots: 3 }, parameter_space: {}, max_trials: 1 } });
  assert.equal(fixed.experiment.status, 'selected', JSON.stringify(fixed.experiment.gaps));
  assert.deepEqual(fixed.experiment.best.metrics, base.experiment.best.metrics);
  assert.equal(fixed.experiment.batches[0].method, 'backtrader_backtest');
  const ledgers = await call('compare', { baseline: fixed.projectRef, candidate: base.projectRef, retuned: true });
  assert.equal(ledgers.opportunityCost.status, 'observed_entry_time_difference');
  assert.equal(ledgers.opportunityCost.matchedEntries, 1);
  assert.ok(ledgers.opportunityCost.sourceRefs.every(ref => ref.kind === 'data'));
  // A mechanism can work while the investment objective deteriorates.
  const trend = await call('plan', { operation_id: 'buffer-plan', goal: '研究单一模拟股票的调仓成本。',
    mandate: { context: [{ source: 'assumption', evidence: 'Same simulated account and proportional costs for both trials.', fields: {
      capital: { amount: '100000', currency: 'USD' }, costs: { commission: '0.001', slippage: '0.0005' } } }] } });
  const template = await call('build', { operation_id: 'buffer-build', project_ref: trend.projectRef, native_template: 'forecast_buffer' });
  assert.equal(template.implementation.nativeTemplate, 'forecast_buffer'); assert.ok(template.implementation.nativeSourcePath.endsWith('.py'));
  const rows = [];
  for (let i = 0; i < 160; i++) {
    const close = 100 + .06 * i + 4 * Math.sin(i / 9) + .8 * Math.sin(i * .73), open = Number(rows.at(-1)?.close ?? close);
    rows.push({ datetime: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(), open: String(open), high: String(Math.max(close, open) + 1),
      low: String(Math.min(close, open) - 1), close: String(close), volume: '100000' });
  }
  const settings = { fast_span: 3, slow_span: 12, vol_window: 6, forecast_scale: 2, daily_risk_target: .003, daily_risk_limit: .01,
    max_exposure: .8, cash_reserve: .05, halt_drawdown: .5, buffer_mode: 'forecast', trade_to_edge: true, buffer_fraction: 0 };
  const a = await call('backtest', { operation_id: 'buffer-A', project_ref: template.projectRef,
    experiment: { backend: 'backtrader', development: publishBars(runtime.contractArtifacts, 'trend-bars', rows), python_path: python,
      config: { feed: { timeframe: 'days', compression: 1 } }, parameters: settings, parameter_space: {}, max_trials: 1 } });
  assert.equal(a.experiment.status, 'selected', JSON.stringify(a.experiment.gaps));
  const decision = await call('plan', { operation_id: 'buffer-decision', project_ref: a.projectRef, parameter_trial: {
    parameter: 'buffer_fraction', to: .1, component: 'execution', hypothesis: 'Allowing small deviations should reduce two-sided traded notional.',
    primary: 'turnover', direction: 'minimize' } });
  assert.equal(decision.stage, 'test_single_change'); assert.deepEqual(decision.parameterTrial.baselineRef, a.projectRef);
  const b = await call('backtest', { operation_id: 'buffer-B', project_ref: decision.projectRef, experiment: { backend: 'backtrader', planned_trial: true } });
  assert.equal(b.experiment.status, 'selected', JSON.stringify(b.experiment.gaps));
  const change = await call('compare', { baseline: a.projectRef, candidate: b.projectRef });
  assert.equal(change.comparisons.candidateMinusBaseline.attribution, 'predeclared_parameter_change', JSON.stringify(change.comparisons));
  assert.equal(change.interventionOutcome.outcome, 'supported_on_development', JSON.stringify(change.interventionOutcome));
  assert.equal(change.interventionOutcome.mandateObjective.outcome, 'declined');
  assert.ok(change.comparisons.candidateMinusBaseline.executionDelta.commission < 0);
  t.diagnostic(JSON.stringify({ fixture: 'synthetic daily stock', A: change.arms.A.metrics, B: change.arms.B.metrics,
    execution: change.comparisons.candidateMinusBaseline.executionDelta }));
  assert.equal(runtime.plugins.entries.has('sesame/auto-factor-mining'), false);
});
