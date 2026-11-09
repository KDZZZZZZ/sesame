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
  const job = await journal.create('search-propose', { requestId: 'recovery', budget });
  await journal.update(job.id, value => ({ ...value, runId: 'parent', status: 'running', startedAt: Date.now() }));
  const processes = new Map([['parent', { id: 'parent', status: 'interrupted' }]]); let launches = 0;
  f.host.context.pluginRoot = f.root;
  f.host.capabilities = { async invoke(name, input, options) {
    assert.equal(name, 'host.process.exec'); launches++;
    const request = JSON.parse(await readFile(input.argv.at(-2), 'utf8'));
    const checkpoint = join(request.input.outputDir, 'checkpoint.json'); await writeFile(checkpoint, canonical({ schema: 'factor-search-state/1', trials: [] }));
    await writeFile(input.argv.at(-1), canonical({ schema: 'factor-worker/1', command: 'propose', status: 'ok', output: { candidates: [], exhausted: true, checkpoint: await fileReceipt(checkpoint) }, error: null }));
    const run = { id: `process-${launches}`, parentRunId: 'parent', capabilityId: name, operationId: options.operationId, status: 'completed', output: { exitCode: 0 } }; processes.set(run.id, run); return { type: 'run', run };
  } };
  f.host.runs = { list: input => ({ items: [...processes.values()].filter(run => run.parentRunId === input.parentRunId && run.capabilityId === input.capabilityId) }), read: ref => ({ run: processes.get(typeof ref === 'string' ? ref : ref.id) }), wait: ref => ({ reason: 'settled', run: processes.get(typeof ref === 'string' ? ref : ref.id) }), cancel: () => assert.fail('Unexpected cancellation') };
  const python = createPython({ host: f.host, artifacts, journal, environment: { inspect: async () => ({ ready: true, pythonPath: 'fixture-python' }) } });
  const input = { request: {}, checkpoint: null, feedback: [], limit: 1 }, operation = identifier('process', ['propose', input]);
  const ctx = { jobId: job.id, epoch: 1, attemptId: 'caller', nativeAttempt: 1, signal: new AbortController().signal };
  return { ...f, artifacts, journal, processes, python, input, operation, ctx, launches: () => launches };
}

test('unknown process keeps its reservation and cannot retry until termination is observed', async t => {
  const f = await fixture(t), old = { ...f.ctx, attemptId: 'old-unknown' }, dir = attemptDirectory(f.root, old);
  await mkdir(dir, { recursive: true });
  f.processes.set('old', { id: 'old', status: 'unknown' });
  await f.journal.entry(f.ctx.jobId, 'process', f.operation, () => ({ command: 'propose', attemptId: old.attemptId, nativeAttempt: 1, runId: 'old', resultPath: join(dir, 'result.json'), outputRef: null, status: 'running', budgetToken: 'old-token', inputBytes: 64, budgetSettled: false }));
  await f.journal.update(f.ctx.jobId, job => ({ ...job, byteUsage: { input: 0, output: 0, active: { 'old-token': { input: 64, output: 1024 } } } }));
  await assert.rejects(f.python.execute('propose', f.input, f.ctx), { code: 'PROCESS_RECONCILIATION_REQUIRED' });
  await assert.rejects(f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 }), { code: 'PROCESS_RECONCILIATION_REQUIRED' });
  assert.equal(f.launches(), 0);
  assert.deepEqual((await f.journal.get(f.ctx.jobId)).byteUsage, { input: 0, output: 0, active: { 'old-token': { input: 64, output: 1024 } } });
  f.processes.set('old', { id: 'old', status: 'cancelled' });
  const result = await f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 });
  assert.equal(result.exhausted, true); assert.equal(f.launches(), 1);
  const attempts = await f.journal.all(f.ctx.jobId, 'process-attempt'); assert.equal(attempts.length, 1);
  assert.equal(attempts[0].disposition, 'retry_isolated_pure_computation');
  const current = await f.journal.readEntry(f.ctx.jobId, 'process', f.operation); assert.notEqual(current.attemptId, old.attemptId);
  assert.deepEqual(await f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 }), result); assert.equal(f.launches(), 1);
});

test('a retained receipt does not prove an unknown process stopped', async t => {
  const f = await fixture(t), first = await f.python.execute('propose', f.input, f.ctx);
  const prior = await f.journal.readEntry(f.ctx.jobId, 'process', f.operation);
  f.processes.set(prior.runId, { id: prior.runId, status: 'unknown' });
  await f.journal.entry(f.ctx.jobId, 'process', f.operation, value => ({ ...value, outputRef: null, status: 'running' }));
  await assert.rejects(f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 }), { code: 'PROCESS_RECONCILIATION_REQUIRED' });
  assert.equal(f.launches(), 1);
  f.processes.set(prior.runId, { id: prior.runId, status: 'cancelled' });
  const resumed = await f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 });
  assert.deepEqual(resumed, first); assert.equal(f.launches(), 1);
  assert.equal((await f.journal.all(f.ctx.jobId, 'process-attempt'))[0].disposition, 'use_verified_receipt');
});

test('a stopped child is not automatically restarted and explicit resubmission reuses its valid receipt', async t => {
  const f = await fixture(t), result = await f.python.execute('propose', f.input, f.ctx);
  const prior = await f.journal.readEntry(f.ctx.jobId, 'process', f.operation);
  f.processes.set(prior.runId, { id: prior.runId, status: 'cancelled' });
  await f.journal.entry(f.ctx.jobId, 'process', f.operation, value => ({ ...value, outputRef: null, status: 'running' }));
  await assert.rejects(f.python.execute('propose', f.input, f.ctx), { code: 'PROCESS_RECONCILIATION_REQUIRED' });
  assert.equal(f.launches(), 1);
  assert.deepEqual(await f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 }), result);
  assert.equal(f.launches(), 1);
});

test('explicit retry after interrupted child admission preserves its old attempt files', async t => {
  const f = await fixture(t), old = { ...f.ctx, attemptId: 'admission-without-run' }, dir = attemptDirectory(f.root, old);
  await mkdir(dir, { recursive: true });
  const retained = join(dir, 'request.json'); await writeFile(retained, 'retained admission bytes');
  await f.journal.entry(f.ctx.jobId, 'process', f.operation, () => ({ command: 'propose', attemptId: old.attemptId, nativeAttempt: 1, parentRunId: 'parent', operationId: 'unadmitted-operation', runId: null, resultPath: join(dir, 'result.json'), outputRef: null, status: 'prepared' }));
  await assert.rejects(f.python.execute('propose', f.input, f.ctx), { code: 'PROCESS_RECONCILIATION_REQUIRED' });
  assert.equal(f.launches(), 0);
  await f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 });
  assert.equal(f.launches(), 1); assert.equal(await readFile(retained, 'utf8'), 'retained admission bytes');
  assert.notEqual((await f.journal.readEntry(f.ctx.jobId, 'process', f.operation)).attemptId, old.attemptId);
});

test('explicit retry checks a retained receipt even when child admission lost its Run reference', async t => {
  const f = await fixture(t), result = await f.python.execute('propose', f.input, f.ctx);
  await f.journal.entry(f.ctx.jobId, 'process', f.operation, value => ({ ...value, runId: null, outputRef: null, status: 'prepared' }));
  assert.deepEqual(await f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 }), result);
  assert.equal(f.launches(), 1);
  assert.equal((await f.journal.readEntry(f.ctx.jobId, 'process', f.operation)).runId, 'process-1');
});

test('unrecorded child recovery finds exact admission across pages and preserves an unknown child reservation', async t => {
  const f = await fixture(t), old = { ...f.ctx, attemptId: 'lost-reference' }, dir = attemptDirectory(f.root, old);
  await mkdir(dir, { recursive: true });
  f.processes.set('parent', { id: 'parent', status: 'unknown' });
  const child = { id: 'lost-child', parentRunId: 'parent', capabilityId: 'host.process.exec', operationId: 'exact-operation', status: 'unknown' };
  f.processes.set(child.id, child); let pages = 0;
  f.host.runs.list = input => { pages++; return input.cursor ? { items: [child] } : { items: [{ ...child, id: 'different', operationId: 'another-operation' }], nextCursor: 'offset:1' }; };
  await f.journal.entry(f.ctx.jobId, 'process', f.operation, () => ({ command: 'propose', attemptId: old.attemptId, nativeAttempt: 1, parentRunId: 'parent', operationId: child.operationId, runId: null, resultPath: join(dir, 'result.json'), outputRef: null, status: 'prepared', budgetToken: 'pending', inputBytes: 64, budgetSettled: false }));
  await f.journal.update(f.ctx.jobId, job => ({ ...job, byteUsage: { input: 0, output: 0, active: { pending: { input: 64, output: 1024 } } } }));
  await assert.rejects(f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 }), { code: 'PROCESS_RECONCILIATION_REQUIRED' });
  assert.equal(pages, 2); assert.equal(f.launches(), 0);
  assert.equal((await f.journal.readEntry(f.ctx.jobId, 'process', f.operation)).runId, child.id);
  assert.ok((await f.journal.get(f.ctx.jobId)).byteUsage.active.pending);
});

test('unknown parent without a matching child cannot release a prepared reservation', async t => {
  const f = await fixture(t);
  f.processes.set('parent', { id: 'parent', status: 'unknown' });
  await f.journal.entry(f.ctx.jobId, 'process', f.operation, () => ({ command: 'propose', attemptId: 'missing-child', nativeAttempt: 1, parentRunId: 'parent', operationId: 'missing-operation', runId: null, resultPath: join(f.root, 'missing.json'), outputRef: null, status: 'prepared', budgetToken: 'pending', inputBytes: 64, budgetSettled: false }));
  await f.journal.update(f.ctx.jobId, job => ({ ...job, byteUsage: { input: 0, output: 0, active: { pending: { input: 64, output: 1024 } } } }));
  await assert.rejects(f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 }), { code: 'PROCESS_RECONCILIATION_REQUIRED' });
  assert.equal(f.launches(), 0); assert.ok((await f.journal.get(f.ctx.jobId)).byteUsage.active.pending);
});

test('a first invocation observing an unknown child keeps the reservation instead of settling it', async t => {
  const f = await fixture(t);
  f.host.runs.wait = ref => {
    const id = typeof ref === 'string' ? ref : ref.id;
    const run = { ...f.processes.get(id), status: 'unknown' }; f.processes.set(id, run);
    return { reason: 'settled', run };
  };
  await assert.rejects(f.python.execute('propose', f.input, f.ctx), { code: 'PROCESS_FAILED' });
  const record = await f.journal.readEntry(f.ctx.jobId, 'process', f.operation), job = await f.journal.get(f.ctx.jobId);
  assert.equal(record.budgetSettled, false); assert.ok(job.byteUsage.active[record.budgetToken]);
  assert.equal(job.byteUsage.input, 0); assert.equal(job.byteUsage.output, 0);
  await assert.rejects(f.python.execute('propose', f.input, { ...f.ctx, nativeAttempt: 2 }), { code: 'PROCESS_RECONCILIATION_REQUIRED' });
  assert.equal(f.launches(), 1);
});

test('failure to save an accepted child Run preserves its reservation and original error', async t => {
  const f = await fixture(t), entry = f.journal.entry;
  f.journal.entry = async (...args) => {
    if (args[1] === 'process' && f.launches() > 0) throw Object.assign(Error('Run reference save failed'), { code: 'SAVE_FAILED' });
    return entry(...args);
  };
  await assert.rejects(f.python.execute('propose', f.input, f.ctx), { code: 'SAVE_FAILED' });
  const record = await f.journal.readEntry(f.ctx.jobId, 'process', f.operation), job = await f.journal.get(f.ctx.jobId);
  assert.equal(record.runId, null); assert.equal(record.budgetSettled, false);
  assert.ok(job.byteUsage.active[record.budgetToken]); assert.equal(job.byteUsage.input, 0);
  assert.equal(f.launches(), 1);
});

test('oversized artifact input is refused before materialization or process launch', async t => {
  const f = await fixture(t);
  await f.journal.update(f.ctx.jobId, job => ({ ...job, budget: { ...job.budget, maxInputBytes: 1024 } }));
  const checkpoint = await f.artifacts.publishJSON({ schema: 'factor-search-state/1', value: 'x'.repeat(2048) }, { schema: 'factor-search-state/1', dependencies: [], operationId: 'large-input' });
  await assert.rejects(f.python.execute('propose', { ...f.input, checkpoint }, f.ctx), { code: 'RESOURCE_EXHAUSTED' }); assert.equal(f.launches(), 0);
});
