import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createArtifacts, attemptDirectory, fileReceipt } from '../artifacts.js';
import { createJournal } from '../journal.js';
import { createPython } from '../python-bridge.js';
import { canonical, identifier } from '../contracts.js';
import { storageFixture } from './storage-fixture.js';

async function fixture(t) {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host });
  const journal = createJournal({ state: f.state, artifacts, ownerSessionId: 'bridge-test' });
  const budget = { maxCandidates: 4, batchSize: 2, maxWorkers: 2, maxSeconds: 180, maxInputBytes: 1048576, maxOutputBytes: 1048576, seed: 1 };
  const job = await journal.create('research', { requestId: 'recovery', budget });
  await journal.update(job.id, value => ({ ...value, status: 'running', startedAt: Date.now() }));
  const processes = new Map(); let launches = 0;
  f.host.context.pluginRoot = f.root;
  f.host.capabilities = { async invoke(name, input) {
    assert.equal(name, 'host.process.exec'); launches++;
    const request = JSON.parse(await readFile(input.argv.at(-2), 'utf8'));
    const checkpoint = join(request.input.outputDir, 'checkpoint.json'); await writeFile(checkpoint, canonical({ schema: 'factor-search-state/1', trials: [] }));
    await writeFile(input.argv.at(-1), canonical({ schema: 'factor-worker/1', command: 'propose', status: 'ok', output: { candidates: [], exhausted: true, checkpoint: await fileReceipt(checkpoint) }, error: null }));
    const run = { id: `process-${launches}`, status: 'completed', output: { exitCode: 0 } }; processes.set(run.id, run); return { type: 'run', run };
  } };
  f.host.runs = { read: ref => ({ run: processes.get(typeof ref === 'string' ? ref : ref.id) }), wait: ref => ({ reason: 'settled', run: processes.get(typeof ref === 'string' ? ref : ref.id) }), cancel: () => assert.fail('Unexpected cancellation') };
  const python = createPython({ host: f.host, artifacts, journal, environment: { inspect: async () => ({ ready: true, pythonPath: 'fixture-python' }) } });
  const input = { request: {}, checkpoint: null, feedback: [], limit: 1 }, operation = identifier('process', ['propose', input]);
  const ctx = { jobId: job.id, epoch: 1, attemptId: 'caller', nativeAttempt: 1, signal: new AbortController().signal };
  return { ...f, artifacts, journal, processes, python, input, operation, ctx, launches: () => launches };
}

test('unknown process is retained; only an explicitly resumed native attempt retries pure work', async t => {
  const f = await fixture(t), old = { ...f.ctx, attemptId: 'old-unknown' }, dir = attemptDirectory(f.root, old);
  await mkdir(dir, { recursive: true });
  f.processes.set('old', { id: 'old', status: 'unknown' });
  await f.journal.entry(f.ctx.jobId, 'process', f.operation, () => ({ command: 'propose', attemptId: old.attemptId, nativeAttempt: 1, runId: 'old', resultPath: join(dir, 'result.json'), outputRef: null, status: 'running' }));
  await assert.rejects(f.python.execute('propose', f.input, f.ctx), { code: 'PROCESS_RECONCILIATION_REQUIRED' });
  assert.equal(f.launches(), 0);
  const result = await f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 });
  assert.equal(result.exhausted, true); assert.equal(f.launches(), 1);
  const attempts = await f.journal.all(f.ctx.jobId, 'process-attempt'); assert.equal(attempts.length, 1);
  assert.equal(attempts[0].disposition, 'retry_isolated_pure_computation');
  const current = await f.journal.readEntry(f.ctx.jobId, 'process', f.operation); assert.notEqual(current.attemptId, old.attemptId);
  assert.deepEqual(await f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 }), result); assert.equal(f.launches(), 1);
});

test('a resumed unknown process with a valid receipt is recovered without a new process', async t => {
  const f = await fixture(t), first = await f.python.execute('propose', f.input, f.ctx);
  const prior = await f.journal.readEntry(f.ctx.jobId, 'process', f.operation);
  f.processes.set(prior.runId, { id: prior.runId, status: 'unknown' });
  await f.journal.entry(f.ctx.jobId, 'process', f.operation, value => ({ ...value, outputRef: null, status: 'running' }));
  const resumed = await f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 });
  assert.deepEqual(resumed, first); assert.equal(f.launches(), 1);
  assert.equal((await f.journal.all(f.ctx.jobId, 'process-attempt'))[0].disposition, 'use_verified_receipt');
});

test('oversized artifact input is refused before materialization or process launch', async t => {
  const f = await fixture(t);
  await f.journal.update(f.ctx.jobId, job => ({ ...job, budget: { ...job.budget, maxInputBytes: 1024 } }));
  const checkpoint = await f.artifacts.publishJSON({ schema: 'factor-search-state/1', value: 'x'.repeat(2048) }, { schema: 'factor-search-state/1', dependencies: [], operationId: 'large-input' });
  await assert.rejects(f.python.execute('propose', { ...f.input, checkpoint }, f.ctx), { code: 'RESOURCE_EXHAUSTED' }); assert.equal(f.launches(), 0);
});
