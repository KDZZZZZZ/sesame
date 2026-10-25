import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, input, finished, iso } from '../packages/auto-factor-mining/tests/host-fixture.js';
import { evaluate } from '../packages/factor-evaluator/evaluator.js';

const singleSymbolRows = () => {
  let close = 100;
  return Array.from({ length: 120 }, (_, day) => {
    const signal = day % 7 - 3;
    const row = { time: iso(day + 1), availableAt: iso(day + 1), symbol: 'SINGLE', fields: { close, signal } };
    close *= 1 + signal * 0.002;
    return row;
  });
};

test('single-symbol evaluation and a selected knowledge method complete the native workflow and Strategy report', async t => {
  const f = await fixture({ evaluator: evaluate });
  t.after(() => f.runtime.dispose());
  f.datasets.set('data', { id: 'data', rows: singleSymbolRows(), provenance: { source_kind: 'synthetic' } });
  f.manifests.set('fixture/range-method', { id: 'fixture/range-method', version: '1', revision: 'knowledge-v1',
    capabilities: [], skills: [{ name: 'range-method', description: 'A synthetic hypothesis method' }] });
  const request = input();
  request.config.evaluator.arguments = { dataset: { mode: 'auto', trainEnd: iso(70), validationEnd: iso(100), holdoutEnd: iso(120) } };
  request.config.research = { plugins: ['fixture/range-method'], tools: [] };
  const created = await f.runtime.create(f.main, request);
  const done = await finished(f, created.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  assert.equal(done.trials.length, 1);
  assert.equal(done.trials[0].eligible, true);
  assert.ok(Number.isFinite(done.trials[0].metrics.validation.rankIC));
  assert.ok(f.requests.length > 0);
  for (const child of f.requests) {
    assert.ok(child.plugins.includes('fixture/range-method'), 'The method must reach every research member');
    assert.ok(child.allowedCalls.some(call => call.pluginId === 'sesame/plugin-manager' && call.capabilityId === 'plugin_read'), 'Members must be able to read method references');
  }
  assert.equal(f.jobs.get(done.workflow.id).options.task.output.space, 'strategy');
  assert.equal(done.report.ref.kind, 'report');
  assert.ok(Object.keys(done.holdout).length > 0);
});

test('unavailable or erroneous optional diagnostics preserve successful measurements and workflow delivery', async t => {
  const f = await fixture({ evaluator: evaluate, onTask: async ({ request, runtime, child, execution, job }) => {
    if (request.input.mode !== 'code') return;
    await runtime.submit(child, request.input.runId, { candidate: { op: 'field', name: 'signal' }, explanation: 'A parameter-free synthetic feature' }, undefined, execution);
    job.finish({ status: 'completed', output: { text: 'Submitted the fixed synthetic feature', sessionId: child.context.sessionId } });
    return 'hold';
  } });
  t.after(() => f.runtime.dispose());
  f.datasets.set('data', { id: 'data', rows: singleSymbolRows(), provenance: { source_kind: 'synthetic' } });
  const request = input();
  request.config.evaluator.arguments = {
    dataset: { mode: 'time-series', trainEnd: iso(70), validationEnd: iso(100), holdoutEnd: iso(120) },
    diagnostics: {
      placebo: { samples: 1 },
      monteCarlo: { samples: 20, seed: 17, blockSize: 2 },
      bootstrap: { samples: 20, seed: 17, blockSize: 2 },
      sensitivity: true,
      regimes: { field: 'missing_regime' },
    },
  };
  const created = await f.runtime.create(f.main, request);
  const done = await finished(f, created.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  const trial = done.trials[0], diagnostics = trial.metrics.diagnostics;
  assert.equal(trial.eligible, true);
  assert.equal(diagnostics.placebo.status, 'error');
  assert.ok(diagnostics.placebo.reason);
  assert.equal(diagnostics.walkForward.status, 'not-requested');
  assert.equal(diagnostics.sensitivity.status, 'not-applicable');
  assert.equal(diagnostics.regimes.status, 'unavailable');
  assert.ok(diagnostics.regimes.reason);
  assert.equal(diagnostics.monteCarlo.status, 'completed');
  assert.equal(diagnostics.bootstrap.status, 'completed');
  assert.deepEqual(done.selection.trialIds, [trial.id]);
  assert.equal(done.report.ref.kind, 'report');
});

test('unmeasurable candidates remain unmeasured while empty selection and report delivery complete', async t => {
  const f = await fixture({ evaluator: evaluate });
  t.after(() => f.runtime.dispose());
  const rows = singleSymbolRows().map(row => ({ ...row, fields: { ...row.fields, signal: 1 } }));
  f.datasets.set('data', { id: 'data', rows, provenance: { source_kind: 'synthetic' } });
  const request = input();
  request.config.evaluator.arguments = {
    dataset: { mode: 'auto', trainEnd: iso(70), validationEnd: iso(100), holdoutEnd: iso(120) },
    diagnostics: { placebo: true, bootstrap: true },
  };
  const created = await f.runtime.create(f.main, request);
  const done = await finished(f, created.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  assert.equal(done.trials.length, 1);
  assert.equal(done.trials[0].eligible, false);
  assert.equal(done.trials[0].metrics.validation.rankIC, null);
  assert.equal(done.trials[0].metrics.diagnostics.placebo.status, 'unavailable');
  assert.equal(done.trials[0].metrics.diagnostics.bootstrap.status, 'unavailable');
  assert.deepEqual(done.selection.trialIds, []);
  assert.deepEqual(done.holdout, {});
  assert.equal(done.report.ref.kind, 'report');
});
