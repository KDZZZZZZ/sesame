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

test('a research error interrupts the original workflow without publishing an unfinished report and can resume', async t => {
  let interrupted = false;
  const f = await fixture({ evaluator: evaluate, onTask: () => {
    if (!interrupted) { interrupted = true; throw Object.assign(new Error('Observed research failure'), { code: 'FIXTURE_FAILURE' }); }
  } });
  t.after(() => f.runtime.dispose());
  const run = await f.runtime.create(f.main, input()), paused = await finished(f, run.id);
  assert.equal(paused.status, 'interrupted');
  assert.equal(f.jobs.get(paused.workflow.id).value.status, 'interrupted');
  assert.equal(paused.report, undefined);
  assert.equal(paused.reportPending, false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.saved.emitted.some(event => event.type === 'artifact'), false);
  const pending = await f.runtime.observed(f.main, run.id);
  await f.runtime.control(f.main, run.id, 'resume', { interrupt_ids: pending.interrupts.map(item => item.id) });
  const done = await finished(f, run.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.workflow.id, paused.workflow.id);
  assert.equal(done.tasks[0].runRef.id, paused.tasks[0].runRef.id);
  assert.equal(done.report.ref.kind, 'report');
});

test('a saved checkpoint does not turn an interrupted Agent into a completed workflow and survives same-Run recovery', async t => {
  const f = await fixture({ evaluator: evaluate, onTask: async ({ request, runtime, child, execution, job }) => {
    if (request.input.mode !== 'plan') return;
    await runtime.submit(child, request.input.runId, { directions: ['momentum'], stop: false, reason: 'Saved before observed exit failure' }, undefined, execution);
    job.finish(job.attempt === 1
      ? { status: 'interrupted', error: { code: 'RUN_RELEASE_FAILED', message: 'Observed release failure' } }
      : { status: 'completed', output: { text: 'Resumed the saved checkpoint', sessionId: child.context.sessionId } });
    return 'hold';
  } });
  t.after(() => f.runtime.dispose());
  const created = await f.runtime.create(f.main, input()), paused = await finished(f, created.id);
  assert.equal(paused.status, 'interrupted'); assert.equal(f.jobs.get(paused.workflow.id).value.status, 'interrupted');
  assert.ok(paused.tasks[0].output, 'Retain the structured checkpoint for an explicit later resume');
  assert.equal(paused.tasks[0].finishedAt, undefined);
  assert.equal(f.requests.length, 1); assert.equal(paused.report, undefined);
  const pending = await f.runtime.observed(f.main, created.id);
  await f.runtime.control(f.main, created.id, 'resume', { interrupt_ids: pending.interrupts.map(item => item.id) });
  const done = await finished(f, created.id);
  assert.equal(done.status, 'completed'); assert.equal(done.workflow.id, paused.workflow.id);
  assert.equal(done.tasks[0].runRef.id, paused.tasks[0].runRef.id);
  assert.deepEqual(done.tasks[0].output, paused.tasks[0].output);
  assert.equal(done.report.ref.kind, 'report');
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
