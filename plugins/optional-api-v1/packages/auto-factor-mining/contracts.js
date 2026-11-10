import { createHash } from 'node:crypto';

export const VERSION = '3.1.0';
export const OPERATORS = Object.freeze(['Add', 'Sub', 'Mul', 'Div', 'Abs', 'Log', 'Ref', 'Mean', 'Std', 'Min', 'Max', 'Sum', 'Rank']);
export const COLLECTIONS = Object.freeze(Object.fromEntries(['jobs', 'trials', 'factors', 'evaluations', 'pools', 'feedback', 'searches'].map(name => [name, `factor_research_v1_${name}`])));
export const ARTIFACT_SCHEMAS = Object.freeze(['snapshot', 'source-rows', 'provider', 'provider-features', 'symbol-map', 'calendar', 'matrix', 'values', 'search-state', 'evidence', 'usage', 'history', 'provider-file'].map(name => `factor-${name}/1`));
export const MAX_SHARD_BYTES = 16 * 1024 * 1024;
export const error = (code, message, retryable = false) => Object.assign(new Error(message), { code, retryable });
export const ensure = (condition, message, code = 'INVALID_ARGUMENT') => { if (!condition) throw error(code, message); };
export const failure = e => ({ code: e?.code ?? 'FACTOR_FAILED', message: String(e?.message ?? e).slice(0, 2000), retryable: e?.retryable === true });
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { ensure(Number.isFinite(value), 'JSON numbers must be finite'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  ensure(object(value), 'Expected a JSON value');
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export const digest = value => `sha256:${createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex')}`;
export const OPERATOR_DIGEST = digest({ dsl: 'qlib-expr/1', version: 1, operators: [...OPERATORS], ref: 'positive-grid-lag', rolling: 'positive-grid-window', rank: 'rolling-time-series-average-ties-percentile', warmup: 'complete-lookback-grid', nonfinite: 'null' });
export const referenceIdentity = values => values.map(value => ({ snapshotId: value.snapshotId, partition: value.partition, engine: value.engine, candidates: value.candidates.filter(c => c.status === 'ok').map(c => ({ formula: c.value.candidate.formula, computeKey: c.value.computeKey })) }));
export const clone = value => JSON.parse(canonical(value));
export const identifier = (prefix, value) => `${prefix}_${digest(value).slice(7)}`;
export function keys(value, allowed, required = allowed) {
  ensure(object(value) && Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k)), `Expected fields: ${allowed.join(', ')}`);
  return value;
}
export const text = (value, max = 4096) => { ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Expected nonempty text within ${max} characters`); return value; };
const integer = (n, low, high) => ensure(Number.isSafeInteger(n) && n >= low && n <= high, `Expected integer ${low}–${high}`);
const proportion = n => ensure(Number.isFinite(n) && n >= 0 && n <= 1, 'Expected a proportion from zero to one');
const list = (v, max = 256) => ensure(Array.isArray(v) && v.length <= max, `Expected an array with at most ${max} entries`);
export function artifactRef(ref) {
  keys(ref, ['id', 'revision', 'digest', 'kind', 'schemaVersion']);
  for (const k of ['id', 'revision', 'kind']) text(ref[k], 256);
  ensure(ref.schemaVersion === '1.0.0' && /^sha256:[a-f0-9]{64}$/.test(ref.digest), 'Use a complete fixed artifact reference');
  return ref;
}
export function validateSource(value) {
  ensure(object(value) && Object.keys(value).length === 1, 'Source must choose datasetId or ref');
  if ('datasetId' in value) text(value.datasetId, 256);
  else { keys(value, ['ref']); artifactRef(value.ref); ensure(value.ref.kind === 'data', 'Fixed input must be a data artifact'); }
  return value;
}
export function validateLayout(value) {
  keys(value, ['universe', 'frequency', 'timezone', 'availableAt', 'development', 'holdout', 'target']);
  list(value.universe, 4096); ensure(value.universe.length > 0 && new Set(value.universe).size === value.universe.length, 'Universe must be nonempty and unique'); value.universe.forEach(s => text(s, 128));
  ensure(/^(?:[1-9]\d*(?:min|m|h|d)|day)$/.test(value.frequency), 'Frequency must be explicit minute/hour/day bars');
  ensure(value.timezone === 'UTC', 'Normalize source instants to the explicit UTC grid'); ensure(value.availableAt === 'bar_close', 'Features must be available by the bar close');
  for (const part of ['development', 'holdout']) {
    const range = value[part]; ensure(Array.isArray(range) && range.length === 2, `${part} requires a start and end`);
    range.forEach(t => ensure(typeof t === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(t) && Number.isFinite(Date.parse(t)), 'Times need an explicit UTC offset'));
    ensure(Date.parse(range[0]) <= Date.parse(range[1]), 'Partition dates must be ordered');
  }
  ensure(Date.parse(value.development[1]) < Date.parse(value.holdout[0]), 'Development must end before holdout starts');
  const t = value.target;
  keys(t, t?.kind === 'provided' ? ['kind', 'field', 'scale', 'horizonBars'] : ['kind', 'field', 'horizonBars']);
  ensure(['forward_return', 'forward_volatility', 'provided'].includes(t.kind), 'Unknown factor target');
  text(t.field, 64); integer(t.horizonBars, 1, 10000);
  if (t.kind === 'provided') ensure(['continuous', 'categorical'].includes(t.scale), 'Provided target needs its scale');
  return value;
}
export function validateBudget(value) {
  keys(value, ['maxCandidates', 'batchSize', 'maxWorkers', 'maxSeconds', 'maxInputBytes', 'maxOutputBytes', 'seed']);
  integer(value.maxCandidates, 1, 100000); integer(value.batchSize, 1, 64); integer(value.maxWorkers, 1, 16); integer(value.maxSeconds, 1, 86400);
  integer(value.maxInputBytes, 1024, 512 * 1024 * 1024); integer(value.maxOutputBytes, 1024, 512 * 1024 * 1024); integer(value.seed, 0, 2147483647);
  return value;
}
export function validateProfile(value, layout) {
  keys(value, ['id', 'version', 'kind', 'axis', 'minPairs', 'minCoverage', 'stabilityWindows', 'maxReferenceCorrelation', 'score', 'diagnostics']);
  text(value.id, 128); ensure(value.version === 1, 'Unknown profile version');
  ensure(['alpha', 'risk', 'state'].includes(value.kind) && ['time_series', 'cross_section'].includes(value.axis), 'Unknown factor profile/axis');
  integer(value.minPairs, 3, 1000000); proportion(value.minCoverage); integer(value.stabilityWindows, 2, 100); proportion(value.maxReferenceCorrelation);
  ensure(value.score === (value.kind === 'state' ? 'eta_squared' : 'abs_rank_ic'), 'Score must match the factor purpose');
  if (layout && value.kind === 'state') ensure(layout.target.kind === 'provided' && layout.target.scale === 'categorical', 'State profiles need categorical labels');
  if (layout && value.kind !== 'state') ensure(layout.target.kind !== 'provided' || layout.target.scale === 'continuous', 'Alpha/risk profiles need continuous labels');
  validateDiagnostics(value.diagnostics);
  return value;
}
export function validateDiagnostics(value) {
  list(value, 6); ensure(new Set(value.map(d => d.kind)).size === value.length, 'Diagnostic kinds must be unique');
  const options = { placebo: ['blockBars', 'seed', 'confidence'], bootstrap: ['blockBars', 'seed', 'confidence'], walk_forward: ['foldBars'], regimes: ['field', 'bins'], sensitivity: ['argumentPath', 'neighbors'], quantiles: ['count'] };
  for (const d of value) {
    const resampling = ['placebo', 'bootstrap'].includes(d.kind);
    keys(d, ['kind', 'required', 'repetitions', 'options'], resampling ? ['kind', 'required', 'repetitions', 'options'] : ['kind', 'required', 'options']);
    ensure(options[d.kind] && typeof d.required === 'boolean', 'Unknown diagnostic'); keys(d.options, options[d.kind]);
    if (resampling) { integer(d.repetitions, 1, 10000); integer(d.options.blockBars, 1, 100000); integer(d.options.seed, 0, 2147483647); ensure(d.options.confidence > 0 && d.options.confidence < 1, 'Confidence must be between zero and one'); }
    if (d.kind === 'walk_forward') integer(d.options.foldBars, 3, 1000000);
    if (d.kind === 'regimes') { text(d.options.field, 64); list(d.options.bins, 20); ensure(d.options.bins.length > 0 && d.options.bins.every((n, i, a) => Number.isFinite(n) && (!i || n > a[i - 1])), 'Regime thresholds must be fixed ordered values'); }
    if (d.kind === 'sensitivity') { list(d.options.argumentPath, 12); d.options.argumentPath.forEach(n => integer(n, 0, 1)); list(d.options.neighbors, 16); ensure(d.options.neighbors.length > 0 && d.options.neighbors.every(Number.isFinite), 'Sensitivity needs finite neighbors'); }
    if (d.kind === 'quantiles') integer(d.options.count, 2, 20);
  }
  return value;
}
export function validateFormula(formula, policy = {}) {
  const { fields, maxNodes = 128, maxDepth = 12, maxLookbackBars = 10000 } = policy;
  keys(formula, ['dsl', 'tree']); ensure(formula.dsl === 'qlib-expr/1', 'Unsupported formula DSL'); let nodes = 0;
  const visit = (tree, depth) => {
    ensure(++nodes <= maxNodes && depth <= maxDepth, 'Formula exceeds complexity budget'); ensure(object(tree), 'Expression node must be an object');
    if ('field' in tree) { keys(tree, ['field']); ensure(/^[a-z][a-z0-9_]{0,63}$/.test(tree.field), 'Invalid feature field'); ensure(!fields || fields.includes(tree.field), 'Feature outside declared data fields'); return { series: true, lookback: 0 }; }
    if ('constant' in tree) { keys(tree, ['constant']); ensure(Number.isFinite(tree.constant) && Math.abs(tree.constant) <= 1e12, 'Invalid numeric constant'); ensure(!policy.constants || policy.constants.includes(tree.constant), 'Scalar is outside declared constants'); return { series: false, lookback: 0 }; }
    keys(tree, ['call', 'args']); ensure(OPERATORS.includes(tree.call) && (!policy.operators || policy.operators.includes(tree.call)), 'Operator is not allowed'); ensure(Array.isArray(tree.args) && tree.args.length === (['Abs', 'Log'].includes(tree.call) ? 1 : 2), 'Wrong operator arity');
    const rolling = ['Ref', 'Mean', 'Std', 'Min', 'Max', 'Sum', 'Rank'].includes(tree.call);
    let children, lookback;
    if (rolling) {
      const first = visit(tree.args[0], depth + 1); ensure(++nodes <= maxNodes && depth + 1 <= maxDepth, 'Formula exceeds complexity budget'); keys(tree.args[1], ['constant']); integer(tree.args[1].constant, 1, 10000); ensure(first.series, 'Window operators require a series');
      const choices = tree.call === 'Ref' ? policy.lags : policy.windows; ensure(!choices || choices.includes(tree.args[1].constant), 'Window or lag outside declared search space');
      lookback = first.lookback + tree.args[1].constant - (tree.call === 'Ref' ? 0 : 1);
    } else { children = tree.args.map(arg => visit(arg, depth + 1)); ensure(children.some(c => c.series), 'An operator must consume a feature series'); lookback = Math.max(...children.map(c => c.lookback)); }
    ensure(lookback <= maxLookbackBars, 'Formula exceeds lookback budget'); return { series: true, lookback };
  }; ensure(visit(formula.tree, 1).series, 'A factor must produce a feature series'); return formula;
}
export function validateCandidate(candidate) {
  keys(candidate, ['id', 'formula', 'hypothesis', 'origin']); text(candidate.id, 128); text(candidate.hypothesis, 4000); validateFormula(candidate.formula);
  keys(candidate.origin, ['method', 'parents', 'parameters']); ensure(['seed', 'template', 'random', 'deap', 'optuna'].includes(candidate.origin.method), 'Unknown candidate origin'); list(candidate.origin.parents, 64); candidate.origin.parents.forEach(v => text(v, 128)); ensure(object(candidate.origin.parameters) && Object.keys(candidate.origin.parameters).length <= 32 && Object.values(candidate.origin.parameters).every(Number.isFinite), 'Invalid candidate parameters');
  return candidate;
}
export function validateSpace(value) {
  keys(value, ['fields', 'operators', 'windows', 'lags', 'constants', 'maxNodes', 'maxDepth', 'maxLookbackBars', 'seeds', 'templates']);
  for (const field of ['fields', 'operators', 'windows', 'lags', 'constants', 'seeds', 'templates']) list(value[field], 64);
  ensure(value.fields.length > 0 && value.fields.every(v => /^[a-z][a-z0-9_]{0,63}$/.test(v)), 'Declare available features');
  ensure(value.operators.every(v => OPERATORS.includes(v)), 'Unknown search operator');
  for (const n of [...value.windows, ...value.lags]) integer(n, 1, 10000);
  ensure(value.constants.every(n => Number.isFinite(n) && Math.abs(n) <= 1e12), 'Constants must be finite');
  integer(value.maxNodes, 1, 128); integer(value.maxDepth, 1, 12); integer(value.maxLookbackBars, 1, 10000);
  value.seeds.forEach(f => validateFormula(f, value));
  for (const template of value.templates) { keys(template, ['tree', 'domains']); ensure(object(template.domains) && Object.keys(template.domains).length <= 16, 'Template domains must be bounded'); for (const [key, domain] of Object.entries(template.domains)) { text(key, 64); list(domain, 64); ensure(domain.length && domain.every(Number.isFinite), 'Template domains need finite choices'); } }
  return value;
}
export function validateExecutionBudget(value) {
  keys(value, ['maxSeconds', 'maxInputBytes', 'maxOutputBytes']);
  integer(value.maxSeconds, 1, 86400);
  integer(value.maxInputBytes, 1024, 512 * 1024 * 1024); integer(value.maxOutputBytes, 1024, 512 * 1024 * 1024);
  return value;
}
export function validateSearchBudget(value) {
  keys(value, ['maxSeconds', 'maxInputBytes', 'maxOutputBytes', 'maxCandidates', 'batchSize', 'seed']);
  const { maxCandidates, batchSize, seed, ...resources } = value;
  validateExecutionBudget(resources); integer(maxCandidates, 1, 100000); integer(batchSize, 1, 64); integer(seed, 0, 2147483647);
  return value;
}
export function operationBudget(resources, count = 1) {
  validateExecutionBudget(resources); integer(count, 1, 64);
  return { ...resources, maxCandidates: count, batchSize: count, maxWorkers: 1, seed: 0 };
}
function resourceRef(ref) { artifactRef(ref); ensure(ref.kind === 'resource', 'Use a fixed factor resource reference'); }
export function validatePrepare(value) {
  keys(value, ['requestId', 'source', 'layout', 'budget']); text(value.requestId, 128);
  validateSource(value.source); validateLayout(value.layout); validateExecutionBudget(value.budget); return value;
}
export function validateComputeInput(value) {
  keys(value, ['requestId', 'snapshotRef', 'formulas', 'partition', 'budget', 'diagnostics'], ['requestId', 'snapshotRef', 'formulas', 'partition', 'budget']);
  text(value.requestId, 128); resourceRef(value.snapshotRef); validateExecutionBudget(value.budget);
  ensure(['development', 'holdout'].includes(value.partition), 'Choose the data partition explicitly');
  list(value.formulas, 64); ensure(value.formulas.length > 0, 'At least one formula is required'); value.formulas.forEach(validateCandidate);
  ensure(new Set(value.formulas.map(c => c.id)).size === value.formulas.length, 'Candidate IDs must be unique');
  if (value.diagnostics !== undefined) validateDiagnostics(value.diagnostics);
  return value;
}
export function validateEvaluateInput(value) {
  keys(value, ['requestId', 'valuesRef', 'profile', 'referenceValues', 'budget']);
  text(value.requestId, 128); resourceRef(value.valuesRef); validateProfile(value.profile); validateExecutionBudget(value.budget);
  list(value.referenceValues, 32); value.referenceValues.forEach(resourceRef);
  ensure(new Set(value.referenceValues.map(canonical)).size === value.referenceValues.length, 'Reference values must be unique');
  return value;
}
export function validateSearchInput(value) {
  ensure(['open', 'propose', 'read'].includes(value?.action), 'Choose open, propose or read');
  if (value.action === 'open') {
    keys(value, ['action', 'requestId', 'snapshotRef', 'need', 'space', 'profile', 'references', 'budget']);
    text(value.requestId, 128); resourceRef(value.snapshotRef); text(value.need, 8000); validateSpace(value.space); validateProfile(value.profile); validateSearchBudget(value.budget);
    list(value.references, 32); value.references.forEach(id => text(id, 128));
    ensure(new Set(value.references).size === value.references.length, 'Reference factor IDs must be unique');
    ensure(Buffer.byteLength(canonical(value)) <= 96000, 'Search request exceeds 96 KB');
  } else if (value.action === 'propose') {
    keys(value, ['action', 'requestId', 'searchId', 'limit', 'feedback']); text(value.requestId, 128); text(value.searchId, 128); integer(value.limit, 0, 64);
    list(value.feedback, 64); for (const item of value.feedback) { keys(item, ['factorId', 'evaluationId']); text(item.factorId, 128); text(item.evaluationId, 128); }
    ensure(new Set(value.feedback.map(canonical)).size === value.feedback.length, 'Feedback evaluation identifiers must be unique');
  } else { keys(value, ['action', 'searchId']); text(value.searchId, 128); }
  return value;
}
