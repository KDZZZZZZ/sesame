import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDataset } from '../engine.js';
import { deflatedSharpeRatio, returnMoments, probabilityOfBacktestOverfitting, evaluateSearchDiagnostics, normalCDF, inverseNormal } from '../search-diagnostics.js';

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const paper = { sharpe: 2.5 / Math.sqrt(250), sampleLength: 1250, skewness: -3, kurtosis: 10, trialSharpeVariance: .5 / 250, independentTrials: 100 };
const field = name => ({ op: 'field', name });
const iso = day => new Date(Date.UTC(2024, 0, day)).toISOString();
function panel() {
  const prices = [100, 100, 100, 100], rows = [];
  for (let day = 1; day <= 65; day++) for (let s = 0; s < 4; s++) {
    rows.push({ time: iso(day), availableAt: iso(day), symbol: `S${s}`, fields: { close: prices[s], signal: s, noise: (s + day) % 4 } });
    prices[s] *= 1 + (s - 1.5) * (.002 + .0005 * Math.sin(day));
  }
  return rows;
}
const prepared = rows => prepareDataset(rows ?? panel(), { trainEnd: iso(16), validationEnd: iso(49), holdoutEnd: iso(65), costBps: 0 });
const candidates = { positive: field('signal'), negative: { op: 'neg', args: [field('signal')] }, noise: field('noise') };

test('normal functions have known quantiles and symmetric probabilities', () => {
  close(inverseNormal(.975), 1.959963984540054, 1e-8);
  close(inverseNormal(.001), -3.090232306167814, 1e-8);
  close(normalCDF(1.959963984540054), .975);
  close(normalCDF(-3), .00134989803163);
  assert.equal(normalCDF(0), .5);
  assert.equal(normalCDF(Infinity), 1);
  assert.equal(normalCDF(-Infinity), 0);
});

test('DSR reproduces the primary paper numerical example, including annualized variance conversion', () => {
  const result = deflatedSharpeRatio(paper);
  assert.equal(result.status, 'completed');
  close(result.benchmarkSharpe, .1132, .00005);
  close(result.probability, .9004, .00015);
  close(deflatedSharpeRatio({ ...paper, independentTrials: 46 }).probability, .9505, .00015);
  close(deflatedSharpeRatio({ ...paper, skewness: 0, kurtosis: 3, independentTrials: 88 }).probability, .9505, .00015);
});

test('DSR includes non-normality and multiplicity, stays bounded, and does not treat it as profit probability', () => {
  const one = deflatedSharpeRatio({ ...paper, independentTrials: 1 });
  const many = deflatedSharpeRatio(paper);
  assert.equal(one.benchmarkSharpe, 0);
  assert.ok(one.probability > many.probability);
  assert.ok(deflatedSharpeRatio({ ...paper, independentTrials: 1000 }).probability < many.probability);
  assert.ok(deflatedSharpeRatio({ ...paper, skewness: 0, kurtosis: 3 }).probability > many.probability);
  for (const sharpe of [-100, -1, 0, 1, 100]) {
    const result = deflatedSharpeRatio({ ...paper, sharpe });
    assert.equal(result.status, 'completed');
    assert.ok(result.probability >= 0 && result.probability <= 1);
    assert.match(result.interpretation, /not the probability of future profit/);
  }
});

test('DSR absence and infeasible/degenerate moments produce reasons without fabricated probability', () => {
  for (const values of [undefined, { ...paper, trialSharpeVariance: -1 }, { ...paper, sampleLength: 2 },
    { ...paper, independentTrials: 0 }, { ...paper, sharpe: Infinity }, { ...paper, kurtosis: 3 },
    { ...paper, sharpe: 1, skewness: 2, kurtosis: 5 }]) {
    const result = deflatedSharpeRatio(values);
    assert.equal(result.status, 'unavailable');
    assert.ok(result.reason); assert.equal(result.probability, undefined);
  }
});

test('return moments use sample SD and Pearson kurtosis, are scale/permutation invariant, and reject missing or constant returns', () => {
  const result = returnMoments([-1, 0, 1]);
  assert.equal(result.sharpe, 0); assert.equal(result.skewness, 0); close(result.kurtosis, 1.5);
  const values = [.01, -.02, .03, .015, -.004, .006];
  const first = returnMoments(values), reordered = returnMoments([...values].reverse()), scaled = returnMoments(values.map(value => value * 1e-100));
  for (const key of ['sharpe', 'skewness', 'kurtosis']) { close(first[key], reordered[key], 1e-12); close(first[key], scaled[key], 1e-12); }
  for (const values of [[], [1, 2], [0, 0, 0], [.1, .1, .1], [1, null, 2], [1, NaN, 2]]) {
    assert.equal(returnMoments(values).status, 'unavailable');
  }
});

// Hand-checkable two-block fixture. A wins in the first block, B in the second;
// each IS winner ranks 1/(2+1) OOS, so both logits are -log(2) and PBO = 1.
const reversal = [[3, -2], [4, -1], [3, -2], [4, -1], [-2, 3], [-1, 4], [-2, 3], [-1, 4]];
test('CSCV known answers: complete rank reversal is 1, persistent winner is 0', async () => {
  const reversed = await probabilityOfBacktestOverfitting(reversal, { blocks: 2, complete: true });
  assert.equal(reversed.status, 'completed'); assert.equal(reversed.probability, 1);
  assert.equal(reversed.totalSplits, 2);
  for (const split of reversed.splitResults) close(split.winners[0].logit, -Math.log(2), 1e-12);
  const persistent = reversal.map((_, index) => [3 + index % 2, -2 + index % 2]);
  const result = await probabilityOfBacktestOverfitting(persistent, { blocks: 4, complete: true });
  assert.equal(result.probability, 0); assert.equal(result.totalSplits, 6); assert.equal(result.discardedPeriods, 0);
});

test('CSCV results are invariant to trial-column permutations, including exact IS ties', async () => {
  const tied = reversal.map((row, i) => [row[0], row[1], i < 4 ? row[0] : row[1]]);
  const first = await probabilityOfBacktestOverfitting(tied, { blocks: 2, complete: true });
  const other = await probabilityOfBacktestOverfitting(tied.map(row => [row[2], row[0], row[1]]), { blocks: 2, complete: true });
  assert.equal(first.status, 'completed'); assert.ok(first.tiedISSplits > 0);
  close(first.probability, other.probability, 1e-15);
  assert.ok(first.probability >= 0 && first.probability <= 1);
  const same = await probabilityOfBacktestOverfitting(reversal.map(row => [row[0], row[0]]), { blocks: 2, complete: true });
  assert.equal(same.probability, 1); assert.equal(same.tiedISSplits, 2);
  assert.match(same.tiePolicy, /median ties as overfit/);
});

test('CSCV cannot infer missing trials/returns or silently discard uneven blocks and degenerate splits', async () => {
  for (const [matrix, options] of [[reversal, {}], [reversal.map(row => [row[0]]), { complete: true }],
    [reversal.map((row, i) => i ? row : [null, 1]), { complete: true }], [reversal.slice(1), { complete: true }],
    [reversal, { complete: true, blocks: 3 }], [reversal, { complete: true, blocks: 6 }],
    [reversal.map((row, i) => [i < 4 ? 1 : row[0], row[1]]), { complete: true, blocks: 2 }]]) {
    const result = await probabilityOfBacktestOverfitting(matrix, options);
    assert.equal(result.status, 'unavailable'); assert.ok(result.reason); assert.equal(result.probability, undefined);
  }
});

test('search diagnostics use all registered trials, include losers, and ignore altered holdout', async () => {
  const plan = { dsr: true, pbo: { blocks: 4 } };
  const result = await evaluateSearchDiagnostics(prepared(), candidates, plan);
  assert.equal(result.dsr.status, 'completed'); assert.equal(result.pbo.status, 'completed');
  assert.deepEqual(result.pbo.trialIds, ['negative', 'noise', 'positive']);
  assert.equal(result.pbo.trials, 3); assert.equal(result.pbo.periods, 32);
  assert.equal(Object.keys(result.dsr.byTrial).length, 3);
  assert.equal(result.dsr.independentTrials, 3);
  assert.equal(result.dsr.riskFreeAssumption, 'zero per diagnostic period');
  assert.match(result.pbo.returnSource, /idealized/);
  const changed = panel().map(row => row.time > iso(49) ? { ...row, fields: { close: 1e100, signal: -999, noise: 1e10 } } : row);
  assert.deepEqual(await evaluateSearchDiagnostics(prepared(changed), candidates, plan), result);
  const reordered = Object.fromEntries(Object.entries(candidates).reverse());
  assert.deepEqual(await evaluateSearchDiagnostics(prepared(), reordered, plan), result);
});

test('failed and excluded trials are retained, never dropped to report an optimistic statistic', async () => {
  const plan = { dsr: true, pbo: true }, dataset = prepared();
  const result = await evaluateSearchDiagnostics(dataset, { ...candidates, empty: { op: 'constant', value: 1 } }, plan,
    { failedTrials: [{ trialId: 'bad', reason: 'invalid AST' }] });
  for (const name of ['dsr', 'pbo']) {
    assert.equal(result[name].status, 'unavailable');
    assert.equal(result[name].attemptedTrialCount, 5);
    assert.deepEqual(result[name].excludedTrials.map(item => item.trialId), ['bad', 'empty']);
    assert.equal(result[name].probability, undefined); assert.equal(result[name].byTrial, undefined);
  }
  const single = await evaluateSearchDiagnostics(dataset, { winner: field('signal') }, plan);
  assert.equal(single.dsr.status, 'unavailable'); assert.equal(single.pbo.status, 'unavailable');
  const differentIntervals = await evaluateSearchDiagnostics(dataset, { ...candidates, late: { op: 'mean', args: [field('close')], window: 25 } }, plan);
  assert.equal(differentIntervals.pbo.status, 'unavailable'); assert.match(differentIntervals.pbo.reason, /synchronous/);
});

test('search diagnostics are opt-in, independent errors remain visible, and cancellation aborts CSCV', async () => {
  assert.deepEqual(await evaluateSearchDiagnostics(prepared(), candidates), { dsr: { status: 'not-requested' }, pbo: { status: 'not-requested' } });
  const invalid = await evaluateSearchDiagnostics(prepared(), candidates, { dsr: { independentTrials: 2 }, pbo: { blocks: 4 } });
  assert.equal(invalid.dsr.status, 'error'); assert.equal(invalid.pbo.status, 'completed');
  const adjusted = await evaluateSearchDiagnostics(prepared(), candidates, { dsr: { independentTrials: 2, reason: 'Task-provided conservative effective count; not estimated by this evaluator.' } });
  assert.equal(adjusted.dsr.independentTrials, 2);
  const controller = new AbortController();
  const matrix = Array.from({ length: 32 }, (_, index) => [Math.sin(index), Math.cos(index), Math.sin(index + 2)]);
  const pending = probabilityOfBacktestOverfitting(matrix, { complete: true, blocks: 16, signal: controller.signal });
  setImmediate(() => controller.abort(new Error('cancel-cscv')));
  await assert.rejects(pending, /cancel-cscv/);
});
