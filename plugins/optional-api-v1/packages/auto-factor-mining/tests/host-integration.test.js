// Opt-in real host/SQLite/process/Qlib/Electron integration. Every input is demo data.
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
const budget = { maxCandidates: 2, batchSize: 2, maxWorkers: 2, maxSeconds: 180, maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, seed: 11 };
const candidate = (id, tree) => ({ id, formula: { dsl: 'qlib-expr/1', tree }, hypothesis: 'Synthetic deterministic signal; not market evidence.', origin: { method: 'seed', parents: [], parameters: {} } });
const formulas = [candidate('demo-signal', { field: 'signal' }), candidate('demo-negative', { call: 'Mul', args: [{ field: 'signal' }, { constant: -1 }] })];

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

test('production host runs factor computation, evaluation, search, library/pool and checked reports', { skip: !hostRoot || !pythonPath || !scratch, timeout: 600000 }, async t => {
  await mkdir(scratch, { recursive: true });
  const ownedRoot = await realpath(scratch), oldTemp = process.env.TEMP, oldTmp = process.env.TMP;
  assert.equal(resolve(ownedRoot).slice(0, 2).toUpperCase(), 'E:', 'Use the explicit isolated E: fixture root');
  process.env.TEMP = ownedRoot; process.env.TMP = ownedRoot;
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const [{ fixture }, { createTools }, { createHostContextV2 }] = await Promise.all([load('tests/fixture-provider.js'), load('modules/agent/tools.js'), load('modules/plugins/host-v2/context.js')]);
  let app, stage = 'host startup', primaryError, sequence = 0;
  const evidence = { synthetic: true, brokerCalls: 0, modelCalls: 0, stages: [], jobs: [] };
  const advance = async value => { stage = value; evidence.stages.push(value); await writeFile(join(ownedRoot, 'current-host-stage.json'), JSON.stringify({ stage, at: new Date().toISOString() })); t.diagnostic(`factor host stage: ${value}`); };
  try {
    app = await fixture({ configured: false, reportRenderer: 'electron', responseHandler: () => { throw new Error('Factor research must not invoke a model transport'); } });
    const child = relative(ownedRoot, await realpath(app.directory)); assert.ok(!child.startsWith('..') && !isAbsolute(child));
    await advance('production package installation');
    const install = async (source, name) => {
      const draft = join(app.runtime.workspaces.root('conv_main'), `${name}-draft`);
      await cp(source, draft, { recursive: true, filter: path => !path.split(/[\\/]/).includes('__pycache__') && !/\.py[co]$/.test(path) });
      const checked = await app.runtime.plugins.manager.test('conv_main', { path: draft });
      assert.equal(checked.passed, true, JSON.stringify(checked));
      const previous = app.runtime.plugins.entries.get(checked.id);
      const installed = previous?.digest === checked.digest ? previous : await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest, ...(previous ? { expected_digest: previous.digest } : {}) }, Boolean(previous));
      assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
      app.runtime.plugins.activate('conv_main', installed.id); return installed;
    };
    // The host's cached default bundle can predate its report-service API.
    // Install the current production provider into this disposable fixture too.
    const reports = await install(resolve(packageRoot, '../../../api-v1/packages/reports'), 'reports');
    const installed = await install(packageRoot, 'factor-research');
    evidence.packages = { reports: { id: reports.id, digest: reports.digest }, factor: { id: installed.id, digest: installed.digest } };
    const entry = app.runtime.plugins.entry(pluginId), host = createHostContextV2(app.runtime, entry, 'conv_main'), main = createHostContextV2(app.runtime, app.runtime.capabilities.hostEntry, 'conv_main');
    const settle = async accepted => {
      if (accepted.type === 'result') return accepted.value;
      assert.equal(accepted.type, 'run'); let result;
      do { result = await main.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000 }); } while (result.reason === 'timeout');
      assert.equal(result.run.status, 'completed', JSON.stringify(result.run.error)); return result.run.output;
    };
    const invoke = async (name, input = {}) => {
      const tool = createTools(app.runtime, 'conv_main').find(tool => tool.name === name); assert.ok(tool, `Missing public tool ${name}`);
      const result = await tool.execute(`factor-host-${++sequence}`, input);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const value = result.details ?? JSON.parse(result.content[0].text);
      return value?.type === 'run' || value?.type === 'result' ? settle(value) : value;
    };
    const names = createTools(app.runtime, 'conv_main').map(tool => tool.name);
    assert.deepEqual(names.filter(name => name.startsWith('factor_')).sort(), ['factor_environment', 'factor_job', 'factor_library', 'factor_measure', 'factor_pool', 'factor_research']);
    assert.ok(!names.includes('auto_factor_start') && !names.includes('factor_evaluate'));

    await advance('real Python environment and host-only configuration');
    const environment = await invoke('factor_environment', { action: 'inspect', pythonPath });
    assert.equal(environment.ready, true, JSON.stringify(environment));
    assert.equal(environment.versions.pyqlib, '0.9.7');
    assert.ok(environment.versions.deap && environment.versions.optuna);
    const configurationPath = `/settings/integrations?plugin_id=${encodeURIComponent(pluginId)}`;
    const configured = await app.api('/settings/integrations', { plugin_id: pluginId, values: { pythonPath } }, 'synthetic-host-python');
    assert.equal(configured.response.status, 200, JSON.stringify(configured.data));
    assert.equal(configured.data.status, 'applied');
    const configuration = await app.api(configurationPath);
    assert.equal(configuration.response.status, 200, JSON.stringify(configuration.data));
    const pythonField = configuration.data.items[0].fields.find(field => field.id === 'pythonPath');
    assert.equal(pythonField.configured, true); assert.equal(resolve(pythonField.value), resolve(pythonPath));
    const repeatedConfiguration = await app.api('/settings/integrations', { plugin_id: pluginId, values: { pythonPath } }, 'synthetic-host-python');
    assert.deepEqual(repeatedConfiguration.data, configured.data);
    evidence.configuration = { status: configured.data.status, configured: pythonField.configured };
    evidence.environment = environment;

    app.store.put('dataset', { id: 'factor-host-demo', title: 'Invented deterministic panel for host acceptance only', rows: syntheticRows(), provenance: { kind: 'demo', source_kind: 'synthetic' } });
    const finish = async job => {
      assert.ok(job.runId);
      const deadline = Date.now() + 240000;
      for (;;) {
        const read = await invoke('factor_job', { action: 'read', jobId: job.id });
        const native = (await host.runs.read(job.runId)).run;
        if (['failed', 'interrupted', 'cancelled'].includes(read.status)) assert.fail(JSON.stringify({ job: read, native }));
        if (read.reportStatus === 'failed' && ['completed', 'interrupted', 'failed'].includes(native.status)) assert.fail(JSON.stringify({ job: read, native }));
        if (read.status === 'completed' && read.reportStatus === 'published' && native.status === 'completed') {
          assert.ok(read.report); evidence.jobs.push({ id: read.id, runId: read.runId, proposed: read.proposed, completed: read.completed, report: read.report }); return read;
        }
        assert.ok(Date.now() < deadline, JSON.stringify({ timeout: read, native }));
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    };
    const rendered = async job => {
      const manifest = await host.resources.read(job.report, { part: 'manifest' }); assert.equal(manifest.kind, 'report');
      assert.equal(manifest.content.provenance.kind, 'demo');
      const receipts = await host.resources.read(job.report, { part: 'receipts' });
      assert.ok(receipts.items.some(receipt => receipt.renderer?.name === 'sesame-report-inspector' && receipt.status === 'rendered'));
      const html = await host.resources.read(job.report, { part: 'content', entry: manifest.content.entry, encoding: 'utf8' }); assert.match(html.content, /<!doctype html>/i);
      (evidence.reports ??= []).push({ ref: job.report, manifest, receipts: receipts.items });
    };
    const readJSON = async ref => {
      const manifest = await host.resources.read(ref, { part: 'manifest' });
      const part = await host.resources.read(ref, { part: 'content', entry: manifest.content.path, encoding: 'utf8' });
      assert.equal(part.nextOffset, undefined, 'Synthetic identity documents fit one page'); return JSON.parse(part.content);
    };

    await advance('compute-only through real host process and artifact publication');
    const computed = await finish(await invoke('factor_measure', { mode: 'compute', requestId: 'host-compute', source: { datasetId: 'factor-host-demo' }, layout, formulas, budget }));
    assert.ok(computed.valuesRef ?? computed.evidence.items[0]);
    const valuesRef = computed.valuesRef ?? computed.evidence.items[0];
    const valuesManifest = await host.resources.read(valuesRef, { part: 'manifest' }); assert.equal(valuesManifest.content.schema, 'factor-values/1');
    await rendered(computed);

    await advance('evaluate-only and immutable identical re-evaluation');
    const evaluated = await finish(await invoke('factor_measure', { mode: 'evaluate', requestId: 'host-evaluate', valuesRef, profile, references: [], budget }));
    await rendered(evaluated);
    const libraryPage = await invoke('factor_library', { action: 'query', query: { kind: 'alpha', axis: 'time_series', minCoverage: 0.8 } });
    assert.equal(libraryPage.items.length, 2);
    const firstFactor = await invoke('factor_library', { action: 'read', factorId: libraryPage.items[0].id, limit: 100 });
    assert.equal(firstFactor.evaluations.items.length, 1);
    assert.ok(Math.abs(firstFactor.evaluations.items[0].rankIC.value) > 0.99);
    const repeated = await finish(await invoke('factor_measure', { mode: 'evaluate', requestId: 'host-evaluate-repeat', valuesRef, profile, references: [], budget }));
    await rendered(repeated);
    const afterRepeat = await invoke('factor_library', { action: 'read', factorId: firstFactor.factor.id, limit: 100 });
    assert.deepEqual(afterRepeat.evaluations, firstFactor.evaluations, 'Repeated frozen evidence should reuse its immutable evaluation identity');

    await advance('library-first reuse of exact frozen source evidence');
    const frozenValues = await readJSON(valuesRef), frozenSnapshot = await readJSON(frozenValues.snapshotRef);
    const workflowsBefore = app.store.list('run').filter(run => run.capabilityId === `${pluginId}#factor_workflow`).length;
    const reused = await invoke('factor_research', { draft: { requestId: 'host-reuse', need: 'Reuse exact synthetic evidence', source: { ref: frozenSnapshot.source }, layout, profile, references: [], budget, space: { fields: ['signal', 'close', 'volume'], operators: ['Mul'], windows: [2], lags: [1], constants: [-1], maxNodes: 12, maxDepth: 5, maxLookbackBars: 6, seeds: [firstFactor.factor.formula], templates: [] } } });
    assert.equal(reused.resolution, 'reuse'); assert.equal(reused.factors[0].id, firstFactor.factor.id);
    assert.equal(app.store.list('run').filter(run => run.capabilityId === `${pluginId}#factor_workflow`).length, workflowsBefore);

    await advance('explicit pool selection and external application feedback');
    assert.equal((await host.state.query({ collection: 'factor_research_v1_pools', limit: 200 })).items.length, 0, 'Research/evaluation cannot change a strategy pool');
    const selected = await invoke('factor_pool', { action: 'decide', change: { operationId: 'host-select', poolId: 'demo-pool', strategyId: 'demo-strategy', expectedVersion: 0, decision: 'add', factorIds: [firstFactor.factor.id], replaces: [], purpose: 'Synthetic integration selection', reason: 'Explicit fixture strategy decision', strategyVersion: 'demo-v1', applicationEvidence: [] } });
    assert.deepEqual(selected.factorIds, [firstFactor.factor.id]);
    await invoke('factor_pool', { action: 'feedback', poolId: selected.id, strategyVersion: 'demo-v1', poolVersion: selected.version, applicationEvidence: [evaluated.report], note: 'External synthetic evidence only; no strategy execution.', operationId: 'host-feedback' });
    assert.deepEqual((await invoke('factor_library', { action: 'read', factorId: firstFactor.factor.id, limit: 100 })).evaluations, firstFactor.evaluations);

    await advance('combined compute/evaluate mode with immutable reference evidence');
    const combined = await finish(await invoke('factor_measure', { mode: 'both', requestId: 'host-both', source: { datasetId: 'factor-host-demo' }, layout, formulas: [candidate('demo-mean', { call: 'Mean', args: [{ field: 'signal' }, { constant: 2 }] })], profile, references: [firstFactor.factor.id], budget }));
    await rendered(combined);

    await advance('real search plus frozen holdout');
    const seed = { dsl: 'qlib-expr/1', tree: { call: 'Ref', args: [{ field: 'signal' }, { constant: 1 }] } };
    const searchDraft = { requestId: 'host-research', need: 'Synthetic signal search for integration acceptance only', source: { datasetId: 'factor-host-demo' }, layout, profile, references: [], budget: { ...budget, maxCandidates: 4 }, space: { fields: ['signal', 'close'], operators: ['Add', 'Sub', 'Mul', 'Abs', 'Mean', 'Ref'], windows: [2, 3], lags: [1], constants: [-1, 1], maxNodes: 12, maxDepth: 5, maxLookbackBars: 6, seeds: [seed], templates: [{ tree: { call: 'Mean', args: [{ field: 'signal' }, { parameter: 'window' }] }, domains: { window: [2, 3] } }] } };
    const searched = await invoke('factor_research', { draft: searchDraft });
    assert.equal(searched.resolution, 'research');
    const researched = await finish(searched.job); await rendered(researched);
    const trials = await host.state.query({ collection: 'factor_research_v1_trials', filter: { jobId: researched.id, kind: 'candidate' }, limit: 200 });
    assert.ok(trials.items.some(row => row.value.holdout?.status === 'evaluated'));
    assert.deepEqual((await invoke('factor_pool', { action: 'read', poolId: selected.id })).factorIds, selected.factorIds);

    await advance('report failure resumes the same native task without repeating numerical work');
    let stopped, originalRun;
    await app.runtime.plugins.configure('sesame/reports', 'disabled', app.runtime.plugins.policy().version);
    try {
      const pending = await invoke('factor_measure', { mode: 'compute', requestId: 'host-report-retry', source: { datasetId: 'factor-host-demo' }, layout, formulas, budget });
      const deadline = Date.now() + 120000;
      for (;;) {
        stopped = await invoke('factor_job', { action: 'read', jobId: pending.id });
        originalRun = (await host.runs.read(pending.runId)).run;
        if (stopped.reportStatus === 'failed' && originalRun.status === 'interrupted') break;
        assert.ok(!['failed', 'completed', 'cancelled'].includes(originalRun.status), JSON.stringify({ job: stopped, native: originalRun }));
        assert.ok(Date.now() < deadline, JSON.stringify({ timeout: stopped, native: originalRun }));
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      assert.equal(stopped.completed, formulas.length); assert.ok(stopped.valuesRef);
      assert.equal(stopped.status, 'interrupted'); assert.equal(stopped.report, null);
    } finally {
      await app.runtime.plugins.configure('sesame/reports', 'mounted', app.runtime.plugins.policy().version);
    }
    const processCount = app.store.list('run').filter(run => run.capabilityId === 'host.process.exec').length;
    const bindingIdentity = sessionId => {
      const bound = app.runtime.reportLibrary.boundTarget(sessionId);
      return bound && { reportId: bound.reportId, fileId: bound.fileId, space: bound.space, path: bound.path };
    };
    const binding = bindingIdentity(originalRun.executionSessionId);
    assert.ok(binding?.fileId);
    const retry = await invoke('factor_job', { action: 'report', jobId: stopped.id });
    assert.equal(retry.runId, originalRun.id);
    const recovered = await finish(retry); await rendered(recovered);
    assert.deepEqual(recovered.valuesRef, stopped.valuesRef);
    assert.equal(app.store.list('run').filter(run => run.capabilityId === 'host.process.exec').length, processCount, 'A report retry cannot launch another numerical worker');
    const resumed = (await host.runs.read(originalRun.id)).run;
    assert.equal(resumed.executionSessionId, originalRun.executionSessionId);
    assert.deepEqual(bindingIdentity(resumed.executionSessionId), binding);
    evidence.reportRecovery = { runId: resumed.id, attempt: resumed.attempt, processCountBefore: processCount, processCountAfter: processCount, binding, valuesRef: recovered.valuesRef, report: recovered.report };

    const processes = app.store.list('run').filter(run => run.capabilityId === 'host.process.exec');
    assert.ok(processes.length >= 8); assert.ok(processes.every(run => run.status === 'completed'));
    assert.equal(app.requests.length, 0, 'The factor workflow uses numerical workers, not model calls');
    evidence.processRuns = processes.map(run => ({ id: run.id, status: run.status, parentRunId: run.parentRunId }));
    evidence.completed = true; await advance('verified complete');
  } catch (error) {
    primaryError = error; evidence.failedStage = stage; evidence.error = { message: error.message, stack: error.stack };
    if (app) {
      evidence.runs = app.store.list('run').map(run => ({ id: run.id, capability: run.capabilityId, status: run.status, error: run.error, output: run.output }));
      evidence.jobState = app.store.list(`plugin:${pluginId}:v2-state/factor_research_v1_jobs`);
      evidence.trialState = app.store.list(`plugin:${pluginId}:v2-state/factor_research_v1_trials`);
    }
    t.diagnostic(JSON.stringify({ stage, error: error.message, runs: evidence.runs?.map(({ id, capability, status, error }) => ({ id, capability, status, error })) })); throw error;
  } finally {
    evidence.modelCalls = app?.requests.length ?? 0;
    await writeFile(join(ownedRoot, 'latest-host-evidence.json'), JSON.stringify(evidence, null, 2));
    if (app) {
      const child = relative(ownedRoot, await realpath(app.directory)); assert.ok(!child.startsWith('..') && !isAbsolute(child));
      try { await app.dispose(); } catch (error) { if (!primaryError) throw error; t.diagnostic(`Cleanup after failure: ${error.message}`); }
    }
    if (oldTemp === undefined) delete process.env.TEMP; else process.env.TEMP = oldTemp;
    if (oldTmp === undefined) delete process.env.TMP; else process.env.TMP = oldTmp;
  }
});
