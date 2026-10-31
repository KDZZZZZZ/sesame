// Real Store/Runtime/API2 install, one actual Agent conversation and real evaluator.
// Model replies and market rows are explicit local fixtures; no real provider or broker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const hostRoot = process.env.SESAME_HOST_ROOT;
const outputDirectory = process.env.SESAME_FACTOR_SINGLE_RECEIPT_DIR;
const nativePython = process.env.SESAME_FACTOR_NATIVE_PYTHON;
const conditional = { valid_when: ['Only the explicit synthetic regime in this fixture'], invalid_when: ['Real market generalization has not been established'], evidence: ['Actual evaluator candidate receipt'], limitations: ['Synthetic software test only'], monitor: ['Frozen input/source identities'], stop_when: ['Data identities or regime assumptions change'], counterexamples: [] };
const pluginId = 'sesame/auto-factor-mining';
const text = content => typeof content === 'string' ? content : (content ?? []).map(part => part.text ?? '').join('');
const day = n => `2025-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;
const dataset = { trainEnd: day(6), validationEnd: day(12), holdoutEnd: day(18), horizon: 1, costBps: 10, quantile: .25 };
let sequence = 0;
function reply(response, model, content, call) {
  const chunk = (delta, reason) => JSON.stringify({ id: 'factor-single-fixture', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: reason }] });
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: `single_${++sequence}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { role: 'assistant', content };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, call ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
}
function task(body) {
  for (const message of body.messages.filter(m => m.role === 'user').toReversed()) { const value = text(message.content), marker = '\n\nInput JSON:\n', at = value.lastIndexOf(marker); if (at >= 0) return JSON.parse(value.slice(at + marker.length)); }
}
function outputs(body) {
  const calls = new Map(body.messages.flatMap(m => m.tool_calls ?? []).map(call => [call.id, call.function.name]));
  return body.messages.filter(m => m.role === 'tool').map(message => ({ name: calls.get(message.tool_call_id), value: JSON.parse(text(message.content)) }));
}

test('installed single mode uses one native Agent Run, real factor evaluator, hidden holdout and an actually rendered Strategy report', { skip: !hostRoot, timeout: 120000 }, async t => {
  const load = p => import(pathToFileURL(join(hostRoot, p)).href);
  // The common fixture uses Electron only after these checks. No installer is run.
  const executable = (await readFile(join(hostRoot, 'node_modules/electron/path.txt'), 'utf8')).trim();
  assert.ok((await stat(join(hostRoot, 'node_modules/electron/dist', executable))).isFile(), 'Existing Electron required; no download in this test');
  process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,localhost,::1';
  const { fixture, eventually } = await load('tests/fixture-provider.js');
  const { createTools } = await load('modules/agent/tools.js');
  const failures = [], assignments = new Set(), modes = new Set(); let fixtureCalls = 0, dataRead = false;
  const app = await fixture({ reportRenderer: 'electron', responseHandler: (body, response) => {
    try {
      const input = task(body); if (!input?.runId) { reply(response, body.model, 'Local fixture ready'); return true; }
      fixtureCalls++; assert.equal(input.mode, 'single'); assignments.add(input.assignmentId);
      const prompt = JSON.stringify(body.messages); assert.ok(prompt.includes('预期交易平台的原生引擎')); assert.ok(prompt.includes('自带参数搜索或优化器'));
      const names = body.tools.map(tool => tool.function.name);
      assert.ok(names.includes('auto_factor_context') && names.includes('auto_factor_submit'));
      assert.equal(names.includes('factor_evaluate'), false); assert.equal(names.includes('host_agent_run'), false); assert.equal(names.includes('backtrader_backtest'), false); assert.equal(names.includes('backtrader_optimize'), false);
      const returned = outputs(body), last = returned.at(-1);
      const call = (name, args = {}) => reply(response, body.model, null, { name, arguments: { run_id: input.runId, ...args } });
      if (!last || last.name === 'auto_factor_submit') { call('auto_factor_context', { section: 'team', limit: 100 }); return true; }
      const context = last.value; assert.equal(context.assignment.executionMode, 'single');
      assert.equal(context.config.evaluator.arguments, undefined); assert.equal(context.data.inputRefs, undefined); assert.equal(context.data.sourceId, undefined);
      if (nativePython) { assert.equal(context.config.nativeValidation.development, undefined); assert.equal(context.config.nativeValidation.holdout, undefined); assert.equal(context.config.nativeValidation.strategy, undefined); }
      if (context.assignment.complete) { reply(response, body.model, '全部阶段已固定；结束此 Agent，由原生工作流最终验证与归档。'); return true; }
      const mode = context.assignment.mode; modes.add(mode);
      if (mode === 'code' && !dataRead) { dataRead = true; call('auto_factor_context', { section: 'data', limit: 100 }); return true; }
      if (context.rows) { assert.equal(context.rows.total, 48); assert.ok(context.rows.items.every(row => row.time <= dataset.validationEnd)); }
      if (mode === 'review') { assert.equal(context.trial.metrics.validation.rankIC, 1); assert.equal(context.trial.metrics.holdout, undefined); }
      const output = { plan: { directions: context.config.directions, stop: false, reason: 'One fixed software-fixture direction' },
        hypothesis: { hypothesis: 'Synthetic preknown ordering', rationale: 'Only a software fixture; actual evaluator must measure it' },
        code: { candidate: { op: 'field', name: 'feature' }, explanation: 'Fixed field AST; not model-supplied metrics' },
        review: { verdict: nativePython ? 'conditional' : 'accept', reason: 'Actual development evidence, limited to the synthetic scenario; not market profitability', ...(nativePython ? { applicability: conditional } : {}) },
        reflection: { summary: 'Synthetic evidence retained; no real strategy backtest performed', lessons: ['Use the intended native engine for subsequent trading rules'], stop: false },
        selection: { trialIds: (context.trials?.items ?? []).filter(row => row.status === 'accepted').map(row => row.id), reason: 'Freeze before holdout exposure', ...(nativePython ? { applicability: conditional } : {}) } }[mode];
      call('auto_factor_submit', { step_id: context.assignment.step_id, output }); return true;
    } catch (error) { failures.push(error.message); reply(response, body.model, 'Fixture assertion failed; stop.'); return true; }
  } });
  try {
    for (const name of ['factor-evaluator', 'auto-factor-mining', ...(nativePython ? ['backtrader'] : [])]) {
      const draft = join(app.runtime.workspaces.root('conv_main'), name + '-single-draft');
      await cp(fileURLToPath(new URL(`../packages/${name}/`, import.meta.url)), draft, { recursive: true });
      const checked = await app.runtime.plugins.manager.test('conv_main', { path: draft }); assert.equal(checked.passed, true, JSON.stringify(checked));
      const installed = await app.runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest }); assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
    }
    app.runtime.plugins.activate('conv_main', pluginId);
    const invoke = async (name, args = {}) => {
      const tool = createTools(app.runtime, 'conv_main').find(item => item.name === name); assert.ok(tool);
      const result = await tool.execute(`single-host-${++sequence}`, args); assert.ok(!result.isError && !result.details?.isError, JSON.stringify(result.details));
      if (result.details?.type !== 'run') return result.details;
      const done = await app.runtime.runs.wait(result.details.run.id, { timeoutMs: 30000 }); assert.equal(done.run.status, 'completed', JSON.stringify(done.run.error)); return done.run.output;
    };
    const rows = Array.from({ length: 18 }, (_, d) => Array.from({ length: 4 }, (_, i) => ({ time: day(d + 1), availableAt: day(d + 1), symbol: `SYNTHETIC_${i}`, fields: { close: 100 * (1 + (i + 1) * .005) ** d, feature: i + 1 } }))).flat();
    app.store.put('dataset', { id: 'single-synthetic', title: 'Explicit fictional software test data', rows, provenance: { kind: 'demo', source_kind: 'synthetic' } });
    let nativeValidation;
    if (nativePython) {
      const sourcePath = join(app.runtime.workspaces.root('conv_main'), 'native-roundtrip.py');
      await cp(fileURLToPath(new URL('../packages/auto-factor-mining/examples/native-roundtrip.py', import.meta.url)), sourcePath);
      const fixed = (id, begin) => {
        const bars = Array.from({ length: 8 }, (_, i) => ({ datetime: day(begin + i), open: String(100 + i), high: String(102 + i), low: String(99 + i), close: String(101 + i), volume: '100' }));
        const data = app.runtime.contractArtifacts;
        return data.publish({ id: 'fixture/native-bars', version: '1.0.0', digest: `sha256:${'c'.repeat(64)}` }, { operationId: id, manifest: { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: bars.length, columns: Object.keys(bars[0]), provenance: { kind: 'demo' } }, dependencies: [], blobs: [{ path: 'rows.json', mediaType: 'application/json', ...data.blob(JSON.stringify(bars)) }] } });
      };
      nativeValidation = { engine: 'backtrader', reason: 'Explicit isolated engine integration; synthetic cash strategy, not MT5 equivalence', strategy: { path: sourcePath, className: 'RoundTrip' }, development: { data: fixed('native-development', 1), start: day(1), end: day(9) }, holdout: { data: fixed('native-holdout', 9), start: day(9), end: day(17) }, config: { capital: '10000', commission: '0.001', slippage: '0', feed: { timeframe: 'days', compression: 1 } }, search: { mode: 'auto', parameterSpace: { exit_bar: [3, 5, 7] }, objective: { metric: 'finalEquity', direction: 'max' } }, environment: { pythonPath: nativePython } };
    }
    const model = (await invoke('auto_factor_models')).models.find(item => item.id === 'fixture');
    const startRequest = { request_id: 'single-native-fixture', title: '单 Agent 因子与策略研究 · 合成验收', goal: 'Test a genuine single Agent and independent evaluation; not a trading result', dataset_id: 'single-synthetic', config: { executionMode: 'single', model, rounds: 1, maxTrials: 1, directions: ['synthetic ordering'], evaluator: { plugin_id: 'sesame/factor-evaluator', tool: 'factor_evaluate', arguments: { dataset } }, strategyValidation: { intendedPlatform: 'MT5', requestedEngine: 'MT5 Strategy Tester', dataSource: 'Synthetic fixture only', notes: 'Request future real-engine validation; not performed here' }, ...(nativeValidation ? { nativeValidation } : {}) } };
    const started = await invoke('auto_factor_start', startRequest);
    if (nativeValidation) await writeFile(nativeValidation.strategy.path, '# source changed after start; frozen original must be used\n');
    const done = await eventually(async () => {
      assert.deepEqual(failures, []); const value = await invoke('auto_factor_runs', { action: 'read', run_id: started.id });
      assert.notEqual(value.status, 'interrupted', JSON.stringify({ error: value.error, reportError: value.reportError }));
      return value.status === 'completed' && value.report && app.runtime.runs.read(value.workflow.id).status === 'completed' ? value : false;
    }, 90000);
    const agents = app.runtime.runs.descendants(done.workflow.id).filter(run => run.kind === 'agent');
    assert.equal(agents.length, 1); assert.equal(assignments.size, 1); assert.equal(done.tasks.length, 1);
    assert.deepEqual([...modes], ['plan', 'hypothesis', 'code', 'review', 'reflection', 'selection']);
    assert.equal(done.single.steps.length, 6); assert.equal(done.trials[0].metrics.validation.rankIC, 1); assert.equal(done.finalEvaluation.holdoutStatus, 'evaluated');
    assert.equal(done.finalEvaluation.selectionDigest, done.selection.digest); assert.equal(done.strategyValidation.status, 'not-executed-by-workflow');
    if (nativeValidation) {
      assert.equal(done.nativeValidation.status, 'completed', JSON.stringify({ error: done.nativeValidation.error, environment: done.nativeValidation.environment, attempts: done.nativeValidation.attempts.map(a => ({ status: a.status, error: a.error })), processes: app.runtime.runs.descendants(done.workflow.id).filter(run => run.capabilityId === 'host.process.exec').map(run => ({ status: run.status, error: run.error, output: run.output })) }));
      assert.equal(done.nativeValidation.development.passes.length, 3); assert.equal(done.nativeValidation.selection.parameters.exit_bar, 7);
      assert.equal(done.nativeValidation.holdout.status, 'completed'); assert.equal(done.nativeValidation.holdout.statistics.closedTrades, 1);
      assert.equal(done.nativeValidation.attempts.length, 2); assert.ok(done.nativeValidation.startedAt >= done.tasks[0].finishedAt);
      assert.equal(done.nativeValidation.holdout.selectionDigest, done.nativeValidation.selection.digest);
      assert.deepEqual(done.trials[0].applicability, conditional); assert.deepEqual(done.selection.applicability, conditional);
      assert.equal(done.trials[0].review.verdict, 'conditional'); assert.equal(done.trials[0].status, 'accepted');
      for (const attempt of done.nativeValidation.attempts) assert.equal(app.runtime.contractArtifacts.read(attempt.result.ref).manifest.content.provenance.kind, 'demo');
      const repeated = await invoke('auto_factor_start', startRequest);
      assert.equal(repeated.id, done.id); assert.deepEqual(repeated.nativeValidation.attempts, done.nativeValidation.attempts);
      app.runtime.plugins.activate('conv_main', 'sesame/backtrader');
      const original = await invoke('backtrader_operation', { operation_id: done.nativeValidation.attempts[0].operationId });
      assert.deepEqual(original.result, done.nativeValidation.attempts[0].result);
      await cp(fileURLToPath(new URL('../packages/auto-factor-mining/examples/native-roundtrip.py', import.meta.url)), nativeValidation.strategy.path);
      const failedArgs = { operation_id: 'native-failure-prefix', title: 'Explicit synthetic optimizer failure test', data: nativeValidation.development.data, strategy_path: nativeValidation.strategy.path, class_name: 'RoundTrip', config: nativeValidation.config, parameter_space: { exit_bar: [3, 0, 7] } };
      // Environment selection is plugin-private; the workflow already inspected
      // the exact existing Python, so this call does not install or reconfigure it.
      const failed = await invoke('backtrader_optimize', failedArgs);
      assert.equal(failed.status, 'failed'); assert.deepEqual(failed.passes.map(pass => pass.status), ['completed', 'not-completed', 'not-completed']);
      assert.ok(failed.rawResult); assert.deepEqual(await invoke('backtrader_optimize', failedArgs), failed);
      const op = await invoke('backtrader_operation', { operation_id: failedArgs.operation_id }); assert.deepEqual(op.result, failed);
      if (outputDirectory) await writeFile(join(outputDirectory, 'actual-optimizer-failure.json'), JSON.stringify({ status: 'passed', fixture: 'synthetic software data; actual Cerebro.optstrategy', result: failed }, null, 2) + '\n');
    }
    assert.equal(app.runtime.runs.read(done.workflow.id).task.output.space, 'strategy');
    const record = app.runtime.contractArtifacts.read(done.report.ref);
    const html = app.runtime.contractArtifacts.resource(done.report.ref, record.manifest.content.entry).bytes;
    const receipts = { items: app.store.list('contract_render_receipt').filter(item => item.artifact.digest === done.report.ref.digest) };
    assert.ok(receipts.items.some(item => item.status === 'rendered'));
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(join(outputDirectory, 'single-strategy-report.html'), html);
      const nativeReceipt = done.nativeValidation ? Object.fromEntries(Object.entries(done.nativeValidation).filter(([key]) => key !== 'source')) : undefined;
      await writeFile(join(outputDirectory, 'single-host-receipt.json'), JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString(), plugin: { id: pluginId, version: app.runtime.plugins.entry(pluginId).version, digest: app.runtime.plugins.entry(pluginId).digest }, realModelCalls: 0, fixtureCalls, nativeAgentRuns: agents.length, stages: [...modes], workflowId: done.workflow.id, agentRunId: agents[0].id, selection: done.selection, finalEvaluation: done.finalEvaluation, strategyValidation: done.strategyValidation, ...(nativeReceipt ? { nativeValidation: nativeReceipt } : {}), report: done.report, rendering: receipts.items.map(item => ({ status: item.status, renderer: item.renderer })) }, null, 2) + '\n');
    }
    t.diagnostic('One actual Agent Run; six persisted stages; real evaluator candidate/select/finalize; holdout hidden until freeze; exact report rendered; no real model or broker.');
  } finally { await app.dispose(); }
});
