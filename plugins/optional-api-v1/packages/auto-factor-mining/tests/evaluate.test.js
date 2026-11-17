import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvaluator } from '../evaluate.js';

test('evaluator forwards the exact narrow request and local context', async () => {
  const values = { id: 'values' }, profile = { id: 'profile' }, references = [{ id: 'reference' }];
  const context = { jobId: 'job', epoch: 1, attemptId: 'attempt', signal: new AbortController().signal };
  const result = [{ id: 'candidate', status: 'ok', value: { pairs: 20 } }];
  const evaluator = createEvaluator({ python: { execute: async (...args) => {
    assert.deepEqual(args, ['evaluate', { values, profile, referenceValues: references }, context]);
    assert.equal(args[2], context);
    return result;
  } } });
  assert.equal(await evaluator.evaluate(values, profile, references, context), result);
});

test('evaluator preserves bridge failures and requires its sole dependency', async () => {
  assert.throws(() => createEvaluator({}), /python.execute/);
  const error = new Error('cancelled');
  const evaluator = createEvaluator({ python: { execute: async () => { throw error; } } });
  await assert.rejects(evaluator.evaluate({}, {}, [], {}), caught => caught === error);
});
