import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, input, finished, poll, iso, rows } from '../packages/auto-factor-mining/tests/host-fixture.js';
import { evaluate } from '../packages/factor-evaluator/evaluator.js';
import { SYSTEM, collaboration } from '../packages/auto-factor-mining/team.js';

const args = () => { const value = input(); value.config.executionMode = 'single'; value.config.agentModels = {}; return value; };
const own = (t, f) => { t.after(() => f.runtime.dispose()); return f; };
function output(context) {
  const a = context.assignment;
  return { plan: { directions: context.config.directions, stop: false, reason: 'Fixed synthetic direction' },
    hypothesis: { hypothesis: 'Synthetic ordering', rationale: 'A fixed software fixture; not a market performance claim' },
    code: { candidate: a.round ? { op: 'add', args: [{ op: 'field', name: 'signal' }, { op: 'constant', value: a.round }] } : { op: 'field', name: 'signal' }, explanation: 'Selected evaluator computes this fixed AST; no hand-entered metrics' },
    review: { verdict: 'accept', reason: 'Read the actual evaluator receipt and its eligibility gate' },
    reflection: { summary: 'Retain measured evidence and every failed trial', lessons: ['Independent future evidence remains necessary'], stop: false },
    selection: { trialIds: context.trials.items.filter(t => t.status === 'accepted').slice(0, 1).map(t => t.id), reason: 'Freeze measured eligible candidates before final holdout' } }[a.mode];
}
const runner = hook => async state => {
  const { request, runtime, child, execution, job } = state;
  if (request.input.mode !== 'single') return;
  for (let i = 0; i < 250; i++) {
    const context = runtime.context(child, request.input.runId, 'team', 0, 100, execution);
    assert.equal(context.assignment.executionMode, 'single');
    if (context.holdoutMode !== 'none') {
      assert.equal(context.config.evaluator.arguments, undefined);
      assert.equal(context.data.inputRefs, undefined);
      assert.equal(context.data.sourceId, undefined);
    }
    if (context.assignment.complete) { job.finish({ status: 'completed', output: { text: 'All structured stages completed', sessionId: child.context.sessionId } }); return 'hold'; }
    const overridden = await hook?.({ ...state, context });
    if (overridden === 'hold') return 'hold';
    await runtime.submit(child, request.input.runId, overridden?.output ?? context.assignment.retryOutput ?? output(context), undefined, execution, context.assignment.step_id);
  }
  throw new Error('Single stage loop did not terminate');
};

test('single mode uses one actual Agent Run for all duties while actual evaluator and isolated finalization remain native', async t => {
  const actions = [], stages = [];
  const f = own(t, await fixture({ evaluator: evaluate, onEvaluate: request => actions.push(request.action), onTask: runner(({ context }) => { stages.push(context.assignment.mode); if (context.assignment.mode === 'review') assert.equal(context.trial.metrics.validation.rankIC, 1); }) }));
  const request = args(); request.config.strategyValidation = { intendedPlatform: 'MT5', requestedEngine: 'MT5 Strategy Tester', notes: 'Use the native optimizer; this is an unexecuted test request' };
  const run = await f.runtime.create(f.main, request), done = await finished(f, run.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  assert.equal(f.requests.length, 1); assert.equal(done.tasks.length, 1); assert.equal(done.tasks[0].mode, 'single');
  assert.deepEqual(stages, ['plan', 'hypothesis', 'code', 'review', 'reflection', 'selection']);
  assert.deepEqual(actions, ['prepare', 'candidate', 'select', 'finalize']);
  assert.equal(done.single.steps.length, 6); assert.equal(done.trials[0].status, 'accepted'); assert.equal(Object.keys(done.holdout).length, 1);
  assert.equal(f.jobs.get(done.workflow.id).options.task.collaboration, undefined); assert.equal(collaboration(done.config), null);
  assert.equal(f.jobs.get(done.workflow.id).options.task.output.space, 'strategy'); assert.equal(done.report.ref.kind, 'report');
  assert.equal(done.strategyValidation.status, 'not-executed-by-workflow');
  const publications = f.saved.reportState.calls.filter(call => call.id === 'sesame/reports#report_publish');
  assert.equal(publications.length, 1);
  assert.equal(publications[0].input.content.kind, 'signal-study');
  const snapshot = publications[0].input.content.run;
  assert.equal(snapshot.id, run.id); assert.equal(snapshot.data.digest, done.data.digest);
  assert.deepEqual(snapshot.selection, done.selection); assert.deepEqual(snapshot.trials, done.trials);
  assert.deepEqual(snapshot.finalEvaluation, done.finalEvaluation); assert.deepEqual(snapshot.holdout, done.holdout);
  assert.equal(snapshot.strategyValidation.status, 'not-executed-by-workflow');
  assert.deepEqual(snapshot.strategyValidation.request, request.config.strategyValidation);
  assert.equal(snapshot.nativeValidation, undefined, 'An unexecuted request must not acquire a native execution receipt');
  const report = await f.main.resources.read(done.report.ref, { part: 'content', entry: done.report.entry });
  // This protocol fixture delivers structured signal-study content, not renderer-specific headings.
  const embedded = Buffer.from(report.content, 'base64').toString().match(/<script type="application\/json" id="run-snapshot">([\s\S]*?)<\/script>/);
  assert.ok(embedded, 'The delivered report must retain the fixed study and its validation status');
  assert.deepEqual(JSON.parse(embedded[1]), snapshot);
  const archived = await f.main.resources.read(done.report.ref, { part: 'content', entry: 'run.json' });
  assert.deepEqual(JSON.parse(Buffer.from(archived.content, 'base64').toString()), snapshot);
});

test('stage IDs prevent skipping and rewrites, exact retry is inert, and main/spoofed callers cannot submit', async t => {
  let checked = false;
  const f = own(t, await fixture({ evaluator: evaluate, onTask: runner(async ({ context, runtime, request, child, execution }) => {
    if (checked || context.assignment.mode !== 'plan') return; checked = true;
    const id = request.input.runId, value = output(context), step = context.assignment.step_id;
    await assert.rejects(runtime.submit(child, id, value, undefined, execution, 'selection'), { code: 'STALE_STEP' });
    await assert.rejects(runtime.submit(child, id, value, undefined, execution), { code: 'STALE_STEP' });
    const spoof = structuredClone(execution); spoof.provenance.agent.runId = 'other';
    assert.throws(() => runtime.context(child, id, 'team', 0, 20, spoof), { code: 'FORBIDDEN' });
    const first = await runtime.submit(child, id, value, undefined, execution, step);
    const again = await runtime.submit(child, id, value, undefined, execution, step);
    assert.equal(again.reused, true); assert.deepEqual(first.output, again.output);
    await assert.rejects(runtime.submit(child, id, { ...value, reason: 'rewrite' }, undefined, execution, step), { code: 'OUTPUT_FROZEN' });
    // The generic runner will repeat this exact accepted stage once; the ledger must remain unchanged.
  }) }));
  const run = await f.runtime.create(f.main, args()), done = await finished(f, run.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error)); assert.equal(done.single.steps.length, 6);
  await assert.rejects(f.runtime.submit(f.main, run.id, {}, undefined, undefined, 'selection'), /registered|active|step_id/i);
});

for (const mode of ['single', 'multi']) test(`${mode} selection may correct an explicit user-hard-requirement rejection without overriding it or freezing an unknown replacement`, async t => {
  let rejected = false;
  const attempt = async ({ context, runtime, request, child, execution }) => {
    if ((context?.assignment.mode ?? request.input.mode) !== 'selection') return;
    context ??= runtime.context(child, request.input.runId, 'team', 0, 100, execution);
    const proposed = { trialIds: context.trials.items.filter(trial => trial.status === 'accepted').map(trial => trial.id), reason: 'Try the actual pending user hard requirement' };
    assert.equal(proposed.trialIds.length, 1);
    await assert.rejects(runtime.submit(child, request.input.runId, proposed, undefined, execution, context.assignment.step_id), { code: 'HARD_REQUIREMENT_UNMET' }); rejected = true;
    const run = runtime.get(request.input.runId); assert.equal(run.selection, undefined);
    if (mode === 'single') assert.equal(run.single.pending, undefined);
    else assert.equal(run.tasks.find(task => task.mode === 'selection').pendingOutput, undefined);
    return { output: { trialIds: [], reason: 'No candidate can satisfy the explicit user hard search requirement; retain every measured trial and rejection' } };
  };
  const onTask = mode === 'single' ? runner(attempt) : async state => {
    const correction = await attempt(state); if (!correction) return;
    await state.runtime.submit(state.child, state.request.input.runId, correction.output, undefined, state.execution);
    state.job.finish({ status: 'completed', output: { text: 'Empty selection honors the user hard requirement', sessionId: state.child.context.sessionId } }); return 'hold';
  };
  const f = own(t, await fixture({ evaluator: evaluate, onTask }));
  const request = mode === 'single' ? args() : input();
  request.config.evaluator.arguments.evaluationPlan = { tests: { pbo: { blocks: 4 } }, thresholds: [{ metric: 'diagnostics.pbo.probability', operator: 'lte', value: .9, mode: 'required', source: 'user', reason: 'Explicit user requirement in this fixture' }] };
  const run = await f.runtime.create(f.main, request), done = await finished(f, run.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error)); assert.equal(rejected, true); assert.deepEqual(done.selection.trialIds, []);
  assert.equal(done.selection.diagnostics.pbo.status, 'unavailable'); assert.equal(done.finalEvaluation.holdoutStatus, 'not-requested'); assert.deepEqual(done.holdout, {});
});

test('pause and Store reopen resume the same single Agent at its saved stage without recomputing accepted candidate', async t => {
  let held = false; const actions = [];
  const f = own(t, await fixture({ evaluator: evaluate, onEvaluate: request => actions.push(request.action), onTask: runner(({ context }) => { if (context.assignment.mode === 'review') { held = true; return 'hold'; } }) }));
  const run = await f.runtime.create(f.main, args()); await poll(() => held); await f.runtime.control(f.main, run.id, 'pause');
  const paused = f.runtime.get(run.id); assert.equal(paused.single.step.mode, 'review'); assert.equal(paused.single.steps.length, 3);
  const g = own(t, await fixture({ storage: f.saved, evaluator: evaluate, onEvaluate: request => actions.push(request.action), onTask: runner() }));
  const pending = await g.runtime.observed(g.main, run.id);
  await g.runtime.control(g.main, run.id, 'resume', { interrupt_ids: pending.interrupts.map(item => item.id) });
  const done = await finished(g, run.id); assert.equal(done.status, 'completed', JSON.stringify(done.error));
  assert.equal(done.workflow.id, paused.workflow.id); assert.equal(done.tasks.length, 1); assert.equal(done.tasks[0].runRef.id, paused.tasks[0].runRef.id);
  assert.deepEqual(done.single.steps.slice(0, 3), paused.single.steps); assert.equal(actions.filter(action => action === 'candidate').length, 1);
  assert.equal(done.single.steps.length, 6);
});

test('semantic rejection can be corrected but no model verdict can promote an evaluator-ineligible candidate', async t => {
  let tested = false;
  const f = own(t, await fixture({ evaluator: evaluate, onTask: runner(async ({ context, runtime, request, child, execution }) => {
    if (context.assignment.mode !== 'code') return;
    if (!tested) { tested = true; await assert.rejects(runtime.submit(child, request.input.runId, { candidate: { op: 'invalid' }, explanation: 'Invalid fixture' }, undefined, execution, context.assignment.step_id), { code: 'EVALUATION_REJECTED' }); }
    return { output: { candidate: { op: 'constant', value: 1 }, explanation: 'Constant cannot pass actual IC gate' } };
  }) }));
  const started = await f.runtime.create(f.main, args()), done = await finished(f, started.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error)); assert.equal(tested, true);
  assert.equal(done.trials[0].eligible, false); assert.equal(done.trials[0].status, 'rejected');
  assert.deepEqual(done.selection.trialIds, []); assert.equal(done.single.steps.length, 6);
});

test('unknown evaluator outcome freezes pending input and resumes the original single Agent', async t => {
  let first = true;
  const f = own(t, await fixture({ evaluator: evaluate, onTask: runner(), onEvaluate: request => {
    if (request.action === 'candidate' && first) { first = false; throw Object.assign(new Error('Temporary evaluator unavailable'), { code: 'EVALUATOR_UNAVAILABLE' }); }
  } }));
  const started = await f.runtime.create(f.main, args()), paused = await finished(f, started.id);
  assert.equal(paused.status, 'interrupted'); assert.equal(paused.single.step.mode, 'code'); assert.ok(paused.single.pending.output.candidate);
  const g = own(t, await fixture({ storage: f.saved, evaluator: evaluate, onTask: runner(async ({ context, runtime, request, child, execution }) => {
    if (context.assignment.retryOutput) await assert.rejects(runtime.submit(child, request.input.runId, { candidate: { op: 'constant', value: 1 }, explanation: 'Changed uncertain input' }, undefined, execution, context.assignment.step_id), { code: 'OUTPUT_FROZEN' });
  }) }));
  const pending = await g.runtime.observed(g.main, started.id);
  await g.runtime.control(g.main, started.id, 'resume', { interrupt_ids: pending.interrupts.map(item => item.id) });
  const done = await finished(g, started.id); assert.equal(done.status, 'completed', JSON.stringify(done.error));
  assert.equal(done.tasks[0].runRef.id, paused.tasks[0].runRef.id); assert.equal(done.single.steps.filter(step => step.mode === 'code').length, 1);
  assert.equal(done.single.pending, undefined); assert.equal(done.trials[0].metrics.validation.rankIC, 1);
});

test('single mode with general data access keeps development-only evaluation and no holdout claim', async t => {
  const f = own(t, await fixture({ evaluator: evaluate, onTask: runner() }));
  f.manifests.set('third-party/research', { id: 'third-party/research', version: '1', revision: 'fixed', capabilities: [{ id: 'read', consumers: ['agent','host'] }] });
  f.datasets.get('data').rows = rows.filter(row => row.time <= iso(9));
  const request = args(); request.config.research = { plugins: ['third-party/research'], tools: ['third-party/research#read'] };
  const started = await f.runtime.create(f.main, request), done = await finished(f, started.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error)); assert.equal(done.data.holdoutMode, 'none');
  assert.equal(done.finalEvaluation.holdoutStatus, 'not-requested'); assert.deepEqual(done.holdout, {}); assert.equal(done.tasks.length, 1);
});

test('single configuration forbids parallel stages, missing duties and incompatible model overrides', async t => {
  const f = own(t, await fixture({ evaluator: evaluate, onTask: runner() }));
  for (const patch of [{ parallelism: 2 }, { workflow: { review: null } }, { agentModels: { reviewer: args().config.model } }]) {
    const request = args(); Object.assign(request.config, patch);
    await assert.rejects(f.runtime.create(f.main, request), /Single|single|role|member/i);
  }
  assert.equal(f.requests.length, 0);
});

test('integrated knowledge is declared and engine/native-optimizer boundaries reach actual Agent instructions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/auto-factor-mining/capabilities.json', import.meta.url)));
  for (const path of ['references/research-guide.md', 'references/factor-method.md', 'references/strategy-evidence.md', 'scripts/reference-factor.mjs', 'scripts/reference-experiment.mjs']) assert.ok(manifest.knowledge.some(item => item.path === path), path);
  assert.match(SYSTEM, /预期交易平台的原生引擎/); assert.ok(SYSTEM.includes("自带参数搜索或优化器")); assert.match(SYSTEM, /特殊参数组/);
  assert.match(SYSTEM, /不自动下单/); assert.match(SYSTEM, /开发数据用于/);
});
