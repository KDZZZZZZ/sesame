import { createHash } from 'node:crypto';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const reject = message => { throw Object.assign(new Error(message), { code: 'INVALID_EVALUATION_PLAN' }); };
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
const compare = { gte: (a, b) => a >= b, lte: (a, b) => a <= b, gt: (a, b) => a > b, lt: (a, b) => a < b, eq: (a, b) => a === b };
const safePath = value => typeof value === 'string' && value.length <= 200 && /^(validation|diagnostics|redundancy)\.[A-Za-z0-9_.]+$/.test(value)
  && value.split('.').every(item => item && !['__proto__', 'prototype', 'constructor'].includes(item))
  && !value.startsWith('diagnostics.outOfSample.holdout.');
function normalized(value) { return Array.isArray(value) ? value.map(normalized) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value; }
export const planDigest = plan => `sha256:${createHash('sha256').update(JSON.stringify(normalized(plan))).digest('hex')}`;

export function normalizeEvaluationPlan(options, diagnosticNames) {
  const raw = options.evaluationPlan ?? {};
  if (!plain(raw) || Object.keys(raw).some(key => !['tests', 'thresholds', 'reasons'].includes(key))) reject('Use evaluationPlan tests, thresholds and reasons');
  const tests = { ...(options.diagnostics ?? {}), ...(raw.tests ?? {}) }, reasons = raw.reasons ?? {};
  if ((raw.tests !== undefined && !plain(raw.tests)) || !plain(reasons) || Object.keys(tests).some(key => !diagnosticNames.includes(key)) ||
    Object.values(tests).some(value => typeof value !== 'boolean' && !plain(value)) ||
    Object.entries(reasons).some(([key, value]) => !diagnosticNames.includes(key) || !text(value))) reject('Use known diagnostic names and brief reasons');
  if (!Array.isArray(raw.thresholds ?? []) || (raw.thresholds ?? []).length > 40) reject('Use at most 40 evidence thresholds');
  const thresholds = (raw.thresholds ?? []).map((entry, index) => {
    if (!plain(entry) || Object.keys(entry).some(key => !['metric', 'value', 'operator', 'mode', 'source', 'reason'].includes(key)) ||
      !safePath(entry.metric) || !Number.isFinite(entry.value) || !Object.hasOwn(compare, entry.operator) ||
      !['advisory', 'required'].includes(entry.mode ?? 'advisory') || !['agent', 'user'].includes(entry.source ?? 'agent') || !text(entry.reason))
      reject(`Invalid evaluationPlan threshold ${index + 1}`);
    return { metric: entry.metric, value: entry.value, operator: entry.operator, mode: entry.mode ?? 'advisory', source: entry.source ?? 'agent', reason: entry.reason };
  });
  for (const [key, metric, operator] of [['minRankIC', 'validation.rankIC', 'gte'], ['minCoverage', 'validation.coverage', 'gte'], ['maxCorrelation', 'redundancy.absoluteCorrelation', 'lte']]) {
    if (options[key] !== undefined) thresholds.push({ metric, value: options[key], operator, mode: 'advisory', source: 'agent',
      reason: `Legacy ${key} is advisory in 1.2; an Agent argument is not evidence of a user hard requirement.` });
  }
  const plan = { tests: structuredClone(tests), thresholds, reasons: structuredClone(reasons) };
  if (Buffer.byteLength(JSON.stringify(thresholds)) > 8000) reject('Keep threshold descriptions within 8KB');
  if (Buffer.byteLength(JSON.stringify(plan)) > 12000) reject('Keep the evaluation plan within 12KB');
  return plan;
}

function pathValue(object, path) {
  let value = object;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/** Evidence eligibility is distinct from usefulness, prediction or scientific success. */
export function assessCandidate(metrics, plan, { phase = 'candidate', searchDiagnostics, trialId, redundancy } = {}) {
  const diagnostics = { ...metrics.diagnostics, ...(searchDiagnostics ? { dsr: searchDiagnostics.dsr?.byTrial?.[trialId] ?? searchDiagnostics.dsr, pbo: searchDiagnostics.pbo } : {}) };
  const root = { ...metrics, diagnostics, ...(redundancy ? { redundancy } : {}) };
  const measuredEvidence = [], conditions = [], invalidations = [], limitations = [];
  if (Number.isFinite(metrics.validation?.rankIC)) measuredEvidence.push({ metric: 'validation.rankIC', value: metrics.validation.rankIC, scope: 'validation' });
  if (Number.isFinite(metrics.validation?.meanNetReturn) && metrics.validation.portfolioPeriods >= 3) measuredEvidence.push({ metric: 'validation.meanNetReturn', value: metrics.validation.meanNetReturn, scope: 'validation', observations: metrics.validation.portfolioPeriods });
  for (const [index, item] of (diagnostics.regimes?.strata ?? []).entries()) if (Number.isFinite(item.rankIC) && item.status === 'completed') {
    const evidence = { metric: `diagnostics.regimes.strata.${index}.rankIC`, value: item.rankIC, scope: 'validation-state',
      condition: { field: diagnostics.regimes.field, bin: item.bin, thresholdFitEnd: diagnostics.regimes.thresholdFitEnd }, observations: item.observations, evidenceStatus: 'exploratory' };
    measuredEvidence.push(evidence); conditions.push(evidence);
  }
  for (const [index, item] of (diagnostics.walkForward?.folds ?? []).entries()) if (Number.isFinite(item.rankIC) && item.status === 'completed') {
    const evidence = { metric: `diagnostics.walkForward.folds.${index}.rankIC`, value: item.rankIC, scope: 'development-forward-fold',
      condition: { trainEnd: item.trainEnd, testStart: item.testStart, testEnd: item.testEnd }, observations: item.observations, evidenceStatus: 'exploratory' };
    measuredEvidence.push(evidence); conditions.push(evidence);
  }
  const measured = measuredEvidence.length > 0, overall = Number.isFinite(metrics.validation?.rankIC);
  if (conditions.length) limitations.push('Conditions examined or discovered on development data are exploratory, not independently validated. Keep unfavorable and unavailable strata/folds; a favorable subset does not establish general validity.');
  for (const [name, items] of [['regimes.strata', diagnostics.regimes?.strata], ['walkForward.folds', diagnostics.walkForward?.folds]])
    for (const [index, item] of (items ?? []).entries()) if (!Number.isFinite(item.rankIC)) invalidations.push({ metric: `diagnostics.${name}.${index}.rankIC`, status: 'unavailable', reason: item.reason ?? 'Subset association is unmeasurable' });
  if (!overall) limitations.push('No overall validation association; any eligible use is limited to the identified return or development-subset evidence.');
  for (const [name, result] of Object.entries(diagnostics)) if (result && ['unavailable', 'not-applicable', 'error', 'partial', 'deferred'].includes(result.status))
    limitations.push(`${name}: ${result.reason ?? result.status}`);
  const thresholdResults = plan.thresholds.map(entry => {
    const hard = entry.source === 'user' && entry.mode === 'required', actual = pathValue(root, entry.metric);
    const searchPending = phase === 'candidate' && /^diagnostics\.(dsr|pbo)\./.test(entry.metric) && diagnostics[entry.metric.split('.')[1]]?.status === 'deferred';
    const pairPending = phase === 'candidate' && entry.metric.startsWith('redundancy.');
    const vacuous = phase === 'select' && entry.metric === 'redundancy.absoluteCorrelation' && redundancy?.pairCount === 0;
    const status = searchPending || pairPending ? 'deferred' : vacuous ? 'not-applicable' : !Number.isFinite(actual) ? 'unavailable'
      : compare[entry.operator](actual, entry.value) ? 'met' : 'unmet';
    return { ...entry, hard, status, actual: Number.isFinite(actual) ? actual : null,
      ...(vacuous ? { reason: `${entry.reason} No selected peer exists for a pairwise constraint.` } : {}) };
  });
  const finding = item => ({ thresholdIndex: thresholdResults.indexOf(item), metric: item.metric, status: item.status, actual: item.actual, operator: item.operator, expected: item.value });
  const hardRequirementFailures = thresholdResults.filter(item => item.hard && ['unmet', 'unavailable'].includes(item.status)).map(finding);
  const pendingHardRequirements = thresholdResults.filter(item => item.hard && item.status === 'deferred').map(finding);
  const advisoryFindings = thresholdResults.filter(item => !item.hard && ['unmet', 'unavailable'].includes(item.status)).map(finding);
  const limitedOverall = !overall || conditions.length > 0 && thresholdResults.some(item => item.metric === 'validation.rankIC' && item.status === 'unmet');
  invalidations.push(...thresholdResults.filter(item => ['unmet', 'unavailable'].includes(item.status)).map(item => ({ thresholdIndex: thresholdResults.indexOf(item), metric: item.metric, status: item.status })));
  return { status: measured ? limitedOverall ? 'conditional' : 'measured' : 'not-evaluable', eligible: measured && !hardRequirementFailures.length,
    planDigest: planDigest(plan), thresholdResults, hardRequirementFailures, pendingHardRequirements, advisoryFindings,
    measuredEvidence, conditions, invalidations, limitations, evidenceStatus: 'exploratory-development',
    interpretation: 'Measurable evidence permits research consideration; it does not establish usefulness, future profit, or all-test success.' };
}
