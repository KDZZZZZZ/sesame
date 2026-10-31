import { createHash } from 'node:crypto';
import { factorEvidence } from './engine.js';

const DSR_SOURCE = 'https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf';
const PBO_SOURCE = 'https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf';
const unavailable = (reason, detail = {}) => ({ status: 'unavailable', reason, ...detail });
const finite = Number.isFinite;
const mean = values => values.reduce((sum, value) => sum + value / values.length, 0);
const hash = value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Standard normal CDF, absolute error < 7.5e-8 (Abramowitz & Stegun 26.2.17).
export function normalCDF(value) {
  if (value === 0) return .5;
  const x = Math.abs(value), t = 1 / (1 + .2316419 * x);
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
    (.319381530 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return Math.max(0, Math.min(1, value > 0 ? 1 - tail : tail));
}

// Acklam's inverse-normal rational approximation, relative error < 1.2e-9.
export function inverseNormal(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-.00778489400243029, -.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [.00778469570904146, .32246712907004, 2.445134137143, 3.75440866190742];
  const tail = q => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < .02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > .97575) return -tail(Math.sqrt(-2 * Math.log1p(-p)));
  const q = p - .5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Nonannualized Sharpe, sample SD; population standardized central moments. */
export function returnMoments(returns) {
  if (!Array.isArray(returns) || returns.length < 3 || !returns.every(finite)) return unavailable('At least 3 finite, observed period returns are required');
  // Scaling prevents overflow/underflow without changing dimensionless moments.
  const scale = Math.max(...returns.map(Math.abs));
  if (scale === 0) return unavailable('Return variance is zero');
  const values = returns.map(value => value / scale), average = mean(values);
  const centered = values.map(value => value - average), m2 = mean(centered.map(value => value ** 2));
  if (!(m2 > 0)) return unavailable('Return variance is zero');
  const sd = Math.sqrt(m2), sampleSD = sd * Math.sqrt(values.length / (values.length - 1));
  const z = centered.map(value => value / sd);
  const result = { sampleLength: values.length, sharpe: average / sampleSD,
    skewness: mean(z.map(value => value ** 3)), kurtosis: mean(z.map(value => value ** 4)) };
  return Object.values(result).every(finite) ? { status: 'completed', ...result } : unavailable('Return moments exceed numerical range');
}

/** Bailey & López de Prado (2014), equation (2); numeric kernel, not public input. */
export function deflatedSharpeRatio({ sharpe, sampleLength, skewness, kurtosis, trialSharpeVariance, independentTrials } = {}) {
  const assumptions = ['Per-period returns use a zero risk-free assumption. The evaluator supplies cost-adjusted idealized direction returns; observed risk-free returns are not subtracted. No annualization is inferred.',
    'IID/asymptotic Sharpe sampling approximation with finite first four moments; serial dependence is not corrected.',
    'Trial Sharpe estimates are approximately normal; independentTrials is an explicit independence assumption, not an estimated fact.',
    'Expected-maximum approximation is less accurate for small trial counts; the null strategy-class mean Sharpe is zero.'];
  const detail = { method: 'deflated-sharpe-ratio', source: DSR_SOURCE, riskFreeAssumption: 'zero per diagnostic period', assumptions };
  if (![sharpe, skewness, kurtosis, trialSharpeVariance, independentTrials].every(finite) || !Number.isSafeInteger(sampleLength) || sampleLength < 3 ||
    trialSharpeVariance < 0 || !Number.isSafeInteger(independentTrials) || independentTrials < 1 || independentTrials > 1e7 || kurtosis < 1 || kurtosis < skewness ** 2 + 1 - 1e-10)
    return unavailable('Finite feasible moments, nonnegative trial variance, and at least 3 observations are required', detail);
  const gamma = .5772156649015329;
  const benchmarkSharpe = independentTrials === 1 ? 0 : Math.sqrt(trialSharpeVariance) *
    ((1 - gamma) * inverseNormal(1 - 1 / independentTrials) + gamma * inverseNormal(1 - 1 / (independentTrials * Math.E)));
  const varianceTerm = 1 - skewness * sharpe + (kurtosis - 1) / 4 * sharpe ** 2;
  if (!(varianceTerm > 0) || !finite(benchmarkSharpe)) return unavailable('Sharpe sampling variance is zero or nonfinite', detail);
  const z = (sharpe - benchmarkSharpe) * Math.sqrt(sampleLength - 1) / Math.sqrt(varianceTerm);
  if (!finite(z)) return unavailable('Deflated Sharpe statistic exceeds numerical range', detail);
  return { status: 'completed', ...detail, probability: normalCDF(z), z, benchmarkSharpe, sharpe, sampleLength,
    skewness, kurtosis, trialSharpeVariance, independentTrials, varianceTerm,
    interpretation: 'Model-based probability of exceeding the multiple-trial null benchmark; not the probability of future profit.' };
}

function combinations(n, k, start = 0, prefix = [], result = []) {
  if (!k) result.push(prefix);
  else for (let i = start; i <= n - k; i++) combinations(n, k - 1, i + 1, [...prefix, i], result);
  return result;
}
const tied = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
function merge(a, b) {
  if (!a.n) return { ...b };
  const n = a.n + b.n, delta = b.mean - a.mean;
  return { n, mean: a.mean + delta * b.n / n, m2: a.m2 + b.m2 + delta ** 2 * a.n * b.n / n };
}
function moments(values) {
  const average = mean(values);
  return { n: values.length, mean: average, m2: values.reduce((sum, value) => sum + (value - average) ** 2, 0) };
}
const sharpeFromMoments = item => item.n >= 3 && item.m2 > 0 ? item.mean / Math.sqrt(item.m2 / (item.n - 1)) : null;

/** Exact CSCV on a complete synchronous T × N matrix; no winner-only fallback. */
export async function probabilityOfBacktestOverfitting(matrix, { blocks, complete = false, signal } = {}) {
  const detail = { method: 'combinatorially-symmetric-cross-validation', source: PBO_SOURCE,
    performanceMetric: 'nonannualized-sharpe', scope: 'development-validation',
    assumptions: ['The supplied columns contain every attempted trial in the declared research universe; omitted upstream searches are not observable.',
      'Rows are synchronous, comparable period returns; contiguous equal blocks preserve only within-block ordering.',
      'This evaluates selection by maximum Sharpe, not arbitrary Agent selection or factor Rank IC.',
      'Every split must support finite Sharpe for every column. No missing row, failed trial, or degenerate split is silently discarded.'],
    tiePolicy: 'Uniform weight over IS maximizers; OOS midranks; logit <= 0 counts median ties as overfit (conservative boundary).' };
  if (complete !== true) return unavailable('The full attempted-trial return matrix is not confirmed complete', detail);
  if (!Array.isArray(matrix) || matrix.length < 8 || matrix.length > 20000 || !Array.isArray(matrix[0]) || matrix[0].length < 2 || matrix[0].length > 40)
    return unavailable('CSCV requires 8–20000 periods and 2–40 complete trial columns', detail);
  const periods = matrix.length, trials = matrix[0].length;
  if (matrix.some(row => !Array.isArray(row) || row.length !== trials || !row.every(finite))) return unavailable('All trial columns require finite returns at every synchronous period', detail);
  const partitionCount = blocks ?? [8, 6, 4, 2].find(n => periods % n === 0 && periods / n >= 2);
  if (!Number.isSafeInteger(partitionCount) || partitionCount < 2 || partitionCount > 16 || partitionCount % 2 || periods % partitionCount || periods / partitionCount < 2)
    return unavailable('Choose an even block count from 2 to 16 that exactly divides the periods with at least 2 rows per block', { ...detail, periods, trials, requestedBlocks: blocks ?? null });
  const size = periods / partitionCount, splits = combinations(partitionCount, partitionCount / 2);
  const stats = Array.from({ length: trials }, (_, column) => {
    const scale = Math.max(...matrix.map(row => Math.abs(row[column])));
    return Array.from({ length: partitionCount }, (_, block) => moments(matrix.slice(block * size, (block + 1) * size).map(row => scale ? row[column] / scale : 0)));
  });
  let overfitWeight = 0, validSplits = 0, tiedISSplits = 0, tiedOOSSelections = 0;
  const splitResults = [], invalidSplits = [];
  for (const [index, chosen] of splits.entries()) {
    signal?.throwIfAborted();
    if (index % 32 === 0) await new Promise(resolve => setImmediate(resolve));
    signal?.throwIfAborted();
    const included = new Set(chosen), scores = stats.map(column => {
      let inside = { n: 0, mean: 0, m2: 0 }, outside = { n: 0, mean: 0, m2: 0 };
      for (let block = 0; block < partitionCount; block++) {
        if (included.has(block)) inside = merge(inside, column[block]); else outside = merge(outside, column[block]);
      }
      return [sharpeFromMoments(inside), sharpeFromMoments(outside)];
    });
    const invalid = scores.flatMap((pair, trial) => pair.every(finite) ? [] : [trial]);
    if (invalid.length) { invalidSplits.push({ inSampleBlocks: chosen, invalidTrialIndexes: invalid }); continue; }
    const best = Math.max(...scores.map(pair => pair[0])), winners = scores.flatMap((pair, trial) => tied(pair[0], best) ? [trial] : []);
    if (winners.length > 1) tiedISSplits++;
    const outcomes = winners.map(trial => {
      const score = scores[trial][1], lower = scores.filter(pair => pair[1] < score && !tied(pair[1], score)).length;
      const equals = scores.filter(pair => tied(pair[1], score)).length, rank = lower + (equals + 1) / 2;
      if (equals > 1) tiedOOSSelections++;
      const relativeRank = rank / (trials + 1), logit = Math.log(relativeRank / (1 - relativeRank));
      return { trialIndex: trial, relativeRank, logit, weight: 1 / winners.length };
    });
    overfitWeight += outcomes.reduce((sum, item) => sum + (item.logit <= 0 ? item.weight : 0), 0);
    validSplits++;
    if (splitResults.length < 8) splitResults.push({ inSampleBlocks: chosen, winners: outcomes.slice(0, 4), winnerCount: outcomes.length, omittedWinnerDetails: Math.max(0, outcomes.length - 4) });
  }
  const summary = { ...detail, periods, trials, blocks: partitionCount, rowsPerBlock: size, totalSplits: splits.length,
    validSplits, invalidSplitCount: invalidSplits.length, invalidSplits: invalidSplits.slice(0, 8),
    omittedInvalidSplitDetails: Math.max(0, invalidSplits.length - 8), tiedISSplits, tiedOOSSelections,
    splitResults, omittedSplitDetails: Math.max(0, validSplits - splitResults.length), discardedPeriods: 0 };
  if (invalidSplits.length) return unavailable('One or more CSCV splits have undefined Sharpe; a complete-universe PBO cannot be estimated', summary);
  return { status: 'completed', ...summary, probability: Math.max(0, Math.min(1, overfitWeight / validSplits)), overfitWeight };
}

function request(value, allowed) {
  if (value === true) return {};
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown search diagnostic configuration');
  return value;
}

/** Recompute all registered candidates, including unselected/ineligible ones, at select. */
export async function evaluateSearchDiagnostics(dataset, candidates, requested = {}, { failedTrials = [], signal } = {}) {
  const results = { dsr: { status: 'not-requested' }, pbo: { status: 'not-requested' } };
  if (!requested.dsr && !requested.pbo) return results;
  const columns = [];
  for (const [trialId, candidate] of Object.entries(candidates).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    signal?.throwIfAborted();
    await new Promise(resolve => setImmediate(resolve));
    try {
      const returns = factorEvidence(dataset, candidate.candidate ?? candidate).returns;
      columns.push({ trialId, returns, moments: returnMoments(returns.map(item => item.net)) });
    } catch (error) { signal?.throwIfAborted(); columns.push({ trialId, returns: [], moments: unavailable(error.message) }); }
  }
  const exclusions = [...failedTrials.map(item => ({ trialId: item.trialId, status: 'failed', reason: item.reason })),
    ...columns.filter(item => item.moments.status !== 'completed').map(item => ({ trialId: item.trialId, status: 'unavailable', reason: item.moments.reason }))];
  const common = { scope: 'development-validation', returnSource: 'factor-evaluator-idealized-nonoverlapping-diagnostic-portfolio',
    universe: 'all registered session trials, including unselected and ineligible candidates; upstream trials are not inferred',
    trialIds: columns.map(item => item.trialId), attemptedTrialCount: columns.length + failedTrials.length, excludedTrials: exclusions,
    trialSetDigest: hash({ candidates: columns.map(item => ({ trialId: item.trialId, returns: item.returns })), failedTrials }),
    periodsByTrial: Object.fromEntries(columns.map(item => [item.trialId, item.returns.length])),
    limitation: 'These are fixed diagnostic portfolio returns, not broker fills. No holdout rows or selected-only return summaries are used.' };
  for (const name of ['dsr', 'pbo']) if (requested[name]) {
    try {
      const options = request(requested[name], name === 'dsr' ? ['independentTrials', 'reason'] : ['blocks']);
      if (exclusions.length) { results[name] = unavailable('The attempted-trial universe contains failed or unmeasurable returns; no trials were silently excluded', common); continue; }
      if (columns.length < 2) { results[name] = unavailable('At least two complete trial return series are required; a selected winner alone is insufficient', common); continue; }
      const timeline = columns[0].returns.map(item => [item.time, item.endTime]);
      if (columns.some(column => JSON.stringify(column.returns.map(item => [item.time, item.endTime])) !== JSON.stringify(timeline))) {
        results[name] = unavailable('Trial returns are not synchronous on identical intervals; missing periods were not filled with zero or dropped', common); continue;
      }
      if (name === 'dsr') {
        const independentTrials = options.independentTrials ?? columns.length;
        if (!Number.isSafeInteger(independentTrials) || independentTrials < 1 || independentTrials > columns.length ||
          (options.independentTrials !== undefined && (typeof options.reason !== 'string' || !options.reason.trim() || options.reason.length > 1000)))
          throw new Error('independentTrials must be an integer between 1 and attempted trials; an override requires a recorded reason');
        const sharpes = columns.map(item => item.moments.sharpe), average = mean(sharpes);
        const variance = sharpes.reduce((sum, value) => sum + (value - average) ** 2 / (sharpes.length - 1), 0);
        let metadata;
        const byTrial = Object.fromEntries(columns.map(item => {
          const { method, source, riskFreeAssumption, assumptions, interpretation, ...statistic } = deflatedSharpeRatio({ ...item.moments, trialSharpeVariance: variance, independentTrials });
          metadata ??= { method, source, riskFreeAssumption, assumptions, ...(interpretation ? { interpretation } : {}) };
          return [item.trialId, statistic];
        }));
        results.dsr = { status: Object.values(byTrial).every(item => item.status === 'completed') ? 'completed' : 'partial', ...common,
          ...metadata, byTrial, independentTrials, independenceBasis: options.reason ?? 'Assumes every registered trial is independent; correlation is not estimated.',
          trialSharpeVariance: variance, varianceEstimator: 'sample variance (N-1) of all registered nonannualized trial Sharpes',
          returnMomentEstimator: 'sample SD for Sharpe; population standardized central moments for skewness and Pearson (non-excess) kurtosis' };
      } else {
        const matrix = timeline.map((_, row) => columns.map(column => column.returns[row].net));
        results.pbo = { ...await probabilityOfBacktestOverfitting(matrix, { ...options, complete: true, signal }), ...common,
          matrixDigest: hash({ timeline, trialIds: common.trialIds, matrix }) };
      }
    } catch (error) { signal?.throwIfAborted(); results[name] = { status: 'error', reason: error.message, ...common }; }
  }
  return results;
}
