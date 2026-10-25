import { average, compound, evaluateFactor, factorEvidence, quantile, rankCorrelation, validateExpression } from './engine.js';

export const DIAGNOSTICS = Object.freeze({
  placebo: 'Break factor/label alignment and compare the observed association with a null control.',
  monteCarlo: 'Simulate empirical block-resampled diagnostic return paths and measure return/drawdown dispersion.',
  outOfSample: 'Separate development validation from the frozen-selection holdout.',
  walkForward: 'Evaluate the fixed candidate in forward chronological folds with training-only thresholds.',
  sensitivity: 'Measure local changes to one AST window or constant at a time.',
  regimes: 'Condition validation association on an explicitly supplied point-in-time state field.',
  bootstrap: 'Estimate paired/block-bootstrap percentile intervals for association and mean diagnostic return.',
});
const fail = (message, code = 'INVALID_DIAGNOSTIC_CONFIG') => { throw Object.assign(new Error(message), { code }); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unavailable = (reason, detail = {}) => ({ status: 'unavailable', reason, ...detail });
const notApplicable = reason => ({ status: 'not-applicable', reason });
const done = value => ({ status: 'completed', ...value });
const integer = (value, fallback, min, max, name) => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) fail(`${name} must be an integer from ${min} to ${max}`);
  return result;
};
const number = (value, fallback, min, max, name) => {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < min || result > max) fail(`${name} must be from ${min} to ${max}`);
  return result;
};
function config(value, allowed) {
  if (value === true) return {};
  if (!plain(value)) fail('Diagnostic must be true, false, or a configuration object');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Unknown diagnostic configuration field');
  return value;
}
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
async function checkpoint(index, signal) {
  signal?.throwIfAborted();
  if (index % 8 === 0) await new Promise(resolve => setImmediate(resolve));
  signal?.throwIfAborted();
}
function groups(items, key) {
  const result = new Map();
  for (const item of items) {
    if (!result.has(item[key])) result.set(item[key], []);
    result.get(item[key]).push(item);
  }
  return [...result.values()];
}
function association(items, mode, minimum = 4) {
  const by = groups(items, mode === 'time-series' ? 'symbol' : 'time'), scores = [];
  for (const rows of by) if (rows.length >= minimum) {
    const value = rankCorrelation(rows.map(row => row.value), rows.map(row => row.label));
    if (value !== null) scores.push(value);
  }
  return average(scores);
}
function sampling(options, length) {
  const requestedSamples = integer(options.samples, 199, 20, 999, 'samples');
  const seed = integer(options.seed, 20261024, 0, 4294967295, 'seed');
  // Bounded work is reported rather than silently truncating the input data.
  const samples = Math.min(requestedSamples, Math.floor(1_000_000 / Math.max(1, length)));
  return { requestedSamples, samples, seed };
}
function blockSize(options, length) {
  return integer(options.blockSize, Math.max(1, Math.ceil(Math.cbrt(length))), 1, 20000, 'blockSize');
}
function resampleBlocks(items, size, random) {
  const result = [];
  while (result.length < items.length) {
    const start = Math.floor(random() * items.length);
    for (let offset = 0; offset < size && result.length < items.length; offset++) result.push(items[(start + offset) % items.length]);
  }
  return result;
}
function distribution(values) {
  return { count: values.length, mean: average(values), p05: quantile(values, .05), p50: quantile(values, .5), p95: quantile(values, .95) };
}
const metricSummary = metrics => ({ rankIC: metrics.rankIC, coverage: metrics.coverage, observations: metrics.eligibleObservations, meanNetReturn: metrics.meanNetReturn, portfolioPeriods: metrics.portfolioPeriods });

async function placebo(dataset, expression, request, signal) {
  const options = config(request, ['samples', 'seed']);
  const evidence = factorEvidence(dataset, expression), observed = evidence.metrics.rankIC;
  if (!Number.isFinite(observed)) return unavailable('No measurable validation association');
  const partitions = groups(evidence.observations, evidence.mode === 'time-series' ? 'symbol' : 'time').filter(items => items.length >= (evidence.mode === 'time-series' ? 8 : 4));
  if (!partitions.length) return unavailable('Insufficient observations for a placebo control');
  const sampleConfig = sampling(options, evidence.observations.length), random = rng(sampleConfig.seed), values = [];
  if (sampleConfig.samples < 20) return unavailable('Requested input exceeds the diagnostic work budget', sampleConfig);
  const baseline = association(partitions.flat(), evidence.mode);
  for (let sample = 0; sample < sampleConfig.samples; sample++) {
    await checkpoint(sample, signal);
    const scores = [];
    for (const rows of partitions) {
      const labels = rows.map(row => row.label);
      if (evidence.mode === 'time-series') {
        const offset = 1 + Math.floor(random() * (labels.length - 1));
        labels.push(...labels.splice(0, offset));
      } else {
        for (let i = labels.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [labels[i], labels[j]] = [labels[j], labels[i]]; }
      }
      const score = rankCorrelation(rows.map(row => row.value), labels);
      if (score !== null) scores.push(score);
    }
    const value = average(scores); if (value !== null) values.push(value);
  }
  if (!values.length || baseline === null) return unavailable('No finite placebo statistics', sampleConfig);
  const extreme = values.filter(value => Math.abs(value) >= Math.abs(baseline) - 1e-12).length;
  return done({ method: evidence.mode === 'time-series' ? 'within-symbol-circular-label-shift' : 'within-date-label-permutation',
    hypothesis: 'factor-label alignment does not add association', alternative: 'two-sided-absolute',
    ...sampleConfig, observed: baseline, pValue: (extreme + 1) / (values.length + 1), nullDistribution: distribution(values),
    scope: 'validation', observations: partitions.reduce((sum, items) => sum + items.length, 0),
    excludedObservations: evidence.observations.length - partitions.reduce((sum, items) => sum + items.length, 0),
    assumptions: evidence.mode === 'time-series' ? 'Circular shifts require approximate stationarity; this control is not a multiple-testing correction.' : 'Labels must be exchangeable within each date; this control is not a multiple-testing correction.' });
}

async function monteCarlo(dataset, expression, request, signal) {
  const options = config(request, ['samples', 'seed', 'blockSize']);
  const observations = factorEvidence(dataset, expression).returns.map(row => row.net);
  if (observations.length < 8) return unavailable('At least 8 nonoverlapping diagnostic return periods are needed');
  const size = blockSize(options, observations.length);
  if (size > Math.floor(observations.length / 2)) return unavailable('blockSize must leave at least two observed blocks');
  const sampleConfig = sampling(options, observations.length), random = rng(sampleConfig.seed), returns = [], drawdowns = [];
  let insolventPaths = 0, invalidPaths = 0, lossPaths = 0;
  for (let sample = 0; sample < sampleConfig.samples; sample++) {
    await checkpoint(sample, signal);
    const path = compound(resampleBlocks(observations, size, random));
    if (path.insolvent) { insolventPaths++; lossPaths++; continue; }
    if (path.return === null || path.maxDrawdown === null) { invalidPaths++; continue; }
    returns.push(path.return); drawdowns.push(path.maxDrawdown); if (path.return < 0) lossPaths++;
  }
  if (!returns.length) return unavailable('No finite simulated return paths', { insolventPaths, invalidPaths, ...sampleConfig });
  return { ...done({ method: 'circular-block-resampled-return-paths', scope: 'validation', ...sampleConfig,
    blockSize: size, periodsPerPath: observations.length, observed: compound(observations),
    terminalReturn: { ...distribution(returns), population: 'finite-solvent-paths' },
    maxDrawdown: { ...distribution(drawdowns), population: 'finite-solvent-paths' },
    lossPathFraction: lossPaths / (returns.length + insolventPaths), insolventPaths, invalidPaths,
    assumptions: 'Empirical dependent-return scenarios, not a null significance test, future price forecast, or executed-trade simulation.' }),
    ...(invalidPaths ? { status: 'partial', reason: 'Some simulated paths overflowed numerical range' } : {}) };
}

function outOfSample(dataset, expression, request, finalized) {
  config(request, []);
  const metrics = evaluateFactor(dataset, expression), validationAvailable = Number.isFinite(metrics.validation.rankIC);
  const heldout = finalized && dataset.access !== 'development-only' ? evaluateFactor(dataset, expression, { holdout: true }).holdout : null;
  const holdoutUnavailable = heldout !== null && !Number.isFinite(heldout.rankIC);
  return { status: validationAvailable ? holdoutUnavailable ? 'partial' : 'completed' : 'unavailable',
    ...(!validationAvailable ? { reason: 'Validation has no measurable association' } : holdoutUnavailable ? { reason: 'Validation measured; selected holdout has no measurable association' } : {}),
    method: 'chronological-train-validation-and-frozen-selection-holdout',
    train: { end: dataset.config.trainEnd, ...metricSummary(metrics.train) },
    validation: { startExclusive: dataset.config.trainEnd, end: dataset.config.validationEnd, ...metricSummary(metrics.validation),
      role: 'development-validation; may inform candidate research, not an untouched final test' },
    holdout: dataset.access === 'development-only' ? { status: 'not-requested', reason: 'development-only input has no sealed holdout' }
      : finalized ? { status: 'evaluated', startExclusive: dataset.config.validationEnd, end: dataset.config.holdoutEnd,
        measurementStatus: holdoutUnavailable ? 'unavailable' : 'measured', ...metricSummary(heldout) }
        : { status: 'deferred', reason: 'Computed only after select freezes the candidate set' } };
}

async function walkForward(dataset, expression, request, signal) {
  const options = config(request, ['folds', 'minTrain', 'minTest', 'gap']);
  const folds = integer(options.folds, 3, 2, 8, 'folds'), minTrain = integer(options.minTrain, 20, 8, 20000, 'minTrain');
  const minTest = integer(options.minTest, 10, 4, 20000, 'minTest');
  const gap = integer(options.gap, dataset.config.horizon, dataset.config.horizon, 20000, 'gap');
  const times = [...new Set(dataset.rows.filter(row => row.time <= dataset.config.validationEnd).map(row => row.time))];
  const testSize = Math.floor((times.length - minTrain - gap) / folds);
  if (testSize < minTest) return unavailable('Development timestamps cannot fill the requested training/gap/test folds', { folds, minTrain, minTest, gap, timestamps: times.length });
  const results = [];
  for (let fold = 0; fold < folds; fold++) {
    await checkpoint(fold, signal);
    const testStart = minTrain + gap + fold * testSize, testEnd = fold === folds - 1 ? times.length - 1 : testStart + testSize - 1;
    const trainEnd = times[testStart - gap - 1], testStartExclusive = times[testStart - 1];
    const evidence = factorEvidence(dataset, expression, { start: testStartExclusive, end: times[testEnd], fitEnd: trainEnd });
    results.push({ fold: fold + 1, trainEnd, testStart: times[testStart], testEnd: times[testEnd], gap,
      status: Number.isFinite(evidence.metrics.rankIC) ? 'completed' : 'unavailable',
      ...(!Number.isFinite(evidence.metrics.rankIC) ? { reason: 'No measurable association in this test fold' } : {}),
      ...metricSummary(evidence.metrics), purgedBoundaryRows: evidence.metrics.purgedBoundaryRows, thresholdFitEnd: trainEnd });
  }
  const measured = results.filter(fold => fold.status === 'completed');
  return { status: measured.length === folds ? 'completed' : measured.length ? 'partial' : 'unavailable',
    ...(measured.length < folds ? { reason: 'Some forward folds have insufficient usable observations' } : {}),
    method: 'fixed-candidate-expanding-window', scope: 'development', folds: results, completedFolds: measured.length,
    meanRankIC: average(measured.map(fold => fold.rankIC)),
    assumptions: 'Candidate formula is fixed across folds; this is not a nested rerun of candidate discovery. Thresholds fit only training history; labels crossing each test end are purged.' };
}

function neighbors(expression, options) {
  const result = [], maxVariants = integer(options.maxVariants, 12, 2, 16, 'maxVariants');
  const step = integer(options.windowStep, 1, 1, 20, 'windowStep');
  const fraction = number(options.constantFraction, .1, Number.EPSILON, 1, 'constantFraction');
  function visit(node, path) {
    for (const key of ['window', 'value']) if (typeof node[key] === 'number') {
      const delta = key === 'window' ? step : Math.max(Math.abs(node[key]), 1) * fraction;
      for (const direction of [-1, 1]) {
        const value = node[key] + direction * delta;
        if ((key === 'window' && (value < 1 || value > 252)) || result.length >= maxVariants) continue;
        const candidate = structuredClone(expression); let target = candidate;
        for (const index of path) target = target.args[index];
        target[key] = value;
        try { validateExpression(candidate); } catch { continue; }
        result.push({ path: [...path.map(index => `args[${index}]`), key].join('.'), original: node[key], value, candidate });
      }
    }
    (node.args ?? []).forEach((child, index) => visit(child, [...path, index]));
  }
  visit(expression, []); return result;
}
async function sensitivity(dataset, expression, request, signal) {
  const options = config(request, ['maxVariants', 'windowStep', 'constantFraction']);
  const variants = neighbors(expression, options);
  if (!variants.length) return notApplicable('The candidate has no adjustable window or numeric constant');
  const baseline = evaluateFactor(dataset, expression).validation.rankIC, results = [];
  for (const [index, variant] of variants.entries()) {
    await checkpoint(index, signal);
    const metrics = evaluateFactor(dataset, variant.candidate).validation;
    const { candidate: _candidate, ...parameter } = variant;
    results.push({ ...parameter, ...metricSummary(metrics), status: Number.isFinite(metrics.rankIC) ? 'completed' : 'unavailable' });
  }
  const scores = results.map(result => result.rankIC).filter(Number.isFinite);
  return { status: scores.length === results.length ? 'completed' : scores.length ? 'partial' : 'unavailable',
    ...(!scores.length ? { reason: 'No finite neighbor association' } : {}),
    method: 'one-parameter-at-a-time-local-neighborhood', scope: 'validation', baseline,
    worstRankIC: scores.length ? Math.min(...scores) : null, bestRankIC: scores.length ? Math.max(...scores) : null,
    maxAbsoluteChange: baseline !== null && scores.length ? Math.max(...scores.map(score => Math.abs(score - baseline))) : null,
    variants: results, assumptions: 'Local diagnostic, not global Sobol sensitivity or automatic parameter selection.' };
}

function regimes(dataset, expression, request) {
  const options = config(request, ['field', 'bins', 'minObservations']);
  if (typeof options.field !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(options.field)) return unavailable('Specify an available point-in-time numeric state field');
  const bins = integer(options.bins, 3, 2, 5, 'bins'), minimum = integer(options.minObservations, 8, 4, 20000, 'minObservations');
  const training = dataset.rows.filter(row => row.time <= dataset.config.trainEnd && Number.isFinite(row.fields[options.field]));
  if (!training.length) return unavailable(`State field ${options.field} is absent from training data`);
  const thresholds = Object.fromEntries(groups(training, 'symbol').map(rows => [rows[0].symbol,
    Array.from({ length: bins - 1 }, (_, index) => quantile(rows.map(row => row.fields[options.field]), (index + 1) / bins))]));
  const evidence = factorEvidence(dataset, expression), partitions = Array.from({ length: bins }, () => []); let missing = 0;
  for (const row of evidence.observations) {
    const cuts = Object.hasOwn(thresholds, row.symbol) ? thresholds[row.symbol] : null, value = row.fields[options.field];
    if (!cuts || !Number.isFinite(value)) { missing++; continue; }
    let bin = 0; while (bin < cuts.length && value > cuts[bin]) bin++;
    partitions[bin].push(row);
  }
  const strata = partitions.map((items, index) => {
    const score = items.length < minimum ? null : association(items, evidence.mode, evidence.mode === 'time-series' ? minimum : 4);
    return { bin: index + 1, observations: items.length, rankIC: score,
      status: score === null ? 'unavailable' : 'completed', ...(score === null ? { reason: 'Insufficient within-stratum variation or paired observations' } : {}) };
  });
  const measured = strata.filter(item => item.status === 'completed').length;
  return { status: measured === bins ? 'completed' : measured ? 'partial' : 'unavailable',
    ...(measured < bins ? { reason: 'One or more states cannot support a separate association estimate' } : {}),
    method: 'training-quantile-state-stratification', scope: 'validation', field: options.field, minObservations: minimum,
    thresholdFitEnd: dataset.config.trainEnd, thresholdsBySymbol: Object.fromEntries(Object.entries(thresholds).slice(0, 32)),
    thresholdSymbolCount: Object.keys(thresholds).length, omittedThresholdDetails: Math.max(0, Object.keys(thresholds).length - 32), missingObservations: missing, strata,
    assumptions: 'The supplied state field must be observable at decision time; strata are not inferred hidden-state probabilities.' };
}

async function bootstrap(dataset, expression, request, signal) {
  const options = config(request, ['samples', 'seed', 'blockSize', 'confidence']);
  const confidence = number(options.confidence, .95, .5, .999, 'confidence');
  const evidence = factorEvidence(dataset, expression), observations = evidence.observations;
  if (!Number.isFinite(evidence.metrics.rankIC)) return unavailable('No measurable validation association');
  const partitions = evidence.mode === 'time-series' ? groups(observations, 'symbol').filter(rows => rows.length >= 8) : [evidence.ic];
  if (!partitions.length || partitions.some(items => items.length < 8)) return unavailable('At least 8 temporal observations per resampled series are needed');
  const minimumLength = Math.min(...partitions.map(items => items.length));
  const size = blockSize({ ...options, blockSize: options.blockSize ?? Math.max(dataset.config.horizon, Math.ceil(Math.cbrt(minimumLength))) }, minimumLength);
  if (size > Math.floor(minimumLength / 2)) return unavailable('blockSize must leave at least two observed blocks');
  const sampleConfig = sampling(options, observations.length), random = rng(sampleConfig.seed), scores = [], returns = [];
  const net = evidence.returns.map(row => row.net);
  const times = [...new Set(partitions.flat().map(row => row.time))].sort();
  for (let sample = 0; sample < sampleConfig.samples; sample++) {
    await checkpoint(sample, signal);
    // Shared market-time blocks retain simultaneous cross-symbol shocks and missingness.
    const sampledTimes = evidence.mode === 'time-series' ? resampleBlocks(times, size, random) : null;
    const multiplicity = sampledTimes ? new Map() : null;
    for (const time of sampledTimes ?? []) multiplicity.set(time, (multiplicity.get(time) ?? 0) + 1);
    const values = partitions.map(items => {
      // Rank correlation depends on the paired multiset, not row order. Visit
      // only each symbol's observations instead of every market timestamp.
      const sampled = multiplicity ? [] : resampleBlocks(items, size, random);
      if (multiplicity) for (const item of items) {
        const count = multiplicity.get(item.time) ?? 0;
        for (let repeat = 0; repeat < count; repeat++) sampled.push(item);
      }
      if (sampled.length < 4) return null;
      return evidence.mode === 'time-series' ? rankCorrelation(sampled.map(row => row.value), sampled.map(row => row.label)) : average(sampled.map(row => row.value));
    }).filter(value => value !== null);
    const score = average(values); if (score !== null) scores.push(score);
    if (net.length >= 8 && size <= Math.floor(net.length / 2)) returns.push(average(resampleBlocks(net, size, random)));
  }
  if (scores.length < 20) return unavailable('Fewer than 20 finite bootstrap statistics', { validSamples: scores.length, ...sampleConfig });
  const alpha = (1 - confidence) / 2;
  const interval = values => ({ low: quantile(values, alpha), high: quantile(values, 1 - alpha), validSamples: values.length });
  const includedObservations = evidence.mode === 'time-series' ? partitions.reduce((sum, items) => sum + items.length, 0) : observations.length;
  const observed = evidence.mode === 'time-series' ? association(partitions.flat(), evidence.mode) : evidence.metrics.rankIC;
  return { ...done({ method: 'paired-circular-block-percentile', scope: 'validation', ...sampleConfig, confidence, blockSize: size,
    samplingUnit: evidence.mode === 'time-series' ? 'shared-market-timestamps' : 'cross-sectional-IC-dates',
    observations: includedObservations, excludedObservations: observations.length - includedObservations,
    rankIC: { observed, ...interval(scores) },
    meanNetReturn: returns.length >= 20 ? { status: 'completed', observed: evidence.metrics.meanNetReturn, ...interval(returns) }
      : unavailable('Insufficient nonoverlapping returns for a separate return-mean interval'),
    assumptions: 'Percentile intervals use dependent paired blocks, not BCa; block length and stationarity affect coverage.' }),
    ...(returns.length < 20 || includedObservations < observations.length ? { status: 'partial', reason: 'Association interval completed; return interval or short per-symbol histories have limited coverage' } : {}) };
}

/** Each requested diagnostic is independent. Cancellation still cancels the invocation. */
export async function evaluateDiagnostics(dataset, expression, requested = {}, { signal, finalized = false } = {}) {
  if (!plain(requested) || Object.keys(requested).some(key => !Object.hasOwn(DIAGNOSTICS, key))) fail('Unknown diagnostic name');
  const methods = { placebo, monteCarlo, outOfSample: (d, e, r) => outOfSample(d, e, r, finalized), walkForward, sensitivity, regimes, bootstrap };
  const results = {};
  for (const name of Object.keys(DIAGNOSTICS)) {
    signal?.throwIfAborted();
    if (requested[name] === undefined || requested[name] === false) { results[name] = { status: 'not-requested' }; continue; }
    try { results[name] = await methods[name](dataset, expression, requested[name], signal); }
    catch (error) {
      signal?.throwIfAborted();
      results[name] = { status: 'error', reason: error.message, code: error.code ?? 'DIAGNOSTIC_COMPUTATION_FAILED' };
    }
  }
  return results;
}

export async function evaluateCandidate(dataset, expression, options = {}, signal) {
  const metrics = evaluateFactor(dataset, expression);
  // Save the exact plan with measured evidence so portable archives can reproduce it.
  metrics.diagnosticPlan = structuredClone(options.diagnostics ?? {});
  metrics.diagnostics = await evaluateDiagnostics(dataset, expression, metrics.diagnosticPlan, { signal });
  return metrics;
}
