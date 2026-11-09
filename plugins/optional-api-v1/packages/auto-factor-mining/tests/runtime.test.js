import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntime } from '../runtime.js';
import { createJournal } from '../journal.js';
import { OPERATOR_DIGEST, canonical, clone, digest, error, identifier } from '../contracts.js';
import { evidenceContext } from '../python-bridge.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const ref = id => ({ id, revision: '1', digest: digest(id), kind: 'resource', schemaVersion: '1.0.0' });
const scalar = value => ({ constant: value });
const field = name => ({ field: name });
const formula = value => ({ dsl: 'qlib-expr/1', tree: { call: 'Add', args: [field('close'), scalar(value)] } });
const candidate = (id, value) => ({ id, formula: formula(value), hypothesis: `Synthetic ${id}`, origin: { method: 'seed', parents: [], parameters: {} } });
const env = { ready: true, versions: { pyqlib: '0.9.7' }, environmentDigest: digest('test-environment') };
const engine = { name: 'qlib', version: '0.9.7', environmentDigest: env.environmentDigest, operatorDigest: OPERATOR_DIGEST };
const metric = value => ({ value, status: value === null ? 'unavailable' : 'computed' });
function draft(overrides = {}) {
  return {
    requestId: 'runtime-test', need: 'Synthetic research fixture', source: { ref: { ...ref('source'), kind: 'data' } },
    layout: { universe: ['A', 'B'], frequency: '60min', timezone: 'UTC', availableAt: 'bar_close', development: ['2026-01-01T00:00:00Z', '2026-01-10T00:00:00Z'], holdout: ['2026-01-11T00:00:00Z', '2026-01-20T00:00:00Z'], target: { kind: 'forward_return', field: 'close', horizonBars: 1 } },
    space: { fields: ['close'], operators: ['Add', 'Mean', 'Ref'], windows: [2, 3], lags: [1], constants: [0, 1, 2, 3], maxNodes: 32, maxDepth: 6, maxLookbackBars: 8, seeds: [], templates: [] },
    profile: { id: 'alpha', version: 1, kind: 'alpha', axis: 'time_series', minPairs: 3, minCoverage: 0.5, stabilityWindows: 2, maxReferenceCorrelation: 0.9, score: 'abs_rank_ic', diagnostics: [] },
    references: [], budget: { maxCandidates: 8, batchSize: 1, maxWorkers: 2, maxSeconds: 60, maxInputBytes: 1048576, maxOutputBytes: 1048576, seed: 19 }, ...overrides,
  };
}

function memoryState() {
  const rows = new Map();
  const keyOf = key => `${key.collection}:${key.key}`;
  return {
    async read(key) { const row = rows.get(keyOf(key)); if (!row) throw error('NOT_FOUND', 'missing'); return clone(row); },
    async commit(changes) {
      for (const change of changes) if ((rows.get(keyOf(change.key))?.version ?? 0) !== change.expectedVersion) throw error('VERSION_CONFLICT', 'version');
      for (const change of changes) rows.set(keyOf(change.key), { key: clone(change.key), version: change.expectedVersion + 1, value: clone(change.value) });
    },
    async query({ collection, filter = {}, limit = 100, cursor }) {
      const offset = Number(cursor ?? 0), matches = [...rows.values()].filter(row => row.key.collection === collection && Object.entries(filter).every(([key, value]) => row.value[key] === value));
      return { items: clone(matches.slice(offset, offset + limit)), ...(offset + limit < matches.length ? { nextCursor: String(offset + limit) } : {}) };
    },
  };
}

async function harness(options = {}) {
  const payloads = new Map(), events = [], calls = { prepare: 0, compute: 0, evaluate: 0, search: 0, reports: 0, launches: 0, pool: 0 }, records = new Map(), nativeRuns = new Map();
  let inFlight = 0, peak = 0, queryCalls = 0;
  const artifacts = {
    async publishJSON(value, write) { const handle = ref(identifier('artifact', [write.schema, write.operationId, value])); payloads.set(handle.id, clone(value)); return handle; },
    async readJSON(handle) { assert.ok(payloads.has(handle.id), `Unknown artifact ${handle.id}`); return clone(payloads.get(handle.id)); },
  };
  const journal = createJournal({ state: memoryState(), artifacts, ownerSessionId: 'test-session' });
  const base = options.input ?? draft();
  const snapshot = { id: identifier('snapshot', [base.source, base.layout]), source: base.source.ref ?? { ...ref('dataset-frozen'), kind: 'data' }, layout: clone(base.layout), fields: ['close'], calendarDigest: digest('calendar'), development: { manifest: ref('development'), digest: digest('development-rows'), rows: 40, bytes: 1000 }, holdout: { manifest: ref('holdout'), digest: digest('holdout-rows'), rows: 40, bytes: 1000 }, provider: ref('provider'), usageLedgerRef: ref('usage') };
  snapshot.manifest = await artifacts.publishJSON(snapshot, { schema: 'factor-snapshot/1', operationId: 'snapshot' });
  const operation = async (type, detail, action) => {
    inFlight++; peak = Math.max(peak, inFlight); events.push(`${type}:start:${detail}`);
    try { return await action(); } finally { events.push(`${type}:end:${detail}`); inFlight--; }
  };
  const makeValues = async (candidates, partition = 'development', frozen = snapshot) => {
    const id = identifier('values', [frozen.id, partition, candidates]);
    const values = { id, snapshotId: frozen.id, snapshotRef: frozen.manifest, partition, engine, candidates: candidates.map(item => options.computeFailure === item.id ? { id: item.id, status: 'failed', error: { code: 'BAD_FORMULA', message: 'synthetic invalid candidate', retryable: false } } : {
      id: item.id, status: 'ok', value: { candidate: item, column: item.id, computeKey: digest({ formula: digest({ dsl: item.formula.dsl, operatorDigest: OPERATOR_DIGEST, tree: item.formula.tree }), snapshotId: frozen.id, calendarDigest: frozen.calendarDigest, layout: frozen.layout, partition, engine }) },
    }), matrix: { manifest: ref('matrix'), digest: digest('rows'), rows: 40, bytes: 1000 }, labels: { manifest: ref('labels'), digest: digest('rows'), rows: 40, bytes: 1000 }, diagnosticValues: { covariates: null, sensitivityMatrix: null, sensitivity: [] } };
    return { ...values, manifest: await artifacts.publishJSON(values, { schema: 'factor-values/1', operationId: id }) };
  };
  const evaluation = (values, item, profile, references = []) => ({ id: identifier('evaluation', [values.id, item.id, profile]), candidateId: item.id, valuesId: values.id, valuesRef: values.manifest, context: evidenceContext(values, snapshot, profile, references), profile, partition: values.partition, pairs: 40, coverage: metric(1), ic: metric(0.5), rankIC: metric(0.5), stability: metric(0.4), maxReferenceCorrelation: metric(references.length ? 0.1 : null), complement: metric(null), score: metric(options.scores?.[item.id] ?? 0.5), diagnostics: [], eligibility: options.insufficient ? 'insufficient' : 'supported', reasons: options.insufficient ? ['synthetic insufficient evidence'] : [], details: ref(`details-${item.id}`) });
  const compute = {
    async prepare(source, layout, budget, ctx) { calls.prepare++; return operation('prepare', ctx.jobId, async () => { await options.onPrepare?.({ source, layout, budget, ctx }); return clone(snapshot); }); },
    async compute(frozen, candidates, partition, ctx, diagnosticValues) {
      calls.compute++;
      return operation('compute', `${partition}:${candidates.map(item => item.id)}`, async () => {
        if (partition === 'holdout') { const job = await journal.get(ctx.jobId); assert.ok(Array.isArray(job.selection)); assert.ok(job.holdoutExposureRef); }
        await options.onCompute?.({ frozen, candidates, partition, ctx, diagnosticValues, journal, nativeRuns });
        return makeValues(candidates, partition, frozen);
      });
    },
  };
  const evaluator = { async evaluate(values, profile, references, ctx) {
    calls.evaluate++;
    return operation('evaluate', `${values.partition}:${values.candidates.map(item => item.id)}`, async () => {
      await options.onEvaluate?.({ values, profile, references, ctx });
      return values.candidates.map(item => item.status === 'failed' ? item : { id: item.id, status: 'ok', value: evaluation(values, item, profile, references) });
    });
  } };
  const libraryFactors = options.factors ?? [], libraryEvaluations = new Map();
  const library = {
    async query(query) { queryCalls++; return options.query ? options.query(query) : { items: clone(libraryFactors), cursor: null }; },
    async read(id) { const factor = libraryFactors.find(value => value.id === id); assert.ok(factor); return clone(factor); },
    async evaluations(id) { return { items: clone(libraryEvaluations.get(id) ?? []), cursor: null }; },
    async record(candidates, measured, fence) {
      await options.onRecord?.({ candidates, measured, fence });
      const job = await journal.get(fence.jobId);
      if (job.epoch !== fence.epoch || !['running', 'pausing'].includes(job.status)) throw error('CANCELLED', 'stale commit');
      for (const value of measured) records.set(value.id, clone(value));
      return candidates.map(value => ({ id: `factor-${value.id}`, formula: value.formula, definitionDigest: digest(value.formula), evaluationIds: measured.map(value => value.id), annotations: [] }));
    },
    async decide() { calls.pool++; throw Error('Runtime must never modify pools'); },
  };
  const proposals = options.proposals ?? [candidate('slow', 1), candidate('fast', 2)];
  const receivedFeedback = [];
  const search = { async propose(request, checkpoint, feedback, limit, ctx) {
    calls.search++;
    assert.equal('holdout' in request.development.layout, false);
    assert.deepEqual(Object.keys(request.development).sort(), ['calendarDigest', 'fields', 'layout', 'snapshotId', 'source']);
    return operation('search', String(calls.search), async () => {
      const prior = checkpoint ? await artifacts.readJSON(checkpoint) : { offset: 0, budget: { used: 0, proposed: 0 }, feedback: [] };
      receivedFeedback.push(...clone(feedback));
      const candidates = proposals.slice(prior.offset, prior.offset + limit);
      const offset = prior.offset + candidates.length;
      const state = { offset, feedback: [...prior.feedback, ...feedback], budget: { used: offset + (options.extraAttempts ?? 0), proposed: offset } };
      const next = await artifacts.publishJSON(state, { schema: 'factor-search-state/1', operationId: identifier('search', state) });
      await options.onSearch?.({ request, checkpoint, feedback, limit, ctx });
      return { candidates: clone(candidates), checkpoint: next, exhausted: offset === proposals.length };
    });
  } };
  const capabilities = { async invoke(name, input, invokeOptions) {
    assert.equal(name, 'sesame/auto-factor-mining#factor_workflow'); calls.launches++;
    assert.ok(invokeOptions.operationId);
    assert.equal(invokeOptions.task.output.type, 'report'); assert.equal(invokeOptions.task.output.space, 'research');
    assert.match(invokeOptions.task.output.path, /^(因子研究|因子计算与评价)-[a-f0-9]{12}\.html$/);
    const id = `run-${input.jobId}`;
    nativeRuns.set(id, { id, status: 'queued', interrupts: [] }); return { type: 'run', run: { id } };
  } };
  const runs = {
    async read(handle) { return { run: { ...nativeRuns.get(handle.id) } }; },
    async wait(handle) { const value = nativeRuns.get(handle.id); if (value.cleanup) { await value.cleanup; value.status = 'cancelled'; } return { reason: 'settled', run: { ...value } }; },
    async cancel(handle) { const value = nativeRuns.get(handle.id); value.status = value.cleanup ? 'cancelling' : 'cancelled'; events.push(`cancel:${handle.id}`); return { run: { ...value } }; },
    async resume(handle, input) { const value = nativeRuns.get(handle.id); for (const interrupt of value.interrupts) if (input.interruptIds.includes(interrupt.id)) interrupt.status = 'resolved'; value.status = 'queued'; return { run: { ...value } }; },
  };
  const reports = { async publish(job, onPublished) {
    calls.reports++;
    await options.onReport?.({ job, onPublished });
    if (options.reportFailureBefore && calls.reports === 1) throw error('REPORT_PROVIDER_UNAVAILABLE', 'synthetic provider unavailable');
    const report = job.report ?? ref(`report-${job.id}`); await onPublished(report);
    if (options.reportFailure && calls.reports === 1) throw error('REPORT_CHECK_FAILED', 'synthetic publication check failure');
    return { ref: report };
  } };
  const ports = { search, compute, evaluator, library, journal, runs, reports, capabilities, artifacts, environment: async () => env };
  const runtime = createRuntime(ports);
  function execution(runId) {
    const controller = new AbortController();
    nativeRuns.get(runId).status = 'running';
    return { run: { id: runId }, signal: controller.signal, checkpoint: async state => { events.push(`checkpoint:${state.phase}`); }, emit: (type, value) => events.push(`emit:${type}:${value.phase}`), interrupt: payload => {
      const value = nativeRuns.get(runId); value.status = 'interrupted'; value.interrupts = [{ id: 'interrupt-1', status: 'pending', reason: payload.reason }]; throw error('RUN_INTERRUPTED', payload.reason);
    }, controller };
  }
  return { runtime, ports, journal, artifacts, calls, events, records, nativeRuns, receivedFeedback, libraryEvaluations, libraryFactors, snapshot, makeValues, evaluation, execution, base, peak: () => peak, queryCalls: () => queryCalls };
}

test('continuous queue evaluates fast batch before slow compute finishes, within worker budget', async () => {
  const slow = deferred(), fastEvaluated = deferred();
  const h = await harness({ extraAttempts: 2, onCompute: async ({ candidates, partition }) => { if (partition === 'development' && candidates[0].id === 'slow') await slow.promise; }, onEvaluate: async ({ values }) => { if (values.partition === 'development' && values.candidates[0].id === 'fast') fastEvaluated.resolve(); } });
  const admitted = await h.runtime.research(h.base);
  assert.equal(admitted.job.status, 'queued'); assert.equal(h.calls.prepare, 0);
  const working = h.runtime.execute(admitted.job.id, h.execution(admitted.job.runId));
  await fastEvaluated.promise;
  assert.equal(h.events.includes('compute:end:development:slow'), false);
  slow.resolve(); const job = await working;
  assert.equal(job.status, 'completed'); assert.equal(job.completed, 2); assert.equal(h.peak(), 2);
  assert.equal((await h.journal.get(job.id)).attemptsUsed, 4);
  assert.equal(h.calls.pool, 0); assert.equal(h.records.size, 4);
  assert.ok(h.receivedFeedback.length >= 2);
  assert.ok(h.receivedFeedback.every(item => !item.evaluationId.includes('holdout')));
  assert.equal((await h.journal.all(job.id, 'proposal')).every(item => item.status === 'committed'), true);
});

test('pause drains active work, preserves native Run, and resume requires observed interrupt IDs', async () => {
  const started = deferred(), release = deferred();
  const h = await harness({ onCompute: async ({ partition }) => { if (partition === 'development') { started.resolve(); await release.promise; } } });
  const { job } = await h.runtime.research(h.base), first = h.runtime.execute(job.id, h.execution(job.runId));
  const interrupted = assert.rejects(first, cause => cause.code === 'RUN_INTERRUPTED');
  await started.promise;
  assert.equal((await h.runtime.control(job.id, 'pause')).status, 'pausing');
  release.resolve(); await interrupted;
  assert.equal((await h.journal.get(job.id)).status, 'paused');
  const completed = h.calls.compute;
  await assert.rejects(h.runtime.control(job.id, 'resume', ['stale']), cause => cause.code === 'INTERRUPT_IDS_REQUIRED');
  assert.equal((await h.runtime.control(job.id, 'resume', ['interrupt-1'])).runId, job.runId);
  const final = await h.runtime.execute(job.id, h.execution(job.runId));
  assert.equal(final.status, 'completed');
  assert.equal(h.events.filter(value => value === 'compute:start:development:slow').length, 1);
  assert.ok(h.calls.compute >= completed);
});

test('queued pause launches no numerical process', async () => {
  const h = await harness(), { job } = await h.runtime.research(h.base);
  await h.runtime.control(job.id, 'pause');
  await assert.rejects(h.runtime.execute(job.id, h.execution(job.runId)), cause => cause.code === 'RUN_INTERRUPTED');
  assert.equal(h.calls.prepare + h.calls.search + h.calls.compute, 0);
});

test('pause during a reference batch drains that batch and dispatches no further references', async () => {
  const started = deferred(), release = deferred(), input = draft(); input.references = ['reference-a', 'reference-b'];
  const factors = input.references.map((id, index) => ({ id, formula: formula(index + 1) }));
  const referenceStarts = [];
  const h = await harness({ input, factors, proposals: [], onCompute: async ({ ctx }) => {
    if (!ctx.attemptId.startsWith('reference:')) return;
    referenceStarts.push(ctx.attemptId);
    if (referenceStarts.length === 1) { started.resolve(); await release.promise; }
  } });
  const { job } = await h.runtime.research(input), work = h.runtime.execute(job.id, h.execution(job.runId));
  const stopped = assert.rejects(work, cause => cause.code === 'RUN_INTERRUPTED');
  await started.promise; await h.runtime.control(job.id, 'pause'); release.resolve(); await stopped;
  assert.deepEqual(referenceStarts, ['reference:development:0']); assert.equal(h.calls.search, 0);
  assert.ok((await h.journal.readEntry(job.id, 'reference', 'development:0')).valuesRef);
  await h.runtime.control(job.id, 'resume', ['interrupt-1']);
  assert.equal((await createRuntime(h.ports).execute(job.id, h.execution(job.runId))).status, 'completed');
  assert.deepEqual(referenceStarts, ['reference:development:0', 'reference:development:1']);
});

test('cancel fences first, waits for real cleanup observation, and rejects late candidate completion', async () => {
  const started = deferred(), release = deferred(), cleanup = deferred();
  const h = await harness({ onCompute: async ({ partition, ctx, journal, nativeRuns }) => {
    if (partition !== 'development') return;
    nativeRuns.set('process-1', { id: 'process-1', status: 'running', interrupts: [], cleanup: cleanup.promise });
    await journal.entry(ctx.jobId, 'process', 'process-1', () => ({ runId: 'process-1', status: 'running' }));
    started.resolve(); await release.promise;
  } });
  const { job } = await h.runtime.research(h.base), working = h.runtime.execute(job.id, h.execution(job.runId));
  await started.promise;
  let acknowledged = false;
  const cancelling = h.runtime.control(job.id, 'cancel').then(result => { acknowledged = true; return result; });
  await tick(); assert.equal((await h.journal.get(job.id)).epoch, 2); assert.equal(acknowledged, false);
  release.resolve(); cleanup.resolve();
  assert.equal((await cancelling).status, 'cancelled'); assert.equal((await working).status, 'cancelled');
  assert.equal(h.records.size, 0); assert.equal(h.calls.reports, 0);
});

test('a repeated cancel from a fresh caller also waits for owned child cleanup', async () => {
  const cleanup = deferred(), h = await harness(), { job } = await h.runtime.research(h.base);
  h.nativeRuns.set('child', { id: 'child', status: 'running', cleanup: cleanup.promise });
  await h.journal.entry(job.id, 'process', 'child', () => ({ runId: 'child' }));
  let firstDone = false, secondDone = false;
  const first = h.runtime.control(job.id, 'cancel').then(value => { firstDone = true; return value; });
  await tick();
  const second = createRuntime(h.ports).control(job.id, 'cancel').then(value => { secondDone = true; return value; });
  await tick(); assert.equal(firstDone, false); assert.equal(secondDone, false);
  assert.equal(h.nativeRuns.get('child').status, 'cancelling');
  cleanup.resolve(); await Promise.all([first, second]);
  assert.equal((await h.journal.get(job.id)).epoch, 2); assert.equal(h.nativeRuns.get(job.runId).status, 'cancelled');
});

test('native UI interruption uses fresh control ports to reconcile and resume the same Run', async () => {
  const started = deferred(), release = deferred(); let fail = true;
  const h = await harness({ proposals: [candidate('only', 1)], onEvaluate: async () => {
    if (fail) { fail = false; started.resolve(); await release.promise; }
  } });
  const { job } = await h.runtime.research(h.base), execution = h.execution(job.runId);
  let revokedCalls = 0;
  const boundJournal = Object.fromEntries(Object.entries(h.journal).map(([name, method]) => [name, (...args) => {
    if (name !== 'assertActive' && execution.signal.aborted) { revokedCalls++; execution.signal.throwIfAborted(); }
    return method(...args);
  }]));
  const work = createRuntime({ ...h.ports, journal: boundJournal }).execute(job.id, execution);
  const stopped = assert.rejects(work, cause => cause.code === 'RUN_INTERRUPTED');
  await started.promise;
  h.nativeRuns.set(job.runId, { id: job.runId, status: 'interrupted', interrupts: [{ id: 'native-pause', status: 'pending' }] });
  execution.controller.abort(error('RUN_INTERRUPTED', 'Native UI pause')); release.resolve(); await stopped;
  assert.equal(revokedCalls, 0); assert.equal((await h.journal.get(job.id)).status, 'running');
  const fresh = createRuntime(h.ports);
  assert.equal((await fresh.control(job.id, 'read')).status, 'interrupted');
  assert.equal((await fresh.control(job.id, 'resume', ['native-pause'])).runId, job.runId);
  assert.equal((await fresh.execute(job.id, h.execution(job.runId))).status, 'completed');
  assert.equal(h.events.filter(value => value === 'compute:start:development:only').length, 1);
});

test('native cancellation is fenced on refresh and unknown workflow outcomes cannot replay', async () => {
  for (const status of ['cancelled', 'unknown', 'completed']) {
    const h = await harness(), { job } = await h.runtime.research(h.base);
    await h.journal.update(job.id, value => ({ ...value, status: 'running', startedAt: Date.now() - 10 }));
    h.nativeRuns.set(job.runId, { id: job.runId, status, interrupts: [{ id: 'stale', status: 'pending' }] });
    const fresh = createRuntime(h.ports), observed = await fresh.control(job.id, 'read');
    if (status === 'cancelled') {
      assert.equal(observed.status, 'cancelled'); assert.equal(observed.epoch, 2);
      assert.equal((await fresh.control(job.id, 'read')).epoch, 2);
      await assert.rejects(fresh.control(job.id, 'resume', ['stale']), cause => cause.code === 'INVALID_STATE');
    } else {
      assert.equal(observed.status, 'interrupted'); assert.equal(observed.error.code, 'NATIVE_RECONCILIATION_REQUIRED');
      await assert.rejects(fresh.control(job.id, 'resume', ['stale']), cause => cause.code === 'NATIVE_RECONCILIATION_REQUIRED');
    }
    assert.equal(h.calls.search + h.calls.compute + h.calls.evaluate, 0);
  }
});

test('resume an interrupted evaluation reuses frozen Values rather than recomputing', async () => {
  let fail = true;
  const h = await harness({ proposals: [candidate('only', 1)], onEvaluate: async () => { if (fail) { fail = false; throw error('RUN_INTERRUPTED', 'restart fixture'); } } });
  const { job } = await h.runtime.research(h.base);
  await assert.rejects(h.runtime.execute(job.id, h.execution(job.runId)), cause => cause.code === 'RUN_INTERRUPTED');
  assert.equal(h.calls.compute, 1);
  const partial = (await h.journal.all(job.id, 'batch'))[0]; assert.ok(partial.valuesRef); assert.equal(partial.status, 'evaluating');
  await h.runtime.control(job.id, 'resume', ['interrupt-1']);
  const restarted = createRuntime(h.ports);
  assert.equal((await restarted.execute(job.id, h.execution(job.runId))).status, 'completed');
  assert.equal(h.events.filter(value => value === 'compute:start:development:only').length, 1);
});

test('recovery commits a retained search receipt before proposing any new candidates', async () => {
  const limits = [];
  const h = await harness({ proposals: [candidate('only', 1)], onSearch: async ({ limit }) => limits.push(limit) });
  const original = h.journal.entry; let injected = false;
  h.journal.entry = async (...args) => {
    if (args[1] === 'candidate' && !injected) { injected = true; throw error('RUN_INTERRUPTED', 'crash after proposal receipt'); }
    return original(...args);
  };
  const { job } = await h.runtime.research(h.base);
  await assert.rejects(h.runtime.execute(job.id, h.execution(job.runId)), cause => cause.code === 'RUN_INTERRUPTED');
  const pending = (await h.journal.all(job.id, 'proposal'))[0];
  assert.equal(pending.status, 'received'); assert.ok(pending.receiptRef); assert.equal(h.calls.compute, 0);
  await h.runtime.control(job.id, 'resume', ['interrupt-1']);
  assert.equal((await createRuntime(h.ports).execute(job.id, h.execution(job.runId))).status, 'completed');
  assert.deepEqual(limits, [1, 0]);
  assert.equal((await h.journal.all(job.id, 'candidate')).length, 1);
});

test('holdout selection freezes top eight using development only and records exposure before access', async () => {
  const input = draft(); input.budget.maxCandidates = 20; input.budget.batchSize = 4;
  const proposals = Array.from({ length: 12 }, (_, index) => candidate(`c-${String(index).padStart(2, '0')}`, index));
  const h = await harness({ input, proposals, scores: Object.fromEntries(proposals.map((item, index) => [item.id, index])) });
  const { job } = await h.runtime.research(input);
  assert.equal((await h.runtime.execute(job.id, h.execution(job.runId))).status, 'completed');
  const saved = await h.journal.get(job.id);
  assert.deepEqual(saved.selection, proposals.slice(4).reverse().map(item => item.id));
  assert.ok(saved.holdoutExposureRef);
  const exposure = await h.artifacts.readJSON(saved.holdoutExposureRef);
  assert.deepEqual(exposure.candidateIds, saved.selection);
  assert.equal([...h.records.values()].filter(item => item.partition === 'holdout').length, 8);
  const developmentIds = new Set([...h.records.values()].filter(item => item.partition === 'development').map(item => item.id));
  assert.ok(h.receivedFeedback.every(item => developmentIds.has(item.evaluationId)));
});

test('compute-only returns values and evaluate-only consumes the same immutable snapshot', async () => {
  const h = await harness(), input = { requestId: 'compute-only', mode: 'compute', source: h.base.source, layout: h.base.layout, budget: h.base.budget, formulas: [candidate('independent', 1)] };
  const job = await h.runtime.measure(input);
  assert.equal((await h.runtime.execute(job.id, h.execution(job.runId))).status, 'completed');
  const saved = await h.journal.get(job.id);
  assert.ok(saved.valuesRef); assert.equal(h.calls.search, 0); assert.equal(h.calls.evaluate, 0);
  const evaluated = await h.runtime.measure({ requestId: 'evaluate-only', mode: 'evaluate', valuesRef: saved.valuesRef, profile: h.base.profile, references: [], budget: h.base.budget });
  assert.equal((await h.runtime.execute(evaluated.id, h.execution(evaluated.runId))).status, 'completed');
  assert.equal(h.calls.prepare, 1); assert.equal(h.calls.compute, 1); assert.equal(h.calls.evaluate, 1); assert.equal(h.records.size, 1);
});

test('report failure preserves numerical evidence and retry performs publication only', async () => {
  for (const reportFailureBefore of [false, true]) {
    const h = await harness({ reportFailure: !reportFailureBefore, reportFailureBefore, proposals: [candidate('only', 1)] }), { job } = await h.runtime.research(h.base);
    await assert.rejects(h.runtime.execute(job.id, h.execution(job.runId)), cause => cause.code === 'RUN_INTERRUPTED');
    const saved = await h.journal.get(job.id);
    assert.equal(saved.status, 'interrupted'); assert.equal(saved.numericalComplete, true); assert.equal(saved.reportStatus, 'failed');
    assert.equal(saved.error.code, reportFailureBefore ? 'REPORT_PROVIDER_UNAVAILABLE' : 'REPORT_CHECK_FAILED'); assert.equal(Boolean(saved.report), !reportFailureBefore);
    assert.equal(h.nativeRuns.get(job.runId).status, 'interrupted'); const before = { ...h.calls };
    const fresh = createRuntime(h.ports), retry = await fresh.control(job.id, 'report');
    assert.equal(retry.runId, job.runId); assert.equal(retry.status, 'queued'); assert.equal(h.calls.reports, 1);
    assert.equal((await fresh.execute(job.id, h.execution(job.runId))).status, 'completed');
    assert.equal((await h.journal.get(job.id)).valuesRef.id, saved.valuesRef.id);
    assert.equal(h.calls.prepare, before.prepare); assert.equal(h.calls.compute, before.compute); assert.equal(h.calls.evaluate, before.evaluate); assert.equal(h.calls.search, before.search); assert.equal(h.calls.reports, 2);
    h.nativeRuns.get(job.runId).status = 'completed';
    assert.equal((await fresh.control(job.id, 'report')).status, 'completed'); assert.equal(h.calls.reports, 3);
  }
});

test('late report completion cannot overwrite a cancellation fence', async () => {
  const started = deferred(), release = deferred();
  const h = await harness({ proposals: [candidate('only', 1)], onReport: async () => { started.resolve(); await release.promise; } });
  const { job } = await h.runtime.research(h.base), work = h.runtime.execute(job.id, h.execution(job.runId));
  await started.promise;
  const cancelling = createRuntime(h.ports).control(job.id, 'cancel');
  await tick(); assert.equal((await h.journal.get(job.id)).status, 'cancelled');
  release.resolve(); await cancelling;
  assert.equal((await work).status, 'cancelled');
  const saved = await h.journal.get(job.id);
  assert.equal(saved.epoch, 2); assert.equal(saved.status, 'cancelled'); assert.equal(saved.report, null);
  assert.equal(saved.numericalComplete, true);
});

test('only exact frozen evidence can bypass a new research job', async () => {
  const c = candidate('known', 1), factor = { id: 'factor-known', formula: c.formula, definitionDigest: digest(c.formula), evaluationIds: [], annotations: [] };
  const input = draft(); input.space.seeds = [c.formula];
  const h = await harness({ input, factors: [factor] });
  const values = await h.makeValues([c]);
  h.libraryEvaluations.set(factor.id, [h.evaluation(values, values.candidates[0], input.profile)]);
  assert.equal((await h.runtime.research(input)).resolution, 'reuse'); assert.equal(h.calls.launches, 0);
  const changedProfile = clone(input); changedProfile.requestId = 'changed-profile'; changedProfile.profile.minCoverage = 0.9;
  assert.equal((await h.runtime.research(changedProfile)).resolution, 'research');
  const changedSource = clone(input); changedSource.requestId = 'changed-source'; changedSource.source.ref = { ...changedSource.source.ref, revision: '2', digest: digest('source-v2') };
  assert.equal((await h.runtime.research(changedSource)).resolution, 'research');
  const dataset = clone(input); dataset.requestId = 'dataset'; dataset.source = { datasetId: 'mutable' };
  assert.equal((await h.runtime.research(dataset)).resolution, 'research');
  const target = clone(input); target.requestId = 'target'; target.layout.target.horizonBars = 2;
  assert.equal((await h.runtime.research(target)).resolution, 'research');
  const changedEngine = createRuntime({ ...h.ports, environment: async () => ({ ...env, environmentDigest: digest('new-environment') }) });
  assert.equal((await changedEngine.research({ ...input, requestId: 'engine' })).resolution, 'research');
  h.libraryFactors.push({ id: 'reference', formula: formula(2), definitionDigest: digest(formula(2)), evaluationIds: [], annotations: [] });
  assert.equal((await h.runtime.research({ ...input, requestId: 'references', references: ['reference'] })).resolution, 'research');
  assert.ok(h.queryCalls() >= 4);
});

test('library lookup follows a cursor even when a filtered page is empty', async () => {
  const c = candidate('known', 1), factor = { id: 'factor-known', formula: c.formula, definitionDigest: digest(c.formula), evaluationIds: [], annotations: [] };
  const input = draft(); input.space.seeds = [c.formula];
  const h = await harness({ input, factors: [factor], query: query => query.cursor ? { items: [factor], cursor: null } : { items: [], cursor: 'next' } });
  const values = await h.makeValues([c]); h.libraryEvaluations.set(factor.id, [h.evaluation(values, values.candidates[0], input.profile)]);
  assert.equal((await h.runtime.research(input)).resolution, 'reuse'); assert.equal(h.queryCalls(), 2);
});

test('different seedless needs with matching library fields and evidence still run their requested search', async () => {
  const c = candidate('old-add', 1), factor = { id: 'old-factor', formula: c.formula };
  const input = draft(); input.need = 'Find a smoothing factor'; input.space.operators = ['Mean']; input.space.constants = [];
  const proposal = { ...candidate('new-mean', 0), formula: { dsl: 'qlib-expr/1', tree: { call: 'Mean', args: [field('close'), scalar(2)] } } };
  const h = await harness({ input, factors: [factor], proposals: [proposal] }), values = await h.makeValues([c]);
  h.libraryEvaluations.set(factor.id, [h.evaluation(values, values.candidates[0], input.profile)]);
  const admitted = await h.runtime.research(input); assert.equal(admitted.resolution, 'research');
  assert.equal((await h.runtime.execute(admitted.job.id, h.execution(admitted.job.runId))).status, 'completed');
  assert.ok(h.calls.search > 0); assert.deepEqual((await h.journal.all(admitted.job.id, 'candidate')).map(value => value.candidate.id), ['new-mean']);
  const other = { ...clone(input), requestId: 'different-need', need: 'Find a slow mean-reversion factor' };
  assert.equal((await h.runtime.research(other)).resolution, 'research');
});

test('known definitions with missing evidence are remeasured without invoking search', async () => {
  const c = candidate('known', 1), input = draft(); input.space.seeds = [c.formula];
  const h = await harness({ input, insufficient: true, factors: [{ id: 'factor-known', formula: c.formula, definitionDigest: digest(c.formula), evaluationIds: [], annotations: [] }] });
  const { job } = await h.runtime.research(input);
  assert.equal((await h.runtime.execute(job.id, h.execution(job.runId))).status, 'completed');
  assert.equal(h.calls.search, 0); assert.equal(h.calls.compute, 1); assert.equal(h.records.size, 1);
  assert.equal([...h.records.values()][0].eligibility, 'insufficient');
});

test('individual compute failures preserve successful siblings and whole attempt counts', async () => {
  const input = draft(); input.budget.batchSize = 2;
  const h = await harness({ input, computeFailure: 'slow' }), { job } = await h.runtime.research(input);
  const final = await h.runtime.execute(job.id, h.execution(job.runId));
  assert.equal(final.completed, 2); assert.equal(final.status, 'completed');
  const failed = await h.journal.readEntry(job.id, 'candidate', 'slow'); assert.equal(failed.development.status, 'failed');
  assert.equal((await h.journal.get(job.id)).selection.includes('slow'), false);
  assert.ok(h.receivedFeedback.some(item => item.candidateId === 'slow' && item.status === 'invalid'));
  assert.equal(h.records.size, 2);
});
