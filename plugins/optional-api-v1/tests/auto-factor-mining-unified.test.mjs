import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, input, finished } from '../packages/auto-factor-mining/tests/host-fixture.js';
import { evaluate } from '../packages/factor-evaluator/evaluator.js';

test('workflow is a native Run and contains no custom live view declaration', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/auto-factor-mining/capabilities.json', import.meta.url)));
  assert.equal(manifest.capabilities.find(cap => cap.id === 'auto_factor_workflow').kind, 'workflow');
  assert.deepEqual(manifest.views, []);
  assert.equal(manifest.capabilities.some(cap => cap.id.startsWith('auto_factor_view_')), false);
});

test('failed research publishes retained evidence then fails its actual workflow Run', async t => {
  const f = await fixture({ evaluator: evaluate, onTask: () => { throw Object.assign(new Error('Observed research failure'), { code: 'FIXTURE_FAILURE' }); } });
  t.after(() => f.runtime.dispose());
  const run = await f.runtime.create(f.main, input()), done = await finished(f, run.id);
  assert.equal(done.status, 'failed');
  assert.equal(f.jobs.get(done.workflow.id).value.status, 'failed');
  assert.equal(done.report.ref.kind, 'report');
  assert.equal(done.reportPending, false);
  assert.equal(f.requests.length, 1, 'A native report must not dispatch a reporter Agent');
  assert.ok(f.saved.emitted.some(event => event.type === 'artifact' && event.data.ref.id === done.report.ref.id));
});

test('a saved checkpoint does not turn a failed actual Agent Run into a completed workflow', async t => {
  const f = await fixture({ evaluator: evaluate, onTask: async ({ request, runtime, child, execution, job }) => {
    if (request.input.mode !== 'plan') return;
    await runtime.submit(child, request.input.runId, { directions: ['momentum'], stop: false, reason: 'Saved before observed exit failure' }, undefined, execution);
    job.finish({ status: 'failed', error: { code: 'RUN_RELEASE_FAILED', message: 'Observed release failure' } });
    return 'hold';
  } });
  t.after(() => f.runtime.dispose());
  const created = await f.runtime.create(f.main, input()), done = await finished(f, created.id);
  assert.equal(done.status, 'failed'); assert.equal(f.jobs.get(done.workflow.id).value.status, 'failed');
  assert.ok(done.tasks[0].output, 'Retain the structured checkpoint for an explicit later resume');
  assert.equal(f.requests.length, 1); assert.equal(done.report.ref.kind, 'report');
});

test('actual workflow session owns child Runs and preserves measured handoff and output metadata', async t => {
  const f = await fixture({ evaluator: evaluate }); t.after(() => f.runtime.dispose());
  const run = await f.runtime.create(f.main, input()), done = await finished(f, run.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  const workflow = f.jobs.get(done.workflow.id);
  assert.equal(workflow.options.task.output.type, 'report');
  assert.ok(done.tasks.every(task => f.jobs.get(task.runRef.id).parentRunId === done.workflow.id));
  assert.ok(done.tasks.every(task => f.jobs.get(task.runRef.id).options.task.role === task.role));
  assert.ok(f.saved.emitted.some(event => event.type === 'handoff' && event.data.fromRunId && event.data.toRunId));
  assert.equal(done.report.ref.kind, 'report');
  assert.equal(done.trials[0].metrics.validation.rankIC, 1);
  assert.equal(Object.keys(done.holdout).length, 1);
});
