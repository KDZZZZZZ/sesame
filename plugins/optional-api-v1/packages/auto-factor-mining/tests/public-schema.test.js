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
const libraryCapability = capabilities.find(value => value.id === 'factor_library');
const ref = { id: 'fixed-artifact', revision: '1', digest: digest('artifact'), kind: 'resource', schemaVersion: '1.0.0' };
const change = { operationId: 'selection-1', poolId: 'selected', strategyId: 'strategy', expectedVersion: 0, decision: 'add', factorIds: ['factor-1'], replaces: [], purpose: 'Explicit strategy selection', reason: 'Schema boundary regression', strategyVersion: '1', applicationEvidence: [] };
const registration = { action: 'register', operationId: 'register-1', formula: { dsl: 'qlib-expr/1', tree: { field: 'close' } }, name: 'Synthetic close reference', hypothesis: 'A declared synthetic formula, not evaluated evidence.', sources: [{ url: 'https://example.invalid/factor-reference', revision: 'synthetic-v1', license: 'Synthetic test fixture' }], changes: 'Adapted only for this schema fixture.' };

test('factor registration accepts explicit formulas and provenance, never caller-authored evaluation fields', () => {
  assert.equal(Value.Check(libraryCapability.inputSchema, registration), true);
  assert.equal(Value.Check(libraryCapability.inputSchema, { ...registration, sources: [] }), true, 'Original formulas do not require a fabricated external source');
  for (const field of ['score', 'rankIC', 'eligibility', 'evaluationIds']) {
    assert.equal(Value.Check(libraryCapability.inputSchema, { ...registration, [field]: field === 'evaluationIds' ? [] : 1 }), false, `Register must reject caller-supplied ${field}`);
  }
  assert.equal(Value.Check(libraryCapability.inputSchema, { ...registration, formula: { ...registration.formula, code: 'return 1' } }), false);
  assert.equal(Value.Check(libraryCapability.inputSchema, { ...registration, sources: [{ ...registration.sources[0], score: 1 }] }), false);
  assert.equal(Value.Check(libraryCapability.inputSchema, { ...registration, formula: { dsl: 'qlib-expr/1', tree: { call: 'Execute', args: [{ field: 'close' }] } } }), false);
});

test('registration source and descriptive bounds are exposed by the public input schema', () => {
  for (const [field, maximum] of [['name', 128], ['hypothesis', 4000], ['changes', 4000]]) {
    for (const length of [0, maximum, maximum + 1]) {
      assert.equal(Value.Check(libraryCapability.inputSchema, { ...registration, [field]: 'x'.repeat(length) }), length === maximum, `${field} length ${length}`);
    }
  }
  for (const length of [4, 5]) assert.equal(Value.Check(libraryCapability.inputSchema, { ...registration, sources: Array.from({ length }, () => registration.sources[0]) }), length === 4);
  for (const [field, maximum] of [['url', 2048], ['revision', 128], ['license', 128]]) {
    for (const length of [0, maximum, maximum + 1]) {
      const value = field === 'url' && length ? 'https://example.invalid/'.padEnd(length, 'x') : 'x'.repeat(length);
      assert.equal(Value.Check(libraryCapability.inputSchema, { ...registration, sources: [{ ...registration.sources[0], [field]: value }] }), length === maximum, `source ${field} length ${length}`);
    }
  }
  for (const missing of ['url', 'revision', 'license']) {
    const source = { ...registration.sources[0] }; delete source[missing];
    assert.equal(Value.Check(libraryCapability.inputSchema, { ...registration, sources: [source] }), false, `source requires ${missing}`);
  }
});

test('library output exposes bounded registrations without requiring an evaluation', () => {
  const { formula, name, hypothesis, sources, changes } = registration;
  const definitionDigest = digest({ dsl: formula.dsl, operatorDigest: OPERATOR_DIGEST, tree: formula.tree });
  const factor = { id: identifier('factor', [formula.dsl, definitionDigest]), formula, definitionDigest, evaluationIds: [], annotations: [] };
  const provenance = { name, hypothesis, sources, changes };
  assert.equal(Value.Check(libraryCapability.outputSchema, factor), true, 'Registrations remain optional for factors archived from numerical evaluation');
  for (const length of [1, 8, 9]) {
    const registered = { ...factor, registrations: Array.from({ length }, (_, index) => ({ ...provenance, name: `${name} ${index}` })) };
    assert.equal(Value.Check(libraryCapability.outputSchema, registered), length <= 8);
    assert.equal(Value.Check(libraryCapability.outputSchema, { factor: registered, evaluations: { items: [], cursor: null } }), length <= 8);
    assert.equal(Value.Check(libraryCapability.outputSchema, { items: [registered], cursor: null }), length <= 8);
  }
  assert.equal(Value.Check(libraryCapability.outputSchema, { ...factor, registrations: [{ ...provenance, score: 1 }] }), false);
  assert.equal(Value.Check(libraryCapability.inputSchema, { action: 'query', query: { text: 'Synthetic close', evaluated: false } }), true);
  assert.equal(Value.Check(libraryCapability.inputSchema, { action: 'query', query: { evaluated: true } }), true);
  for (const length of [0, 256, 257]) assert.equal(Value.Check(libraryCapability.inputSchema, { action: 'query', query: { text: 'x'.repeat(length) } }), length === 256);
  assert.equal(Value.Check(libraryCapability.inputSchema, { action: 'query', query: { evaluated: 'true' } }), false);
});

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
