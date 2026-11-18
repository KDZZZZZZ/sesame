import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compareProjects, diagnoseProject, loadTradeEvidence } from '../methods.js';
import { evaluateTrialMeasure, fixedTrialExperiment, planParameterTrial } from '../revision-trial.js';

const ref = (id, kind = 'resource') => ({ id, revision: '1', kind, schemaVersion: '1.0.0', digest: 'sha256:' + createHash('sha256').update(id).digest('hex') });
const project = (id, model, netReturn = .1, closedTrades = 2) => ({
  goal: 'Test a rule', version: 1, mandateRef: ref('mandate'), mandate: { questions: [], fields: { maxDrawdown: .2 } },
  structure: { mode: 'framework', components: { alpha: { model }, risk: { model: 'mandate_limits' } }, factors: [], bindings: {} },
  protocol: { backend: 'backtrader', development: ref('development', 'data'), config: { capital: '100', commission: '0.001', slippage: '0', feed: { timeframe: 'days', compression: 1 } },
    constraints: [{ metric: 'maxDrawdown', op: '<=', value: .2 }], objective: { metric: 'netReturn', direction: 'maximize' }, parameter_space: { n: [5, 10] }, parameters: {}, max_trials: 2 },
  implementation: { nativeSourceRef: ref(id + '-native'), nativeHash: ref(id + '-code').digest },
  experiment: { status: 'selected', protocolRef: ref(id + '-protocol'), selectionRef: ref(id + '-selection'),
    best: { parameters: { n: 5 }, metrics: { netReturn, maxDrawdown: .1, finalEquity: 100 * (1 + netReturn), closedTrades }, batchResultRef: ref(id + '-result', 'strategy.result') },
    counts: { planned: 2, completed: 2, eligible: 2 } },
});

test('A/B/C/D deltas use frozen development evidence, distinguish a matched count and ignore holdout ranking', () => {
  const a = project('A', 'close_threshold', .1), b = project('B', 'moving_average', .2), c = project('C', 'close_threshold', .15), d = project('D', 'close_threshold', .12);
  b.experiment.holdout = { status: 'constraints-failed', metrics: { netReturn: -.8 } };
  b.experiment.status = 'failed';
  const result = compareProjects({ baseline: a, candidate: b, matched: c, ablation: d });
  assert.equal(result.status, 'compared'); assert.equal(result.partition, 'development');
  assert.equal(result.arms.B.metrics.netReturn, .2);
  assert.equal(result.comparisons.candidateMinusBaseline.delta.netReturn, .1);
  assert.equal(result.comparisons.candidateMinusBaseline.objective.outcome, 'improved');
  assert.deepEqual(result.comparisons.candidateMinusBaseline.changes, ['component.alpha']);
  assert.equal(result.comparisons.candidateMinusBaseline.attribution, 'single_declared_change');
  assert.equal(result.comparisons.candidateMinusMatched.matchedOnClosedTradeCount, true);
  assert.equal(result.comparisons.candidateMinusMatched.exposureMatchVerified, false);
  assert.ok(Math.abs(result.comparisons.candidateMinusAblation.delta.netReturn - .08) < 1e-10);
  assert.equal(result.opportunityCost.status, 'needs_trade_evidence');
});

test('changed protocol, costs, columns, mandate and actual selected parameters produce explicit mismatches', () => {
  const a = project('A', 'close_threshold'), b = project('B', 'moving_average');
  b.protocol.config.commission = '0.002'; b.protocol.columns = { close: 'adjclose' }; b.protocol.development = ref('other', 'data');
  b.mandateRef = ref('new-mandate'); b.experiment.best.parameters.n = 10;
  let result = compareProjects({ baseline: a, candidate: b });
  assert.equal(result.status, 'not_comparable');
  assert.deepEqual(result.comparisons.candidateMinusBaseline.mismatch.toSorted(), ['columns', 'config', 'development', 'mandate', 'selectedParameters']);
  assert.equal(result.comparisons.candidateMinusBaseline.delta, undefined);
  b.protocol = structuredClone(a.protocol); b.mandateRef = a.mandateRef;
  result = compareProjects({ baseline: a, candidate: b, retuned: true });
  assert.equal(result.status, 'compared'); assert.equal(result.comparisons.candidateMinusBaseline.attribution, 'retuned_system');
  b.experiment.best.parameters.n = a.experiment.best.parameters.n;
  b.protocol.selection = { method: 'stable_region' };
  assert.deepEqual(compareProjects({ baseline: a, candidate: b }).comparisons.candidateMinusBaseline.mismatch, ['selection']);
  assert.deepEqual(compareProjects({ baseline: a, candidate: b, retuned: true }).comparisons.candidateMinusBaseline.selectionMethods,
    { from: { method: 'point_best' }, to: b.protocol.selection, changed: true });
  b.protocol.constraints[0].value = .3;
  assert.equal(compareProjects({ baseline: a, candidate: b, retuned: true }).status, 'not_comparable');
});

test('multiple design interventions, purely declared changes and partial trials get distinct feedback', () => {
  const a = project('A', 'close_threshold'), b = project('B', 'moving_average');
  b.structure.components.risk.model = 'new-stop';
  assert.equal(compareProjects({ baseline: a, candidate: b }).comparisons.candidateMinusBaseline.attribution, 'multiple_changes');
  b.structure.components.risk.model = 'mandate_limits'; b.implementation.nativeHash = a.implementation.nativeHash;
  assert.equal(compareProjects({ baseline: a, candidate: b }).comparisons.candidateMinusBaseline.attribution, 'native_change_unverified');
  b.experiment.counts.completed--;
  const incomplete = compareProjects({ baseline: a, candidate: b });
  assert.equal(incomplete.status, 'needs_evidence'); assert.equal(incomplete.comparisons.candidateMinusBaseline.delta, undefined);
  b.experiment = { factorScore: .78 };
  assert.equal(compareProjects({ baseline: a, candidate: b }).status, 'needs_evidence');
});

function source(p, transactions, { fixed = false, nativeParams = p.experiment.best.parameters, orders, bars, equity, env, unpinnedEnv = false } = {}) {
  const resultRef = p.experiment.best.batchResultRef, name = fixed ? 'trades' : 'passes', table = ref(resultRef.id + '-' + name, 'data');
  const inputsRef = ref(resultRef.id + '-inputs'), nativeSource = p.implementation.nativeSourceRef;
  const envRef = ref(resultRef.id + '-env', 'environment');
  if (env) envRef.digest = ref(JSON.stringify(env)).digest;
  const statistics = { finalEquity: p.experiment.best.metrics.finalEquity, closedTrades: transactions.length };
  const rows = fixed ? transactions : [{ status: 'completed', parameters: nativeParams, statistics, trades: transactions, orders, equity }];
  const tables = [{ id: name, ref: table, rows }];
  if (fixed && orders) tables.push({ id: 'orders', ref: ref(resultRef.id + '-orders', 'data'), rows: orders });
  if (fixed && equity) tables.push({ id: 'equity', ref: ref(resultRef.id + '-equity', 'data'), rows: equity });
  const calls = [];
  return { calls, resources: { async read(key, options) {
    calls.push([key.id, options.part]);
    if (key.id === resultRef.id && options.part === 'metadata') return { producer: { id: 'sesame/backtrader' }, ref: resultRef };
    if (key.id === resultRef.id) return { dependencies: [inputsRef, ...tables.map(t => t.ref), ...(env && !unpinnedEnv ? [envRef] : [])], content: { status: 'completed', inputs: [p.protocol.development], nativeSource,
      ...(env ? { environment: envRef, engine: { name: fixed ? 'Backtrader Cerebro' : 'Backtrader Cerebro.optstrategy', version: '1.9.78.123' } } : {}),
      ...(fixed ? { statistics, assumptions: inputsRef } : { optimizer: { native: true, method: 'Cerebro.optstrategy' } }), data: tables.map(({ id, ref }) => ({ id, ref })) } };
    if (key.id === envRef.id) {
      if (options.part === 'metadata') return { producer: { id: 'sesame/backtrader' }, ref: envRef };
      if (options.part === 'manifest') return { content: { type: 'backtrader-environment', execution: 'host', version: '1.9.78.123', path: 'environment.json' } };
      const json = Buffer.from(JSON.stringify(env)); return { content: json.toString('base64'), total: json.byteLength };
    }
    if (key.id === inputsRef.id) return { content: { type: 'backtrader-inputs', data: p.protocol.development, parameters: nativeParams, nativeSource } };
    const values = key.id === p.protocol.development.id ? bars : tables.find(t => t.ref.id === key.id)?.rows;
    assert.ok(values);
    const json = Buffer.from(JSON.stringify(values));
    return options.part === 'manifest' ? { content: { format: 'json-rows', rowCount: values.length, path: 'rows.json' } } : { content: json.toString('base64'), total: json.byteLength };
  } } };
}
const trade = (day, gross, net) => ({ openTime: '2024-01-' + day + 'T09:00:00Z', closeTime: '2024-02-01T16:00:00Z', pnl: String(gross), pnlAfterCommission: String(net) });

test('planned attribution compares the pinned runtime versions independent of paths and discloses an already-observed intervention', async () => {
  const a = project('A', 'baseline', .1, 0), b = project('B', 'baseline', .2, 0);
  a.projectRef = ref('project-A'); b.projectRef = ref('project-B'); b.implementation = a.implementation;
  const trial = planParameterTrial(a, a.projectRef, { component: 'portfolio', parameter: 'n', to: 10, hypothesis: 'Longer duration improves return.', primary: 'netReturn', direction: 'maximize' });
  assert.equal(trial.alreadyTestedOnBaselineGrid, true);
  b.parameterTrial = trial; b.protocol = fixedTrialExperiment(a, trial);
  b.experiment.counts = { planned: 1, completed: 1, eligible: 1 }; b.experiment.best.parameters = b.protocol.parameters;
  const engine = '1.9.78.123', env = { version: [3, 12, 1], platform: 'linux', bits: 64, library: engine,
    python: '/usr/bin/python', packages: { backtrader: engine, 'Example_Lib': '1.4' } };
  a.tradeEvidence = await loadTradeEvidence(source(a, [], { env }), a);
  const alias = { ...env, python: '/usr/local/bin/alternate', origin: 'different-selection', packages: { 'example.lib': '1.4', BackTrader: engine } };
  async function compare(native) {
    b.tradeEvidence = await loadTradeEvidence(source(b, [], { fixed: true, ...native }), b);
    return compareProjects({ baseline: a, candidate: b });
  }
  const matched = await compare({ env: alias }), pair = matched.comparisons.candidateMinusBaseline;
  assert.equal(matched.status, 'compared'); assert.equal(pair.trial.environment.status, 'matched');
  assert.equal(pair.trial.environment.basis, 'recorded_version_fingerprint');
  assert.notDeepEqual(pair.trial.environment.baseline.ref, pair.trial.environment.candidate.ref);
  assert.equal(matched.selection, 'previously_tested_parameter_change'); assert.equal(evaluateTrialMeasure(matched).outcome, 'observed_on_grid_retest');
  for (const changes of [{ version: [3, 12, 2] }, { platform: 'win32' }, { bits: 32 }, { packages: { ...env.packages, 'Example_Lib': '1.5' } }]) {
    const changed = await compare({ env: { ...env, ...changes } });
    assert.equal(changed.status, 'not_comparable'); assert.equal(changed.comparisons.candidateMinusBaseline.trial.environment.status, 'different');
    assert.equal(changed.comparisons.candidateMinusBaseline.trial.verified, false); assert.equal(evaluateTrialMeasure(changed), undefined);
  }
  for (const missing of [{}, { env: { ...env, packages: {} } }, { env: { ...env, packages: { ...env.packages, 'example-lib': '9' } } }, { env, unpinnedEnv: true }]) {
    const unresolved = await compare(missing); assert.equal(unresolved.status, 'needs_evidence');
    assert.equal(unresolved.comparisons.candidateMinusBaseline.trial.environment.status, 'needs_evidence');
    assert.equal(evaluateTrialMeasure(unresolved), undefined); assert.equal(b.tradeEvidence.status, 'observed');
  }
  const ambiguous = { ...env, packages: { ...env.packages, 'example-lib': '9', null: null } };
  a.tradeEvidence = await loadTradeEvidence(source(a, [], { env: ambiguous }), a);
  const sameSnapshot = (await compare({ env: ambiguous })).comparisons.candidateMinusBaseline.trial.environment;
  assert.equal(sameSnapshot.status, 'matched'); assert.equal(sameSnapshot.basis, 'identical_pinned_environment_snapshot');
  assert.equal(sameSnapshot.baseline.incompleteEntries, 1); assert.deepEqual(sameSnapshot.baseline.conflictingDistributions, ['example-lib']);
  assert.equal(sameSnapshot.baseline.ref.digest, sameSnapshot.candidate.ref.digest); assert.notEqual(sameSnapshot.baseline.ref.id, sameSnapshot.candidate.ref.id);
  assert.equal((await compare({ env: { ...ambiguous, python: '/unidentified/other' } })).status, 'needs_evidence');
  const noCore = { ...ambiguous, library: null };
  a.tradeEvidence = await loadTradeEvidence(source(a, [], { env: noCore }), a);
  assert.equal((await compare({ env: noCore })).status, 'needs_evidence');
});

test('a single fixed baseline uses the pinned trades table and checks the parameters that actually ran', async () => {
  const p = project('A', 'a', .1, 1);
  p.protocol.parameter_space = {}; p.protocol.max_trials = 1;
  p.experiment.counts = { planned: 1, completed: 1, eligible: 1 };
  const trades = [trade('01', 10, 8)];
  const ledger = await loadTradeEvidence(source(p, trades, { fixed: true }), p);
  assert.equal(ledger.status, 'observed'); assert.equal(ledger.closed[0].net, 8);
  assert.equal(ledger.tableRef.id, 'A-result-trades');
  const mismatch = await loadTradeEvidence(source(p, trades, { fixed: true, nativeParams: { n: 99 } }), p);
  assert.equal(mismatch.status, 'unavailable');
  assert.match(mismatch.reason, /differs from the selected/);
});

test('native closed-trade receipts distinguish absent winning and losing entry bars from confirmed filter causation', async () => {
  const a = project('A', 'a', -.1, 3), b = project('B', 'b', .1, 1);
  const ah = source(a, [trade('01', 8, 4), trade('02', 20, 8), trade('03', -20, -25)]);
  a.tradeEvidence = await loadTradeEvidence(ah, a);
  b.tradeEvidence = await loadTradeEvidence(source(b, [trade('01', 8, 4)]), b);
  assert.equal(a.tradeEvidence.status, 'observed');
  const { opportunityCost } = compareProjects({ baseline: a, candidate: b });
  assert.equal(opportunityCost.matchedEntries, 1); assert.equal(opportunityCost.baselineOnlyLosses, 1);
  assert.equal(opportunityCost.baselineOnlyProfits, 1); assert.equal(opportunityCost.baselineOnlyNetPnl, -17);
  assert.equal(opportunityCost.confirmedFilteredLosses, null); assert.equal(opportunityCost.confirmedMissedProfits, null);
  assert.ok(diagnoseProject(a).findings.some(item => item.code === 'closed_trade_cost_drag'));
  assert.equal(diagnoseProject(a).nextRevision.component, 'execution');
  b.tradeEvidence = await loadTradeEvidence(source(b, []), b);
  assert.equal(b.tradeEvidence.status, 'unavailable'); assert.equal(compareProjects({ baseline: a, candidate: b }).opportunityCost.status, 'needs_trade_evidence');
});

test('reducing the selected drawdown objective improves its comparison even when total return declines', () => {
  const a = project('A', 'a', .2), b = project('B', 'b', .1);
  for (const p of [a, b]) p.protocol.objective = { metric: 'maxDrawdown', direction: 'minimize' };
  b.experiment.best.metrics.maxDrawdown = .05;
  const result = compareProjects({ baseline: a, candidate: b });
  assert.equal(result.comparisons.candidateMinusBaseline.objective.outcome, 'improved');
  assert.ok(result.comparisons.candidateMinusBaseline.delta.netReturn < 0);
});

test('diagnosis uses known problems, archival holdout evidence and minimal next edits', () => {
  const p = project('A', 'moving_average', .15, 0);
  p.experiment.status = 'failed';
  p.experiment.holdout = { status: 'constraints-failed', resultRef: ref('holdout', 'strategy.result'), recordRef: ref('signed-holdout'),
    metrics: { netReturn: -.2, maxDrawdown: .24, closedTrades: 1, finalEquity: 80 }, violations: p.protocol.constraints };
  const result = diagnoseProject(p);
  assert.ok(result.findings.some(item => item.code === 'no_closed_trades'));
  assert.equal(result.nextRevision.reason, 'holdout_deterioration');
  assert.ok(result.checks.some(item => item.includes('warm-up')));
  assert.equal(result.findings.find(item => item.code === 'holdout_deterioration').evidence.length, 2);
  delete p.experiment.holdout.recordRef;
  assert.equal(diagnoseProject(p).findings.some(item => item.code === 'holdout_deterioration'), false);
});

test('public diagnostic and comparison views expose fixed and grid native paths, turnover and one exit hypothesis', async () => {
  const a = project('A', 'a', -.01, 1), b = project('B', 'b', -.02, 1);
  const bar = (day, high, low) => ({ datetime: '2024-01-0' + day + 'T00:00:00Z', high, low });
  const bars = [bar(1, 1000, 1), bar(2, 108, 97), bar(3, 500, 1)];
  for (const [i, p] of [a, b].entries()) {
    const size = i + 1;
    const fixed = !i;
    if (fixed) { p.protocol.parameter_space = {}; p.protocol.max_trials = 1; p.experiment.counts = { planned: 1, completed: 1, eligible: 1 }; }
    const transactions = [{ tradeId: 'T', openTime: bars[0].datetime, closeTime: bars[2].datetime, pnl: String(-size), pnlAfterCommission: String(-size - 2) }];
    const orders = [0, 2].map((j, n) => ({ orderId: String(j), status: 'Completed', size: String(n ? -size : size),
      executedTime: bars[j].datetime, executedSize: String(n ? -size : size), executedPrice: String(n ? 99 : 100), commission: 1 }));
    const equity = bars.map((r, n) => ({ time: r.datetime, value: n === 2 ? p.experiment.best.metrics.finalEquity : 100 }));
    const h = source(p, transactions, { fixed, orders, bars, equity }); p.tradeEvidence = await loadTradeEvidence(h, p);
    assert.ok(h.calls.some(([id]) => id === 'development')); assert.equal(p.tradeEvidence.tradePath.coverage.measured, 1);
  }
  const d = diagnoseProject(a);
  assert.equal(d.tradePath.trades[0].mfePrice, 8); assert.equal(d.tradePath.trades[0].maePrice, 3);
  assert.equal(d.nextRevision.reason, 'observed_favorable_move_given_back');
  const comparison = compareProjects({ baseline: a, candidate: b, retuned: true });
  assert.equal(comparison.arms.A.tradePath.coverage.measured, 1); assert.equal(comparison.arms.B.tradePath.trades, undefined);
  assert.equal(comparison.comparisons.candidateMinusBaseline.executionDelta.grossTradedNotional, 199);
  assert.equal(comparison.comparisons.candidateMinusBaseline.executionDelta.commission, 0);
});
