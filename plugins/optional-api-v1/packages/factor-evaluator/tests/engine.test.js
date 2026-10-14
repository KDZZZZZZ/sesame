import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFactors, EVALUATOR_VERSION, evaluateFactor, prepareDataset, validateExpression } from '../engine.js';

const date = day => new Date(Date.UTC(2024, 0, day)).toISOString();
const field = name => ({ op: 'field', name });
const constant = value => ({ op: 'constant', value });
const unary = (op, child) => ({ op, args: [child] });
const rolling = (op, child, window) => ({ op, args: [child], window });
const binary = (op, left, right) => ({ op, args: [left, right] });
const config = overrides => ({ trainEnd: date(5), validationEnd: date(9), holdoutEnd: date(13), ...overrides });
const clone = value => JSON.parse(JSON.stringify(value));

// Exact, deterministic synthetic fixture. Each day's signal ranks the next
// return; this is a numerical oracle, not evidence of a tradable strategy.
function rows({ days = 13, assets = 4, returns = [-0.03, -0.01, 0.01, 0.03], flipAfter = Infinity } = {}) {
  const result = [];
  const prices = Array(assets).fill(100);
  for (let day = 1; day <= days; day++) {
    for (let symbol = 0; symbol < assets; symbol++) {
      result.push({ time: date(day), symbol: `S${symbol}`, availableAt: date(day), fields: {
        close: prices[symbol], volume: 1000 + symbol * 100,
        signal: (day > flipAfter ? -1 : 1) * symbol,
      } });
      prices[symbol] *= 1 + returns[symbol % returns.length];
    }
  }
  return result;
}

function approx(actual, expected, epsilon = 1e-12) {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
}

function assertFiniteJson(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  if (value && typeof value === 'object') Object.values(value).forEach(assertFiniteJson);
}

test('known perfect ordering and reversal produce measured cross-sectional rank IC', () => {
  const dataset = prepareDataset(rows(), config());
  const positive = evaluateFactor(dataset, field('signal'));
  const reverse = evaluateFactor(dataset, unary('neg', field('signal')));
  assert.equal(positive.evaluatorVersion, EVALUATOR_VERSION);
  approx(positive.train.rankIC, 1);
  approx(positive.validation.rankIC, 1);
  approx(reverse.train.rankIC, -1);
  assert.equal(positive.train.rankICIR, null, 'zero IC variance must not create infinite IR');
  assert.equal(positive.train.rankICStd, 0);
  assert.equal(positive.train.validICPeriods, 4);
  approx(positive.train.coverage, 1);
  approx(positive.train.meanGrossReturn, 0.03);
  approx(reverse.train.meanGrossReturn, -0.03);
  assert.equal('holdout' in positive, false);
  assert.match(positive.expressionDigest, /^sha256:[a-f0-9]{64}$/);
  assertFiniteJson(positive);
});

test('fixed costs and flat-to-flat turnover agree with a hand-calculated result', () => {
  const dataset = prepareDataset(rows(), config({ costBps: 10 }));
  const result = evaluateFactor(dataset, field('signal')).train;
  assert.equal(result.portfolioPeriods, 4);
  assert.equal(result.turnover, 2);
  assert.equal(result.totalTurnover, 8);
  approx(result.costPerPeriod, 0.002);
  approx(result.meanNetReturn, 0.028);
  approx(result.netReturn, 1.028 ** 4 - 1);
  approx(result.grossReturn, 1.03 ** 4 - 1);
  approx(result.maxDrawdown, 0);
  const costly = evaluateFactor(prepareDataset(rows(), config({ costBps: 200 })), field('signal')).train;
  approx(costly.netReturn, 0.99 ** 4 - 1);
  approx(costly.maxDrawdown, 1 - 0.99 ** 4);
});

test('ICIR uses sample standard deviation and never adds an annualization factor', () => {
  const raw = rows();
  for (const row of raw) if (row.time === date(2)) row.fields.signal *= -1;
  const result = evaluateFactor(prepareDataset(raw, config()), field('signal')).train;
  // Per-date IC [1, -1, 1, 1] has mean 0.5 and sample SD 1.
  approx(result.rankIC, 0.5);
  approx(result.rankICStd, 1);
  approx(result.rankICIR, 0.5);
  approx(result.maxDrawdown, 0.032);
});

test('nonoverlapping horizon sampling prevents double-compounding and measures drawdown', () => {
  const result = evaluateFactor(prepareDataset(rows(), config({ horizon: 2 })), unary('neg', field('signal'))).train;
  assert.equal(result.validICPeriods, 3, 'IC remains descriptive over all eligible dates');
  assert.equal(result.portfolioPeriods, 2, 'Jan 1–3 and Jan 3–5 are the two nonoverlapping intervals');
  assert.equal(result.overlapSkippedPeriods, 1);
  assert.equal(result.purgedBoundaryRows, 8);
  // Half of (-5.91% - 6.09%) = -6%; two one-way costs = 0.2%.
  approx(result.meanGrossReturn, -0.06);
  approx(result.meanNetReturn, -0.062);
  approx(result.netReturn, 0.938 ** 2 - 1);
  approx(result.maxDrawdown, 1 - 0.938 ** 2);
});

test('the last label in every split is purged instead of crossing into the next split', () => {
  const raw = rows();
  const original = evaluateFactor(prepareDataset(raw, config()), field('signal'));
  const changed = clone(raw);
  for (const row of changed) if (row.time >= date(6)) row.fields.close *= 1000;
  const after = evaluateFactor(prepareDataset(changed, config()), field('signal'));
  assert.deepEqual(after.train, original.train);
  assert.equal(original.train.purgedBoundaryRows, 4);
  assert.equal(original.validation.purgedBoundaryRows, 4);
  assert.equal(original.validation.validICPeriods, 3);
});

test('development output is completely independent of holdout prices, fields and symbol coverage', () => {
  const raw = rows();
  const changed = clone(raw).filter(row => row.time <= date(9) || row.symbol === 'S0');
  for (const row of changed) if (row.time > date(9)) {
    row.fields.close = 1e9;
    row.fields.signal = -9999;
    row.fields.secretFutureField = 42;
  }
  const first = prepareDataset(raw, config()), second = prepareDataset(changed, config());
  const expression = rolling('mean', unary('rank', field('signal')), 3);
  assert.deepEqual(evaluateFactor(second, expression), evaluateFactor(first, expression));
  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.summary.fields.includes('secretFutureField'), false);
  assert.notEqual(first.digest, second.digest, 'full sealed input identity still records holdout differences');
});

test('holdout evaluation is explicitly separate and returns no development metrics', () => {
  const dataset = prepareDataset(rows({ flipAfter: 9 }), config());
  const development = evaluateFactor(dataset, field('signal'));
  const held = evaluateFactor(dataset, field('signal'), { holdout: true });
  approx(development.validation.rankIC, 1);
  approx(held.holdout.rankIC, -1);
  assert.equal(held.holdout.rows, 16);
  assert.equal(held.holdout.purgedBoundaryRows, 4);
  assert.equal('train' in held, false);
  assert.equal('validation' in held, false);
  assert.notEqual(held.dataDigest, development.dataDigest);
});

test('redundancy uses training timestamps only, including for rolling and cross-sectional operators', () => {
  const original = rows(), changed = clone(original);
  for (const row of changed) if (row.time > date(5)) { row.fields.volume *= -1; row.fields.signal *= -1; }
  const a = field('signal'), b = rolling('mean', field('volume'), 2);
  const first = compareFactors(prepareDataset(original, config()), a, b);
  assert.deepEqual(compareFactors(prepareDataset(changed, config()), a, b), first);
  approx(first.correlation, 1);
  assert.equal(first.scope, 'train');
  assert.equal(first.method, 'mean-cross-sectional-spearman');
  assert.equal(first.periods, 4);
  assert.equal(first.observations, 16);
  approx(compareFactors(prepareDataset(original, config()), a, unary('neg', a)).correlation, -1);
});

test('point-in-time availability is enforced before any evaluation', () => {
  const future = rows();
  future[0].availableAt = date(2);
  assert.throws(() => prepareDataset(future, config()), /Point-in-time violation/);
  const valid = rows();
  valid[0].availableAt = '2023-12-31T18:00:00-06:00';
  assert.equal(prepareDataset(valid, config()).rows[0].availableAt, date(1));
});

test('duplicate instants, invalid timestamps, bad closes and invalid boundaries are rejected', () => {
  const duplicate = rows();
  duplicate.push({ ...clone(duplicate[0]), time: '2023-12-31T19:00:00-05:00' });
  assert.throws(() => prepareDataset(duplicate, config()), /Duplicate time\/symbol/);
  for (const value of [0, -1, Infinity, NaN, '12']) {
    const bad = rows(); bad[0].fields.close = value;
    assert.throws(() => prepareDataset(bad, config()), /positive finite close|finite numeric/);
  }
  for (const value of ['2024-02-30T00:00:00Z', '2024-01-01T25:00:00Z', '2024-01-01', '2024-01-01T00:00:00']) {
    const bad = rows(); bad[0].time = value;
    assert.throws(() => prepareDataset(bad, config()), /timestamp/);
  }
  assert.throws(() => prepareDataset(rows(), config({ trainEnd: date(9) })), /trainEnd < validationEnd/);
  assert.throws(() => prepareDataset(rows(), config({ quantile: 0.75 })), /quantile/);
  assert.throws(() => prepareDataset(rows(), config({ costBps: -1 })), /costBps/);
  assert.throws(() => prepareDataset(rows(), config({ horizon: 0 })), /horizon/);
  assert.throws(() => prepareDataset(rows(), config({ holdoutEnd: date(12) })), /after holdoutEnd/);
  assert.throws(() => prepareDataset(Array(20001).fill(rows()[0]), config()), /1–20000/);
});

test('preparation normalizes ordering and copies data; persisted snapshots are revalidated', () => {
  const raw = rows(), normal = prepareDataset(raw, config());
  const reversed = prepareDataset([...raw].reverse(), config());
  assert.equal(normal.digest, reversed.digest);
  assert.ok(Object.isFrozen(normal.rows[0].fields));
  const before = normal.rows[0].fields.close;
  raw[0].fields.close = 2;
  assert.equal(normal.rows[0].fields.close, before);
  const persisted = clone(normal);
  assert.deepEqual(evaluateFactor(persisted, field('signal')), evaluateFactor(normal, field('signal')));
  persisted.rows[0].availableAt = date(3);
  assert.throws(() => evaluateFactor(persisted, field('signal')), /Point-in-time/);
});

test('zero variance, ties, absent data and undefined math never manufacture evidence', () => {
  const dataset = prepareDataset(rows(), config());
  for (const expression of [constant(1), field('missing'), binary('div', field('close'), constant(0)),
    unary('log', constant(-1)), unary('zscore', constant(5))]) {
    const result = evaluateFactor(dataset, expression);
    assert.equal(result.train.rankIC, null);
    assert.equal(result.train.rankICIR, null);
    assert.equal(result.train.netReturn, null);
    assert.equal(result.train.portfolioPeriods, 0);
    assertFiniteJson(result);
  }
  const tied = rows();
  for (const row of tied) row.fields.signal = row.symbol === 'S0' || row.symbol === 'S1' ? 0 : 1;
  const result = evaluateFactor(prepareDataset(tied, config()), field('signal')).train;
  assert.ok(result.rankIC > 0, 'tied ranks can still have descriptive information');
  assert.equal(result.portfolioPeriods, 0, 'ties spanning a quantile boundary cannot be split by symbol');
  assert.equal(result.tiedTails, 4);
});

test('lag and rolling windows use only historical observations and require full windows', () => {
  const dataset = prepareDataset(rows(), config());
  const lagged = evaluateFactor(dataset, rolling('lag', field('signal'), 2)).train;
  const mean = evaluateFactor(dataset, rolling('mean', field('signal'), 3)).train;
  assert.equal(lagged.factorObservations, 12);
  assert.equal(lagged.validICPeriods, 2);
  assert.equal(mean.factorObservations, 12);
  approx(mean.rankIC, 1);
  assert.equal(evaluateFactor(dataset, rolling('delta', field('signal'), 1)).train.rankIC, null);
  assert.equal(evaluateFactor(dataset, rolling('std', field('signal'), 2)).train.rankIC, null);
  approx(evaluateFactor(dataset, rolling('sum', field('signal'), 3)).train.rankIC, 1);
  approx(evaluateFactor(dataset, unary('rank', field('signal'))).train.rankIC, 1);
  approx(evaluateFactor(dataset, unary('zscore', field('signal'))).train.rankIC, 1);
});

test('a missing field invalidates each rolling window that contains it without zero filling', () => {
  const raw = rows();
  delete raw.find(row => row.time === date(2) && row.symbol === 'S0').fields.signal;
  const result = evaluateFactor(prepareDataset(raw, config()), rolling('mean', field('signal'), 2)).train;
  assert.equal(result.factorObservations, 14);
  assert.equal(result.validICPeriods, 1);
  approx(result.rankIC, 1);
});

test('arithmetic operators compose without arbitrary code and overflow remains unavailable', () => {
  const dataset = prepareDataset(rows(), config());
  const expression = unary('log', binary('div', unary('abs', binary('sub',
    binary('mul', binary('add', field('signal'), constant(2)), constant(2)), constant(1))), constant(3)));
  approx(evaluateFactor(dataset, expression).train.rankIC, 1);
  const overflow = binary('mul', constant(1e308), constant(1e308));
  const result = evaluateFactor(dataset, overflow);
  assert.equal(result.train.coverage, 0);
  assertFiniteJson(result);
});

test('missing forward bars are excluded by aligned timestamp, never replaced by a later symbol bar', () => {
  const raw = rows().filter(row => !(row.time === date(3) && row.symbol === 'S0'));
  const result = evaluateFactor(prepareDataset(raw, config()), field('signal')).train;
  assert.equal(result.missingForwardRows, 1);
  assert.equal(result.validICPeriods, 2, 'Jan 2 has no S0 endpoint; Jan 3 has only three current assets');
  assert.equal(result.rows, 19);
  assert.equal(result.labelObservations, 14);
});

test('AST validation rejects hidden fields, invalid arity, code injection and unbounded workloads', () => {
  for (const expression of [null, [], { op: 'eval', source: 'process.exit()' },
    { op: 'field', name: '__proto__' }, { op: 'field', name: 'close;process.exit()' },
    { op: 'field', name: 'close', code: 'anything' }, constant(Infinity),
    { op: 'add', args: [constant(1)] }, { op: 'mean', args: [field('close')], window: 0 },
    { op: 'lag', args: [field('close')], window: 253 },
    { op: 'mean', args: [field('close')], window: 2.5 }]) {
    assert.throws(() => validateExpression(expression));
  }
  let deep = field('close');
  for (let i = 0; i < 12; i++) deep = unary('neg', deep);
  assert.throws(() => validateExpression(deep), /depth/);
  let expensive = field('close');
  for (let i = 0; i < 9; i++) expensive = rolling('std', expensive, 252);
  assert.throws(() => validateExpression(expensive), /rolling work/);
  const broad = depth => depth === 0 ? constant(1) : binary('add', broad(depth - 1), broad(depth - 1));
  assert.throws(() => validateExpression(broad(7)), /nodes/);
  const cycle = { op: 'neg', args: [] }; cycle.args.push(cycle);
  assert.throws(() => validateExpression(cycle), /depth/);
});

test('a loss beyond available diagnostic capital is explicit instead of misleading compounding', () => {
  const raw = rows({ returns: [5, 0.01, -0.01, -0.03] });
  const result = evaluateFactor(prepareDataset(raw, config()), field('signal')).train;
  assert.equal(result.insolvent, true);
  assert.equal(result.netReturn, null);
  assert.equal(result.maxDrawdown, null);
  assert.ok(result.meanNetReturn < -1);
  assertFiniteJson(result);
});
