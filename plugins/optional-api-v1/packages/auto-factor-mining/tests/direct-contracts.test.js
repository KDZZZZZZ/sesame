import test from 'node:test';
import assert from 'node:assert/strict';
import { operationBudget, validatePrepare, validateComputeInput, validateEvaluateInput, validateSearchInput } from '../contracts.js';

const budget = { maxSeconds: 60, maxInputBytes: 100000, maxOutputBytes: 100000 };
const ref = { id: 'a', revision: 'r', digest: `sha256:${'a'.repeat(64)}`, kind: 'resource', schemaVersion: '1.0.0' };
const formula = { id: 'f', formula: { dsl: 'qlib-expr/1', tree: { field: 'close' } }, hypothesis: 'Momentum', origin: { method: 'seed', parents: [], parameters: {} } };
const profile = { id: 'alpha', version: 1, kind: 'alpha', axis: 'time_series', minPairs: 3, minCoverage: 0.8, stabilityWindows: 2, maxReferenceCorrelation: 0.95, score: 'abs_rank_ic', diagnostics: [] };

test('each operation accepts only its own narrow input and no implicit pipeline options', () => {
  const compute = { requestId: 'c', snapshotRef: ref, formulas: [formula], partition: 'development', budget };
  assert.equal(validateComputeInput(compute), compute);
  assert.throws(() => validateComputeInput({ ...compute, autoEvaluate: true }));
  assert.throws(() => validateComputeInput({ ...compute, formulas: [formula, formula] }));
  assert.throws(() => validateComputeInput({ ...compute, formulas: Array.from({ length: 65 }, (_, i) => ({ ...formula, id: `f${i}` })) }));
  const evaluate = { requestId: 'e', valuesRef: ref, profile, referenceValues: [], budget };
  assert.equal(validateEvaluateInput(evaluate), evaluate);
  assert.throws(() => validateEvaluateInput({ ...evaluate, references: ['factor-id'] }));
  assert.throws(() => validatePrepare({ requestId: 'p', source: { datasetId: 'd' }, budget }));
});

test('search feedback is only exact evaluation identifiers, never caller scores', () => {
  const next = { action: 'propose', requestId: 'n', searchId: 's', limit: 1, feedback: [{ factorId: 'f', evaluationId: 'e' }] };
  assert.equal(validateSearchInput(next), next);
  assert.throws(() => validateSearchInput({ ...next, feedback: [{ ...next.feedback[0], developmentScore: 1 }] }));
  assert.throws(() => validateSearchInput({ ...next, budget }));
  assert.throws(() => validateSearchInput({ action: 'read', searchId: 's', limit: 1 }));
  assert.equal(validateSearchInput({ ...next, limit: 0 }).limit, 0);
});

test('resource budget does not imply worker scheduling', () => {
  assert.deepEqual(operationBudget(budget, 2), { ...budget, maxCandidates: 2, batchSize: 2, maxWorkers: 1, seed: 0 });
  assert.throws(() => operationBudget({ ...budget, maxWorkers: 8 }));
});
