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

test('new factor workflow delivers its report to Strategy without an SVL source', async t => {
  const f = await fixture({ evaluator: evaluate }); t.after(() => f.runtime.dispose());
  const run = await f.runtime.create(f.main, input()), done = await finished(f, run.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  const output = f.jobs.get(done.workflow.id).options.task.output;
  assert.equal(output.type, 'report');
  assert.equal(output.space, 'strategy');
  assert.ok(output.path.endsWith('.html'));
  assert.equal(done.report.ref.kind, 'report');
  assert.equal((await f.runtime.create(f.main, input())).workflow.id, done.workflow.id, 'Idempotent reuse keeps the accepted report task');
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

test('an immediately started child uses verified Run provenance before its reference is saved', async t => {
  let checked = 0;
  const f = await fixture({ evaluator: evaluate, onTask: ({ request, runtime, child, execution }) => {
    if (request.input.mode !== 'hypothesis') return;
    const { runId, assignmentId } = request.input;
    assert.equal(runtime.get(runId).tasks.find(task => task.id === assignmentId).runRef, undefined);
    for (const change of [
      value => { value.provenance.agent.runId = 'unrelated-child'; },
      value => { value.provenance.workflow.runId = 'unrelated-workflow'; },
      value => { value.provenance.workflow.ownerSessionId = 'another-owner'; },
    ]) {
      const untrusted = structuredClone(execution); change(untrusted);
      assert.throws(() => runtime.context(child, runId, 'team', 0, 20, untrusted), { code: 'FORBIDDEN' });
    }
    const before = f.saved.emitted.length;
    runtime.context(child, runId, 'team', 0, 20, execution);
    const handoffs = f.saved.emitted.slice(before).filter(event => event.type === 'handoff');
    assert.equal(handoffs.length, 1);
    assert.equal(handoffs[0].data.toRunId, execution.provenance.agent.runId);
    assert.equal(handoffs[0].data.toRunId, child.context.runId);
    assert.notEqual(handoffs[0].data.toRunId, request.input.runId);
    checked++;
  } });
  t.after(() => f.runtime.dispose());
  const started = await f.runtime.create(f.main, input()), done = await finished(f, started.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  assert.equal(checked, 1);
  const handoffs = f.saved.emitted.filter(event => event.type === 'handoff');
  const pairs = handoffs.map(event => `${event.data.fromRunId}:${event.data.toRunId}`);
  assert.equal(new Set(pairs).size, pairs.length, 'Repeated context reads do not duplicate handoffs');
});
