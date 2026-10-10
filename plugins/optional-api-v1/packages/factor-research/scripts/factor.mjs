#!/usr/bin/env node
// Original, dependency-free descriptive factor diagnostics; no engine or orders.
import { createHash } from 'node:crypto';
import { openSync, readSync, readFileSync, closeSync, fstatSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const object = (value, keys, label) => {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  check(Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)), `${label}: exact fields required: ${keys.join(', ')}`);
};
const text = (value, label) => check(typeof value === 'string' && value.trim().length > 0 && value.length <= 2000, `${label}: nonempty text <=2000 required`);
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const fixedDigest = value => typeof value === 'string' && hashPattern.test(value);
export const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  check(value === null || ['string', 'boolean', 'number'].includes(typeof value), 'Only JSON values supported');
  check(typeof value !== 'number' || Number.isFinite(value), 'Non-finite JSON number'); return JSON.stringify(value);
}
export const jsonDigest = value => digest(canonical(value));
export function instant(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), 'Canonical UTC timestamp required; ambiguous wall clocks are unsupported');
  const at = Date.parse(value); check(Number.isFinite(at) && new Date(at).toISOString() === value, 'Invalid UTC calendar timestamp'); return at;
}
function decimal(value, label, min = -1e12, max = 1e12) {
  check(typeof value === 'string' && value.length <= 100 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value), `${label}: finite decimal text required`);
  const number = Number(value); check(Number.isFinite(number) && number >= min && number <= max, `${label}: outside supported numeric range`); return number;
}
export function validatePlan(plan) {
  object(plan, ['schemaVersion', 'experimentId', 'data', 'factors', 'splits', 'embargoMs', 'portfolio', 'trialBudget', 'selectionRule'], 'plan');
  check(plan.schemaVersion === 1, 'Unsupported factor plan'); text(plan.experimentId, 'experimentId');
  object(plan.data, ['developmentSha256', 'holdoutSha256', 'provenance', 'description', 'universe', 'adjustment', 'delistings', 'availability', 'evidence'], 'data');
  check(fixedDigest(plan.data.developmentSha256) && fixedDigest(plan.data.holdoutSha256) && plan.data.developmentSha256 !== plan.data.holdoutSha256, 'Separate fixed development and holdout byte digests required');
  check(['demo', 'observed', 'derived', 'user_input'].includes(plan.data.provenance), 'Declare input provenance'); text(plan.data.description, 'data description');
  check(['point-in-time', 'unknown'].includes(plan.data.universe), 'Declare PIT universe or unknown');
  check(['raw', 'split', 'total-return', 'unknown'].includes(plan.data.adjustment), 'Declare adjustment mode');
  check(['included', 'not-applicable', 'unknown'].includes(plan.data.delistings), 'Declare delisting handling');
  check(['timestamped', 'unknown'].includes(plan.data.availability), 'Declare availability evidence');
  check(Array.isArray(plan.data.evidence) && plan.data.evidence.length > 0 && plan.data.evidence.length <= 32, 'Source as-of references/digests required'); plan.data.evidence.forEach(value => text(value, 'source evidence'));
  check(Array.isArray(plan.factors) && plan.factors.length >= 1 && plan.factors.length <= 16, 'Choose 1–16 factors; no hidden formula search');
  const ids = new Set();
  for (const factor of plan.factors) {
    object(factor, ['id', 'direction', 'definition'], 'factor');
    check(typeof factor.id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(factor.id) && !ids.has(factor.id), 'Unique simple factor IDs required'); ids.add(factor.id);
    check(factor.direction === 1 || factor.direction === -1, 'Fix the factor direction before screening'); text(factor.definition, 'factor definition');
  }
  check(Array.isArray(plan.splits) && plan.splits.length === 3, 'Three chronological splits required'); let end = -Infinity;
  for (const [index, split] of plan.splits.entries()) {
    object(split, ['name', 'start', 'end'], 'split');
    check(split.name === ['train', 'validation', 'holdout'][index], 'Expected train, validation, holdout order');
    const start = instant(split.start), stop = instant(split.end); check(start >= end && stop > start, 'Splits overlap or reverse'); end = stop;
  }
  check(Number.isSafeInteger(plan.embargoMs) && plan.embargoMs >= 0 && plan.embargoMs <= 31 * 86400000, 'embargoMs must be 0–31 days');
  object(plan.portfolio, ['tailFraction', 'minAssets', 'oneWayCostBps', 'borrowBpsPerPeriod', 'returnDefinition'], 'portfolio');
  check(typeof plan.portfolio.tailFraction === 'number' && plan.portfolio.tailFraction > 0 && plan.portfolio.tailFraction <= 0.5, 'tailFraction must be (0,0.5]');
  check(Number.isSafeInteger(plan.portfolio.minAssets) && plan.portfolio.minAssets >= 4 && plan.portfolio.minAssets <= 1000, 'minAssets must be 4–1000');
  decimal(plan.portfolio.oneWayCostBps, 'oneWayCostBps', 0, 10000); decimal(plan.portfolio.borrowBpsPerPeriod, 'borrowBpsPerPeriod', 0, 10000);
  check(plan.portfolio.returnDefinition === 'simple-total-return-fraction', 'Labels must explicitly include the declared income/delisting convention as simple return fractions');
  check(Number.isSafeInteger(plan.trialBudget) && plan.trialBudget >= plan.factors.length && plan.trialBudget <= 1000, 'Budget must cover every factor/direction tried'); text(plan.selectionRule, 'predeclared selection rule');
  return { planDigest: jsonDigest(plan), limitations: [
    'Descriptive binary64 statistics; original decimal text and byte digests remain the source of record.',
    'No p-values, DSR, PBO or significance claims. All candidates/directions and prior trials must remain in the experiment ledger.',
    'Fixed timestamps are checked, not independently certified vendor publication times; a holdout can be contaminated by prior research outside these files.',
    'Portfolio output is a gross-one, half-long/half-short, flat-to-flat diagnostic with fixed round-trip costs, not a broker backtest. Shortability, liquidity, execution timing and capacity are unverified.',
    ...['universe', 'adjustment', 'delistings', 'availability'].filter(key => plan.data[key] === 'unknown').map(key => `Unknown ${key}: do not treat these diagnostics as market-valid strategy evidence.`),
  ] };
}

export function validateRows(plan, rows, stage) {
  validatePlan(plan); check(['screen', 'holdout'].includes(stage), 'Invalid evaluation stage');
  check(Array.isArray(rows) && rows.length > 0 && rows.length <= 50000, 'Expected 1–50000 fixed rows');
  const seen = new Set(), groups = { train: new Map(), validation: new Map(), holdout: new Map() }, purged = [], counts = { supplied: rows.length, ineligible: 0 };
  for (const row of rows) {
    object(row, ['instrument', 'decisionAt', 'universeKnownAt', 'eligible', 'features', 'label'], 'row');
    text(row.instrument, 'instrument'); check(typeof row.eligible === 'boolean', 'Universe membership must be explicit');
    const at = instant(row.decisionAt); check(instant(row.universeKnownAt) <= at, 'Universe membership was not known at decision time');
    const key = `${row.instrument}\u0000${row.decisionAt}`; check(!seen.has(key), 'Duplicate instrument/decision row'); seen.add(key);
    const index = plan.splits.findIndex(split => at >= instant(split.start) && at < instant(split.end)); check(index >= 0, 'Rows outside declared split boundaries');
    const split = plan.splits[index]; check(stage === 'screen' ? index < 2 : index === 2, 'Development/holdout data must be physically separate; no out-of-stage rows');
    object(row.features, plan.factors.map(factor => factor.id), 'features');
    for (const factor of plan.factors) {
      const feature = row.features[factor.id]; object(feature, ['value', 'availableAt'], 'feature');
      if (feature.value === null) check(feature.availableAt === null, 'Unavailable factor must use null value and null availability');
      else { decimal(feature.value, `factor ${factor.id}`); check(instant(feature.availableAt) <= at, `Future feature ${factor.id} at ${row.decisionAt}`); }
    }
    object(row.label, ['start', 'end', 'availableAt', 'return', 'status'], 'label');
    const start = instant(row.label.start), end = instant(row.label.end), available = instant(row.label.availableAt);
    check(start >= at && end > start && available >= end, 'Label must start no earlier than decision and become available no earlier than its end');
    check(['observed', 'delisting_included', 'unavailable'].includes(row.label.status), 'Explicit return/delisting status required');
    if (row.label.return === null) check(row.label.status === 'unavailable', 'Missing return must be unavailable');
    else { decimal(row.label.return, 'simple return fraction', -1, 100); check(row.label.status !== 'unavailable', 'Unavailable return cannot carry an invented value'); }
    if (!row.eligible) { counts.ineligible++; continue; }
    check(row.label.return !== null, 'Eligible instrument has unavailable label; never silently drop delistings or fill missing returns with zero');
    const cutoff = index < 2 ? Math.min(instant(split.end), instant(plan.splits[index + 1].start) - plan.embargoMs) : instant(split.end);
    if (end > cutoff || available > cutoff) { purged.push({ instrument: row.instrument, decisionAt: row.decisionAt, reason: 'label_end_or_availability_overlaps_boundary_or_embargo' }); continue; }
    const group = groups[split.name].get(row.decisionAt) ?? [];
    if (group.length) check(group[0].label.start === row.label.start && group[0].label.end === row.label.end, 'Cross-section must compare identical label intervals');
    group.push(row); groups[split.name].set(row.decisionAt, group);
  }
  for (const group of Object.values(groups)) {
    let priorEnd = -Infinity;
    for (const [, rowsAt] of [...group].sort(([a], [b]) => a.localeCompare(b))) {
      const start = instant(rowsAt[0].label.start), end = instant(rowsAt[0].label.end);
      check(start >= priorEnd, 'Overlapping holding intervals are unsupported by this flat-to-flat diagnostic'); priorEnd = end;
    }
  }
  return { groups, purged, counts };
}
export function ranks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value), result = Array(values.length);
  for (let i = 0; i < order.length;) { let j = i + 1; while (j < order.length && order[j].value === order[i].value) j++; const rank = (i + 1 + j) / 2; for (let k = i; k < j; k++) result[order[k].index] = rank; i = j; }
  return result;
}
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function sd(values) { if (values.length < 2) return null; const m = mean(values); return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1)); }
export function spearman(x, y) {
  check(x.length === y.length && x.length >= 2, 'Correlation requires paired observations');
  const a = ranks(x), b = ranks(y), am = mean(a), bm = mean(b);
  const numerator = a.reduce((sum, value, i) => sum + (value - am) * (b[i] - bm), 0), denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - am) ** 2, 0) * b.reduce((sum, value) => sum + (value - bm) ** 2, 0));
  return denominator === 0 ? null : Math.max(-1, Math.min(1, numerator / denominator));
}
function metrics(plan, group, factor) {
  const periods = []; let missingFeatures = 0;
  for (const [decisionAt, all] of [...group].sort(([a], [b]) => a.localeCompare(b))) {
    const rows = all.filter(row => row.features[factor.id].value !== null).sort((a, b) => a.instrument.localeCompare(b.instrument));
    missingFeatures += all.length - rows.length;
    if (rows.length < plan.portfolio.minAssets) { periods.push({ decisionAt, eligible: all.length, covered: rows.length, status: 'insufficient_coverage', rankIC: null, gross: null, net: null }); continue; }
    const values = rows.map(row => Number(row.features[factor.id].value) * factor.direction), returns = rows.map(row => Number(row.label.return)), tail = Math.max(1, Math.floor(rows.length * plan.portfolio.tailFraction));
    const counts = new Map(); for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    const lowValues = new Set(), highValues = new Set(); let before = 0;
    for (const [value, count] of [...counts].sort(([a], [b]) => a - b)) {
      if (before + count <= tail) lowValues.add(value);
      if (before >= values.length - tail) highValues.add(value);
      before += count;
    }
    const low = rows.map((_, i) => i).filter(i => lowValues.has(values[i])), high = rows.map((_, i) => i).filter(i => highValues.has(values[i]));
    // Keep tied values together. A tie straddling a boundary is excluded;
    // never use symbol sort order to manufacture a long/short signal.
    const rankIC = spearman(values, returns);
    if (!low.length || !high.length || low.some(i => high.includes(i))) { periods.push({ decisionAt, eligible: all.length, covered: rows.length, status: 'indeterminate_tails', rankIC, gross: null, net: null }); continue; }
    const gross = 0.5 * mean(high.map(i => returns[i])) - 0.5 * mean(low.map(i => returns[i]));
    const cost = 2 * Number(plan.portfolio.oneWayCostBps) / 10000 + 0.5 * Number(plan.portfolio.borrowBpsPerPeriod) / 10000;
    periods.push({ decisionAt, eligible: all.length, covered: rows.length, status: 'computed', rankIC, long: high.map(i => rows[i].instrument), short: low.map(i => rows[i].instrument), gross, cost, net: gross - cost, absoluteTurnover: 2 });
  }
  const ic = periods.map(row => row.rankIC).filter(value => value !== null), returns = periods.filter(row => row.net !== null).map(row => row.net);
  const compound = returns.length && returns.every(value => value > -1) ? returns.reduce((nav, value) => nav * (1 + value), 1) - 1 : null;
  check(compound === null || Number.isFinite(compound), 'Compounded diagnostic exceeds numeric budget');
  return { factor: factor.id, direction: factor.direction, periods: periods.length, validICPeriods: ic.length, missingFeatures, rankICMean: mean(ic), rankICSampleSD: sd(ic), meanNetDiagnostic: mean(returns), cumulativeNetDiagnostic: compound, computedPortfolioPeriods: returns.length, curve: periods };
}
function redundant(plan, group) {
  const result = [];
  for (let i = 0; i < plan.factors.length; i++) for (let j = i + 1; j < plan.factors.length; j++) {
    const a = plan.factors[i], b = plan.factors[j], perPeriod = [];
    for (const rows of group.values()) {
      const paired = rows.filter(row => row.features[a.id].value !== null && row.features[b.id].value !== null);
      if (paired.length >= plan.portfolio.minAssets) { const value = spearman(paired.map(row => Number(row.features[a.id].value) * a.direction), paired.map(row => Number(row.features[b.id].value) * b.direction)); if (value !== null) perPeriod.push(value); }
    }
    result.push({ a: a.id, b: b.id, pairedPeriods: perPeriod.length, meanRankCorrelation: mean(perPeriod) });
  }
  return result;
}
const scriptDigest = digest(readFileSync(fileURLToPath(import.meta.url)));
function evidence(plan) { return { schemaVersion: 1, experimentId: plan.experimentId, provenance: plan.data.provenance, planDigest: jsonDigest(plan), scriptDigest, methodVersion: '1.0.0', statisticalInference: 'not_performed', trialsInThisScreen: plan.factors.length, trialBudget: plan.trialBudget, inputQuality: ['universe', 'adjustment', 'delistings', 'availability'].some(key => plan.data[key] === 'unknown') ? 'limited' : 'declared_only', ...validatePlan(plan) }; }
export function screen(plan, rows) {
  const checked = validateRows(plan, rows, 'screen');
  check(checked.groups.train.size >= 2 && checked.groups.validation.size >= 2, 'Need at least two retained periods in each development split');
  return { ...evidence(plan), kind: 'factor-screen', developmentDigest: plan.data.developmentSha256, counts: checked.counts, purged: checked.purged, train: plan.factors.map(factor => metrics(plan, checked.groups.train, factor)), validation: plan.factors.map(factor => metrics(plan, checked.groups.validation, factor)), redundancyTrainOnly: redundant(plan, checked.groups.train), holdoutRead: false, selected: null };
}
export function select(plan, screening, factorId) {
  validatePlan(plan);
  check(screening?.kind === 'factor-screen' && screening.planDigest === jsonDigest(plan) && screening.scriptDigest === scriptDigest && screening.developmentDigest === plan.data.developmentSha256 && screening.holdoutRead === false, 'Selection needs the fixed matching development screen and script');
  check(plan.factors.some(factor => factor.id === factorId), 'Select one explicitly declared factor');
  check([screening.train, screening.validation].every(list => Array.isArray(list) && list.some(row => row.factor === factorId && row.validICPeriods >= 2 && row.computedPortfolioPeriods >= 2)), 'Selected factor has insufficient development coverage or constant/tied tails');
  return { kind: 'factor-selection', schemaVersion: 1, experimentId: plan.experimentId, planDigest: jsonDigest(plan), screenDigest: jsonDigest(screening), developmentDigest: plan.data.developmentSha256, holdoutDigest: plan.data.holdoutSha256, factor: factorId, selectionRule: plan.selectionRule, holdoutUsesAllowed: 1, provenance: plan.data.provenance };
}
function validateSelection(plan, screening, selection) {
  check(canonical(selection) === canonical(select(plan, screening, selection?.factor)), 'Selection differs from the fixed development evidence; freeze it before opening holdout data');
}
export function holdout(plan, rows, screening, selection) {
  validateSelection(plan, screening, selection);
  const checked = validateRows(plan, rows, 'holdout'); check(checked.groups.holdout.size >= 2, 'Need at least two retained holdout periods');
  const factor = plan.factors.find(factor => factor.id === selection.factor);
  return { ...evidence(plan), kind: 'factor-holdout', selectionDigest: jsonDigest(selection), screenDigest: jsonDigest(screening), holdoutDigest: plan.data.holdoutSha256, counts: checked.counts, purged: checked.purged, selected: metrics(plan, checked.groups.holdout, factor), otherCandidatesEvaluated: false, holdoutExposure: 'Record this exposure in the durable experiment ledger; local files cannot detect hidden reruns or certify untouched data.' };
}

export function readJson(path, maximum = 16 * 1024 * 1024) {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd); check(stat.isFile() && stat.size <= maximum, 'Input must be a bounded ordinary JSON file');
    const bytes = Buffer.alloc(maximum + 1); let size = 0, read;
    while ((read = readSync(fd, bytes, size, bytes.length - size, null)) > 0) { size += read; check(size <= maximum, 'Input grew beyond the byte budget'); }
    const fixed = bytes.subarray(0, size); return { bytes: fixed, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fixed)) };
  } finally { closeSync(fd); }
}
function writeResult(path, result) {
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  if (!path) return process.stdout.write(bytes);
  try { writeFileSync(path, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST' || !readFileSync(path).equals(bytes)) throw error; }
}
const isMain = () => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  try {
    const args = process.argv.slice(2), outIndex = args.indexOf('--out'); let output;
    if (outIndex !== -1) { check(outIndex === args.length - 2, '--out <new-file> must be last'); output = args.splice(outIndex)[1]; }
    const [command, planPath, dataPath, screenPath, selectionPath] = args;
    check(['screen', 'select', 'holdout'].includes(command) && args.length === ({ screen: 3, select: 4, holdout: 5 })[command], 'Usage: node factor.mjs screen PLAN DEVELOPMENT | select PLAN SCREEN FACTOR_ID | holdout PLAN HOLDOUT SCREEN SELECTION [--out NEW_JSON]');
    const plan = readJson(planPath, 256 * 1024).value; validatePlan(plan);
    let result;
    if (command === 'select') result = select(plan, readJson(dataPath).value, screenPath);
    else {
      // Validate the sealed development choice before opening any holdout bytes.
      // Even an unsuccessful request must not accidentally expose the holdout.
      let screening, selection;
      if (command === 'holdout') {
        screening = readJson(screenPath).value; selection = readJson(selectionPath).value;
        validateSelection(plan, screening, selection);
      }
      const input = readJson(dataPath), expected = command === 'screen' ? plan.data.developmentSha256 : plan.data.holdoutSha256;
      check(digest(input.bytes) === expected, 'Data bytes differ from the predeclared fixed digest');
      result = command === 'screen' ? screen(plan, input.value) : holdout(plan, input.value, screening, selection);
    }
    writeResult(output, result);
  } catch (error) { process.stderr.write(JSON.stringify({ error: error.message }) + '\n'); process.exitCode = 1; }
}
