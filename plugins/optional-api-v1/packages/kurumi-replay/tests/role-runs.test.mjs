import test from 'node:test';
import assert from 'node:assert/strict';
import { waitRole } from '../role-runs.js';

test('an interrupted replay role returns its specific blocker without polling or discarding its Run', async () => {
  let waits = 0;
  const host = { runs: { wait: async ref => {
    waits++;
    return { reason: 'interrupted', run: { id: ref.id, status: 'interrupted', error: { code: 'ECONNRESET', message: 'Model connection reset' },
      interrupts: [{ id: 'interruption-1', reason: 'Model connection reset', resolvedAt: null }] } };
  } } };
  await assert.rejects(waitRole(host, 'retained-role', new AbortController().signal), error => {
    assert.equal(error.code, 'RUN_INTERRUPTED'); assert.match(error.message, /Model connection reset/);
    assert.equal(error.details.runId, 'retained-role'); assert.equal(error.details.interrupts[0].id, 'interruption-1');
    assert.equal(error.details.cause.code, 'ECONNRESET'); return true;
  });
  assert.equal(waits, 1);
});
