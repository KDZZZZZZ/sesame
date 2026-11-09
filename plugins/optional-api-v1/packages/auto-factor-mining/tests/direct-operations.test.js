import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createOperations } from '../operations.js';
import { clone, digest, error } from '../contracts.js';
import { storageFixture } from './storage-fixture.js';

const ref = id => ({ id, revision: '1', digest: digest(id), kind: 'resource', schemaVersion: '1.0.0' });
const budget = { maxSeconds: 60, maxInputBytes: 1048576, maxOutputBytes: 1048576 };
const layout = { universe: ['A'], frequency: '1h', timezone: 'UTC', availableAt: 'bar_close', development: ['2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'], holdout: ['2026-01-04T00:00:00Z', '2026-01-05T00:00:00Z'], target: { kind: 'forward_return', field: 'close', horizonBars: 1 } };
const profile = { id: 'alpha', version: 1, kind: 'alpha', axis: 'time_series', minPairs: 3, minCoverage: 0.5, stabilityWindows: 2, maxReferenceCorrelation: 0.9, score: 'abs_rank_ic', diagnostics: [] };
const candidate = (id, tree = { field: 'close' }) => ({ id, formula: { dsl: 'qlib-expr/1', tree }, hypothesis: 'A stated hypothesis', origin: { method: 'seed', parents: [], parameters: {} } });
const first = candidate('first'), second = candidate('second');
const snapshot = { id: 'snapshot-1', manifest: ref('snapshot'), fields: ['close', 'volume'], layout, development: { rows: 20 }, holdout: { rows: 8 } };
const engine = { name: 'qlib', version: '0.9.7', environmentDigest: digest('environment'), operatorDigest: digest('operators') };
const valuesFor = (partition = 'development', formulas = [first, second]) => ({ id: 'values-1', manifest: ref('values'), snapshotId: snapshot.id, snapshotRef: snapshot.manifest, partition, engine, candidates: formulas.map((value, index) => index ? { id: value.id, status: 'failed', error: { code: 'COMPUTE_FAILED', message: 'One candidate failed', retryable: false } } : { id: value.id, status: 'ok', value: { candidate: value, computeKey: digest(value.formula) } }) });

function harness(overrides = {}) {
  const events = [], controller = new AbortController(), signal = controller.signal;
  const ctx = { jobId: 'operation-job', epoch: 1, attemptId: 'one-step', nativeAttempt: 1, signal };
  const nativeExecution = { run: { id: 'native-operation' }, attempt: 1 };
  const documents = new Map([[snapshot.manifest.id, { schema: 'factor-snapshot/1', value: snapshot }]]);
  const values = valuesFor(); documents.set(values.manifest.id, { schema: 'factor-values/1', value: values });
  const addValues = value => documents.set(value.manifest.id, { schema: 'factor-values/1', value });
  const ports = {
    artifacts: {
      verify: async (value, context) => { assert.equal(context, ctx); return { content: { schema: documents.get(value.id)?.schema } }; },
      readJSON: async (value, context) => { assert.equal(context, ctx); return clone(documents.get(value.id).value); },
    },
    execution: { async execute(kind, input, givenSignal, execution, work) {
      assert.equal(givenSignal, signal); assert.equal(execution, nativeExecution);
      assert.equal(input.budget.maxWorkers, 1); events.push(['execute', kind, clone(input)]); return work(ctx);
    } },
    compute: {
      prepare: async (...args) => { events.push(['prepare', ...args]); return snapshot; },
      compute: async (...args) => { events.push(['compute', ...args]); return { ...values, partition: args[2] }; },
    },
    evaluator: { evaluate: async (...args) => {
      events.push(['evaluate', ...args]);
      return [{ id: first.id, status: 'ok', value: { id: 'evaluation-1', candidateId: first.id, valuesId: values.id, valuesRef: values.manifest, partition: values.partition, profile, eligibility: 'invalid' } }, values.candidates[1]];
    } },
    library: { record: async (...args) => { events.push(['record', ...args]); return [{ id: 'factor-1' }]; } },
  };
  for (const [name, methods] of Object.entries(overrides)) Object.assign(ports[name], methods);
  return { operations: createOperations(ports), ports, events, controller, signal, ctx, nativeExecution, documents, values, addValues };
}

test('prepare completes only data preparation and returns the bounded snapshot handle', async () => {
  const h = harness(), input = { requestId: 'prepare-only', source: { datasetId: 'data' }, layout, budget };
  const result = await h.operations.prepare(input, h.signal, h.nativeExecution);
  assert.deepEqual(h.events.map(event => event[0]), ['execute', 'prepare']);
  assert.deepEqual(result, { snapshotRef: snapshot.manifest, snapshotId: snapshot.id, fields: snapshot.fields, layout, rows: { development: 20, holdout: 8 } });
  assert.deepEqual(h.events[1].slice(1, 3), [input.source, layout]);
  assert.equal(h.events[1][4], h.ctx);
});

test('compute honors the explicit holdout partition and never evaluates, searches or selects', async () => {
  const h = harness(), input = { requestId: 'compute-only', snapshotRef: snapshot.manifest, formulas: [first, second], partition: 'holdout', budget };
  const before = clone(input), result = await h.operations.compute(input, h.signal, h.nativeExecution);
  assert.deepEqual(h.events.map(event => event[0]), ['execute', 'compute']);
  assert.deepEqual(h.events[1][2], input.formulas); assert.equal(h.events[1][3], 'holdout');
  assert.equal(h.events[1][5], undefined);
  assert.deepEqual(result, { valuesRef: h.values.manifest, valuesId: h.values.id, snapshotId: snapshot.id, partition: 'holdout', candidates: [{ id: first.id, status: 'ok', computeKey: digest(first.formula) }, h.values.candidates[1]] });
  assert.deepEqual(input, before);
});

test('compute prepares auxiliary values only for the explicitly supplied diagnostics', async () => {
  const item = candidate('mean', { call: 'Mean', args: [{ field: 'close' }, { constant: 2 }] });
  const h = harness({ compute: { compute: async (...args) => { h.events.push(['compute', ...args]); return valuesFor('development', [item]); } } });
  const input = { requestId: 'diagnostics', snapshotRef: snapshot.manifest, formulas: [item], partition: 'development', budget, diagnostics: [{ kind: 'regimes', required: false, options: { field: 'volume', bins: [100] } }, { kind: 'sensitivity', required: false, options: { argumentPath: [1], neighbors: [0, 1, 3] } }] };
  const before = clone(input); await h.operations.compute(input, h.signal, h.nativeExecution);
  const diagnostics = h.events[1][5];
  assert.deepEqual(diagnostics.covariateFields, ['volume']);
  assert.deepEqual(diagnostics.sensitivity[0].neighbors.map(value => value.value), [1, 3]);
  assert.ok(diagnostics.sensitivity[0].neighbors.every(value => value.formula.tree.args[1].constant === value.value));
  assert.deepEqual(input, before); assert.deepEqual(h.events.map(event => event[0]), ['execute', 'compute']);
});

test('evaluate consumes only explicit fixed Values and mechanically archives successful evaluations', async () => {
  const h = harness(), reference = { ...valuesFor('development', [candidate('reference')]), id: 'reference-values', manifest: ref('reference-values') };
  h.addValues(reference);
  const result = await h.operations.evaluate({ requestId: 'evaluate-only', valuesRef: h.values.manifest, profile, referenceValues: [reference.manifest], budget }, h.signal, h.nativeExecution);
  assert.deepEqual(h.events.map(event => event[0]), ['execute', 'evaluate', 'record']);
  assert.deepEqual(h.events[1][3], [reference]); assert.equal(h.events[1][4], h.ctx);
  assert.equal(result.evaluations[0].value.eligibility, 'invalid');
  assert.deepEqual(h.events[2][1], [first]); assert.equal(h.events[2][3], h.ctx);
  assert.deepEqual(result.factorIds, ['factor-1']); assert.deepEqual(result.valuesRef, h.values.manifest);
  assert.deepEqual(result.evaluations[1], h.values.candidates[1]);
});

test('evaluate rejects reference Values from another snapshot or partition before numerical work', async () => {
  for (const changed of [{ snapshotId: 'other' }, { partition: 'holdout' }, { snapshotRef: ref('other') }, { engine: { ...engine, environmentDigest: digest('other') } }]) {
    const h = harness(), reference = { ...valuesFor('development', [first]), id: 'reference-values', manifest: ref('reference-values'), ...changed };
    h.addValues(reference);
    await assert.rejects(h.operations.evaluate({ requestId: 'wrong-reference', valuesRef: h.values.manifest, profile, referenceValues: [reference.manifest], budget }, h.signal, h.nativeExecution), { code: 'EVIDENCE_MISMATCH' });
    assert.deepEqual(h.events.map(event => event[0]), ['execute']);
  }
});

test('wrong artifact schemas and changed evaluation identities cannot archive factors', async () => {
  const h = harness(); h.documents.get(snapshot.manifest.id).schema = 'factor-values/1';
  await assert.rejects(h.operations.compute({ requestId: 'wrong-schema', snapshotRef: snapshot.manifest, formulas: [first], partition: 'development', budget }, h.signal, h.nativeExecution), { code: 'EVIDENCE_MISMATCH' });
  assert.deepEqual(h.events.map(event => event[0]), ['execute']);
  const changed = harness({ evaluator: { evaluate: async () => [{ id: first.id, status: 'ok', value: { candidateId: first.id, valuesId: 'other', partition: 'development' } }] } });
  await assert.rejects(changed.operations.evaluate({ requestId: 'wrong-evaluation', valuesRef: changed.values.manifest, profile, referenceValues: [], budget }, changed.signal, changed.nativeExecution), { code: 'EVIDENCE_MISMATCH' });
  assert.ok(changed.events.every(event => event[0] !== 'record'));
});

test('native interruption after numerical evaluation prevents late library admission', async () => {
  const h = harness(), evaluate = h.ports.evaluator.evaluate;
  h.ports.evaluator.evaluate = async (...args) => { const result = await evaluate(...args); h.controller.abort(error('RUN_INTERRUPTED', 'Native function interrupted')); return result; };
  await assert.rejects(h.operations.evaluate({ requestId: 'interrupt', valuesRef: h.values.manifest, profile, referenceValues: [], budget }, h.signal, h.nativeExecution), { code: 'RUN_INTERRUPTED' });
  assert.ok(h.events.every(event => event[0] !== 'record'));
});

test('factory preflight exposes only direct capabilities without runtime paths or side effects', async () => {
  const { createCapabilities } = await import('../index.js');
  const capabilities = createCapabilities({ context: { storageRoot: null, pluginRoot: null } });
  assert.deepEqual(capabilities.map(value => value.name), ['factor_environment', 'factor_prepare', 'factor_search', 'factor_compute', 'factor_evaluate', 'factor_library', 'factor_pool', 'factor_configuration_read', 'factor_configuration_update']);
  assert.ok(capabilities.every(value => typeof value.execute === 'function'));
});

test('conflicting concurrent configuration commands cannot change the saved selection', async t => {
  const { createCapabilities } = await import('../index.js');
  const f = await storageFixture(t); f.host.context.pluginRoot = f.root;
  const processes = new Map(); let probes = 0;
  f.host.capabilities = { async invoke(name, input) {
    assert.equal(name, 'host.process.exec'); probes++;
    await writeFile(input.argv.at(-1), JSON.stringify({ ready: true, pythonPath: input.argv[0], environmentDigest: digest('environment'), versions: {} }));
    const run = { id: `probe-${probes}`, status: 'completed', output: { exitCode: 0 } }; processes.set(run.id, run); return { type: 'run', run };
  } };
  f.host.runs = { wait: run => ({ reason: 'settled', run: processes.get(run.id) }) };
  const first = Object.fromEntries(createCapabilities(f.host).map(value => [value.name, value.execute]));
  const second = Object.fromEntries(createCapabilities(f.host).map(value => [value.name, value.execute]));
  const results = await Promise.allSettled([first.factor_configuration_update({ pythonPath: 'A-python', command_id: 'same-command' }), second.factor_configuration_update({ pythonPath: 'B-python', command_id: 'same-command' })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(probes, 1); assert.deepEqual(await first.factor_configuration_read(), { pythonPath: 'A-python', ready: true });
});
