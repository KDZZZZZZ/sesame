import test from 'node:test';
import assert from 'node:assert/strict';
import { MiningRuntime } from '../packages/auto-factor-mining/runtime.js';
import { fixture, input, finished } from '../packages/auto-factor-mining/tests/host-fixture.js';
import { evaluate } from '../packages/factor-evaluator/evaluator.js';

async function runWithReflection(t, submit, rounds = 2) {
  const observed = [];
  const f = await fixture({ evaluator: evaluate, onTask: async value => {
    const { request, runtime, child, execution, job } = value;
    if (request.input.mode !== 'reflection') return;
    const saved = await submit(value);
    observed.push(saved);
    job.finish({ status: 'completed', output: { text: 'Synthetic reflection saved', sessionId: child.context.sessionId } });
    return 'hold';
  } });
  t.after(() => f.runtime.dispose());
  const args = input(); args.config.rounds = rounds;
  const created = await f.runtime.create(f.main, args), done = await finished(f, created.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  return { f, done, observed };
}

for (const stop of [undefined, false, true]) {
  test(`reflection ${stop === undefined ? 'omitted stop defaults to false' : `stop=${stop}`} controls bounded later rounds`, async t => {
    const result = await runWithReflection(t, async ({ request, runtime, child, execution }) => {
      const output = { summary: 'Synthetic evidence supports this bounded decision', lessons: [], ...(stop === undefined ? {} : { stop }) };
      const saved = await runtime.submit(child, request.input.runId, output, undefined, execution);
      assert.equal(saved.stop, stop === true);
      assert.deepEqual(saved.lessons, []);
      assert.deepEqual(await runtime.submit(child, request.input.runId, { ...output, stop: stop === true }, undefined, execution), saved);
      return saved;
    });
    const rounds = stop === true ? 1 : 2;
    assert.equal(result.observed.length, rounds);
    assert.equal(result.f.requests.filter(request => request.input.mode === 'plan').length, rounds);
    assert.equal(result.done.reflections.length, rounds);
    assert.ok(result.done.selection, 'The workflow still freezes a final selection after research stops');
  });
}

test('reflection retains more than eight lessons without truncating the saved checkpoint', async t => {
  const lessons = Array.from({ length: 12 }, (_, i) => `Observed synthetic lesson ${i + 1}`);
  const { done, observed } = await runWithReflection(t, ({ request, runtime, child, execution }) =>
    runtime.submit(child, request.input.runId, { summary: 'All observed lessons remain available', lessons, stop: false }, undefined, execution), 1);
  assert.deepEqual(observed[0].lessons, lessons);
  assert.deepEqual(done.reflections[0].lessons, lessons);
  assert.deepEqual(done.tasks.find(task => task.mode === 'reflection').output.lessons, lessons);
});

test('reflection rejects explicit nonboolean stop with a field-specific explanation', async t => {
  await runWithReflection(t, async ({ request, runtime, child, execution }) => {
    for (const stop of [null, 0, 'false', [], {}]) {
      await assert.rejects(runtime.submit(child, request.input.runId, { summary: 'Type check', lessons: [], stop }, undefined, execution),
        error => error.code === 'INVALID_OUTPUT' && /stop.*boolean/i.test(error.message));
    }
    return runtime.submit(child, request.input.runId, { summary: 'Types checked', lessons: [], stop: false }, undefined, execution);
  }, 1);
});

test('reflection keeps string-array and per-lesson text validation', async t => {
  await runWithReflection(t, async ({ request, runtime, child, execution }) => {
    for (const lessons of [null, 'lesson', {}, [null], [42], [''], ['x'.repeat(1001)]]) {
      await assert.rejects(runtime.submit(child, request.input.runId, { summary: 'Invalid lesson', lessons, stop: false }, undefined, execution),
        error => ['INVALID_OUTPUT', 'INVALID_ARGUMENT'].includes(error.code));
    }
    const lessons = ['x'.repeat(1000)];
    const saved = await runtime.submit(child, request.input.runId, { summary: 'Text boundary retained', lessons, stop: false }, undefined, execution);
    assert.deepEqual(saved.lessons, lessons);
    return saved;
  }, 1);
});

test('the existing total output limit bounds reflection size after removing the lesson-count limit', async t => {
  await runWithReflection(t, async ({ request, runtime, child, execution }) => {
    const oversized = { summary: 'All individual lessons meet their text limit', lessons: Array.from({ length: 16 }, () => 'x'.repeat(1000)), stop: false };
    assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > 16000);
    await assert.rejects(runtime.submit(child, request.input.runId, oversized, undefined, execution),
      error => error.code === 'INVALID_OUTPUT' && /16KB/.test(error.message));
    const bounded = { ...oversized, lessons: oversized.lessons.slice(0, 15) };
    assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 16000);
    const saved = await runtime.submit(child, request.input.runId, bounded, undefined, execution);
    assert.deepEqual(saved.lessons, bounded.lessons);
    return saved;
  }, 1);
});

test('plan stop remains an explicit required boolean', () => {
  const validate = output => MiningRuntime.prototype.validateOutput({ config: { directions: ['momentum'] } }, { mode: 'plan' }, output);
  assert.throws(() => validate({ directions: ['momentum'], reason: 'Plan contract unchanged' }), { code: 'INVALID_OUTPUT' });
  assert.throws(() => validate({ directions: ['momentum'], reason: 'Plan contract unchanged', stop: null }), { code: 'INVALID_OUTPUT' });
  assert.equal(validate({ directions: ['momentum'], reason: 'Continue', stop: false }).stop, false);
  assert.equal(validate({ directions: [], reason: 'Stop', stop: true }).stop, true);
});
