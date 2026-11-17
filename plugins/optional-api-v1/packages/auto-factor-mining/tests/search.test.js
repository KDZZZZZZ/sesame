import assert from 'node:assert/strict';
import test from 'node:test';
import { createSearch } from '../search.js';

test('search delegates the fixed proposal input and local execution context', async () => {
  const request = { requestId: 'request' };
  const checkpoint = { id: 'checkpoint' };
  const feedback = [{ candidateId: 'candidate' }];
  const context = { jobId: 'job', epoch: 2, attemptId: 'attempt', signal: new AbortController().signal };
  const receipt = { candidates: [], checkpoint, exhausted: true };
  const calls = [];
  const search = createSearch({ python: { execute: async (...args) => { calls.push(args); return receipt; } } });
  assert.equal(await search.propose(request, checkpoint, feedback, 4, context), receipt);
  assert.deepEqual(calls, [['propose', { request, checkpoint, feedback, limit: 4 }, context]]);
});

test('search preserves worker failures for the runtime to record', async () => {
  const failure = Object.assign(new Error('checkpoint version changed'), { code: 'CHECKPOINT_VERSION' });
  const search = createSearch({ python: { execute: async () => { throw failure; } } });
  await assert.rejects(search.propose({}, null, [], 1, {}), error => error === failure);
});
