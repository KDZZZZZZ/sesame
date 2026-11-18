import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRef, publishRecord, readRecord } from './records.js';
import { coverageOf, developmentNeighbors, parameterKey, prepareSelection, selectionSchema, selectNeighborhood } from './neighborhood.js';

const BACKEND = 'sesame/backtrader#';
const METRICS = ['netReturn', 'maxDrawdown', 'finalEquity', 'closedTrades'];
const MAX_TRIALS = 8192, MAX_BATCHES = 240;
const TYPE_PROTOCOL = 'strategy-search-protocol', TYPE_SELECTION = 'strategy-parameter-selection';
const string = { type: 'string', minLength: 1 };
const scalar = { anyOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string', maxLength: 1000 }] };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const refSchema = kind => object({ id: string, revision: string, digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, kind: { const: kind }, schemaVersion: { const: '1.0.0' } });
const decimal = { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' };
const metric = { type: 'string', enum: METRICS };
const common = { operation_id: { ...string, maxLength: 160 }, backend: { const: 'backtrader' } };
const search = {
  ...common, title: { ...string, maxLength: 180 }, strategy_path: string, class_name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
  development: refSchema('data'), holdout: refSchema('data'), python_path: string, source_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  config: object({ capital: decimal, commission: decimal, slippage: decimal, feed: object({
    timeframe: { type: 'string', enum: ['minutes', 'days', 'weeks', 'months'] }, compression: { type: 'integer', minimum: 1, maximum: 100000 },
  }) }),
  columns: object(Object.fromEntries(['datetime', 'open', 'high', 'low', 'close', 'volume'].map(name => [name, string])), []),
  parameters: { type: 'object', additionalProperties: scalar },
  parameter_space: { type: 'object', maxProperties: 12, description: 'An empty object with max_trials:1 executes one native baseline using fixed or default parameters.',
    additionalProperties: { type: 'array', minItems: 1, maxItems: MAX_TRIALS, uniqueItems: true, items: scalar } },
  max_trials: { type: 'integer', minimum: 1, maximum: MAX_TRIALS },
  objective: object({ metric, direction: { type: 'string', enum: ['maximize', 'minimize'] } }),
  selection: selectionSchema,
  constraints: { type: 'array', maxItems: 16, items: object({ metric, op: { type: 'string', enum: ['<=', '>='] }, value: { type: 'number' } }) },
};
export const experimentSchema = {
  type: 'object', anyOf: [
    object(search, ['backend', 'operation_id', 'title', 'strategy_path', 'class_name', 'development', 'config', 'parameter_space', 'max_trials', 'objective']),
    object({ ...common, selection_ref: refSchema('resource'), holdout: refSchema('data'), python_path: string }, ['backend', 'operation_id', 'selection_ref', 'holdout']),
    object({ backend: { const: 'mt5' }, operation_id: common.operation_id }, ['backend']),
  ],
};

const check = (ok, code, message) => { if (!ok) throw Object.assign(new Error(message), { code }); };
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const sameRef = (a, b) => a?.id === b?.id && a?.revision === b?.revision && a?.digest === b?.digest;
const gap = (code, message, extra = {}) => ({ code, message, ...extra });

function searchGrid(input) {
  check(Number.isSafeInteger(input.max_trials) && input.max_trials > 0 && input.max_trials <= MAX_TRIALS, 'TRIAL_BUDGET_REQUIRED', 'Set a positive max_trials budget up to ' + MAX_TRIALS + '.');
  check(input.parameter_space && typeof input.parameter_space === 'object' && !Array.isArray(input.parameter_space), 'PARAMETER_SPACE_REQUIRED', 'Declare the parameter grid, or use an empty object for a fixed baseline.');
  const names = Object.keys(input.parameter_space).sort();
  check(names.length <= 12 && (names.length > 0 || input.max_trials === 1), 'INVALID_PARAMETER_SPACE', 'Use at most 12 vectors. A fixed baseline takes parameter_space:{} and max_trials:1.');
  let size = 1;
  for (const name of [...names, ...Object.keys(input.parameters ?? {})]) {
    check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !Object.hasOwn(Object.prototype, name), 'INVALID_PARAMETER_NAME', 'Use a Python parameter name: ' + name);
  }
  for (const name of names) {
    const values = input.parameter_space[name];
    check(Array.isArray(values) && values.length && values.length <= MAX_TRIALS && values.every(value =>
      typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 1000), 'INVALID_PARAMETER_SPACE', 'Use a bounded list of finite scalar values for ' + name);
    check(new Set(values.map(value => JSON.stringify(value))).size === values.length, 'DUPLICATE_PARAMETERS', 'Repeated candidate in ' + name);
    size *= values.length;
    check(size <= input.max_trials, 'TRIAL_BUDGET_EXCEEDED', 'The full grid exceeds max_trials. Narrow the vectors or raise the explicit trial budget.');
  }
  return { names, size };
}

// Rectangular batches preserve the native optstrategy cross product and the declared tie order.
function* batches(names, space, limit, prefix = {}) {
  const [name, ...tail] = names;
  if (!name) { yield prefix; return; }
  const suffixSize = tail.reduce((n, key) => n * space[key].length, 1);
  const width = Math.max(1, Math.floor(limit / suffixSize));
  for (let start = 0; start < space[name].length; start += width) {
    const head = { ...prefix, [name]: space[name].slice(start, start + width) };
    if (suffixSize <= limit) yield { ...head, ...Object.fromEntries(tail.map(key => [key, space[key]])) };
    else yield* batches(tail, space, limit, head);
  }
}

function* combinations(grid, fixed, entries = Object.entries(grid), index = 0) {
  if (index === entries.length) { yield fixed; return; }
  const [key, values] = entries[index];
  for (const value of values) yield* combinations(grid, { ...fixed, [key]: value }, entries, index + 1);
}

async function artifactBytes(host, ref, path, maxBytes, signal) {
  const chunks = [];
  let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    const page = await host.resources.read(ref, { part: 'content', entry: path, encoding: 'base64', offset, length: 256 * 1024 });
    const chunk = Buffer.from(page.content, 'base64');
    offset += chunk.length;
    check(offset <= maxBytes && (page.total === undefined || page.total <= maxBytes), 'ARTIFACT_BUDGET', 'The native artifact exceeds its read limit.');
    chunks.push(chunk);
    if (page.nextOffset === undefined) break;
    check(page.nextOffset === offset && chunk.length, 'INVALID_RESOURCE_PAGE', 'The fixed resource did not return a contiguous page.');
  }
  return Buffer.concat(chunks);
}

async function rows(host, ref, signal) {
  check(isRef(ref, 'data'), 'FIXED_DATA_REQUIRED', 'Use a complete immutable json-rows DataRef.');
  const { kind, content } = await host.resources.read(ref, { part: 'manifest' });
  check(kind === 'data' && content?.format === 'json-rows' && typeof content.path === 'string', 'INVALID_DATA', 'Expected a fixed json-rows artifact.');
  const bytes = await artifactBytes(host, ref, content.path, 32 * 1024 * 1024, signal);
  const values = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  check(Array.isArray(values) && values.length === content.rowCount, 'INVALID_DATA', 'Rows must match the fixed manifest count.');
  return { values, provenance: content.provenance?.kind };
}

export async function readBarPartition(host, ref, columns, signal) {
  const { values, provenance } = await rows(host, ref, signal);
  check(values.length >= 2 && values.length <= 100000, 'INVALID_DATA', 'Supply 2–100000 bars per research partition.');
  let first = null, last = -Infinity;
  for (const row of values) {
    const raw = row?.[columns?.datetime ?? 'datetime'];
    const time = raw?.basis === 'utc' && Number.isSafeInteger(raw.unixMs) ? raw.unixMs :
      typeof raw === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(raw) ? Date.parse(raw) : NaN;
    check(Number.isFinite(time) && time > last, 'INVALID_PARTITION_TIME', 'Use strictly increasing UTC/offset bar timestamps.');
    first ??= time; last = time;
  }
  return { values, partition: { ref, bars: values.length, first, last, provenance } };
}

async function partition(host, ref, columns, signal) {
  return (await readBarPartition(host, ref, columns, signal)).partition;
}

async function backendRun(host, name, input, operationId, signal) {
  signal?.throwIfAborted();
  const accepted = await host.capabilities.invoke(BACKEND + name, input, { signal, ...(operationId ? { operationId } : {}) });
  check(accepted.type === 'run' && accepted.run?.id, 'NATIVE_RUN_REQUIRED', 'Backtrader must return its tracked host Run.');
  for (;;) {
    signal?.throwIfAborted();
    const { run, reason } = await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000, signal });
    if (run.status === 'completed') return run.output;
    if (reason === 'timeout' && ['queued', 'running', 'cancelling'].includes(run.status)) continue;
    throw Object.assign(new Error(run.error?.message ?? 'Reconcile the original native Run before resuming.'), {
      code: run.error?.code ?? 'NATIVE_RUN_' + run.status.toUpperCase(), runId: run.id,
    });
  }
}

async function nativeReceipt(host, output, data, optimizing) {
  check(isRef(output?.ref, 'strategy.result'), 'MISSING_NATIVE_RECEIPT', 'A fixed native strategy.result is required. Inspect backtrader_operation for the original operation_id.');
  const { kind, content } = await host.resources.read(output.ref, { part: 'manifest' });
  check(kind === 'strategy.result' && content.status === output.status && content.inputs?.length === 1 && sameRef(content.inputs[0], data) &&
    isRef(content.nativeSource, 'resource') && ['completed', 'failed'].includes(content.status), 'INVALID_NATIVE_RECEIPT', 'The native result does not match its fixed input and source.');
  if (content.status === 'completed' && optimizing) check(content.optimizer?.native === true && content.optimizer.method === 'Cerebro.optstrategy', 'NATIVE_OPTIMIZER_REQUIRED', 'Expected a native Cerebro.optstrategy receipt.');
  return content;
}

// The backend archives the exact file it executed. Later batches and holdouts can
// reconstruct that source in their own task workspace even after the author edits it.
async function frozenSource(host, ref, signal) {
  const manifest = await host.resources.read(ref, { part: 'manifest' });
  const source = manifest.content;
  check(source?.type === 'native-strategy-source' && source.language === 'python' && /^sha256:[a-f0-9]{64}$/.test(source.sourceDigest), 'INVALID_NATIVE_SOURCE', 'Expected an archived native Python strategy.');
  const bytes = await artifactBytes(host, ref, source.path, 512 * 1024, signal);
  check(hash(bytes) === source.sourceDigest, 'SOURCE_MISMATCH', 'The archived strategy bytes differ from the fixed source digest.');
  const filename = 'strategy-frozen-' + source.sourceDigest.slice(7) + '.py';
  const path = join(host.context.workspaceRoot, filename);
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o444 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await lstat(path);
    check(stat.isFile() && stat.nlink === 1 && stat.size === bytes.length && hash(await readFile(path)) === source.sourceDigest,
      'SOURCE_MISMATCH', 'The frozen task file was replaced. Restore the archived strategy before continuing.');
  }
  return { ref, digest: source.sourceDigest, path: filename };
}

function number(value) {
  const n = typeof value === 'number' || typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
  check(Number.isFinite(n), 'INVALID_NATIVE_STATISTICS', 'The native receipt is missing a finite numeric observation.');
  return n;
}

function metrics(statistics, equity, capital, expectedBars) {
  const initial = number(capital), finalEquity = number(statistics?.finalEquity), closedTrades = number(statistics?.closedTrades);
  check(initial > 0 && Number.isSafeInteger(closedTrades) && closedTrades >= 0 && equity?.length === expectedBars, 'INVALID_NATIVE_STATISTICS', 'Expected an observed equity value per bar and the native closed-trade count.');
  let peak = initial, maxDrawdown = 0, value;
  for (const point of equity) {
    value = number(point.value);
    peak = Math.max(peak, value); maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
  }
  check(value === finalEquity, 'INVALID_NATIVE_STATISTICS', 'The last equity observation disagrees with the native result.');
  return { finalEquity, netReturn: number(finalEquity / initial - 1), maxDrawdown: number(maxDrawdown), closedTrades };
}

const violations = (values, rules) => rules.filter(rule => rule.op === '<=' ? values[rule.metric] > rule.value : values[rule.metric] < rule.value);
const table = (receipt, id) => receipt.data?.find(item => item.id === id)?.ref;
const baseArgs = (input, data, path) => ({ title: input.title, data, strategy_path: path, class_name: input.class_name, config: input.config, ...(input.columns ? { columns: input.columns } : {}) });

export function unusedRange(partition, priorHoldouts) {
  for (const prior of priorHoldouts) {
    check(Number.isFinite(prior.first) && Number.isFinite(prior.last) && prior.first <= prior.last, 'INVALID_HOLDOUT_HISTORY', 'The prior holdout record needs both observed range boundaries.');
    check(partition.last < prior.first || partition.first > prior.last, 'PARTITION_ALREADY_OBSERVED', 'This range overlaps a previous holdout. Use a fresh partition to preserve independence.');
  }
}

async function confirm(host, selection, selectionRef, holdoutRef, prefix, result, signal, priorHoldouts, onPartition) {
  const { protocol, protocolRef, development, source, best } = selection;
  check(isRef(holdoutRef, 'data') && !sameRef(holdoutRef, development.ref) && (!protocol.holdout || sameRef(protocol.holdout, holdoutRef)),
    'HOLDOUT_MISMATCH', 'Use the unexamined, separate holdout fixed in this protocol.');
  const confirmationRef = await publishRecord(host, 'strategy-holdout-protocol', { selectionRef, holdoutRef }, prefix + ':confirmation', [selectionRef, holdoutRef]);
  const frozen = await frozenSource(host, source.ref, signal);
  check(frozen.digest === source.digest, 'SOURCE_MISMATCH', 'The selection and archived strategy disagree.');
  const holdout = await partition(host, holdoutRef, protocol.columns, signal);
  check(development.last < holdout.first, 'OVERLAPPING_PARTITIONS', 'Holdout must begin strictly after the final development bar.');
  unusedRange(holdout, priorHoldouts);
  const operationId = prefix + ':holdout';
  await onPartition?.('holdout', holdout, selectionRef);
  result.holdout = { status: 'pending', operationId, partition: holdout, confirmationRef };
  const answer = await backendRun(host, 'backtrader_backtest', { ...baseArgs(protocol, holdoutRef, frozen.path), operation_id: operationId, parameters: best.parameters }, operationId, signal);
  const receipt = await nativeReceipt(host, answer, holdoutRef, false);
  Object.assign(result.holdout, { nativeStatus: receipt.status, resultRef: answer.ref });
  const { content } = await host.resources.read(receipt.nativeSource, { part: 'manifest' });
  check(content.sourceDigest === source.digest, 'SOURCE_MISMATCH', 'The native holdout used different source bytes.');
  if (receipt.status === 'failed') {
    result.holdout.status = 'failed';
    result.status = 'failed'; result.gaps.push(gap('HOLDOUT_FAILED', answer.diagnostics?.message ?? 'Inspect the failed native holdout receipt.')); return;
  }
  const equity = await rows(host, table(receipt, 'equity'), signal);
  const values = metrics(receipt.statistics, equity.values, protocol.config.capital, holdout.bars);
  const failed = violations(values, protocol.constraints ?? []);
  const assessment = { status: failed.length ? 'constraints-failed' : 'completed', operationId, partition: holdout, confirmationRef,
    resultRef: answer.ref, metrics: values, violations: failed };
  const recordRef = await publishRecord(host, 'strategy-holdout-result', { selectionRef, protocolRef, ...assessment }, operationId + ':record', [confirmationRef, answer.ref]);
  Object.assign(result.holdout, assessment, { recordRef });
  result.status = failed.length ? 'failed' : 'completed';
  if (failed.length) result.gaps.push(gap('HOLDOUT_CONSTRAINT_FAILED', 'The frozen candidate breached its holdout constraint. Record the failure against this selection.'));
}

export async function runExperiments(host, input, signal, { priorHoldouts = [], onPartition } = {}) {
  const result = { status: 'blocked', protocolRef: null, selectionRef: null, best: null, selectionMethod: null, pointBest: null, robustCandidate: null, selectionCoverage: null,
    counts: { planned: 0, completed: 0, eligible: 0, excluded: 0, uncompleted: 0 }, batches: [], holdout: null, gaps: [] };
  let operationId;
  try {
    if (input.backend === 'mt5') {
      result.gaps.push(gap('MT5_NATIVE_PROTOCOL_REQUIRED', 'Use the compiled MT5 build and verified translation, conformance and Tester run_record. This search adapter accepts Backtrader native strategy files.', {
        capabilities: ['mt5_target', 'mt5_translation', 'mt5_compile', 'mt5_conformance', 'mt5_backtest'], next: 'Start mt5_backtest with a frozen build_id, stable command_id, server dates and parameter_space, then wait for the original backtest_id.',
      })); return result;
    }
    check(input.backend === 'backtrader' && typeof input.operation_id === 'string' && input.operation_id.trim(), 'EXPERIMENT_PROTOCOL_REQUIRED', 'Choose the native backend and a stable operation_id.');
    const prefix = 'strategy-search-' + hash(input.operation_id).slice(7);
    let selection, plan;
    if (input.selection_ref) {
      selection = await readRecord(host, input.selection_ref, TYPE_SELECTION);
      check(selection?.protocol?.backend === 'backtrader' && selection.source?.digest && selection.best?.parameters && selection.development?.ref, 'INVALID_SELECTION', 'Use the saved development selection reference.');
      check(Object.keys(input).every(key => ['backend', 'operation_id', 'selection_ref', 'holdout', 'python_path'].includes(key)), 'FROZEN_SELECTION', 'A confirmation takes the frozen selection and holdout. Its strategy, parameters, objective and costs are fixed.');
      result.protocolRef = selection.protocolRef; result.selectionRef = input.selection_ref; result.best = selection.best; result.counts = selection.counts; result.batches = selection.batches;
      result.source = selection.source; result.developmentNeighbors = selection.developmentNeighbors ?? [];
      result.selectionMethod = selection.selectionMethod ?? 'point_best'; result.pointBest = selection.pointBest ?? selection.best;
      result.robustCandidate = selection.robustCandidate ?? null; result.selectionCoverage = selection.selectionCoverage ?? null;
    }
    const grid = selection ? null : searchGrid(input);
    if (!selection) {
      check(METRICS.includes(input.objective?.metric) && ['minimize', 'maximize'].includes(input.objective.direction) &&
        (input.constraints ?? []).every(rule => METRICS.includes(rule.metric) && ['<=', '>='].includes(rule.op) && Number.isFinite(rule.value)), 'METRIC_UNAVAILABLE', 'Select a supported objective and measurable constraints. Return and drawdown are fractions.');
      check(isRef(input.development, 'data') && (!input.holdout || isRef(input.holdout, 'data') && !sameRef(input.development, input.holdout)), 'PARTITION_REUSE', 'Use distinct fixed development and holdout partitions.');
      result.counts.planned = grid.size;
      plan = prepareSelection(input.parameter_space, input.selection);
      result.selectionMethod = plan.method;
      if (plan.method === 'neighborhood_worst') {
        result.selectionCoverage = coverageOf(plan, grid.size);
        check(plan.numeric.length && plan.numeric.every(axis => axis.levels.length >= 3), 'ROBUST_GRID_UNSUPPORTED',
          'Two-sided neighborhoods require at least one varying numeric axis and three distinct levels on every varying numeric axis. Classify numeric category codes explicitly.');
      }
    }
    const environment = await backendRun(host, 'backtrader_environment', { action: 'inspect', ...(input.python_path ? { python_path: input.python_path } : {}) }, undefined, signal);
    if (environment?.ready !== true) {
      result.gaps.push(gap('BACKTRADER_UNAVAILABLE', environment?.required ?? 'Inspect or prepare Backtrader 1.9.78.123, then resume the original search.', {
        attempted: environment?.failures ?? [], capability: BACKEND + 'backtrader_environment',
      }));
      return result;
    }
    if (selection) {
      await confirm(host, selection, input.selection_ref, input.holdout, prefix, result, signal, priorHoldouts, onPartition);
      return result;
    }
    const development = await partition(host, input.development, input.columns, signal);
    unusedRange(development, priorHoldouts);
    const limit = Math.min(64, Math.floor(200000 / development.bars));
    const groups = [...batches(grid.names, input.parameter_space, limit)];
    const optimizing = grid.names.length > 0;
    check(groups.length <= MAX_BATCHES, 'BATCH_BUDGET_EXCEEDED', 'This protocol requires ' + groups.length + ' native batches; narrow the grid or development window to at most ' + MAX_BATCHES + '.');
    const rule = plan.method === 'neighborhood_worst' ? { selectionRule: { version: 1, support: 'center-and-both-axis-adjacent-levels', eligibility: 'all-observations-feasible',
      categories: 'held-fixed', defaultMaxStep: 'smallest-adjacent-distance-per-axis', effectiveMaxStep: result.selectionCoverage.effectiveMaxStep,
      aggregation: input.objective.direction === 'maximize' ? 'minimum' : 'maximum' } } : {};
    result.protocolRef = await publishRecord(host, TYPE_PROTOCOL, { ...input, ...rule, developmentRange: development, planned: grid.size, batchLimit: limit, tieBreak: 'first declared combination in sorted parameter-name order' }, prefix + ':protocol', [input.development, ...(input.holdout ? [input.holdout] : [])]);
    await onPartition?.('development', development, null);
    let source, best;
    const observed = new Map();
    for (const [index, group] of groups.entries()) {
      operationId = prefix + ':dev:' + index;
      const requested = [...combinations(group, input.parameters ?? {})];
      const batch = { operationId, method: optimizing ? 'backtrader_optimize' : 'backtrader_backtest', planned: requested.length, completed: 0, status: 'pending' };
      result.batches.push(batch);
      const args = { ...baseArgs(input, input.development, source?.path ?? input.strategy_path), operation_id: operationId, parameters: input.parameters ?? {},
        ...(optimizing ? { parameter_space: group } : {}) };
      const answer = await backendRun(host, batch.method, args, operationId, signal);
      const receipt = await nativeReceipt(host, answer, input.development, optimizing);
      Object.assign(batch, { status: receipt.status, resultRef: answer.ref });
      if (!source) {
        source = await frozenSource(host, receipt.nativeSource, signal);
        check(!input.source_digest || input.source_digest === source.digest, 'SOURCE_MISMATCH', 'The first native pass used different source bytes from the project.');
        result.source = { ref: source.ref, digest: source.digest };
      }
      else {
        const { content } = await host.resources.read(receipt.nativeSource, { part: 'manifest' });
        check(content.sourceDigest === source.digest, 'SOURCE_MISMATCH', 'Strategy bytes changed during the parameter search.');
      }
      batch.passesRef = table(receipt, 'passes') ?? null;
      if (receipt.status === 'failed') batch.diagnostic = answer.diagnostics?.message ?? 'Inspect the failed native receipt.';
      if (!batch.passesRef && receipt.status === 'failed') {
        if (optimizing) break;
        result.status = 'failed'; result.gaps.push(gap('BASELINE_FAILED', batch.diagnostic)); return result;
      }
      const passes = optimizing ? (await rows(host, batch.passesRef, signal)).values : [{
        parameters: input.parameters ?? {}, status: receipt.status, statistics: receipt.statistics, equity: (await rows(host, table(receipt, 'equity'), signal)).values,
      }];
      check(passes.length === requested.length, 'INCOMPLETE_NATIVE_GRID', 'The native receipt does not account for every requested combination.');
      const byParameters = new Map(passes.map(pass => [parameterKey(pass.parameters), pass]));
      for (const parameters of requested) {
        const pass = byParameters.get(parameterKey(parameters));
        check(pass && ['completed', 'not-completed', 'failed'].includes(pass.status), 'INVALID_NATIVE_PASS', 'The native parameter combination or status does not match the protocol.');
        if (pass.status !== 'completed') continue;
        const values = metrics(pass.statistics, pass.equity, input.config.capital, development.bars);
        result.counts.completed++; batch.completed++;
        const excluded = violations(values, input.constraints ?? []), score = values[input.objective.metric];
        const candidate = { parameters, score, metrics: values, batchResultRef: answer.ref };
        observed.set(parameterKey(parameters), { candidate, eligible: !excluded.length });
        if (excluded.length) { result.counts.excluded++; continue; }
        result.counts.eligible++;
        if (!best || (input.objective.direction === 'maximize' ? score > best.score : score < best.score)) best = candidate;
      }
    }
    if (result.counts.completed !== grid.size || result.batches.some(batch => batch.status !== 'completed')) {
      result.status = 'incomplete'; result.bestObserved = best ?? null;
      result.gaps.push(gap('PARTIAL_NATIVE_SEARCH', 'Some trials failed or lack completed native receipts. Inspect the affected batches before freezing a winner.'));
      return result;
    }
    result.pointBest = best ?? null;
    if (plan.method === 'neighborhood_worst') result.robustCandidate = selectNeighborhood(plan, observed, input.objective.direction, result.selectionCoverage);
    if (!result.pointBest) {
      result.status = 'failed'; result.gaps.push(gap('NO_FEASIBLE_PARAMETERS', 'No completed combination satisfies all declared constraints.'));
      return result;
    }
    if (plan.method === 'neighborhood_worst') {
      if (!result.robustCandidate) {
        result.status = 'failed'; result.gaps.push(gap('NO_SUPPORTED_NEIGHBORHOOD', 'The measured grid has no fully supported feasible interior under the declared spacing and constraints.'));
        return result;
      }
      best = observed.get(parameterKey(result.robustCandidate.parameters)).candidate;
    }
    const neighbors = developmentNeighbors(plan, best, observed);
    const decision = input.selection ? { selectionMethod: result.selectionMethod, pointBest: result.pointBest,
      robustCandidate: result.robustCandidate, selectionCoverage: result.selectionCoverage } : {};
    selection = { protocolRef: result.protocolRef, protocol: input, development, source: result.source, best, developmentNeighbors: neighbors, ...decision, counts: result.counts, batches: result.batches };
    result.selectionRef = await publishRecord(host, TYPE_SELECTION, selection, prefix + ':selection', [result.protocolRef, source.ref, ...result.batches.map(b => b.resultRef)]);
    result.best = best; result.developmentNeighbors = neighbors;
    result.status = 'selected';
    if (input.holdout) await confirm(host, selection, result.selectionRef, input.holdout, prefix, result, signal, priorHoldouts, onPartition);
  } catch (error) {
    signal?.throwIfAborted();
    result.status = result.batches.length && !result.selectionRef ? 'incomplete' : 'blocked';
    result.gaps.push(gap(error.code ?? 'EXPERIMENT_UNAVAILABLE', error.message, {
      ...(error.runId ? { runId: error.runId } : {}), ...(result.holdout?.operationId || operationId ? { operationId: result.holdout?.operationId ?? operationId } : {}),
    }));
  } finally {
    result.counts.uncompleted = result.counts.planned - result.counts.completed;
    if (result.selectionCoverage && !result.selectionCoverage.evaluated) {
      result.selectionCoverage.observedPoints = result.counts.completed; result.selectionCoverage.eligiblePoints = result.counts.eligible;
    }
  }
  return result;
}
