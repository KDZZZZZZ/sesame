// Opt-in production installer/SQLite/native Run/Python integration. All data is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const pythonPath = process.env.SESAME_FACTOR_PYTHON;
const scratch = process.env.SESAME_FACTOR_TEST_ROOT;
const pluginId = 'sesame/auto-factor-mining';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const profile = { id: 'host-synthetic-ts', version: 1, kind: 'alpha', axis: 'time_series', minPairs: 4, minCoverage: 0.8, stabilityWindows: 2, maxReferenceCorrelation: 0.99, score: 'abs_rank_ic', diagnostics: [{ kind: 'quantiles', required: false, options: { count: 3 } }] };
const time = hour => new Date(Date.UTC(2026, 0, 1, hour)).toISOString();
const layout = { universe: ['DEMO_A', 'DEMO_B', 'DEMO_C', 'DEMO_D'], frequency: '1h', timezone: 'UTC', availableAt: 'bar_close', development: [time(8), time(63)], holdout: [time(64), time(95)], target: { kind: 'forward_return', field: 'close', horizonBars: 1 } };
const budget = { maxSeconds: 180, maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024 };
const candidate = (id, tree) => ({ id, formula: { dsl: 'qlib-expr/1', tree }, hypothesis: 'Synthetic deterministic signal; not market evidence.', origin: { method: 'seed', parents: [], parameters: {} } });
const formulas = [candidate('demo-signal', { field: 'signal' }), candidate('demo-negative', { call: 'Mul', args: [{ field: 'signal' }, { constant: -1 }] })];
const json = value => JSON.stringify(value, null, 2);

function syntheticRows() {
  const rows = [];
  for (const [symbolIndex, symbol] of layout.universe.entries()) {
    let close = 100 + symbolIndex * 10, prior = 0;
    for (let bar = 0; bar < 96; bar++) {
      close *= 1 + prior * 0.002;
      const signal = Math.sin(bar / 4) + symbolIndex * 0.15;
      rows.push({ symbol, time: time(bar), availableAt: time(bar), fields: { close, signal, volume: 1000 + bar + symbolIndex } }); prior = signal;
    }
  }
  return rows;
}

test('production host supports explicitly scheduled factor steps without a research controller', { skip: !hostRoot || !pythonPath || !scratch, timeout: 600000 }, async t => {
  await mkdir(scratch, { recursive: true });
  const ownedRoot = await realpath(scratch), oldTemp = process.env.TEMP, oldTmp = process.env.TMP;
  assert.equal(resolve(ownedRoot).slice(0, 2).toUpperCase(), 'E:', 'Use the explicit isolated E: fixture root');
  process.env.TEMP = ownedRoot; process.env.TMP = ownedRoot;
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const [{ fixture }, { createTools }, { createHostContextV2 }] = await Promise.all([load('tests/fixture-provider.js'), load('modules/agent/tools.js'), load('modules/plugins/host-v2/context.js')]);
  let app, stage = 'host startup', primaryError, sequence = 0;
  const evidence = { synthetic: true, brokerCalls: 0, modelCalls: 0, stages: [], operations: [] };
  const advance = async value => { stage = value; evidence.stages.push(value); await writeFile(join(ownedRoot, 'current-directed-host-stage.json'), json({ stage, at: new Date().toISOString() })); t.diagnostic(`factor host stage: ${value}`); };
  try {
    app = await fixture({ configured: false, responseHandler: () => { throw new Error('Numerical integration must not invoke a model transport'); } });
    const child = relative(ownedRoot, await realpath(app.directory)); assert.ok(!child.startsWith('..') && !isAbsolute(child));
    await advance('production package installation');
    const draft = join(app.runtime.workspaces.root('conv_main'), 'factor-direct-draft');
    await cp(packageRoot, draft, { recursive: true, filter: path => {
      const parts = relative(packageRoot, path).split(/[\\/]/);
      return parts[0] !== 'tests' && !parts.includes('__pycache__') && !/\.py[co]$/.test(path);
    } });
    const checked = await app.runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(checked.passed, true, json(checked));
    const previous = app.runtime.plugins.entries.get(checked.id);
    const installed = previous?.digest === checked.digest ? previous : await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest, ...(previous ? { expected_digest: previous.digest } : {}) }, Boolean(previous));
    assert.equal(installed.runtime_status, 'ready', json(installed.diagnostics));
    app.runtime.plugins.activate('conv_main', installed.id);
    evidence.package = { id: installed.id, digest: installed.digest, version: installed.version };
    const entry = app.runtime.plugins.entry(pluginId), own = createHostContextV2(app.runtime, entry, 'conv_main'), main = createHostContextV2(app.runtime, app.runtime.capabilities.hostEntry, 'conv_main');
    const wait = async accepted => {
      let result;
      do { result = await main.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000 }); } while (result.reason === 'timeout');
      return result.run;
    };
    const admit = async (name, input = {}) => {
      const tool = createTools(app.runtime, 'conv_main').find(tool => tool.name === name); assert.ok(tool, `Missing public tool ${name}`);
      const result = await tool.execute(`factor-host-${++sequence}`, input);
      assert.notEqual(result.isError, true, json(result));
      return result.details ?? JSON.parse(result.content[0].text);
    };
    const invoke = async (name, input = {}) => {
      const accepted = await admit(name, input);
      if (accepted.type === 'result') return accepted.value;
      if (accepted.type !== 'run') return accepted;
      const run = await wait(accepted);
      evidence.operations.push({ tool: name, requestId: input.requestId ?? null, runId: run.id, attempt: run.attempt, status: run.status, output: run.output });
      assert.equal(run.status, 'completed', json({ tool: name, error: run.error, interrupts: run.interrupts }));
      assert.equal(run.kind, 'function'); assert.equal(run.executionSessionId, null, 'A primitive operation cannot create a workflow task');
      return run.output;
    };
    const rejectOperation = async (name, input, pattern) => {
      const accepted = await admit(name, input); assert.equal(accepted.type, 'run');
      const run = await wait(accepted);
      assert.equal(run.status, 'interrupted', json(run)); assert.match(json(run.error ?? run.interrupts), pattern);
      evidence.operations.push({ tool: name, requestId: input.requestId, runId: run.id, status: run.status, error: run.error });
      await main.runs.cancel(accepted.run, { reason: 'Expected invalid synthetic request was verified' });
      return run;
    };
    const processRuns = () => app.store.list('run').filter(run => run.capabilityId === 'host.process.exec');
    const isWorker = run => app.store.get('run_invocation', run.id, true)?.input?.argv?.some(value => /[\\/]python[\\/]worker\.py$/.test(value));
    const workerRuns = () => processRuns().filter(isWorker);
    const factorRows = () => own.state.query({ collection: 'factor_research_v1_factors', limit: 200 });
    const readJSON = async ref => {
      // Read through the main Agent's public resource port, not the producer context.
      const manifest = await main.resources.read(ref, { part: 'manifest' });
      const part = await main.resources.read(ref, { part: 'content', entry: manifest.content.path, encoding: 'utf8' });
      assert.equal(part.nextOffset, undefined, 'Synthetic identity documents fit one page'); return JSON.parse(part.content);
    };
    const names = createTools(app.runtime, 'conv_main').map(tool => tool.name);
    assert.deepEqual(names.filter(name => name.startsWith('factor_')).sort(), ['factor_compute', 'factor_environment', 'factor_evaluate', 'factor_library', 'factor_pool', 'factor_prepare', 'factor_search']);
    for (const name of ['factor_prepare', 'factor_search', 'factor_compute', 'factor_evaluate']) {
      const declaration = entry.capabilityManifest.capabilities.find(capability => capability.id === name);
      assert.equal(declaration.kind, 'function'); assert.equal(declaration.execution, 'run'); assert.equal(declaration.resumable, true);
    }

    await advance('real Python environment and host configuration');
    const environment = await invoke('factor_environment', { action: 'inspect', pythonPath });
    assert.equal(environment.ready, true, json(environment)); assert.equal(environment.versions.pyqlib, '0.9.7');
    assert.ok(environment.versions.deap && environment.versions.optuna); evidence.environment = environment;
    const configured = await app.api('/settings/integrations', { plugin_id: pluginId, values: { pythonPath } }, 'synthetic-host-python');
    assert.equal(configured.response.status, 200, json(configured.data)); assert.equal(configured.data.status, 'applied');
    const configuration = await app.api(`/settings/integrations?plugin_id=${encodeURIComponent(pluginId)}`);
    const pythonField = configuration.data.items[0].fields.find(field => field.id === 'pythonPath');
    assert.equal(pythonField.configured, true); assert.equal(resolve(pythonField.value), resolve(pythonPath));
    evidence.configuration = { status: configured.data.status, configured: pythonField.configured };
    app.store.put('dataset', { id: 'factor-host-demo', title: 'Invented deterministic panel for host acceptance only', rows: syntheticRows(), provenance: { kind: 'demo', source_kind: 'synthetic' } });

    await advance('explicit prepare freezes data without computation or library writes');
    const prepared = await invoke('factor_prepare', { requestId: 'host-prepare', source: { datasetId: 'factor-host-demo' }, layout, budget });
    assert.ok(prepared.snapshotRef); assert.deepEqual(prepared.layout, layout);
    assert.ok(prepared.rows.development > 0 && prepared.rows.holdout > 0);
    assert.equal((await factorRows()).items.length, 0);
    const snapshot = await readJSON(prepared.snapshotRef); assert.equal(snapshot.id, prepared.snapshotId);
    evidence.snapshot = { ref: prepared.snapshotRef, id: prepared.snapshotId, rows: prepared.rows };
    assert.throws(() => app.store.update('dataset', 'factor-host-demo', { rows: [] }), { code: 'dataset_immutable' }, 'The host rejects mutation of the registered demo source');

    await advance('standalone Qlib compute and exact request replay');
    const computeInput = { requestId: 'host-compute', snapshotRef: prepared.snapshotRef, formulas, partition: 'development', budget, diagnostics: profile.diagnostics };
    const computed = await invoke('factor_compute', computeInput);
    assert.equal(computed.candidates.length, formulas.length); assert.ok(computed.candidates.every(item => item.status === 'ok' && item.computeKey));
    assert.equal((await factorRows()).items.length, 0, 'Computation does not evaluate or archive a factor');
    const beforeReplay = processRuns().length;
    assert.deepEqual(await invoke('factor_compute', computeInput), computed);
    assert.equal(processRuns().length, beforeReplay, 'Completed operation replay cannot launch another Python worker');
    const frozenValues = await readJSON(computed.valuesRef);
    assert.deepEqual(frozenValues.snapshotRef, prepared.snapshotRef);

    await advance('standalone evaluation and immutable duplicate evidence');
    const evaluated = await invoke('factor_evaluate', { requestId: 'host-evaluate', valuesRef: computed.valuesRef, profile, referenceValues: [], budget });
    assert.equal(evaluated.evaluations.length, 2); assert.equal(evaluated.factorIds.length, 2);
    assert.ok(evaluated.evaluations.every(item => item.status === 'ok' && Math.abs(item.value.rankIC.value) > 0.99));
    const libraryPage = await invoke('factor_library', { action: 'query', query: { kind: 'alpha', axis: 'time_series', minCoverage: 0.8 } });
    assert.equal(libraryPage.items.length, 2);
    const firstFactor = await invoke('factor_library', { action: 'read', factorId: evaluated.factorIds[0], limit: 100 });
    assert.equal(firstFactor.evaluations.items.length, 1);
    const repeated = await invoke('factor_evaluate', { requestId: 'host-evaluate-repeat', valuesRef: computed.valuesRef, profile, referenceValues: [], budget });
    assert.deepEqual(repeated, evaluated, 'Frozen numerical evidence has stable IDs and ArtifactRefs');
    assert.deepEqual((await invoke('factor_library', { action: 'read', factorId: firstFactor.factor.id, limit: 100 })).evaluations, firstFactor.evaluations);
    assert.equal((await own.state.query({ collection: 'factor_research_v1_pools', limit: 200 })).items.length, 0, 'Evaluation cannot select a strategy pool');

    await advance('explicit pool selection, annotation and external feedback preserve numerical evidence');
    const selected = await invoke('factor_pool', { action: 'decide', change: { operationId: 'host-select', poolId: 'demo-pool', strategyId: 'demo-strategy', expectedVersion: 0, decision: 'add', factorIds: [firstFactor.factor.id], replaces: [], purpose: 'Synthetic integration selection', reason: 'Explicit fixture strategy decision', strategyVersion: 'demo-v1', applicationEvidence: [] } });
    assert.deepEqual(selected.factorIds, [firstFactor.factor.id]);
    await invoke('factor_pool', { action: 'feedback', poolId: selected.id, strategyVersion: 'demo-v1', poolVersion: selected.version, applicationEvidence: [computed.valuesRef], note: 'External synthetic evidence only; no strategy execution.', operationId: 'host-feedback' });
    await invoke('factor_library', { action: 'annotate', factorId: firstFactor.factor.id, note: 'Synthetic fixture annotation', operationId: 'host-note' });
    assert.deepEqual((await invoke('factor_library', { action: 'read', factorId: firstFactor.factor.id, limit: 100 })).evaluations, firstFactor.evaluations);

    await advance('explicit reference Values are consumed without implicit computation');
    const referenceTarget = await invoke('factor_compute', { requestId: 'host-reference-target', snapshotRef: prepared.snapshotRef, formulas: [candidate('demo-mean', { call: 'Mean', args: [{ field: 'signal' }, { constant: 2 }] })], partition: 'development', budget });
    const beforeReference = workerRuns().length;
    const withReference = await invoke('factor_evaluate', { requestId: 'host-reference-evaluate', valuesRef: referenceTarget.valuesRef, profile, referenceValues: [computed.valuesRef], budget });
    assert.equal(workerRuns().length, beforeReference + 1, 'Reference evaluation launches only its evaluation worker');
    const referenced = withReference.evaluations[0].value;
    assert.equal(referenced.maxReferenceCorrelation.status, 'computed');
    const details = await readJSON(referenced.details); assert.deepEqual(details.referenceValues, [computed.valuesRef]);

    await advance('manual search batches use DEAP and Optuna with stored development feedback');
    const seed = { dsl: 'qlib-expr/1', tree: { call: 'Ref', args: [{ field: 'signal' }, { constant: 1 }] } };
    const searchInput = { action: 'open', requestId: 'host-search-open', snapshotRef: prepared.snapshotRef, need: 'Synthetic signal search for integration acceptance only', profile, references: [], budget: { ...budget, maxSeconds: 300, maxCandidates: 10, batchSize: 4, seed: 11 }, space: { fields: ['signal', 'close'], operators: ['Add', 'Sub', 'Mul', 'Abs', 'Mean', 'Ref'], windows: [2, 3], lags: [1], constants: [-1, 1], maxNodes: 12, maxDepth: 5, maxLookbackBars: 6, seeds: [seed], templates: [{ tree: { call: 'Mean', args: [{ field: 'signal' }, { parameter: 'window' }] }, domains: { window: [2, 3] } }] } };
    const opened = await invoke('factor_search', searchInput);
    assert.deepEqual(opened.candidates, []); assert.equal(opened.attempted, 0);
    const first = await invoke('factor_search', { action: 'propose', requestId: 'host-search-first', searchId: opened.searchId, limit: 2, feedback: [] });
    assert.equal(first.candidates.length, 2); assert.ok(first.checkpoint);
    const beforeRead = processRuns().length, beforeLibrary = (await factorRows()).items.length;
    const observation = await invoke('factor_search', { action: 'read', searchId: opened.searchId });
    assert.equal(observation.attempted, first.attempted); assert.deepEqual(observation.candidates, []);
    assert.equal(processRuns().length, beforeRead, 'Reading a search session cannot propose or compute');
    assert.equal((await factorRows()).items.length, beforeLibrary, 'Proposing cannot evaluate or archive factors');
    const searchCompute = await invoke('factor_compute', { requestId: 'host-search-compute', snapshotRef: prepared.snapshotRef, formulas: first.candidates, partition: 'development', budget, diagnostics: profile.diagnostics });
    const searchEvaluation = await invoke('factor_evaluate', { requestId: 'host-search-evaluate', valuesRef: searchCompute.valuesRef, profile, referenceValues: [], budget });
    const feedback = [];
    for (const factorId of searchEvaluation.factorIds) {
      const saved = await invoke('factor_library', { action: 'read', factorId, limit: 100 });
      const evaluation = saved.evaluations.items.find(value => searchEvaluation.evaluations.some(item => item.status === 'ok' && item.value.id === value.id));
      assert.ok(evaluation); feedback.push({ factorId, evaluationId: evaluation.id });
    }
    const nextInput = { action: 'propose', requestId: 'host-search-next', searchId: opened.searchId, limit: 4, feedback };
    const next = await invoke('factor_search', nextInput);
    assert.ok(next.attempted > first.attempted);
    const beforeSearchReplay = processRuns().length;
    assert.deepEqual(await invoke('factor_search', nextInput), next);
    assert.equal(processRuns().length, beforeSearchReplay, 'Propose request replay cannot consume attempts or feedback twice');
    const checkpoint = await readJSON(next.checkpoint);
    const methods = new Set(checkpoint.attempts.map(attempt => attempt.method));
    assert.ok(methods.has('deap') && methods.has('optuna'), json(checkpoint.attempts));
    assert.equal(checkpoint.feedback.filter(item => item.disposition === 'accepted').length, feedback.length);
    evidence.search = { searchId: opened.searchId, first, next, methods: [...methods], checkpoint: next.checkpoint };

    await advance('holdout evaluation is explicitly chosen and cannot become search feedback');
    const holdout = await invoke('factor_compute', { requestId: 'host-holdout-compute', snapshotRef: prepared.snapshotRef, formulas: first.candidates.slice(0, 1), partition: 'holdout', budget });
    const holdoutEvaluation = await invoke('factor_evaluate', { requestId: 'host-holdout-evaluate', valuesRef: holdout.valuesRef, profile, referenceValues: [], budget });
    assert.equal(holdoutEvaluation.partition, 'holdout');
    const held = holdoutEvaluation.evaluations.find(item => item.status === 'ok'); assert.ok(held);
    const beforeInvalid = processRuns().length;
    await rejectOperation('factor_search', { action: 'propose', requestId: 'host-holdout-feedback', searchId: opened.searchId, limit: 0, feedback: [{ factorId: holdoutEvaluation.factorIds[0], evaluationId: held.value.id }] }, /holdout|development|EVIDENCE_MISMATCH/i);
    assert.equal(processRuns().length, beforeInvalid, 'Rejected feedback cannot invoke a worker');
    assert.equal((await invoke('factor_search', { action: 'read', searchId: opened.searchId })).attempted, next.attempted);
    assert.deepEqual((await invoke('factor_pool', { action: 'read', poolId: selected.id })).factorIds, selected.factorIds);

    await advance('safe native checkpoint recovery reuses the completed worker receipt');
    const stopAfterWorker = async (name, input, control) => {
      let stoppedChild;
      const listener = event => {
        if (stoppedChild || event.type !== 'run.updated' || event.data.capabilityId !== 'host.process.exec' || event.data.status !== 'completed' || !isWorker(event.data)) return;
        const parent = app.store.get('run', event.data.parentRunId);
        if (parent?.capabilityId !== `${pluginId}#${name}`) return;
        stoppedChild = event.data.id;
        main.runs[control]({ id: parent.id }, { reason: `Synthetic ${control} after a completed worker, before publication` });
      };
      app.store.on('event', listener);
      let accepted, run;
      try { accepted = await admit(name, input); assert.equal(accepted.type, 'run'); run = await wait(accepted); }
      finally { app.store.off('event', listener); }
      assert.ok(stoppedChild, 'The real numerical worker reached a retained receipt');
      assert.equal(run.status, control === 'cancel' ? 'cancelled' : 'interrupted', json(run));
      assert.equal(app.store.get('run', stoppedChild).status, 'completed');
      return { accepted, run, stoppedChild };
    };
    const resumableInput = { requestId: 'host-safe-resume', snapshotRef: prepared.snapshotRef, formulas: [candidate('safe-resume', { call: 'Ref', args: [{ field: 'signal' }, { constant: 2 }] })], partition: 'development', budget };
    const paused = await stopAfterWorker('factor_compute', resumableInput, 'interrupt');
    const beforeResume = workerRuns().length;
    const resume = await main.runs.resume(paused.accepted.run, { interruptIds: paused.run.interrupts.filter(item => !item.resolvedAt).map(item => item.id), operationId: 'host-safe-resume-control' });
    assert.equal(resume.run.id, paused.run.id);
    const recovered = await wait(paused.accepted);
    assert.equal(recovered.status, 'completed', json(recovered)); assert.equal(recovered.attempt, 2);
    assert.equal(workerRuns().length, beforeResume, 'Safe resume consumes the verified receipt without repeating Qlib');
    assert.equal(recovered.output.candidates[0].status, 'ok');
    evidence.safeResume = { runId: recovered.id, attempt: recovered.attempt, retainedChild: paused.stoppedChild, valuesRef: recovered.output.valuesRef, numericalWorkersBefore: beforeResume, numericalWorkersAfter: workerRuns().length };

    await advance('native cancel prevents evaluation archive; explicit resubmission reconciles its receipt');
    const cancellationInput = { requestId: 'host-cancel-reconcile', valuesRef: recovered.output.valuesRef, profile: { ...profile, id: 'host-cancelled-evaluation' }, referenceValues: [], budget };
    const beforeCancelledRecords = (await own.state.query({ collection: 'factor_research_v1_evaluations', limit: 200 })).items;
    const cancelled = await stopAfterWorker('factor_evaluate', cancellationInput, 'cancel');
    assert.deepEqual((await own.state.query({ collection: 'factor_research_v1_evaluations', limit: 200 })).items, beforeCancelledRecords, 'Cancelled operation cannot archive late evaluation records');
    const beforeReconcile = workerRuns().length;
    const reconciled = await invoke('factor_evaluate', cancellationInput);
    assert.equal(reconciled.evaluations[0].status, 'ok');
    assert.equal(workerRuns().length, beforeReconcile, 'Explicit same-request submission reuses the complete immutable worker receipt');
    const newRun = evidence.operations.at(-1).runId;
    assert.notEqual(newRun, cancelled.run.id, 'Cancelled native Runs are terminal; reconciliation uses a new explicit Run');
    assert.equal((await main.runs.read(cancelled.accepted.run)).run.status, 'cancelled');
    evidence.cancelReconciliation = { cancelledRunId: cancelled.run.id, newRunId: newRun, retainedChild: cancelled.stoppedChild, evaluationId: reconciled.evaluations[0].value.id, numericalWorkersBefore: beforeReconcile, numericalWorkersAfter: workerRuns().length };

    const runs = app.store.list('run');
    assert.ok(processRuns().length >= 10); assert.ok(processRuns().every(run => run.status === 'completed'));
    assert.ok(!runs.some(run => run.kind === 'workflow' || /factor_(workflow|research|measure|job)|reports[.#]/.test(run.capabilityId)), 'No hidden controller, report publication or report rendering');
    assert.equal(app.requests.length, 0);
    evidence.processRuns = processRuns().map(run => ({ id: run.id, status: run.status, parentRunId: run.parentRunId, numerical: Boolean(isWorker(run)) }));
    evidence.completed = true; await advance('verified explicit pipeline');
  } catch (error) {
    primaryError = error; evidence.failedStage = stage; evidence.error = { message: error.message, stack: error.stack };
    if (app) {
      evidence.runs = app.store.list('run').map(run => ({ id: run.id, capability: run.capabilityId, status: run.status, error: run.error, output: run.output }));
      evidence.operationsState = app.store.list(`plugin:${pluginId}:v2-state/factor_research_v1_jobs`);
      evidence.searchState = app.store.list(`plugin:${pluginId}:v2-state/factor_research_v1_searches`);
    }
    t.diagnostic(json({ stage, error: error.message, runs: evidence.runs?.map(({ id, capability, status, error }) => ({ id, capability, status, error })) })); throw error;
  } finally {
    evidence.modelCalls = app?.requests.length ?? 0;
    await writeFile(join(ownedRoot, 'agent-directed-host-evidence.json'), json(evidence));
    if (app) {
      const child = relative(ownedRoot, await realpath(app.directory)); assert.ok(!child.startsWith('..') && !isAbsolute(child));
      try { await app.dispose(); } catch (error) { if (!primaryError) throw error; t.diagnostic(`Cleanup after failure: ${error.message}`); }
    }
    if (oldTemp === undefined) delete process.env.TEMP; else process.env.TEMP = oldTemp;
    if (oldTmp === undefined) delete process.env.TMP; else process.env.TMP = oldTmp;
  }
});
