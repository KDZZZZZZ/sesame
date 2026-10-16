import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { executeProcess } from '../packages/workspace/tools.js';

function fixture(run) {
  const calls = [], host = { capabilities: { invoke: async (...args) => { calls.push(['invoke', ...args]); return { type: 'run', run: { id: 'process-1' }, receipt: { id: 'receipt' } }; } }, runs: {
    wait: async (_ref, options) => { options.signal?.throwIfAborted(); return { reason: 'settled', run }; },
    cancel: async ref => { calls.push(['cancel', ref]); },
  } };
  return { host, calls, files: { assertPath: async path => path }, execute: signal => executeProcess(host, { assertPath: async path => path }, { argv: ['actual', 'argument'], cwd: tmpdir() }, signal) };
}
test('process failure preserves actual host diagnostics and exact Run identity', async () => {
  for (const code of ['PROCESS_EXIT', 'CANCELLED', 'OUTPUT_LIMIT']) {
    const details = { output: 'verified checkpoint', executionId: 'exec-1', cwd: tmpdir(), snapshot_errors: [{ stage: 'before', message: 'Incomplete input evidence' }] };
    const f = fixture({ id: 'process-1', status: 'failed', error: { code, message: 'Actual process failure', details } });
    await assert.rejects(f.execute(), error => { assert.equal(error.code, code);assert.equal(error.details.executionId, 'exec-1');assert.equal(error.details.output, details.output);assert.deepEqual(error.details.snapshot_errors, details.snapshot_errors);assert.equal(error.details.run.id, 'process-1');return true; });
  }
});
test('success and failures bound displayed output to valid UTF-8 while keeping real Run references', async () => {
  const output = 'old output\n' + '进度🟢'.repeat(6000) + '\nverified checkpoint';
  const success = fixture({ id: 'process-1', status: 'completed', output: { exitCode: 0, output } });
  const result = await success.execute();assert.ok(Buffer.byteLength(result.output) <= 50000);assert.ok(output.endsWith(result.output));assert.equal(result.output.includes('\uFFFD'), false);assert.equal(result.truncated, true);
  const failure = fixture({ id: 'process-1', status: 'failed', error: { code: 'OUTPUT_LIMIT', details: { output } } });
  await assert.rejects(failure.execute(), error => { assert.ok(Buffer.byteLength(error.details.output) <= 50000);assert.ok(output.endsWith(error.details.output));assert.equal(error.details.truncated, true);return true; });
});
test('upstream truncation is preserved and caller abort cancels the process Run', async () => {
  const f = fixture({ id: 'process-1', status: 'completed', output: { output: 'retained tail', truncated: true } });
  assert.equal((await f.execute()).truncated, true);
  const controller = new AbortController();f.host.runs.wait = async (_run, { signal }) => { controller.abort();signal.throwIfAborted(); };
  await assert.rejects(f.execute(controller.signal), { name: 'AbortError' });assert.equal(f.calls.at(-1)[0], 'cancel');
});
