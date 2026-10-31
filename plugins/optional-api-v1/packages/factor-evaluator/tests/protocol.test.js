import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, PROTOCOL } from '../evaluator.js';
const iso = n => new Date(Date.UTC(2024, 0, n)).toISOString();
const rows = Array.from({ length: 13 }, (_, day) => Array.from({ length: 4 }, (_, i) => ({ time: iso(day + 1), availableAt: iso(day + 1), symbol: `S${i}`, fields: { close: 100 * (1 + i / 100) ** day, signal: i } }))).flat();
const options = { dataset: { trainEnd: iso(5), validationEnd: iso(9), holdoutEnd: iso(13) } };
const candidate = { op: 'field', name: 'signal' };
function fixture() {
  const db = new Map(), resources = new Map(); let chain = [{ pluginId: 'custom/workflow', capabilityId: 'launch' }, { pluginId: 'sesame/factor-evaluator', capabilityId: 'factor_evaluate' }];
  const host = { context: { pluginId: 'sesame/factor-evaluator', kind: 'main', sessionId: 'owner' },
    data: { sources: () => ({ items: [{ ref: { providerId: 'host#datasets', revision: 'host:2' }, contract: 'sesame.datasets/1', operations: { query: 'query' }, available: true }] }), query: async () => ({ items: rows, metadata: { id: 'data', provenance: { kind: 'synthetic' } } }) },
    state: { read({ collection, key }) { const record = db.get(`${collection}:${key}`); if (!record) throw Object.assign(Error('missing'), { code: 'NOT_FOUND' }); return structuredClone(record); },
      async commit(changes) { const entries = changes.map(change => { const key = `${change.key.collection}:${change.key.key}`, previous = db.get(key); assert.equal(change.expectedVersion, previous?.version ?? 0); const next = { key: change.key, value: structuredClone(change.value), version: (previous?.version ?? 0) + 1 }; db.set(key, next); return next; }); return { entries }; } },
    resources: { async create({ kind, source }) { const ref = { id: `resource-${resources.size}`, kind, version: 1 }; resources.set(ref.id, source.content); return ref; },
      async read(ref, { offset = 0, length = 256 * 1024 }) { const content = Buffer.from(resources.get(ref.id)); return { content: content.subarray(offset, offset + length).toString('base64'), total: content.length, ...(offset + length < content.length ? { nextOffset: offset + length } : {}) }; } } };
  const call = (action, more = {}) => evaluate(host, { protocol: PROTOCOL, action, run_id: 'run', ...more }, undefined, { provenance: { chain, caller: { pluginId: chain.at(-2)?.pluginId }, parentRunId: null } });
  return { host, call, db, chain: value => { chain = value; } };
}
test('separate evaluator produces real immutable candidate, selection and final receipts', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  assert.ok(prepared.development.rows.every(row => row.time <= iso(9)));
  const session_id = prepared.sessionId;
  await assert.rejects(f.call('finalize', { session_id }), /frozen selection/);
  const measured = await f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] });
  assert.equal(measured.metrics.validation.rankIC, 1); assert.equal(measured.eligible, true);
  assert.deepEqual(await f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] }), measured);
  await assert.rejects(f.call('candidate', { session_id, trial_id: 'one', candidate: { op: 'constant', value: 1 }, accepted_ids: [] }), /frozen/);
  const selection = await f.call('select', { session_id, trial_ids: ['one'] });
  const final = await f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.equal(final.holdout.one.rankIC, 1); assert.equal(final.holdoutStatus, 'evaluated');
  await assert.rejects(f.call('candidate', { session_id, trial_id: 'two', candidate, accepted_ids: [] }), /frozen/);
});
test('direct calls and other caller plugins cannot read a workflow session', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  f.chain([{ pluginId: 'sesame/factor-evaluator', toolName: 'factor_evaluate' }]);
  await assert.rejects(f.call('finalize', { session_id: prepared.sessionId }), /nested workflow/);
  f.chain([{ pluginId: 'other/workflow', toolName: 'anything' }, { pluginId: 'sesame/factor-evaluator', toolName: 'factor_evaluate' }]);
  await assert.rejects(f.call('candidate', { session_id: prepared.sessionId, trial_id: 'one', candidate, accepted_ids: [] }), /another workflow/);
});

test('workflow sessions follow the trusted original owner across resumed execution sessions', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  const request = { protocol: PROTOCOL, action: 'candidate', run_id: 'run', session_id: prepared.sessionId, trial_id: 'one', candidate, accepted_ids: [] };
  f.host.context = { ...f.host.context, kind: 'subagent', sessionId: 'workflow-session-1', runId: 'workflow-run-1' };
  const execution = { provenance: { caller: { pluginId: 'custom/workflow', runId: 'workflow-run-1' },
    chain: [{ pluginId: 'custom/workflow' }, { pluginId: 'sesame/factor-evaluator' }],
    workflow: { runId: 'workflow-run-1', sessionId: 'workflow-session-1', ownerSessionId: 'owner' } } };
  const first = await evaluate(f.host, request, undefined, execution);
  assert.equal(first.metrics.validation.rankIC, 1);
  const forged = structuredClone(execution); forged.provenance.workflow.ownerSessionId = 'unrelated-owner';
  await assert.rejects(evaluate(f.host, { ...request, ownerSessionId: 'owner' }, undefined, forged), /another workflow owner/);
  f.host.context = { ...f.host.context, sessionId: 'workflow-session-2', runId: 'workflow-run-2' };
  execution.provenance.caller.runId = 'workflow-run-2';
  execution.provenance.workflow = { runId: 'workflow-run-2', sessionId: 'workflow-session-2', ownerSessionId: 'owner' };
  assert.deepEqual(await evaluate(f.host, request, undefined, execution), first);
});
test('general research tools use genuine development-only input with no holdout claim', async () => {
  const f = fixture();
  await assert.rejects(f.call('prepare', { dataset_id: 'data', access: 'development-only', options }), /after validationEnd/);
  f.host.data.query = async () => ({ items: rows.filter(row => row.time <= iso(9)), metadata: { id: 'data' } });
  const prepared = await f.call('prepare', { dataset_id: 'data', access: 'development-only', options });
  assert.equal(prepared.data.holdoutMode, 'none'); assert.equal(prepared.development.summary.holdoutSealed, false);
  const session_id = prepared.sessionId;
  assert.equal((await f.call('candidate', { session_id, trial_id: 'one', candidate, accepted_ids: [] })).metrics.validation.rankIC, 1);
  const selection = await f.call('select', { session_id, trial_ids: ['one'] });
  const final = await f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.deepEqual(final.holdout, {}); assert.equal(final.holdoutStatus, 'not-requested');
});

test('parallel candidates keep both receipts without losing state or bypassing CAS', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  const session_id = prepared.sessionId;
  const [positive, negative] = await Promise.all([
    f.call('candidate', { session_id, trial_id: 'positive', candidate, accepted_ids: [] }),
    f.call('candidate', { session_id, trial_id: 'negative', candidate: { op: 'neg', args: [candidate] }, accepted_ids: [] }),
  ]);
  assert.equal(positive.metrics.validation.rankIC, 1); assert.equal(negative.metrics.validation.rankIC, -1);
  assert.deepEqual(Object.keys(f.db.get(`sessions:${session_id}`).value.refs.candidates).sort(), ['negative', 'positive']);
  assert.deepEqual(await f.call('candidate', { session_id, trial_id: 'positive', candidate, accepted_ids: [] }), positive);
});

test('legacy thresholds are advisory, and unavailable optional diagnostics cannot veto measurable evidence', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted',
    options: { ...options, diagnostics: { regimes: { field: 'absent' }, sensitivity: true, placebo: { samples: -1 } } } });
  const session_id = prepared.sessionId;
  const negative = await f.call('candidate', { session_id, trial_id: 'negative', candidate: { op: 'neg', args: [candidate] } });
  assert.equal(negative.metrics.validation.rankIC, -1);
  assert.equal(negative.eligible, true);
  assert.equal(negative.metrics.diagnostics.regimes.status, 'unavailable');
  assert.equal(negative.metrics.diagnostics.sensitivity.status, 'not-applicable');
  assert.equal(negative.metrics.diagnostics.placebo.status, 'error');
  const positive = await f.call('candidate', { session_id, trial_id: 'positive', candidate });
  assert.equal(positive.eligible, true);
  const selection = await f.call('select', { session_id, trial_ids: ['negative', 'positive'] });
  assert.deepEqual(selection.trialIds, ['negative', 'positive']);

  const gated = fixture();
  const gateSession = await gated.call('prepare', { dataset_id: 'data', access: 'restricted', options: { ...options, minRankIC: 0, maxCorrelation: .5 } });
  const measured = await gated.call('candidate', { session_id: gateSession.sessionId, trial_id: 'negative', candidate: { op: 'neg', args: [candidate] } });
  assert.equal(measured.eligible, true);
  assert.equal(measured.evaluation.advisoryFindings[0].status, 'unmet');
  assert.deepEqual((await gated.call('select', { session_id: gateSession.sessionId, trial_ids: ['negative'] })).trialIds, ['negative']);
});

test('all unmeasurable candidates allow empty completion without claiming any holdout evaluation', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options });
  const session_id = prepared.sessionId;
  const measured = await f.call('candidate', { session_id, trial_id: 'constant', candidate: { op: 'constant', value: 1 } });
  assert.equal(measured.eligible, false);
  assert.equal(measured.metrics.validation.rankIC, null);
  const selection = await f.call('select', { session_id, trial_ids: [] });
  const final = await f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.equal(final.holdoutStatus, 'not-requested');
  assert.deepEqual(final.holdout, {});
});

test('selected out-of-sample diagnostic changes from deferred to measured only in frozen finalize', async () => {
  const f = fixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options: { ...options, diagnostics: { outOfSample: true } } });
  const session_id = prepared.sessionId;
  const measured = await f.call('candidate', { session_id, trial_id: 'one', candidate });
  assert.equal(measured.metrics.diagnostics.outOfSample.holdout.status, 'deferred');
  const selection = await f.call('select', { session_id, trial_ids: ['one'] });
  const final = await f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.equal(final.holdout.one.diagnostics.outOfSample.holdout.status, 'evaluated');
  assert.equal(final.holdout.one.diagnostics.outOfSample.holdout.rankIC, 1);
});

function searchFixture() {
  const f = fixture(), prices = [100, 100, 100, 100], panel = [];
  for (let day = 1; day <= 65; day++) for (let symbol = 0; symbol < 4; symbol++) {
    panel.push({ time: iso(day), availableAt: iso(day), symbol: `S${symbol}`, fields: { close: prices[symbol], signal: symbol, noise: (symbol + day) % 4 } });
    prices[symbol] *= 1 + (symbol - 1.5) * (.002 + .0005 * Math.sin(day));
  }
  f.host.data.query = async () => ({ items: panel, metadata: { id: 'data' } });
  return { ...f, panel, options: { dataset: { trainEnd: iso(16), validationEnd: iso(49), holdoutEnd: iso(65), costBps: 0 },
    evaluationPlan: { tests: { dsr: true, pbo: { blocks: 4 } }, reasons: { dsr: 'Multiple tried factor formulas', pbo: 'Inspect Sharpe selection risk across the complete attempted universe' } } } };
}

test('registered losers enter selection DSR/PBO; candidate receipts stay immutable and finalized evidence is identical', async () => {
  const f = searchFixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options: f.options });
  const session_id = prepared.sessionId;
  assert.equal(prepared.contract.evaluationPlan.tests.dsr, true);
  const first = await f.call('candidate', { session_id, trial_id: 'winner', candidate });
  assert.equal(first.metrics.diagnostics.dsr.status, 'deferred');
  await f.call('candidate', { session_id, trial_id: 'loser', candidate: { op: 'neg', args: [candidate] } });
  const selection = await f.call('select', { session_id, trial_ids: ['winner'] });
  assert.equal(selection.diagnostics.dsr.status, 'completed'); assert.equal(selection.diagnostics.pbo.status, 'completed');
  assert.deepEqual(selection.diagnostics.pbo.trialIds, ['loser', 'winner']);
  assert.equal(selection.diagnostics.pbo.trials, 2);
  assert.equal(selection.evaluations.winner.eligible, true);
  assert.equal(selection.planDigest, prepared.contract.planDigest);
  const candidateRef = f.db.get(`sessions:${session_id}`).value.refs.candidates.winner;
  const stored = JSON.parse(Buffer.from((await f.host.resources.read(candidateRef, {})).content, 'base64').toString());
  assert.deepEqual(stored, first);
  const finalized = await f.call('finalize', { session_id, selection_digest: selection.selectionDigest });
  assert.deepEqual(finalized.diagnostics, selection.diagnostics);
  assert.deepEqual(finalized.evaluations, selection.evaluations);
  assert.deepEqual(await f.call('select', { session_id, trial_ids: ['winner'] }), selection);
});

test('only source=user plus required blocks selection; missing search evidence is not a passing result', async () => {
  const f = searchFixture();
  f.options.evaluationPlan.thresholds = [{ metric: 'diagnostics.pbo.probability', value: .9, operator: 'lte', mode: 'required', source: 'user', reason: 'The user explicitly requires an evaluable PBO below 0.9' }];
  const prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options: f.options }), session_id = prepared.sessionId;
  const first = await f.call('candidate', { session_id, trial_id: 'winner', candidate });
  assert.equal(first.eligible, true); assert.equal(first.evaluation.pendingHardRequirements.length, 1);
  await assert.rejects(f.call('select', { session_id, trial_ids: ['winner'] }), error => {
    assert.equal(error.code, 'HARD_REQUIREMENT_UNMET');
    assert.equal(error.evaluations.winner.hardRequirementFailures[0].status, 'unavailable');
    return true;
  });
  const state = f.db.get(`sessions:${session_id}`).value;
  assert.equal(state.selection, undefined); assert.equal(state.lastSelectionReview.diagnostics.pbo.status, 'unavailable');
  await f.call('candidate', { session_id, trial_id: 'loser', candidate: { op: 'neg', args: [candidate] } });
  const selected = await f.call('select', { session_id, trial_ids: ['winner'] });
  assert.equal(selected.evaluations.winner.pendingHardRequirements.length, 0);
  assert.equal(selected.evaluations.winner.hardRequirementFailures.length, 0);
});

test('explicit user pairwise redundancy gate waits for the actual selected pair; singleton is vacuous', async () => {
  const f = fixture(), evaluationPlan = { thresholds: [{ metric: 'redundancy.absoluteCorrelation', value: .5, operator: 'lte', mode: 'required', source: 'user', reason: 'User disallows selected factors with absolute training correlation above 0.5' }] };
  const prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options: { ...options, evaluationPlan } }), session_id = prepared.sessionId;
  await f.call('candidate', { session_id, trial_id: 'positive', candidate });
  await f.call('candidate', { session_id, trial_id: 'negative', candidate: { op: 'neg', args: [candidate] } });
  await assert.rejects(f.call('select', { session_id, trial_ids: ['positive', 'negative'] }), error => error.code === 'HARD_REQUIREMENT_UNMET');
  const selected = await f.call('select', { session_id, trial_ids: ['positive'] });
  assert.equal(selected.evaluations.positive.thresholdResults[0].status, 'not-applicable');
});

test('failed AST attempts remain in the universe while deterministic rejection permits a corrected candidate', async () => {
  const f = searchFixture(), prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options: f.options }), session_id = prepared.sessionId;
  await f.call('candidate', { session_id, trial_id: 'winner', candidate });
  await f.call('candidate', { session_id, trial_id: 'loser', candidate: { op: 'neg', args: [candidate] } });
  await assert.rejects(f.call('candidate', { session_id, trial_id: 'failed', candidate: { op: 'unknown' } }));
  await assert.rejects(f.call('candidate', { session_id, trial_id: 'failed', candidate: { op: 'unknown' } }));
  const repaired = await f.call('candidate', { session_id, trial_id: 'failed', candidate: { op: 'field', name: 'noise' } });
  assert.equal(repaired.eligible, true);
  await assert.rejects(f.call('candidate', { session_id, trial_id: 'winner', candidate: { op: 'unknown' } }), /receipt is frozen/);
  const selected = await f.call('select', { session_id, trial_ids: ['winner'] });
  assert.equal(selected.diagnostics.pbo.status, 'unavailable'); assert.equal(selected.diagnostics.dsr.status, 'unavailable');
  assert.equal(selected.diagnostics.pbo.attemptedTrialCount, 4);
  assert.deepEqual(selected.failedTrials.map(item => item.trialId), ['failed']);
  assert.equal(selected.failedTrials[0].attemptIndex, 1);
  assert.equal(selected.evaluations.winner.eligible, true);
});

test('actual forward-subset evidence permits conditional selection when full validation association and return evidence are absent', async () => {
  const f = fixture(), panel = []; let price = 100;
  for (let day = 1; day <= 96; day++) {
    panel.push({ time: iso(day), availableAt: iso(day), symbol: 'S', fields: { close: price, signal: day <= 32 ? Math.sin(day) : 0 } });
    price *= 1 + Math.sin(day) * .001;
  }
  f.host.data.query = async () => ({ items: panel, metadata: { id: 'data' } });
  const prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options: {
    dataset: { trainEnd: iso(32), validationEnd: iso(64), holdoutEnd: iso(96), costBps: 0 },
    evaluationPlan: { tests: { walkForward: { folds: 2, minTrain: 8, minTest: 4 } } },
  } }), session_id = prepared.sessionId;
  const result = await f.call('candidate', { session_id, trial_id: 'scoped', candidate });
  assert.equal(result.metrics.validation.rankIC, null); assert.equal(result.metrics.validation.meanNetReturn, null);
  assert.equal(result.evaluation.status, 'conditional'); assert.equal(result.eligible, true);
  assert.ok(result.evaluation.conditions.some(item => item.scope === 'development-forward-fold'));
  assert.deepEqual((await f.call('select', { session_id, trial_ids: ['scoped'] })).trialIds, ['scoped']);
});

test('40-trial search and 20-candidate selection retain findings within the declared receipt bounds', async () => {
  const f = searchFixture();
  f.options.evaluationPlan.tests = { ...f.options.evaluationPlan.tests, placebo: { samples: 20 }, bootstrap: { samples: 20 }, monteCarlo: { samples: 20 },
    regimes: { field: 'noise' }, walkForward: { folds: 2, minTrain: 8, minTest: 4 }, sensitivity: true, outOfSample: true };
  f.options.evaluationPlan.thresholds = Array.from({ length: 40 }, (_, i) => ({ metric: 'validation.rankIC', operator: 'gte', value: 2, mode: 'advisory', source: 'agent', reason: `Evidence reference ${i + 1}; explain the observed limitation.` }));
  const prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options: f.options }), session_id = prepared.sessionId, ids = [];
  for (let i = 0; i < 40; i++) {
    const trialId = `${i.toString().padStart(2, '0')}-${'x'.repeat(190)}`; ids.push(trialId);
    const result = await f.call('candidate', { session_id, trial_id: trialId, candidate: { op: 'add', args: [candidate, { op: 'constant', value: i }] } });
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 64 * 1024, 'Candidate receipt exceeds 64KiB');
    assert.equal(result.evaluation.advisoryFindings.length, 40);
  }
  const result = await f.call('select', { session_id, trial_ids: ids.slice(0, 20) });
  assert.equal(result.diagnostics.dsr.attemptedTrialCount, 40);
  assert.equal(result.diagnostics.pbo.trials, 40);
  assert.equal(Object.keys(result.evaluations).length, 20);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 512 * 1024, `Selection receipt has ${Buffer.byteLength(JSON.stringify(result))} bytes`);
});

test('identified opposing regimes permit exploratory conditional use under an advisory global threshold, never a required-user exemption', async () => {
  const panel = []; let price = 100;
  for (let day = 1; day <= 144; day++) {
    const signal = [-3, -2, -1, 1, 2, 3][(day - 1) % 6], state = Math.floor((day - 1) / 6) % 2 ? 1 : -1;
    panel.push({ time: iso(day), availableAt: iso(day), symbol: 'S', fields: { close: price, signal, state } });
    price *= 1 + signal * state * .001;
  }
  for (const mode of ['advisory', 'required']) {
    const f = fixture(); f.host.data.query = async () => ({ items: panel, metadata: { id: 'data' } });
    const prepared = await f.call('prepare', { dataset_id: 'data', access: 'restricted', options: {
      dataset: { trainEnd: iso(48), validationEnd: iso(96), holdoutEnd: iso(144), costBps: 0 }, evaluationPlan: {
        tests: { regimes: { field: 'state', bins: 2 } }, thresholds: [{ metric: 'validation.rankIC', operator: 'gte', value: .5,
          source: 'user', mode, reason: mode === 'required' ? 'User explicitly requires whole-validation Rank IC >= 0.5' : 'User suggests comparing whole-validation Rank IC with 0.5' }],
      },
    } }), session_id = prepared.sessionId;
    const result = await f.call('candidate', { session_id, trial_id: 'regime', candidate });
    assert.ok(Math.abs(result.metrics.validation.rankIC) < .1);
    assert.ok(result.metrics.diagnostics.regimes.strata[0].rankIC < -.99);
    assert.ok(result.metrics.diagnostics.regimes.strata[1].rankIC > .99);
    assert.equal(result.evaluation.status, 'conditional');
    assert.equal(result.evaluation.evidenceStatus, 'exploratory-development');
    assert.ok(result.evaluation.conditions.every(item => item.evidenceStatus === 'exploratory'));
    assert.ok(result.evaluation.invalidations.some(item => item.metric === 'validation.rankIC'));
    if (mode === 'advisory') {
      assert.equal(result.eligible, true);
      assert.deepEqual((await f.call('select', { session_id, trial_ids: ['regime'] })).trialIds, ['regime']);
    } else {
      assert.equal(result.eligible, false);
      await assert.rejects(f.call('select', { session_id, trial_ids: ['regime'] }), /eligible/);
    }
  }
});
