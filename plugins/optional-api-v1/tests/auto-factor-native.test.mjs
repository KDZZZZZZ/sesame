import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nativePlan, prepareNative } from '../packages/auto-factor-mining/native-plan.js';
import { executeNative, chooseParameters } from '../packages/auto-factor-mining/native-validation.js';
import { applicability } from '../packages/auto-factor-mining/conditional-use.js';
import { renderReport } from '../packages/auto-factor-mining/report.js';
import { digest } from '../packages/auto-factor-mining/workflow-mechanics.js';
import { optimizerPasses } from '../packages/auto-factor-mining/native-mt5.js';

const ref = id => ({ id, revision: '1', digest: `sha256:${'a'.repeat(64)}`, kind: 'data', schemaVersion: '1.0.0' });
const day = n => new Date(Date.UTC(2025, 0, n)).toISOString();
const request = () => ({ engine: 'backtrader', reason: 'Explicit test-only authored cash strategy', strategy: { path: 'strategy.py', className: 'Test' },
  development: { data: ref('development'), start: day(1), end: day(5) }, holdout: { data: ref('holdout'), start: day(5), end: day(9) },
  config: { capital: '100', commission: '0', slippage: '0', feed: { timeframe: 'days', compression: 1 } },
  search: { mode: 'auto', parameterSpace: { period: [2, 3] }, objective: { metric: 'finalEquity', direction: 'max' } } });
async function setup(t, { run, rows: overrides } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'factor-native-boundary-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'strategy.py'), '# authored frozen fixture\nclass Test: pass\n');
  const capabilities = ['backtrader_environment', 'backtrader_backtest', 'backtrader_optimize', 'backtrader_operation'].map(id => ({ id, consumers: ['host', 'agent'] }));
  const calls = [], operations = new Map();
  const host = { context: { workspaceRoot: directory }, plugins: { read: () => ({ id: 'sesame/backtrader', version: '2.1.0', revision: 'fixture-engine', capabilities }), setEnabled: async () => {} },
    resources: { async read(selected, options) {
      const rows = overrides?.[selected.id] ?? [selected.id === 'development' ? 1 : 5, selected.id === 'development' ? 4 : 8].map(n => ({ datetime: day(n), open: '10', high: '11', low: '9', close: '10', volume: '1' }));
      if (options.part === 'metadata') return { ref: selected, producer: { id: 'fixture/fixed-input' } };
      if (options.part === 'manifest') return { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: rows.length, provenance: { kind: 'demo' } }, blobs: [{ path: 'rows.json', mediaType: 'application/json' }] };
      return { content: Buffer.from(JSON.stringify(rows)).toString('base64') };
    } },
    capabilities: { async invoke(id, args) {
      calls.push({ id, args: structuredClone(args) });
      if (id.endsWith('_environment')) return { type: 'result', value: { ready: true, library: 'fixture-only' } };
      if (id.endsWith('_operation')) return { type: 'result', value: operations.get(args.operation_id) ?? { status: 'not-found' } };
      const value = await run?.({ id, args, operations, calls, host }) ?? (id.endsWith('_optimize') ? { status: 'completed', passes: [2, 3].map(period => ({ status: 'completed', parameters: { period }, statistics: { finalEquity: String(100 + period) } })) } : { status: 'completed', statistics: { finalEquity: '97' } });
      operations.set(args.operation_id, { status: value.status, result: value }); return { type: 'result', value };
    } } };
  return { host, calls, operations, directory };
}
const execute = async (fixture, plan, state, options = {}) => {
  const snapshots = [];
  const result = await executeNative(fixture.host, { runId: 'fixture', plan, state, factorSelectionDigest: 'factor-frozen', onChange: value => { snapshots.push(value); options.onChange?.(value); }, ...options });
  return { result, snapshots };
};

test('native plan freezes actual source and fixed right-open windows; overlap, endpoint bars, missing metadata and external source fail honestly', async t => {
  const f = await setup(t), plan = nativePlan(request()), state = await prepareNative(f.host, plan);
  assert.equal(state.status, 'pending'); assert.equal(state.windows.development.last, day(4));
  await writeFile(join(f.directory, 'strategy.py'), '# changed after admission');
  const { result } = await execute(f, plan, state);
  assert.equal(result.status, 'completed'); assert.equal(await readFile(join(f.directory, '.factor-native-fixture/strategy.py'), 'utf8'), state.source);
  assert.equal(result.selection.parameters.period, 3); assert.equal(result.holdout.statistics.finalEquity, '97');
  assert.throws(() => nativePlan({ ...request(), holdout: { ...request().holdout, start: day(4) } }), /Holdout/);
  const bad = await setup(t, { rows: { development: [{ datetime: day(1) }, { datetime: day(5) }] } });
  assert.equal((await prepareNative(bad.host, plan)).status, 'unavailable');
  const outside = await prepareNative(f.host, { ...plan, strategy: { path: '../no-such-file.py', className: 'Test' } });
  assert.equal(outside.status, 'unavailable');
});

test('real-shaped native results freeze parameters before holdout and exact repetition reuses all original results', async t => {
  const f = await setup(t), plan = nativePlan(request()), state = await prepareNative(f.host, plan);
  let frozen;
  const { result } = await execute(f, plan, state, { onChange: value => { if (value.selection) frozen = structuredClone(value.selection); } });
  assert.equal(result.status, 'completed'); assert.equal(result.selection.digest, frozen.digest);
  const computation = f.calls.filter(c => /_(optimize|backtest)$/.test(c.id));
  assert.deepEqual(computation.map(c => c.args.data.id), ['development', 'holdout']);
  assert.deepEqual(computation[1].args.parameters, frozen.parameters); assert.equal(result.holdout.selectionDigest, frozen.digest);
  await execute(f, plan, result); assert.equal(f.calls.filter(c => /_(optimize|backtest)$/.test(c.id)).length, 2);
  const html = renderReport({ title: 'Fixture', config: {}, data: {}, trials: [], nativeValidation: result });
  assert.ok(html.includes('原生交易规则验证')); assert.ok(html.includes('sealed')); assert.ok(!html.split('<script')[0].includes('# authored frozen fixture'));
});

test('admitted plan, factor selection and native parameter digests are checked before any dispatch or completed-result reuse', async t => {
  const f = await setup(t), plan = nativePlan(request()), state = await prepareNative(f.host, plan);
  await assert.rejects(execute(f, { ...plan, parameters: { period: 999 } }, state), { code: 'NATIVE_PLAN_CHANGED' });
  assert.equal(f.calls.length, 0);
  const { result } = await execute(f, plan, state), count = f.calls.length;
  await assert.rejects(execute(f, plan, result, { factorSelectionDigest: 'other-factor-selection' }), { code: 'NATIVE_SELECTION_CHANGED' });
  const changed = structuredClone(result); changed.selection.parameters.period = 999;
  await assert.rejects(execute(f, plan, changed), { code: 'NATIVE_SELECTION_CHANGED' }); assert.equal(f.calls.length, count);
});

test('interrupted dispatch reconciles the same operation and never repeats a completed optimizer or changes parameters', async t => {
  const controller = new AbortController(); let interrupted = false, saved;
  const f = await setup(t, { run: ({ id, args, operations }) => {
    if (id.endsWith('_optimize') && !interrupted) { interrupted = true; operations.set(args.operation_id, { status: 'completed', result: { status: 'completed', passes: [{ status: 'completed', parameters: { period: 2 }, statistics: { finalEquity: '105' } }] } }); controller.abort(new Error('Fixture interruption after adapter receipt')); throw controller.signal.reason; }
  } });
  const plan = nativePlan(request()), state = await prepareNative(f.host, plan);
  await assert.rejects(execute(f, plan, state, { signal: controller.signal, onChange: value => { saved = value; } }), /Fixture interruption/);
  assert.equal(saved.attempts.length, 1); assert.equal(saved.attempts[0].status, 'unknown');
  const { result } = await execute(f, plan, saved); assert.equal(result.status, 'completed');
  assert.equal(f.calls.filter(c => c.id.endsWith('_optimize')).length, 1);
  assert.equal(f.calls.filter(c => c.id.endsWith('_operation')).length, 1);
  assert.equal(result.selection.parameters.period, 2); assert.ok(result.attempts[0].reconciledAt);
});

test('unknown missing receipt is never interpreted as safe to resend; failed optimizer never selects its successful prefix', async t => {
  const f = await setup(t), plan = nativePlan(request()), initial = await prepareNative(f.host, plan);
  const operationId = `factor_${digest(['fixture', initial.planDigest, 'development-optimizer']).slice(7, 55)}`;
  const state = { ...initial, attempts: [{ key: 'development-optimizer', operationId, status: 'dispatching' }] };
  const { result } = await execute(f, plan, state); assert.equal(result.status, 'unknown');
  await execute(f, plan, result); assert.equal(f.calls.filter(c => c.id.endsWith('_operation')).length, 2);
  assert.equal(f.calls.filter(c => c.id.endsWith('_optimize') || c.id.endsWith('_backtest')).length, 0);
  const failed = await setup(t, { run: () => ({ status: 'failed', passes: [{ status: 'completed', parameters: { period: 2 }, statistics: { finalEquity: '1000' } }, { status: 'not-completed', parameters: { period: 3 } }] }) });
  const done = await execute(failed, plan, await prepareNative(failed.host, plan));
  assert.equal(done.result.status, 'failed'); assert.equal(done.result.selection, undefined); assert.equal(done.result.holdout, undefined);
});

test('custom parameter groups need hypotheses, preserve failures, and use an exact predeclared decimal objective', async t => {
  const value = request(); value.search = { mode: 'groups', groups: [{ id: 'failed', hypothesis: 'Failure is a retained software fixture', parameters: { period: 0 } }, { id: 'first', hypothesis: 'First measured group', parameters: { period: 2 } }, { id: 'other', hypothesis: 'Second measured group', parameters: { period: 3 } }], objective: { metric: 'finalEquity', direction: 'max' } };
  const f = await setup(t, { run: ({ args }) => args.parameters.period === 0 ? { status: 'failed', statistics: {} } : { status: 'completed', statistics: { finalEquity: args.parameters.period === 2 ? '9007199254740992.01' : '9007199254740992.02' } } });
  const plan = nativePlan(value), { result } = await execute(f, plan, await prepareNative(f.host, plan));
  assert.equal(result.status, 'completed'); assert.equal(result.development.passes[0].status, 'failed'); assert.equal(result.selection.parameters.period, 3);
  assert.equal(f.calls.filter(c => c.id.endsWith('_optimize')).length, 0);
  assert.equal(f.calls.filter(c => c.id.endsWith('_backtest')).length, 4);
  delete value.search.groups[0].hypothesis; assert.throws(() => nativePlan(value), /hypothesis/);
  assert.throws(() => chooseParameters([{ status: 'completed', statistics: { differentMetric: '999' } }], { metric: 'predeclared', direction: 'max' }), /predeclared/);
});

test('unsupported native optimizer and missing plugin remain optional unavailable, with no invented fallback engine', async t => {
  const f = await setup(t), plan = nativePlan(request()), state = await prepareNative(f.host, plan);
  const read = f.host.plugins.read; f.host.plugins.read = () => ({ ...read(), capabilities: read().capabilities.filter(x => x.id !== 'backtrader_optimize') });
  const { result } = await execute(f, plan, state); assert.equal(result.status, 'unavailable'); assert.equal(result.error.code, 'NATIVE_OPTIMIZER_UNAVAILABLE');
  assert.equal(f.calls.filter(c => c.id.endsWith('_backtest')).length, 0);
  f.host.plugins.read = () => { throw Error('Not installed'); };
  assert.equal((await prepareNative(f.host, plan)).status, 'unavailable');
});

test('conditional use is concrete bounded evidence, keeps counterexamples and never invents fields', () => {
  const value = { valid_when: ['Observed trending subperiod'], invalid_when: ['Observed reversal regime'], evidence: ['trial_1 / regimes.trend'], limitations: ['One synthetic sample only'], monitor: ['Regime data availability'], stop_when: ['Current regime differs'], counterexamples: ['trial_1 / regimes.reversal loss'] };
  assert.deepEqual(applicability(value, true), value); assert.throws(() => applicability(undefined, true), /requires/);
  assert.throws(() => applicability({ valid_when: ['Claim without evidence'] }, true), /supported/);
  assert.throws(() => applicability({ ...value, confidence: 0.9 }), /accepts/);
});

function mt5Request() {
  // This schema is deliberately a local native-server fixture. It is NOT a
  // claim about the argument names exposed by any user's MetaTrader build.
  const inputSchema = { type: 'object', properties: { begin: { type: 'string' }, finish: { type: 'string' }, program: { type: 'string' } }, required: ['begin', 'finish', 'program'], additionalProperties: false };
  return { engine: 'mt5', reason: 'Explicit native-server contract fixture; no terminal is running', strategy: { buildId: 'build_fixture' }, development: { start: '2025-01-01', end: '2025-01-05', authority: 'fixture broker wall dates' }, holdout: { start: '2025-01-05', end: '2025-01-09', authority: 'fixture broker wall dates' }, config: { symbol: 'SYNTHETIC', period: 'D1', deposit: 10000, currency: 'USD', leverage: 1, model: 1 },
    search: { mode: 'auto', objective: { metric: 'net_profit', direction: 'max' }, nativeOptimizer: { inputSchema, arguments: { begin: '2025-01-01', finish: '2025-01-05', program: 'build_fixture' }, windowBinding: { startPointer: '/begin', endPointer: '/finish' }, buildPointer: '/program', result: { complete: { pointer: '/state', equals: 'complete' }, passesPointer: '/passes', parametersPointer: '/inputs', statisticsPointer: '/metrics' } } } };
}
function mt5Host(f, plan, { unparsed = false, schemaChanged = false } = {}) {
  const capabilities = ['mt5_catalog', 'mt5_test', 'mt5_command', 'mt5_backtest', 'mt5_backtest_operation'].map(id => ({ id, consumers: ['host'] }));
  f.host.plugins.read = () => ({ id: 'sesame/mt5', version: 'fixture', revision: 'fixture-mt5', capabilities });
  f.host.capabilities.invoke = async (id, args) => {
    f.calls.push({ id, args: structuredClone(args) });
    if (id.endsWith('#mt5_catalog')) return { type: 'result', value: { checked_at: 'fixture', items: [{ server: 'terminal', status: 'available', tools: [{ name: 'tester_run_optimization', callable: true, agent_tool: 'mt5_test', inputSchema: schemaChanged ? {} : plan.search.nativeOptimizer.inputSchema }] }] } };
    if (id.endsWith('#mt5_command')) return { type: 'result', value: f.operations.get(args.command_id) ?? { status: 'not-found' } };
    if (id.endsWith('#mt5_test')) {
      assert.equal(args.tool, 'tester_run_optimization'); assert.equal(args.server, 'terminal');
      const value = { id: args.command_id, status: 'returned', result: unparsed ? { state: 'running', run_id: 'fixture-native-job' } : { state: 'complete', passes: [{ inputs: { period: 2 }, metrics: { net_profit: '4' } }, { inputs: { period: 3 }, metrics: { net_profit: '5' } }] } };
      f.operations.set(args.command_id, value); return { type: 'result', value };
    }
    if (id.endsWith('#mt5_backtest')) {
      assert.equal(args.action, 'start'); assert.equal(args.config.from_date, plan.holdout.start); assert.equal(args.config.to_date, plan.holdout.end);
      return { type: 'result', value: { id: 'fixture-holdout-job', status: 'succeeded', passes: [{ status: 'succeeded', metrics: { net_profit: '-2' }, parameters: args.config.parameters }] } };
    }
    throw Error(`Unexpected native fixture call: ${id}`);
  };
}

test('MT5 exact-catalog optimizer dispatch parses only native receipts, freezes the winner and calls the declared holdout backend', async t => {
  const f = await setup(t), plan = nativePlan(mt5Request()); mt5Host(f, plan);
  const initial = await prepareNative(f.host, plan), { result } = await execute(f, plan, initial);
  assert.equal(result.status, 'completed'); assert.equal(result.selection.parameters.period, 3); assert.equal(result.holdout.statistics.net_profit, '-2');
  assert.equal(result.windowVerification, 'bound-native-date-arguments'); assert.equal(f.calls.filter(c => c.id.endsWith('#mt5_test')).length, 1);
  assert.equal(result.attempts[0].result.status, 'returned'); assert.equal(result.development.result.command.result.state, 'complete');
  const receipt = result.attempts[0].result;
  const resumed = { ...initial, environment: result.environment, attempts: [{ ...result.attempts[0], status: 'unknown', result: undefined }] };
  const before = f.calls.filter(c => c.id.endsWith('#mt5_test')).length;
  await execute(f, plan, resumed); assert.equal(f.calls.filter(c => c.id.endsWith('#mt5_test')).length, before);
  assert.deepEqual(f.operations.get(receipt.id), receipt);
});

test('MT5 raw prepared configuration requires explicit acknowledgement; actual call is retained without window/selection/holdout claims', async t => {
  const value = mt5Request(), binding = value.search.nativeOptimizer;
  delete binding.windowBinding; delete binding.buildPointer; binding.arguments = { config: 'native-prepared.ini' }; binding.inputSchema = { type: 'object', properties: { config: { type: 'string' } }, required: ['config'] };
  binding.preparedConfiguration = { argumentPointer: '/config', authority: 'Fixture native terminal files', source: 'An explicitly requested prepared native file; no local snapshot', acknowledgeUnverified: true };
  const plan = nativePlan(value), f = await setup(t); mt5Host(f, plan);
  const { result } = await execute(f, plan, await prepareNative(f.host, plan));
  assert.equal(result.status, 'unverified'); assert.equal(result.windowVerification, 'unverified'); assert.equal(result.parameterSelection.status, 'not-run'); assert.equal(result.holdout.status, 'not-run');
  assert.equal(f.calls.filter(c => c.id.endsWith('#mt5_test')).length, 1); assert.equal(f.calls.filter(c => c.id.endsWith('#mt5_backtest')).length, 0);
  delete binding.preparedConfiguration.acknowledgeUnverified; assert.throws(() => nativePlan(value), /acknowledgeUnverified/);
});

test('MT5 changed schema prevents dispatch; incomplete output is not a successful optimization', async t => {
  const plan = nativePlan(mt5Request()), f = await setup(t); mt5Host(f, plan, { schemaChanged: true });
  let result = (await execute(f, plan, await prepareNative(f.host, plan))).result;
  assert.equal(result.status, 'unavailable'); assert.equal(f.calls.filter(c => c.id.endsWith('#mt5_test')).length, 0);
  const g = await setup(t); mt5Host(g, plan, { unparsed: true }); result = (await execute(g, plan, await prepareNative(g.host, plan))).result;
  assert.equal(result.status, 'unverified'); assert.equal(result.selection, undefined); assert.equal(result.holdout.status, 'not-run');
  assert.equal(optimizerPasses({ status: 'returned', result: { isError: true, state: 'complete', passes: [] } }, plan.search.nativeOptimizer).status, 'failed');
});

test('MT5 authored INI source is frozen, bounded to development dates and actual build identity before dispatch', async t => {
  const value = mt5Request(), binding = value.search.nativeOptimizer; delete binding.windowBinding; delete binding.buildPointer;
  binding.arguments = { config: 'tester.ini' }; binding.inputSchema = { type: 'object', properties: { config: { type: 'string' } } };
  binding.preparedConfiguration = { argumentPointer: '/config', workspacePath: 'tester.ini', authority: 'Explicit local native path fixture', source: 'Authored Tester-only INI' };
  const f = await setup(t), plan = nativePlan(value); mt5Host(f, plan);
  const contents = '[Tester]\nExpert=build_fixture.ex5\nFromDate=2025.01.01\nToDate=2025.01.05\nOptimization=1\nForwardMode=0\n';
  await writeFile(join(f.directory, 'tester.ini'), contents); const state = await prepareNative(f.host, plan);
  assert.equal(state.mt5Optimizer.windowVerification, 'frozen-workspace-tester-ini'); assert.equal(state.mt5Optimizer.buildIdentityVerified, true);
  await writeFile(join(f.directory, 'tester.ini'), '[Tester]\nFromDate=2099.01.01');
  const { result } = await execute(f, plan, state); assert.equal(result.status, 'completed');
  const args = f.calls.find(c => c.id.endsWith('#mt5_test')).args.arguments; assert.equal(await readFile(args.config, 'utf8'), contents);
});
