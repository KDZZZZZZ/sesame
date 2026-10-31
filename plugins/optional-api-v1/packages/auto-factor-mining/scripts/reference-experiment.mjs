#!/usr/bin/env node
// Original Sesame research workflow helpers. No engine, network or order entry.
import { createHash } from 'node:crypto';
import { openSync, readSync, readFileSync, closeSync, fstatSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const object = (value, keys, label) => {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  check(Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)), `${label}: exact fields required: ${keys.join(', ')}`);
};
const text = (value, label) => check(typeof value === 'string' && value.trim().length > 0 && value.length <= 4000, `${label}: nonempty text <=4000 characters required`);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const fixedDigest = value => typeof value === 'string' && digestPattern.test(value);
export const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  check(value === null || ['string', 'boolean', 'number'].includes(typeof value), 'Only JSON values are supported');
  check(typeof value !== 'number' || Number.isFinite(value), 'Non-finite number');
  return JSON.stringify(value);
}
export const jsonDigest = value => digest(canonical(value));
export function instant(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), 'Explicit canonical UTC timestamp with milliseconds required; do not guess a wall clock');
  const result = Date.parse(value);
  check(Number.isFinite(result) && new Date(result).toISOString() === value, 'Invalid UTC calendar timestamp');
  return result;
}
function amount(value, label) {
  check(typeof value === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) <= 10000, `${label}: decimal text in [0,10000] required`);
}
export function validatePlan(plan) {
  object(plan, ['schemaVersion', 'experimentId', 'hypothesis', 'data', 'splits', 'embargoMs', 'trialBudget', 'objective', 'baseline', 'failureCriteria', 'costs', 'engine', 'limitations'], 'plan');
  check(plan.schemaVersion === 1, 'Unsupported plan schema');
  for (const key of ['experimentId', 'hypothesis', 'objective', 'baseline', 'failureCriteria']) text(plan[key], key);
  object(plan.data, ['sha256', 'timingSha256', 'provenance', 'universe', 'adjustments', 'delistings', 'availability', 'evidence'], 'data');
  check(fixedDigest(plan.data.sha256) && fixedDigest(plan.data.timingSha256), 'Fixed engine-input and timing-sample bytes each require sha256');
  check(['demo', 'observed', 'derived', 'user_input'].includes(plan.data.provenance), 'Declare data provenance');
  check(['point-in-time', 'unknown'].includes(plan.data.universe), 'Declare point-in-time universe or unknown');
  check(['raw', 'split', 'total-return', 'unknown'].includes(plan.data.adjustments), 'Declare adjustment convention');
  check(['included', 'not-applicable', 'unknown'].includes(plan.data.delistings), 'Declare delisting handling');
  check(['timestamped', 'unknown'].includes(plan.data.availability), 'Declare feature availability evidence');
  check(Array.isArray(plan.data.evidence) && plan.data.evidence.length > 0 && plan.data.evidence.length <= 32, 'Keep actual source references/digests and as-of evidence');
  plan.data.evidence.forEach(value => text(value, 'data evidence'));
  check(Array.isArray(plan.splits) && plan.splits.length === 3, 'Exactly train, validation, holdout splits required');
  let end = -Infinity;
  for (const [index, split] of plan.splits.entries()) {
    object(split, ['name', 'start', 'end'], 'split');
    check(split.name === ['train', 'validation', 'holdout'][index], 'Chronological train/validation/holdout required');
    const start = instant(split.start), next = instant(split.end);
    check(start >= end && next > start, 'Splits must be non-overlapping and increasing'); end = next;
  }
  check(Number.isSafeInteger(plan.embargoMs) && plan.embargoMs >= 0 && plan.embargoMs <= 31 * 86400000, 'embargoMs must be 0–31 days');
  check(Number.isSafeInteger(plan.trialBudget) && plan.trialBudget >= 1 && plan.trialBudget <= 1000, 'trialBudget must be 1–1000');
  object(plan.costs, ['commissionBps', 'slippageBps', 'borrowBpsPerPeriod', 'executionLag', 'description'], 'costs');
  ['commissionBps', 'slippageBps', 'borrowBpsPerPeriod'].forEach(key => amount(plan.costs[key], key));
  text(plan.costs.executionLag, 'execution lag'); text(plan.costs.description, 'cost model');
  object(plan.engine, ['pluginId', 'version', 'compatibility', 'evidence'], 'engine');
  check(typeof plan.engine.pluginId === 'string' && /^sesame\/[a-z][a-z0-9-]+$/.test(plan.engine.pluginId), 'Explicit selected engine plugin ID required');
  text(plan.engine.version, 'engine version'); text(plan.engine.evidence, 'engine evidence');
  check(['not_checked', 'checked'].includes(plan.engine.compatibility), 'Explicit engine compatibility state required');
  check(Array.isArray(plan.limitations) && plan.limitations.length <= 32, 'limitations must be a bounded array');
  plan.limitations.forEach(value => text(value, 'limitation'));
  const blockers = [];
  for (const field of ['universe', 'adjustments', 'delistings', 'availability']) if (plan.data[field] === 'unknown') blockers.push(`Unknown ${field}; no market-validity claim`);
  if (plan.engine.compatibility !== 'checked') blockers.push('Engine compatibility has not been checked; resolve the actually published package before executing');
  return { kind: 'strategy-research-plan', schemaVersion: 1, experimentId: plan.experimentId, planDigest: jsonDigest(plan), provenance: plan.data.provenance, blockers, validationScope: 'declared-plan-consistency-only', nativeEngineExecuted: false };
}

export function auditTiming(plan, samples) {
  const checked = validatePlan(plan);
  check(Array.isArray(samples) && samples.length > 0 && samples.length <= 50000, 'Expected 1–50000 timing samples');
  const ids = new Set(), partition = { train: [], validation: [], holdout: [] }, purged = [], outside = [];
  for (const sample of samples) {
    object(sample, ['id', 'instrument', 'decisionAt', 'featureAvailableAt', 'labelStart', 'labelEnd', 'labelAvailableAt'], 'sample');
    text(sample.id, 'sample ID'); text(sample.instrument, 'instrument');
    check(!ids.has(sample.id), 'Duplicate sample ID'); ids.add(sample.id);
    const decision = instant(sample.decisionAt), available = instant(sample.featureAvailableAt), start = instant(sample.labelStart), end = instant(sample.labelEnd), known = instant(sample.labelAvailableAt);
    check(available <= decision, `Look-ahead feature in ${sample.id}`);
    check(start >= decision && end > start && known >= end, `Invalid label interval in ${sample.id}`);
    const index = plan.splits.findIndex(split => decision >= instant(split.start) && decision < instant(split.end));
    if (index === -1) { outside.push(sample.id); continue; }
    const split = plan.splits[index], cutoff = index < 2 ? Math.min(instant(split.end), instant(plan.splits[index + 1].start) - plan.embargoMs) : instant(split.end);
    if (end > cutoff || known > cutoff) purged.push({ id: sample.id, split: split.name, reason: 'label_end_or_availability_overlaps_boundary_or_embargo', cutoff: new Date(cutoff).toISOString() });
    else partition[split.name].push(sample.id);
  }
  return { ...checked, kind: 'strategy-research-timing', sampleCount: samples.length, partition, purged, outside, limitations: ['Checks supplied timestamps; it cannot verify a vendor publication history or detect omitted instruments.', 'This chronological purge/embargo audit is not CSCV or a native backtest.'] };
}

export function auditLedger(plan, trials) {
  const checked = validatePlan(plan);
  check(Array.isArray(trials) && trials.length <= plan.trialBudget, 'All trials, including failures, must fit the declared budget');
  const ids = new Set(); let holdouts = 0;
  for (const trial of trials) {
    object(trial, ['id', 'phase', 'status', 'planDigest', 'sourceDigest', 'dataDigest', 'parameters', 'engine', 'result', 'note'], 'trial');
    text(trial.id, 'trial ID'); check(!ids.has(trial.id), 'Repeated trial identity'); ids.add(trial.id);
    check(['train', 'validation', 'holdout'].includes(trial.phase), 'Invalid trial phase');
    check(['completed', 'failed', 'aborted', 'unknown'].includes(trial.status), 'Record failed, aborted and unknown attempts too');
    check(holdouts === 0, 'Holdout is terminal: do not tune after observing it; start a new declared experiment with a new untouched sample');
    if (trial.phase === 'holdout') holdouts++;
    check(trial.planDigest === checked.planDigest && fixedDigest(trial.sourceDigest) && trial.dataDigest === plan.data.sha256, 'Trial does not bind the fixed plan, source and input');
    check(trial.parameters && typeof trial.parameters === 'object' && !Array.isArray(trial.parameters) && canonical(trial.parameters).length <= 20000, 'Bounded exact parameters required');
    check(trial.engine === `${plan.engine.pluginId}@${plan.engine.version}`, 'Trial engine/version differs from plan');
    if (trial.result !== null) {
      object(trial.result, ['id', 'revision', 'digest', 'kind', 'schemaVersion'], 'fixed result reference');
      text(trial.result.id, 'result ID'); text(trial.result.revision, 'result revision');
      check(fixedDigest(trial.result.digest) && ['strategy.result', 'resource'].includes(trial.result.kind) && trial.result.schemaVersion === '1.0.0', 'Exact result ArtifactRef required');
      check(trial.status !== 'completed' || trial.result.kind === 'strategy.result', 'Completed engine trial needs a fixed strategy.result reference');
    }
    check(trial.status !== 'completed' || trial.result !== null, 'Completed trial requires actual fixed result evidence'); text(trial.note, 'trial note');
  }
  return { ...checked, kind: 'strategy-research-ledger', attempted: trials.length, remainingBudget: plan.trialBudget - trials.length, holdoutUses: holdouts, ledgerDigest: jsonDigest(trials), multiplicity: { trialsDisclosed: trials.length, hiddenTrialsDetectable: false, pValue: null, dsr: null, pbo: null, reason: 'No complete return matrix, independent-trial estimate or inference assumptions supplied; no significance certificate.' } };
}

export function readJson(path, maximum = 16 * 1024 * 1024) {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd); check(stat.isFile() && stat.size <= maximum, 'Input must be a bounded ordinary JSON file');
    const bytes = Buffer.alloc(maximum + 1); let size = 0, read;
    while ((read = readSync(fd, bytes, size, bytes.length - size, null)) > 0) { size += read; check(size <= maximum, 'Input grew beyond the byte budget'); }
    const fixed = bytes.subarray(0, size); return { bytes: fixed, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fixed)) };
  }
  finally { closeSync(fd); }
}
export function writeResult(path, result) {
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  if (!path) return process.stdout.write(bytes);
  try { writeFileSync(path, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST' || !readFileSync(path).equals(bytes)) throw error; }
}
const isMain = () => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  try {
    const args = process.argv.slice(2), outIndex = args.indexOf('--out');
    let output;
    if (outIndex !== -1) { check(outIndex === args.length - 2, '--out <new-file> must be last'); output = args.splice(outIndex)[1]; }
    const [command, planPath, inputPath] = args;
    check(['plan', 'timing', 'ledger'].includes(command) && args.length === (command === 'plan' ? 2 : 3), 'Usage: node experiment.mjs plan PLAN | timing PLAN SAMPLES | ledger PLAN TRIALS [--out NEW_JSON]');
    const plan = readJson(planPath, 256 * 1024).value;
    let result;
    if (command === 'plan') result = validatePlan(plan);
    else {
      const input = readJson(inputPath);
      if (command === 'timing') check(digest(input.bytes) === plan.data.timingSha256, 'Timing input bytes differ from the fixed plan');
      result = command === 'timing' ? auditTiming(plan, input.value) : auditLedger(plan, input.value);
      result.inputDigest = digest(input.bytes);
    }
    writeResult(output, { ...result, scriptDigest: digest(readFileSync(fileURLToPath(import.meta.url))) });
  } catch (error) { process.stderr.write(JSON.stringify({ error: error.message }) + '\n'); process.exitCode = 1; }
}
