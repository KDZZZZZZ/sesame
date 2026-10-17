import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { records, closeRecords } from '../packages/manual-trading/records.js';
import { createTradingMemory } from '../packages/manual-trading/memory.js';
import { datasetSnapshot } from '../packages/manual-trading/data.js';
const hostRoot = new URL('../../../../mt5agent/', import.meta.url);
const { Store } = await import(new URL('modules/agent/store.js', hostRoot));
const { Runtime } = await import(new URL('modules/agent/runtime.js', hostRoot));
const { createHostContextV2 } = await import(new URL('modules/plugins/host-v2/context.js', hostRoot));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'manual-v2-')), store = new Store(join(root, 'state'));
  const runtime = new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: join(root, 'empty') });
  await runtime.init();
  let host;
  t.after(async () => { await runtime.close(); if (host) closeRecords(host); store.close(); await rm(root, { recursive: true, force: true }); });
  const path = join(runtime.workspaces.root('conv_main'), 'manual');
  await cp(new URL('../packages/manual-trading/', import.meta.url), path, { recursive: true });
  const checked = await runtime.plugins.manager.test('conv_main', { path });
  assert.equal(checked.passed, true);
  await runtime.plugins.manager.install('conv_main', { path, digest: checked.digest });
  runtime.plugins.activate('conv_main', 'sesame/manual-trading');
  const entry = runtime.plugins.entry('sesame/manual-trading');
  host = createHostContextV2(runtime, entry, 'conv_main');
  const state = await import(pathToFileURL(join(entry.root, 'state.js')));
  const instance = state.instance(host);
  const call = async (name, input) => {
    const result = await runtime.capabilities.invoke(`sesame/manual-trading#${name}`, input, {}, { pluginId: 'host', sessionId: 'conv_main', kind: 'main' });
    assert.equal(result.type, 'result'); return result.value;
  };
  return { root, runtime, store, host, instance, call, entry };
}
const account = { accountId: 'fixture', server: 'fixture', revision: '1' };
const completed = { id: 'run', planId: 'plan', plan: { id: 'plan', title: 'API 2 measured fixture', ownerConversationId: 'conv_main', mode: 'single', account, reportFolder: '手工交易日报/fixture' }, status: 'completed', createdAt: 1800000000000, completedAt: 1800000000001, tasks: [], reports: [] };

test('actual Runtime loads explicit bindings and cannot open or republish an unstarted workflow', async t => {
  const f = await fixture(t);
  assert.equal(f.entry.apiVersion, '2');
  assert.equal((await f.call('manual_trading_plan', { action: 'list' })).plans.length, 0);
  f.instance.runtime.save(completed);
  await assert.rejects(f.call('manual_trading_activity', { run_id: 'run' }), { code: 'NOT_STARTED' });
  await assert.rejects(f.call('manual_trading_report', { run_id: 'run' }), { code: 'REPORT_UNAVAILABLE' });
  assert.equal(f.runtime.runs.list().length, 0, 'Viewing and archiving do not start Agents');
});

test('saved data snapshots preserve evidence ancestry, timing and original fill producer checks without a dataset HostContext alias', async t => {
  const f = await fixture(t), now = 1800000060000;
  f.store.put('dataset', { id: 'quote', producer_plugin_id: 'fixture/prices', provenance: { source_kind: 'external', provider: 'fixture/quotes', as_of: new Date(now).toISOString() }, rows: [{ symbol: 'EURUSD', observedAt: now, close: '1.1' }] });
  const datasets = await datasetSnapshot(f.host, ['quote']);
  assert.equal(datasets.get('quote').rows[0].close, '1.1');
  const memory = createTradingMemory(f.host, { now: () => now });
  memory.record({ id: 'episode', planId: 'plan', accountId: 'account', createdAt: now - 1000, symbols: ['EURUSD'], snapshot: { capturedAt: now - 1000 }, decision: { unchanged: true } });
  const input = { runId: 'episode', evidence: [{ datasetId: 'quote', kind: 'market', observedAtField: 'observedAt', symbolField: 'symbol' }], reflection: 'Observed market movement is not a fill or realized profit.' };
  const review = memory.review(input, datasets);
  assert.equal(review.outcome.executionConfirmed, false); assert.equal(review.outcome.realizedPnl, null);
  assert.throws(() => memory.review({ ...input, evidence: [{ ...input.evidence[0], kind: 'execution' }] }, datasets), { code: 'INVALID_EVIDENCE' });
  closeRecords(f.host);
  assert.equal(createTradingMemory(f.host, { now: () => now }).context({ accountId: 'account' }).lessons.length, 1);
});

test('real host preflight retains a report workspace but dispatches no Agent when the frozen model is unavailable', async t => {
  const f = await fixture(t);
  const path = join(f.runtime.workspaces.root('conv_main'), 'execution'); await mkdir(path, { recursive: true });
  const capability = name => ({ id: name, kind: 'function', consumers: ['agent', 'host'], description: 'Read a fixed test account', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, execution: 'immediate', effects: [], binding: { type: 'native', name }, usage: { purpose: 'Fixture', inputs: 'JSON', outputs: 'JSON', prerequisites: [], limitations: ['No broker exists.'] } });
  const manifest = { schemaVersion: 1, apiVersion: '2', configSchema: { type: 'object' }, capabilities: [capability('fixture_context'), capability('fixture_apply')], sources: [], views: [], services: [], hooks: [], knowledge: [], stateCollections: [], artifactSchemas: [] };
  await writeFile(join(path, 'plugin.json'), JSON.stringify({ id: 'fixture/execution', apiVersion: '2', version: '1.0.0', title: 'Fixture execution', description: 'Fixture execution', default_state: 'discoverable', entry: 'index.js', capability_manifest: 'capabilities.json', prompts: [], skills: [] }));
  await writeFile(join(path, 'capabilities.json'), JSON.stringify(manifest));
  await writeFile(join(path, 'index.js'), "export function createCapabilities() { return [{name:'fixture_context', execute:()=>({})},{name:'fixture_apply',execute:()=>{throw new Error('No trading is permitted in this fixture')}}]; }");
  const tested = await f.runtime.plugins.manager.test('conv_main', { path }); await f.runtime.plugins.manager.install('conv_main', { path, digest: tested.digest });
  const execution = f.runtime.plugins.entry('fixture/execution');
  const plan = { ...completed.plan, enabled: true, model: { provider: 'unconfigured-fixture', id: 'model', configurationDigest: 'sha256:fixture' }, agentModels: {}, symbols: [], instructions: '', debateRounds: 1, eventCooldownMs: 5000,
    execution: { pluginId: execution.id, contextTool: 'fixture_context', applyTool: 'fixture_apply', account, arguments: {}, context: {}, quantityRules: { unit: 'units', signed: true, integer: false }, tools: ['fixture_context', 'fixture_apply'], readTools: ['fixture_context'], plugins: [execution.id], revisions: [{ id: execution.id, digest: execution.digest }] }, research: { plugins: [], tools: [], revisions: [] } };
  records(f.host).put('plans', plan);
  const run = await f.call('manual_trading_run', { plan_id: 'plan', request_id: 'once' });
  await Promise.all([...f.instance.runtime.running.values()].map(value => value.promise));
  const persisted = await f.call('manual_trading_runs', { action: 'read', run_id: run.id });
  assert.equal(persisted.status, 'interrupted', JSON.stringify({ error: persisted.error, runs: f.runtime.runs.list().map(run => ({ id: run.id, status: run.status, error: run.error })) })); assert.equal(persisted.execution, undefined);
  const runs = f.runtime.runs.list();
  assert.equal(runs.filter(item => item.capabilityId === 'sesame/manual-trading#workflow_execute').length, 1);
  assert.equal(runs.filter(item => item.kind === 'agent').length, 0, 'Dependency admission happens before Agent dispatch');
  const workflow = runs.find(item => item.kind === 'workflow');
  assert.equal(workflow.status, 'interrupted'); assert.equal(typeof workflow.executionSessionId, 'string'); assert.notEqual(workflow.executionSessionId, 'conv_main');
  assert.ok(f.runtime.reportLibrary.boundTarget(workflow.executionSessionId), 'The interrupted Run keeps its visible report destination');
  assert.equal(persisted.report, undefined); assert.equal(persisted.completedAt, undefined);
  assert.match(workflow.interrupts[0].reason, /model unavailable/i);
  const view = await f.call('manual_trading_activity', { run_id: run.id });
  assert.equal(view.opened, true); assert.equal(view.runId, workflow.id);
  await assert.rejects(f.call('manual_trading_report', { run_id: run.id }), { code: 'REPORT_UNAVAILABLE' });
  const blocked = await f.runtime.runs.wait(workflow.id, { until: 'settled', timeoutMs: 100 });
  assert.equal(blocked.reason, 'interrupted');
  await f.call('manual_trading_run', { plan_id: 'plan', request_id: 'once' });
  assert.equal(f.runtime.runs.list().length, runs.length);
  const scheduled = f.instance.runtime.trigger('plan', { kind: 'interval', id: 'scheduled-after-fixture' });
  await Promise.all([...f.instance.runtime.running.values()].map(value => value.promise));
  const scheduledRecord = f.instance.runtime.run(scheduled.id);
  assert.equal(scheduledRecord.status, 'queued'); assert.equal(scheduledRecord.workflow, undefined, 'A blocked account workflow is not bypassed by a new scheduled Run');

  for (const report of [false, true]) {
    const analysisPlan = { ...plan, id: `analysis-${report}`, mode: 'team', purpose: 'analysis', publishReport: report };
    records(f.host).put('plans', analysisPlan);
    const analysis = f.instance.runtime.trigger(analysisPlan.id, { kind: 'analysis', id: 'one-shot' }, f.host);
    await Promise.all([...f.instance.runtime.running.values()].map(value => value.promise));
    const retained = f.instance.runtime.run(analysis.id), actual = f.runtime.runs.read(retained.workflow.id);
    assert.equal(actual.kind, 'workflow'); assert.equal(actual.status, 'interrupted');
    assert.equal(actual.task.collaboration.agents.length, 8); assert.equal(actual.task.collaboration.agents.some(agent => agent.id === 'executor'), false);
    assert.equal(Boolean(f.runtime.reportLibrary.boundTarget(actual.executionSessionId)), report,
      'Only explicitly requested analysis reports are reserved by the actual host before research completes');
    assert.equal((await f.call('manual_trading_activity', { run_id: analysis.id })).runId, actual.id,
      'A reportless analysis still opens its own native workflow process');
    assert.equal(retained.report, undefined); assert.equal(retained.decision, undefined); assert.equal(retained.execution, undefined);
  }
});
