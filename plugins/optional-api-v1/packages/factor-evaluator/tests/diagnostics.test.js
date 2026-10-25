import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDataset, evaluateFactor, factorEvidence, compareFactors } from '../engine.js';
import { DIAGNOSTICS, evaluateCandidate, evaluateDiagnostics } from '../diagnostics.js';

const iso = day => new Date(Date.UTC(2024, 0, day)).toISOString();
const field = name => ({ op: 'field', name });
const splits = (extra = {}) => ({ trainEnd: iso(80), validationEnd: iso(160), holdoutEnd: iso(240), costBps: 0, ...extra });
function panel({ symbols = 1, days = 240 } = {}) {
  const rows = [], prices = Array(symbols).fill(100);
  let state = 1729;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let day = 1; day <= days; day++) for (let symbol = 0; symbol < symbols; symbol++) {
    const signal = random() * 2 - 1, noise = random() * 2 - 1;
    rows.push({ time: iso(day), availableAt: iso(day), symbol: `S${symbol}`, fields: {
      close: prices[symbol], signal, noise, volatility: Math.abs(signal), state: day % 7,
    } });
    prices[symbol] *= 1 + signal * .002;
  }
  return rows;
}
const data = extra => prepareDataset(panel(), splits(extra));
const cheap = { samples: 39, seed: 17, blockSize: 3 };

test('one symbol automatically uses temporal association and fixed training thresholds', () => {
  const dataset = data(), positive = evaluateFactor(dataset, field('signal'));
  assert.equal(dataset.config.mode, 'time-series');
  assert.equal(positive.validation.rankIC, 1);
  assert.equal(positive.protocol.minAssets, 1);
  assert.equal(positive.validation.rankICIR, null);
  assert.equal(positive.validation.thresholdFitEnd, dataset.config.trainEnd);
  assert.ok(positive.validation.meanNetReturn > 0);
  assert.ok(!Object.hasOwn(positive.validation, 'winRate'));
  assert.equal(compareFactors(dataset, field('signal'), { op: 'neg', args: [field('signal')] }).correlation, -1);
  const altered = panel().map(row => row.time > dataset.config.trainEnd ? { ...row, fields: { ...row.fields, signal: 99 } } : row);
  const other = prepareDataset(altered, splits());
  assert.deepEqual(factorEvidence(dataset, field('signal')).thresholds, factorEvidence(other, field('signal')).thresholds);
});

test('explicit multi-symbol temporal mode measures each symbol then averages, without pooling', () => {
  const rows = panel({ symbols: 2 });
  for (const row of rows) if (row.symbol === 'S1') row.fields.signal *= -1;
  const dataset = prepareDataset(rows, splits({ mode: 'time-series' }));
  const result = evaluateFactor(dataset, field('signal')).validation;
  assert.equal(result.rankIC, 0);
  assert.deepEqual(result.perSymbol.map(item => item.rankIC), [1, -1]);
  assert.equal(result.validICSeries, 2);
  assert.equal(result.rankICMethod, 'equal-weight-per-symbol-time-series-spearman');
});

test('optional diagnostics are not requested by default; all unmeasurable stays unmeasurable', async () => {
  const measured = await evaluateCandidate(data(), field('signal'));
  assert.deepEqual(Object.keys(measured.diagnostics), Object.keys(DIAGNOSTICS));
  assert.ok(Object.values(measured.diagnostics).every(item => item.status === 'not-requested'));
  const result = await evaluateDiagnostics(data(), { op: 'constant', value: 1 }, { placebo: true, bootstrap: true });
  assert.equal(result.placebo.status, 'unavailable');
  assert.equal(result.bootstrap.status, 'unavailable');
});

test('placebo controls distinguish the known signal from independent noise and are reproducible', async () => {
  const options = { placebo: { samples: 99, seed: 31 } }, dataset = data();
  const signal = (await evaluateDiagnostics(dataset, field('signal'), options)).placebo;
  const noise = (await evaluateDiagnostics(dataset, field('noise'), options)).placebo;
  assert.equal(signal.status, 'completed');
  assert.equal(signal.pValue, .01);
  assert.ok(noise.pValue > signal.pValue);
  assert.ok(Math.abs(signal.nullDistribution.mean) < .2);
  assert.deepEqual((await evaluateDiagnostics(dataset, field('signal'), options)).placebo, signal);
  const cross = prepareDataset(panel({ symbols: 4 }), splits());
  const result = (await evaluateDiagnostics(cross, field('signal'), options)).placebo;
  assert.equal(result.method, 'within-date-label-permutation');
  assert.equal(result.pValue, .01);
});

test('Monte Carlo simulates resampled paths rather than merely permuting a fixed terminal return', async () => {
  const result = (await evaluateDiagnostics(data(), field('signal'), { monteCarlo: cheap })).monteCarlo;
  assert.equal(result.status, 'completed');
  assert.equal(result.terminalReturn.count, cheap.samples);
  assert.ok(result.terminalReturn.p05 < result.terminalReturn.p95);
  assert.equal(result.lossPathFraction, 0);
  assert.equal(result.maxDrawdown.p95, 0);
  assert.equal(result.blockSize, cheap.blockSize);
  assert.deepEqual((await evaluateDiagnostics(data(), field('signal'), { monteCarlo: cheap })).monteCarlo, result);
});

test('block bootstrap keeps factor/label pairs, reports percentile intervals and valid sample counts', async () => {
  const result = (await evaluateDiagnostics(data(), field('signal'), { bootstrap: { ...cheap, confidence: .9 } })).bootstrap;
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.rankIC, { observed: 1, low: 1, high: 1, validSamples: cheap.samples });
  assert.ok(result.meanNetReturn.low > 0);
  assert.equal(result.method, 'paired-circular-block-percentile');
  assert.equal(result.confidence, .9);
  const excessive = (await evaluateDiagnostics(data(), field('signal'), { bootstrap: { ...cheap, blockSize: 1000 } })).bootstrap;
  assert.equal(excessive.status, 'unavailable');
});

test('selected diagnostic failures, missing state and parameter-free AST do not block useful checks', async () => {
  const result = await evaluateDiagnostics(data(), field('signal'), {
    placebo: { samples: -1 }, monteCarlo: cheap, bootstrap: cheap, sensitivity: true, regimes: { field: 'notPresent' },
  });
  assert.equal(result.placebo.status, 'error');
  assert.equal(result.placebo.code, 'INVALID_DIAGNOSTIC_CONFIG');
  assert.equal(result.monteCarlo.status, 'completed');
  assert.equal(result.bootstrap.status, 'completed');
  assert.equal(result.sensitivity.status, 'not-applicable');
  assert.equal(result.regimes.status, 'unavailable');
});

test('multi-symbol block bootstrap preserves shared market shocks instead of inventing independent confirmations', async () => {
  const rows = panel(), duplicated = rows.flatMap(row => [row, { ...structuredClone(row), symbol: 'duplicate' }]);
  const plan = { bootstrap: { ...cheap, samples: 99 } };
  const one = (await evaluateDiagnostics(prepareDataset(rows, splits()), field('noise'), plan)).bootstrap;
  const two = (await evaluateDiagnostics(prepareDataset(duplicated, splits({ mode: 'time-series' })), field('noise'), plan)).bootstrap;
  assert.equal(two.samplingUnit, 'shared-market-timestamps');
  assert.deepEqual(two.rankIC, one.rankIC);
  assert.ok(two.rankIC.low < two.rankIC.high);
});

test('development diagnostics and train-fitted state thresholds never consume holdout data', async () => {
  const rows = panel(), changed = structuredClone(rows);
  for (const row of changed) if (row.time > iso(160)) row.fields = { close: 1e15, signal: -1e12, volatility: 1e11, noise: 9000 };
  const plan = { placebo: { samples: 20, seed: 1 }, monteCarlo: cheap, bootstrap: cheap,
    regimes: { field: 'volatility', bins: 2 }, sensitivity: true, walkForward: { folds: 3, minTrain: 40, minTest: 20 }, outOfSample: true };
  const original = await evaluateCandidate(prepareDataset(rows, splits()), field('signal'), { diagnostics: plan });
  const modified = await evaluateCandidate(prepareDataset(changed, splits()), field('signal'), { diagnostics: plan });
  assert.deepEqual(modified, original);
  assert.equal(original.diagnostics.outOfSample.holdout.status, 'deferred');
});

test('walk-forward folds isolate earlier test results from later observations and fit only history', async () => {
  const rows = panel(), plan = { walkForward: { folds: 3, minTrain: 40, minTest: 20, gap: 3 } };
  const initial = (await evaluateDiagnostics(prepareDataset(rows, splits()), field('signal'), plan)).walkForward;
  assert.equal(initial.status, 'completed');
  assert.equal(initial.completedFolds, 3);
  for (const fold of initial.folds) {
    assert.ok(fold.trainEnd < fold.testStart);
    assert.equal(fold.thresholdFitEnd, fold.trainEnd);
    assert.equal(fold.purgedBoundaryRows, 1);
  }
  const cutoff = initial.folds[0].testEnd;
  const changed = rows.map(row => row.time > cutoff ? { ...row, fields: { ...row.fields, close: 99, signal: 999 } } : row);
  const later = (await evaluateDiagnostics(prepareDataset(changed, splits()), field('signal'), plan)).walkForward;
  assert.deepEqual(later.folds[0], initial.folds[0]);
  const invalid = (await evaluateDiagnostics(data({ horizon: 3 }), field('signal'), { walkForward: { gap: 1 } })).walkForward;
  assert.equal(invalid.status, 'error');
});

test('sensitivity changes one actual parameter locally without selecting a replacement', async () => {
  const expression = { op: 'mean', args: [field('signal')], window: 5 }, before = structuredClone(expression);
  const result = (await evaluateDiagnostics(data(), expression, { sensitivity: true })).sensitivity;
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.variants.map(item => item.value), [4, 6]);
  assert.ok(result.maxAbsoluteChange > 0);
  assert.ok(result.variants.every(item => item.path === 'window'));
  assert.deepEqual(expression, before);
});

test('state strata disclose sparse layers and use only training threshold distributions', async () => {
  const dataset = data(), plan = { regimes: { field: 'volatility', bins: 3, minObservations: 8 } };
  const result = (await evaluateDiagnostics(dataset, field('signal'), plan)).regimes;
  assert.equal(result.status, 'completed');
  assert.ok(result.strata.every(item => item.rankIC === 1));
  const sparse = (await evaluateDiagnostics(dataset, field('signal'), { regimes: { ...plan.regimes, minObservations: 1000 } })).regimes;
  assert.equal(sparse.status, 'unavailable');
  assert.ok(sparse.strata.every(item => item.rankIC === null));
  const changed = panel().map(row => row.time > iso(80) ? { ...row, fields: { ...row.fields, volatility: 1e9 } } : row);
  const other = (await evaluateDiagnostics(prepareDataset(changed, splits()), field('signal'), plan)).regimes;
  assert.deepEqual(other.thresholdsBySymbol, result.thresholdsBySymbol);
});

test('out-of-sample clearly separates development validation, deferred holdout and no holdout', async () => {
  const development = prepareDataset(panel().filter(row => row.time <= iso(160)), splits(), { developmentOnly: true });
  const result = (await evaluateDiagnostics(development, field('signal'), { outOfSample: true })).outOfSample;
  assert.equal(result.status, 'completed');
  assert.equal(result.validation.rankIC, 1);
  assert.equal(result.holdout.status, 'not-requested');
  const finalized = (await evaluateDiagnostics(data(), field('signal'), { outOfSample: true }, { finalized: true })).outOfSample;
  assert.equal(finalized.holdout.status, 'evaluated');
  assert.equal(finalized.holdout.rankIC, 1);
});

test('cancellation is observable between batches and is not converted to a successful diagnostic', async () => {
  const controller = new AbortController();
  const pending = evaluateDiagnostics(data(), field('signal'), { placebo: { samples: 999 } }, { signal: controller.signal });
  setImmediate(() => controller.abort(new Error('cancelled-by-test')));
  await assert.rejects(pending, /cancelled-by-test/);
});

test('many symbols keep bounded receipt details without dropping symbols from measured aggregates', async () => {
  const dataset = prepareDataset(panel({ symbols: 250, days: 72 }), { trainEnd: iso(24), validationEnd: iso(48), holdoutEnd: iso(72), mode: 'time-series' });
  const result = await evaluateCandidate(dataset, field('signal'), { diagnostics: { regimes: { field: 'state' }, bootstrap: { samples: 20, seed: 1, blockSize: 2 } } });
  assert.equal(result.validation.validICSeries, 250);
  assert.equal(result.validation.rankIC, 1);
  assert.equal(result.validation.perSymbol.length, 32);
  assert.equal(result.validation.omittedSymbolDetails, 218);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 48 * 1024);
});

test('sparse multi-symbol bootstrap retains paired evidence and responds promptly to cancellation', async () => {
  const minute = index => new Date(Date.UTC(2024, 0, 1) + index * 60000).toISOString();
  const rows = [], symbols = 1000;
  for (let symbol = 0; symbol < symbols; symbol++) {
    let close = 100;
    const append = (time, signal) => rows.push({ time: minute(time), availableAt: minute(time), symbol: `S${symbol}`, fields: { close, signal } });
    append(0, -1); append(1, 1);
    for (let index = 0; index < 12; index++) {
      const signal = ((index * 7 + symbol) % 11 - 5) / 10;
      append(10 + symbol * 12 + index, signal);
      close *= 1 + signal * .01;
    }
    append(20 + symbols * 12, 1);
  }
  const dataset = prepareDataset(rows, { trainEnd: minute(2), validationEnd: minute(10 + symbols * 12),
    holdoutEnd: minute(20 + symbols * 12), mode: 'time-series', costBps: 0 });
  const plan = { bootstrap: { samples: 20, seed: 1, blockSize: 2 } };
  const result = (await evaluateDiagnostics(dataset, field('signal'), plan)).bootstrap;
  assert.equal(result.observations, 11000);
  assert.equal(result.rankIC.observed, 1);
  assert.equal(result.rankIC.low, 1);
  assert.equal(result.rankIC.high, 1);
  const controller = new AbortController(), started = performance.now();
  const timer = setTimeout(() => controller.abort(new Error('sparse-bootstrap-cancelled')), 10);
  try {
    await assert.rejects(evaluateDiagnostics(dataset, field('signal'), plan, { signal: controller.signal }), /sparse-bootstrap-cancelled/);
    assert.ok(performance.now() - started < 1500, 'Sparse data must not monopolize the event loop for seconds before observing cancellation');
  } finally { clearTimeout(timer); }
});
