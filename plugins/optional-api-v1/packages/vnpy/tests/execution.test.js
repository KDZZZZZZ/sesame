import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { runProcess } from '../execution.js';

for (const mode of ['synchronous', 'asynchronous', 'already-aborted']) {
  test(`vn.py cancellation contains ${mode} host cancellation errors and preserves the interrupted outcome`, async () => {
    const controller = new AbortController();
    const reference = { id: 'owned-vnpy-run' };
    const failure = new DOMException('Host context aborted', 'AbortError');
    const outcome = { code: 'run_cancelled', message: 'Owned process cancelled', details: { interrupted: true } };
    let attempts = 0;
    if (mode === 'already-aborted') controller.abort();
    const host = {
      capabilities: {
        async invoke(id, input, options) {
          assert.equal(id, 'host.process.exec');
          assert.deepEqual(input, { argv: ['python'], cwd: '.', timeoutMs: 120000 });
          assert.equal(options.signal, controller.signal);
          return { type: 'run', run: reference };
        },
      },
      runs: {
        cancel(run, options) {
          assert.equal(run, reference);
          assert.deepEqual(options, { reason: 'Caller cancelled' });
          attempts++;
          if (mode === 'asynchronous') return Promise.reject(failure);
          throw failure;
        },
        async wait(run) {
          assert.equal(run, reference);
          controller.abort();
          // EventTarget reports escaped listener errors on the next turn.
          await new Promise(resolve => setImmediate(resolve));
          return { reason: 'settled', run: { ...reference, status: 'cancelled', error: outcome } };
        },
      },
    };
    await assert.rejects(runProcess(host, ['python'], { cwd: '.', signal: controller.signal }), outcome);
    assert.equal(attempts, 1);
    assert.deepEqual(getEventListeners(controller.signal, 'abort'), []);
  });
}
