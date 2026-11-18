import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runExperiments } from '../experiments.js';
import { readRecord } from '../records.js';

const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const names = { optimize: 'backtrader_optimize', test: 'backtrader_backtest', env: 'backtrader_environment' };
function product(grid) {
  return Object.entries(grid).reduce((rows, [key, values]) => rows.flatMap(row => values.map(value => ({ ...row, [key]: value }))), [{}]);
}

// Model immutable public resource reads and the native summaries/row tables.
// The separate native integration test exercises actual Cerebro and host admission.
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'strategy-experiments-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifacts = new Map(), files = new Map(), calls = [], events = [], runs = new Map(), operations = new Map();
  const put = (kind, content, blob = '', producer = 'sesame/backtrader', more = {}) => {
    const bytes = Buffer.from(blob), hash = digest(Buffer.concat([Buffer.from(JSON.stringify(content)), bytes]));
    const ref = { kind, id: kind + '-' + hash.slice(7), revision: '1', schemaVersion: '1.0.0', digest: hash };
    artifacts.set(ref.id, { manifest: { kind, content, ...more }, bytes, producer }); return ref;
  };
  const data = values => put('data', { format: 'json-rows', path: 'rows.json', rowCount: values.length, provenance: { kind: 'demo' } }, JSON.stringify(values));
  const dates = day => [0, 1, 2].map(i => ({ datetime: new Date(Date.UTC(2024, 0, day + i)).toISOString() }));
  const development = data(dates(1)), holdout = data(dates(options.overlap ? 3 : 6));
  const bytes = 'class Frozen: pass\n';
  const source = put('resource', { type: 'native-strategy-source', language: 'python', sourceDigest: digest(bytes), path: 'strategy.py' }, bytes);
  const host = {
    context: { workspaceRoot: directory },
    resources: {
      async create(args, { operationId }) {
        if (files.has(operationId) && JSON.stringify(files.get(operationId)) !== JSON.stringify(args))
          throw Object.assign(new Error('Different inputs for the original resource operation'), { code: 'IDEMPOTENCY_CONFLICT' });
        files.set(operationId, args); return { id: operationId };
      },
      async publish(root, manifest) {
        const file = [...files.values()].find(item => item.parent?.id === root.id);
        events.push(manifest.content.type);
        if (options.failHoldoutRecord && manifest.content.type === 'strategy-holdout-result')
          throw Object.assign(new Error('Holdout record unavailable'), { code: 'PUBLISH_FAILED' });
        return { ref: put(manifest.kind, manifest.content, file.source.content, 'sesame/strategy-development', { provenance: manifest.provenance }) };
      },
      async read(ref, args) {
        const artifact = artifacts.get(ref.id); assert.ok(artifact);
        if (args.part === 'manifest') return artifact.manifest;
        if (args.part === 'metadata') return { ref, producer: { id: artifact.producer } };
        if (ref.id === holdout.id) events.push('holdout-prices');
        const next = Math.min(args.offset + args.length, artifact.bytes.length);
        return { content: artifact.bytes.subarray(args.offset, next).toString('base64'), total: artifact.bytes.length, ...(next < artifact.bytes.length ? { nextOffset: next } : {}) };
      },
    },
    capabilities: { async invoke(id, input, { operationId }) {
      const name = id.split('#')[1];
      if (operationId && operations.has(operationId)) {
        const old = operations.get(operationId); assert.deepEqual(old.input, input);
        return old.accepted;
      }
      calls.push({ name, input });
      let output;
      if (name === names.env) output = { ready: options.ready !== false };
      else {
        const optimize = name === names.optimize;
        const planned = optimize ? product(input.parameter_space) : [input.parameters];
        const failed = options.partial && optimize;
        const passes = planned.map((candidate, index) => {
          const params = { ...input.parameters, ...candidate };
          const profile = input.data.id === development.id ? options.developmentProfile?.(params) : null;
          const last = profile?.end ?? (optimize ? 100 + params.a + params.b : 100 + (options.holdoutReturns ?? -3));
          const middle = profile?.middle ?? (optimize && params.a === 16 || options.holdoutBreaches && !optimize ? 70 : 98);
          const statistics = { finalEquity: String(last), closedTrades: profile?.trades ?? 2 };
          const equity = [100, middle, last].map(value => ({ value: String(value) }));
          return failed && index === planned.length - 1 ? { status: 'not-completed', parameters: params } : { status: 'completed', parameters: params, statistics, equity };
        });
        const status = failed ? 'failed' : 'completed';
        const values = optimize ? passes : options.incompleteHoldoutEquity && input.data.id === holdout.id ? passes[0].equity.slice(1) : passes[0].equity;
        const content = { status, nativeSource: source, inputs: [input.data], data: [{ id: optimize ? 'passes' : 'equity', ref: data(values) }],
          ...(optimize ? { optimizer: { native: true, method: 'Cerebro.optstrategy' } } : { statistics: passes[0].statistics }) };
        output = { status, ref: put('strategy.result', content) };
      }
      const run = { id: 'run' + calls.length, status: 'completed', output };
      runs.set(run.id, run);
      const accepted = { type: 'run', run: { id: run.id } };
      if (operationId) operations.set(operationId, { input, accepted });
      return accepted;
    } },
    runs: { async wait(ref) { return { reason: 'settled', run: runs.get(ref.id) }; } },
  };
  const input = { operation_id: 'study', title: 'Development grid', backend: 'backtrader', strategy_path: 'authored.py', class_name: 'Frozen',
    development, parameter_space: { a: Array.from({ length: 17 }, (_, i) => i), b: Array.from({ length: 9 }, (_, i) => i) }, parameters: { fixed: true },
    config: { capital: '100', commission: '0.001', slippage: '0.0005', feed: { timeframe: 'days', compression: 1 } },
    objective: { metric: 'netReturn', direction: 'maximize' }, constraints: [{ metric: 'maxDrawdown', op: '<=', value: 0.15 }], max_trials: 200 };
  return { host, input, calls, events, holdout };
}

test('search ranks every development combination against fixed constraints, then runs exactly one frozen holdout', async t => {
  const { host, input, holdout, calls, events } = await setup(t, { holdoutBreaches: true });
  const result = await runExperiments(host, { ...input, holdout });
  assert.equal(result.status, 'failed', JSON.stringify(result.gaps));
  assert.deepEqual(result.counts, { planned: 153, completed: 153, eligible: 144, excluded: 9, uncompleted: 0 });
  assert.deepEqual(result.best.parameters, { fixed: true, a: 15, b: 8 });
  assert.ok(result.developmentNeighbors.some(n => n.parameter === 'a' && n.value === 16 && !n.eligible && n.score > result.best.score));
  assert.equal(result.holdout.status, 'constraints-failed'); assert.equal(result.holdout.metrics.maxDrawdown, 0.3);
  assert.equal(result.holdout.recordRef.kind, 'resource');
  const batches = calls.filter(call => call.name === names.optimize);
  assert.ok(batches.length > 1 && batches.every(call => product(call.input.parameter_space).length <= 64));
  assert.ok(batches.slice(1).every(call => call.input.strategy_path.startsWith('strategy-frozen-')));
  assert.equal(calls.filter(c => c.name === names.test).length, 1);
  assert.deepEqual(calls.at(-1).input.parameters, result.best.parameters);
  assert.ok(events.indexOf('strategy-parameter-selection') < events.indexOf('holdout-prices'));
  await runExperiments(host, { ...input, holdout });
  assert.equal(calls.filter(call => call.name === names.optimize).length, batches.length);
  assert.equal(calls.filter(call => call.name === names.test).length, 1);
});

test('ablation can stop after development; separate confirmation reuses the selection and archived native code', async t => {
  const { host, input, holdout, calls, events } = await setup(t);
  const selected = await runExperiments(host, input);
  assert.equal(selected.status, 'selected', JSON.stringify(selected.gaps)); assert.equal(selected.holdout, null);
  assert.ok(!events.includes('holdout-prices'));
  const batches = calls.filter(call => call.name === names.optimize).length;
  const confirmed = await runExperiments(host, { operation_id: 'independent', backend: 'backtrader', selection_ref: selected.selectionRef, holdout });
  assert.equal(confirmed.status, 'completed', JSON.stringify(confirmed.gaps)); assert.deepEqual(confirmed.best, selected.best);
  assert.equal(calls.filter(call => call.name === names.optimize).length, batches);
  assert.equal(calls.filter(call => call.name === names.test).length, 1);
  const invalid = await runExperiments(host, { operation_id: 'revised', backend: 'backtrader', selection_ref: selected.selectionRef, holdout, parameters: { a: 0 } });
  assert.equal(invalid.gaps[0].code, 'FROZEN_SELECTION'); assert.equal(calls.filter(call => call.name === names.test).length, 1);
});

test('failed and uncompleted trials do not create a winner or open the holdout', async t => {
  const { host, input, holdout, calls, events } = await setup(t, { partial: true });
  const result = await runExperiments(host, { ...input, holdout });
  assert.equal(result.status, 'incomplete'); assert.equal(result.best, null); assert.equal(result.selectionRef, null);
  assert.ok(result.counts.uncompleted > 0); assert.ok(result.bestObserved); assert.ok(result.batches.every(batch => batch.resultRef));
  assert.ok(!events.includes('holdout-prices')); assert.ok(!calls.some(call => call.name === names.test));
});

test('the native grid budget, development/holdout chronology and feasible set produce explicit feedback', async t => {
  const { host, input, holdout, calls } = await setup(t, { overlap: true });
  assert.equal((await runExperiments(host, { ...input, max_trials: 100 })).gaps[0].code, 'TRIAL_BUDGET_EXCEEDED');
  assert.equal((await runExperiments(host, { ...input, holdout: input.development })).gaps[0].code, 'PARTITION_REUSE'); assert.equal(calls.length, 0);
  const overlaps = await runExperiments(host, { ...input, holdout });
  assert.equal(overlaps.gaps[0].code, 'OVERLAPPING_PARTITIONS'); assert.ok(overlaps.selectionRef);
  const noFeasible = await runExperiments(host, { ...input, operation_id: 'empty', constraints: [{ metric: 'closedTrades', op: '>=', value: 10 }] });
  assert.equal(noFeasible.gaps[0].code, 'NO_FEASIBLE_PARAMETERS'); assert.equal(noFeasible.counts.excluded, 153);
  assert.equal(calls.filter(call => call.name === names.test).length, 0);
});

test('missing engine and MT5 route identify the required native capabilities', async t => {
  const { host, input, calls } = await setup(t, { ready: false });
  const result = await runExperiments(host, input);
  assert.equal(result.status, 'blocked'); assert.equal(result.gaps[0].code, 'BACKTRADER_UNAVAILABLE');
  assert.equal((await runExperiments(host, { backend: 'mt5' })).gaps[0].code, 'MT5_NATIVE_PROTOCOL_REQUIRED');
  assert.equal(calls.length, 1);
});

test('overlap with an earlier holdout is caught even when the candidate uses a different DataRef', async t => {
  const { host, input, holdout, calls } = await setup(t);
  const history = day => ({ priorHoldouts: [{ first: Date.UTC(2024, 0, day), last: Date.UTC(2024, 0, day + 1) }] });
  const leak = await runExperiments(host, input, undefined, history(2));
  assert.equal(leak.gaps[0].code, 'PARTITION_ALREADY_OBSERVED'); assert.equal(calls.filter(c => c.name === names.optimize).length, 0);
  const selected = await runExperiments(host, input);
  const reused = await runExperiments(host, { operation_id: 'prior-holdout', backend: 'backtrader', selection_ref: selected.selectionRef, holdout }, undefined, history(5));
  assert.equal(reused.gaps[0].code, 'PARTITION_ALREADY_OBSERVED'); assert.equal(calls.filter(c => c.name === names.test).length, 0);
});

test('ties follow the declared candidate order and a changed native source cannot be selected', async t => {
  const { host, input } = await setup(t);
  const tied = await runExperiments(host, { ...input, parameter_space: { b: [2, 0], a: [3, 1] }, objective: { metric: 'maxDrawdown', direction: 'minimize' } });
  assert.equal(tied.status, 'selected'); assert.deepEqual(tied.best.parameters, { fixed: true, a: 3, b: 2 });
  const changed = await runExperiments(host, { ...input, operation_id: 'source-change', source_digest: 'sha256:' + '0'.repeat(64) });
  assert.equal(changed.gaps[0].code, 'SOURCE_MISMATCH'); assert.equal(changed.selectionRef, null);
});

test('an accepted operation keeps its original objective even when new rankings would reuse the same native receipts', async t => {
  const { host, input, calls } = await setup(t);
  const first = await runExperiments(host, input);
  const executions = calls.filter(c => c.name === names.optimize).length;
  const conflict = await runExperiments(host, { ...input, objective: { metric: 'closedTrades', direction: 'maximize' } });
  assert.equal(first.status, 'selected'); assert.equal(conflict.gaps[0].code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(conflict.selectionRef, null); assert.equal(calls.filter(c => c.name === names.optimize).length, executions);
});

test('a fixed baseline without tunable parameters runs one native development backtest, then a separate frozen confirmation', async t => {
  const { host, input, holdout, calls } = await setup(t);
  delete input.parameters;
  const protocol = { ...input, parameter_space: {}, max_trials: 1, holdout };
  const events = [];
  const result = await runExperiments(host, protocol, undefined, { onPartition(role, partition, selection) {
    events.push({ role, partition: partition.ref, selection, started: calls.filter(c => c.name === names.test).length });
  } });
  assert.equal(result.status, 'completed', JSON.stringify(result.gaps));
  assert.deepEqual(result.counts, { planned: 1, completed: 1, eligible: 1, excluded: 0, uncompleted: 0 });
  assert.equal(result.batches.length, 1); assert.equal(result.batches[0].method, names.test);
  assert.deepEqual(result.best.parameters, {}); assert.equal(result.best.batchResultRef.kind, 'strategy.result');
  assert.deepEqual(result.developmentNeighbors, []); assert.ok(result.selectionRef); assert.equal(result.holdout.status, 'completed');
  assert.equal(calls.filter(c => c.name === names.optimize).length, 0);
  const backtests = calls.filter(c => c.name === names.test);
  assert.equal(backtests.length, 2); assert.ok(backtests.every(c => !('parameter_space' in c.input) && Object.keys(c.input.parameters).length === 0));
  assert.deepEqual(events, [{ role: 'development', partition: input.development, selection: null, started: 0 },
    { role: 'holdout', partition: holdout, selection: result.selectionRef, started: 1 }]);
  const excessive = await runExperiments(host, { ...protocol, max_trials: 2 });
  assert.equal(excessive.gaps[0].code, 'INVALID_PARAMETER_SPACE');
});

test('partition reservation conflict prevents dispatching a fixed baseline', async t => {
  const { host, input, calls } = await setup(t);
  const result = await runExperiments(host, { ...input, parameter_space: {}, max_trials: 1 }, undefined, {
    onPartition() { throw Object.assign(new Error('Used by another branch'), { code: 'PARTITION_ALREADY_OBSERVED' }); },
  });
  assert.equal(result.gaps[0].code, 'PARTITION_ALREADY_OBSERVED'); assert.equal(result.status, 'blocked');
  assert.equal(calls.filter(c => c.name === names.test || c.name === names.optimize).length, 0);
});

test('a completed engine run remains pending until holdout metrics and an immutable assessment are available', async t => {
  for (const failure of ['incompleteHoldoutEquity', 'failHoldoutRecord']) {
    const { host, input, holdout } = await setup(t, { [failure]: true });
    const result = await runExperiments(host, { ...input, holdout });
    assert.equal(result.status, 'blocked');
    assert.equal(result.holdout.nativeStatus, 'completed'); assert.equal(result.holdout.resultRef.kind, 'strategy.result');
    assert.equal(result.holdout.status, 'pending'); assert.equal(result.holdout.recordRef, undefined);
    assert.ok(result.selectionRef); assert.ok(result.best);
    assert.equal(result.gaps[0].code, failure === 'failHoldoutRecord' ? 'PUBLISH_FAILED' : 'INVALID_NATIVE_STATISTICS');
  }
});

test('a preregistered worst-neighbor objective selects the plateau, then independently confirms that frozen candidate', async t => {
  const scores = [100, 140, 100, 108, 110, 111, 110, 107, 100];
  const { host, input, holdout, calls, events } = await setup(t, { developmentProfile: ({ a }) => ({ end: scores[a] }) });
  const search = { ...input, parameter_space: { a: scores.map((_, i) => i), b: [0] }, objective: { metric: 'finalEquity', direction: 'maximize' } };
  const single = await runExperiments(host, search);
  assert.equal(single.selectionMethod, 'point_best'); assert.deepEqual(single.pointBest, single.best); assert.equal(single.best.parameters.a, 1);
  const protocol = { ...search, operation_id: 'plateau', selection: { method: 'neighborhood_worst', max_step: { a: 1 } } };
  const selected = await runExperiments(host, protocol);
  assert.equal(selected.status, 'selected', JSON.stringify(selected.gaps));
  assert.equal(selected.selectionMethod, 'neighborhood_worst');
  assert.equal(selected.pointBest.parameters.a, 1); assert.equal(selected.pointBest.score, 140);
  assert.equal(selected.best.parameters.a, 5); assert.equal(selected.best.score, 111); assert.deepEqual(selected.best.metrics, selected.robustCandidate.metrics);
  assert.equal(selected.robustCandidate.worstScore, 110); assert.equal(selected.robustCandidate.supportCount, 3);
  assert.deepEqual(selected.developmentNeighbors.map(n => [n.value, n.score, n.eligible]), [[4, 110, true], [6, 110, true]]);
  assert.ok(selected.developmentNeighbors.every(point => point.batchResultRef.kind === 'strategy.result'));
  assert.deepEqual(selected.selectionCoverage, { evaluated: true, plannedPoints: 9, observedPoints: 9, eligiblePoints: 9,
    numericAxes: ['a'], categoricalAxes: [], fixedAxes: ['b'], categoricalStrata: 1, maxStep: { a: 1 }, effectiveMaxStep: { a: 1 }, requiredNeighbors: 2, supportedCenters: 7,
    excludedCenters: { ineligible: 0, boundary: 2, sparse: 0, missingObservation: 0, ineligibleNeighbor: 0 } });
  const registered = await readRecord(host, selected.protocolRef, 'strategy-search-protocol');
  assert.deepEqual(registered.selection, protocol.selection); assert.equal(registered.selectionRule.aggregation, 'minimum');
  const frozen = await readRecord(host, selected.selectionRef, 'strategy-parameter-selection');
  assert.deepEqual(frozen.pointBest, selected.pointBest); assert.deepEqual(frozen.robustCandidate, selected.robustCandidate);
  assert.deepEqual(frozen.selectionCoverage, selected.selectionCoverage); assert.ok(!events.includes('holdout-prices'));
  const conflict = await runExperiments(host, { ...protocol, selection: { method: 'point_best' } });
  assert.equal(conflict.gaps[0].code, 'IDEMPOTENCY_CONFLICT'); assert.equal(conflict.selectionRef, null);
  const confirmation = { operation_id: 'confirm-plateau', backend: 'backtrader', selection_ref: selected.selectionRef, holdout };
  const changed = await runExperiments(host, { ...confirmation, selection: { method: 'point_best' } });
  assert.equal(changed.gaps[0].code, 'FROZEN_SELECTION'); assert.ok(!events.includes('holdout-prices'));
  const confirmed = await runExperiments(host, confirmation);
  assert.equal(confirmed.status, 'completed', JSON.stringify(confirmed.gaps)); assert.deepEqual(confirmed.best, selected.best);
  assert.deepEqual(confirmed.pointBest, selected.pointBest); assert.deepEqual(confirmed.robustCandidate, selected.robustCandidate);
  assert.deepEqual(calls.filter(c => c.name === names.test).map(call => call.input.parameters), [selected.best.parameters]);
});

test('minimizing drawdown minimizes the largest measured loss while holding categorical choices fixed', async t => {
  const losses = [30, 0, 30, 8, 5, 3, 5, 8, 30];
  const { host, input } = await setup(t, { developmentProfile: ({ a, regime, code }) => ({ end: 100, middle: 100 - losses[a] - (regime === 'slow' ? 10 : 0) - (code === 2 ? 2 : 0) }) });
  const protocol = { ...input, constraints: [], objective: { metric: 'maxDrawdown', direction: 'minimize' },
    parameter_space: { regime: ['slow', 'fast'], code: [2, 1], a: losses.map((_, i) => i) }, selection: { method: 'neighborhood_worst', categorical_axes: ['code'] } };
  const result = await runExperiments(host, protocol);
  assert.equal(result.status, 'selected', JSON.stringify(result.gaps));
  assert.equal(result.pointBest.score, 0); assert.equal(result.pointBest.parameters.a, 1);
  assert.deepEqual(result.best.parameters, { fixed: true, a: 5, code: 1, regime: 'fast' }); assert.equal(result.best.score, 0.03);
  assert.equal(result.robustCandidate.worstScore, 0.05); assert.equal(result.robustCandidate.supportCount, 3);
  assert.deepEqual(result.selectionCoverage.categoricalAxes, ['code', 'regime']); assert.equal(result.selectionCoverage.categoricalStrata, 4);
  assert.equal(result.selectionCoverage.supportedCenters, 28); assert.equal(result.selectionCoverage.excludedCenters.boundary, 8);
  const registered = await readRecord(host, result.protocolRef, 'strategy-search-protocol');
  assert.equal(registered.selectionRule.aggregation, 'maximum');
  const replay = await runExperiments(host, { ...protocol, parameter_space: Object.fromEntries(Object.entries(protocol.parameter_space).reverse()) });
  assert.equal(replay.status, 'selected', JSON.stringify(replay.gaps)); assert.deepEqual(replay.selectionRef, result.selectionRef);
});

test('infeasible neighbors and predeclared gap limits deny isolated centers an independent confirmation', async t => {
  const { host, input, holdout, calls, events } = await setup(t, { developmentProfile: ({ a }) => ({ end: 120 + a, trades: a % 2 === 1 ? 0 : 1 }) });
  const request = { ...input, holdout, parameter_space: { a: [0, 1, 2, 3, 4] }, constraints: [{ metric: 'closedTrades', op: '>=', value: 1 }],
    selection: { method: 'neighborhood_worst' } };
  const constrained = await runExperiments(host, request);
  assert.equal(constrained.status, 'failed'); assert.equal(constrained.gaps[0].code, 'NO_SUPPORTED_NEIGHBORHOOD');
  assert.equal(constrained.pointBest.parameters.a, 4); assert.equal(constrained.best, null); assert.equal(constrained.robustCandidate, null);
  assert.equal(constrained.selectionRef, null); assert.equal(constrained.selectionCoverage.supportedCenters, 0);
  assert.deepEqual(constrained.selectionCoverage.excludedCenters, { ineligible: 2, boundary: 2, sparse: 0, missingObservation: 0, ineligibleNeighbor: 1 });
  const sparse = await runExperiments(host, { ...request, operation_id: 'sparse', constraints: [], parameter_space: { a: [0, 1, 100] }, selection: { method: 'neighborhood_worst', max_step: { a: 3 } } });
  assert.equal(sparse.status, 'failed'); assert.equal(sparse.selectionCoverage.excludedCenters.sparse, 1);
  assert.equal(sparse.selectionCoverage.excludedCenters.boundary, 2); assert.equal(sparse.selectionRef, null);
  const noBridge = await runExperiments(host, { ...request, operation_id: 'default-local-spacing', constraints: [], parameter_space: { a: [0, 1, 100] } });
  assert.equal(noBridge.gaps[0].code, 'NO_SUPPORTED_NEIGHBORHOOD'); assert.deepEqual(noBridge.selectionCoverage.effectiveMaxStep, { a: 1 });
  assert.ok(!events.includes('holdout-prices')); assert.ok(!calls.some(call => call.name === names.test));
});

test('numeric interiors require both sides on every axis, with equal worst scores resolved by the declared grid order', async t => {
  const { host, input } = await setup(t, { developmentProfile: () => ({ end: 123 }) });
  const protocol = { ...input, parameter_space: { b: [3, 1, 2, 0], a: [2, 3, 1, 0] },
    objective: { metric: 'finalEquity', direction: 'maximize' }, selection: { method: 'neighborhood_worst' } };
  const tied = await runExperiments(host, protocol);
  assert.equal(tied.status, 'selected', JSON.stringify(tied.gaps)); assert.deepEqual(tied.pointBest.parameters, { fixed: true, a: 2, b: 3 });
  assert.deepEqual(tied.best.parameters, { fixed: true, a: 2, b: 1 }); assert.equal(tied.selectionCoverage.requiredNeighbors, 4);
  assert.equal(tied.selectionCoverage.supportedCenters, 4); assert.equal(tied.selectionCoverage.excludedCenters.boundary, 12);
  assert.equal(tied.robustCandidate.supportCount, 5);
  const decimal = await runExperiments(host, { ...protocol, operation_id: 'decimal-grid', parameter_space: { a: [0.2, 0.3, 0.4] },
    selection: { method: 'neighborhood_worst', max_step: { a: 0.1 } } });
  assert.equal(decimal.status, 'selected', JSON.stringify(decimal.gaps)); assert.equal(decimal.best.parameters.a, 0.3);
  const prices = await runExperiments(host, { ...protocol, operation_id: 'decimal-price-grid', parameter_space: { a: [1000.1, 1000.2, 1000.3] } });
  assert.equal(prices.status, 'selected', JSON.stringify(prices.gaps)); assert.equal(prices.selectionCoverage.effectiveMaxStep.a, 0.1);
});

test('unsupported or partly observed robust protocols never fall back to the best observed point', async t => {
  const { host, input, holdout, calls, events } = await setup(t, { partial: true });
  for (const [space, selection, expected] of [
    [{ a: [1, 2] }, { method: 'neighborhood_worst' }, 'ROBUST_GRID_UNSUPPORTED'],
    [{ a: ['a', 'b', 'c'] }, { method: 'neighborhood_worst' }, 'ROBUST_GRID_UNSUPPORTED'],
    [{ a: [1, 'b', 3] }, { method: 'neighborhood_worst' }, 'INVALID_SELECTION_RULE'],
    [{ a: [1, 2, 3] }, { method: 'neighborhood_worst', max_step: { other: 1 } }, 'INVALID_SELECTION_RULE'],
    [{ a: [1, 2, 3] }, { method: 'point_best', max_step: { a: 1 } }, 'INVALID_SELECTION_RULE'],
    [{}, { method: 'neighborhood_worst' }, 'ROBUST_GRID_UNSUPPORTED'],
  ]) {
    const result = await runExperiments(host, { ...input, holdout, parameter_space: space, max_trials: Object.keys(space).length ? 3 : 1, selection });
    assert.equal(result.status, 'blocked'); assert.equal(result.gaps[0].code, expected); assert.equal(result.best, null); assert.equal(result.selectionRef, null);
  }
  assert.equal(calls.length, 0);
  const partial = await runExperiments(host, { ...input, holdout, selection: { method: 'neighborhood_worst' } });
  assert.equal(partial.status, 'incomplete'); assert.ok(partial.bestObserved); assert.equal(partial.selectionRef, null);
  assert.equal(partial.pointBest, null); assert.equal(partial.best, null); assert.equal(partial.robustCandidate, null);
  assert.equal(partial.selectionCoverage.evaluated, false); assert.equal(partial.selectionCoverage.observedPoints, partial.counts.completed);
  assert.ok(!events.includes('holdout-prices')); assert.ok(!calls.some(call => call.name === names.test));
});
