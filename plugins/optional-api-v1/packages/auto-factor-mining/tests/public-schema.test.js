import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { createArtifacts } from '../artifacts.js';
import { createLibrary } from '../library.js';
import { COLLECTIONS, digest, identifier, OPERATOR_DIGEST, validateDiagnostics } from '../contracts.js';
import { storageFixture } from './storage-fixture.js';

const capabilities = JSON.parse(readFileSync(new URL('../capabilities.json', import.meta.url))).capabilities;
const pool = capabilities.find(value => value.id === 'factor_pool');
const compute = capabilities.find(value => value.id === 'factor_compute');
const ref = { id: 'fixed-artifact', revision: '1', digest: digest('artifact'), kind: 'resource', schemaVersion: '1.0.0' };
const change = { operationId: 'selection-1', poolId: 'selected', strategyId: 'strategy', expectedVersion: 0, decision: 'add', factorIds: ['factor-1'], replaces: [], purpose: 'Explicit strategy selection', reason: 'Schema boundary regression', strategyVersion: '1', applicationEvidence: [] };

test('a real library pool grown in separate decisions remains valid beyond 200 members', async t => {
  const f = await storageFixture(t), library = createLibrary({ state: f.state, artifacts: createArtifacts({ host: f.host }) });
  const ids = Array.from({ length: 201 }, (_, index) => {
    const formula = { dsl: 'qlib-expr/1', tree: { call: 'Add', args: [{ field: 'close' }, { constant: index }] } };
    const definitionDigest = digest({ dsl: formula.dsl, operatorDigest: OPERATOR_DIGEST, tree: formula.tree });
    const id = identifier('factor', [formula.dsl, definitionDigest]);
    f.seed(COLLECTIONS.factors, id, { id, formula, definitionDigest, evaluationIds: [], annotations: [] }); return id;
  });
  const first = { ...change, factorIds: ids.slice(0, 100) };
  assert.equal(Value.Check(pool.inputSchema, { action: 'decide', change: first }), true);
  assert.equal(Value.Check(pool.outputSchema, await library.decide(first)), true);
  const second = { ...change, operationId: 'selection-2', expectedVersion: 1, factorIds: ids.slice(100) };
  assert.equal(Value.Check(pool.inputSchema, { action: 'decide', change: second }), true);
  const result = await library.decide(second);
  assert.equal(result.factorIds.length, 201);
  assert.equal(Value.Check(pool.outputSchema, result), true, 'A committed pool must be returnable through its public output schema');
  const read = await library.pool(change.poolId);
  assert.deepEqual(read, result); assert.equal(Value.Check(pool.outputSchema, read), true);
});

test('pool member and application evidence schema bounds match the library contract', () => {
  const ids = length => Array.from({ length }, (_, index) => `factor-${index}`);
  for (const key of ['factorIds', 'replaces']) {
    assert.equal(Value.Check(pool.inputSchema, { action: 'decide', change: { ...change, decision: key === 'replaces' ? 'replace' : 'add', [key]: ids(256) } }), true);
    assert.equal(Value.Check(pool.inputSchema, { action: 'decide', change: { ...change, decision: key === 'replaces' ? 'replace' : 'add', [key]: ids(257) } }), false);
  }
  const result = { id: 'selected', strategyId: 'strategy', version: 1, factorIds: ids(256), history: ref };
  assert.equal(Value.Check(pool.outputSchema, result), true);
  assert.equal(Value.Check(pool.outputSchema, { ...result, factorIds: ids(257) }), false);
  const feedback = { action: 'feedback', poolId: 'selected', strategyVersion: '1', poolVersion: 1, applicationEvidence: [], note: 'Observed application evidence', operationId: 'feedback' };
  for (const length of [32, 33]) {
    const applicationEvidence = Array.from({ length }, () => ref);
    assert.equal(Value.Check(pool.inputSchema, { action: 'decide', change: { ...change, applicationEvidence } }), length === 32);
    assert.equal(Value.Check(pool.inputSchema, { ...feedback, applicationEvidence }), length === 32);
  }
  assert.equal(Value.Check(pool.inputSchema, { ...feedback, callerScore: 1 }), false);
});

test('regime diagnostics expose the same closed twenty-bin limit as semantic validation', () => {
  const formula = { id: 'close', formula: { dsl: 'qlib-expr/1', tree: { field: 'close' } }, hypothesis: 'Declared test hypothesis', origin: { method: 'seed', parents: [], parameters: {} } };
  const input = { requestId: 'diagnostics', snapshotRef: ref, formulas: [formula], partition: 'development', budget: { maxSeconds: 60, maxInputBytes: 1048576, maxOutputBytes: 1048576 } };
  for (const length of [20, 21]) {
    const diagnostics = [{ kind: 'regimes', required: false, options: { field: 'volume', bins: Array.from({ length }, (_, index) => index) } }];
    assert.equal(Value.Check(compute.inputSchema, { ...input, diagnostics }), length === 20);
    if (length === 20) assert.equal(validateDiagnostics(diagnostics), diagnostics);
    else assert.throws(() => validateDiagnostics(diagnostics));
  }
  assert.equal(Value.Check(compute.inputSchema, { ...input, diagnostics: [{ kind: 'regimes', required: false, options: { field: 'volume', bins: [1], automaticBins: true } }] }), false);
});
