import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixtureHost } from './mt5-conformance-fixture.js';
import { NativeRunObserver } from '../../optional-api-v1/packages/mt5/backend/run-observer.js';
import { createCapabilities as testerTools } from '../../optional-api-v1/packages/mt5/tools/tester/index.js';
import { createCapabilities as deploymentTools } from '../../optional-api-v1/packages/mt5/tools/deployment/index.js';

async function fixture(t) {
  const f = await fixtureHost(t), { host, store } = f;
  const rows = new Map([
    ['mt5-tester-pass', { id: 'mt5-tester-pass', version: 2, producer: { id: 'sesame/mt5' } }],
    ['mt5-deployment-deploy', { id: 'mt5-deployment-deploy', version: 3, producer: { id: 'sesame/mt5' } }],
    ['mt5-tester-unowned', { id: 'mt5-tester-unowned', version: 1, producer: { id: 'another/plugin' } }],
  ]);
  for (const row of rows.values()) store.put('native_run_record', row);
  const job = { id: 'job', status: 'succeeded', passes: [{ id: 'pass' }, { id: 'legacy' }] }, deployment = { id: 'deploy', status: 'running' };
  const mt5 = { storage: store, official: {}, tester: { pending: new Map(), list: () => [{ id: job.id }], get: () => structuredClone(job), queue: () => structuredClone(job), start: async () => {}, stop: () => structuredClone(job) },
    deployments: { list: () => [structuredClone(deployment)], candidates: () => [], preparations: () => [], check: async () => ({ ready: true }), requestMount: async () => structuredClone(deployment), stop: async () => ({ ...deployment, status: 'stopped' }) } };
  mt5.runObserver = new NativeRunObserver(host, mt5);
  const tools = [...testerTools(host, mt5), ...deploymentTools(host, mt5)], call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  return { rows, host, store, mt5, tools, call, job };
}

test('run reference pins the real current version and never invents legacy or foreign records', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.mt5.runObserver.reference('tester', 'pass'), { id: 'mt5-tester-pass', version: 2, sourceRef: { providerId: 'sesame/mt5#runs', revision: f.host.context.pluginRevision } });
  f.store.update('native_run_record', 'mt5-tester-pass', { version: 4 });
  assert.deepEqual(f.mt5.runObserver.reference('tester', 'pass'), { id: 'mt5-tester-pass', version: 4, sourceRef: { providerId: 'sesame/mt5#runs', revision: f.host.context.pluginRevision } });
  assert.equal(f.mt5.runObserver.reference('tester', 'legacy'), null);
  assert.equal(f.mt5.runObserver.reference('tester', 'unowned'), null);
});

test('backtest responses expose report record references without mutating native evidence', async t => {
  const f = await fixture(t), ref = { id: 'mt5-tester-pass', version: 2, sourceRef: { providerId: 'sesame/mt5#runs', revision: f.host.context.pluginRevision } };
  for (const action of ['start', 'get', 'wait', 'stop']) {
    const args = action === 'start' ? { action, command_id: 'fixture-start-command', build_id: 'build', config: {} } : { action, backtest_id: 'job' };
    const result = await f.call('mt5_backtest', args);
    assert.deepEqual(result.passes[0].run_record, ref); assert.equal(result.passes[1].run_record, null);
  }
  assert.deepEqual((await f.call('mt5_backtest', { action: 'list' }))[0].run_records, [{ pass_id: 'pass', record: ref }, { pass_id: 'legacy', record: null }]);
  assert.equal(Object.hasOwn(f.job.passes[0], 'run_record'), false);
});

test('deployment responses distinguish the checked backtest record from the live record', async t => {
  const f = await fixture(t), live = { id: 'mt5-deployment-deploy', version: 3, sourceRef: { providerId: 'sesame/mt5#runs', revision: f.host.context.pluginRevision } };
  assert.deepEqual((await f.call('mt5_deployment', { action: 'list' })).items[0].run_record, live);
  assert.deepEqual((await f.call('mt5_deployment', { action: 'check', pass_id: 'pass' })).run_record, { id: 'mt5-tester-pass', version: 2, sourceRef: { providerId: 'sesame/mt5#runs', revision: f.host.context.pluginRevision } });
  for (const action of ['mount', 'stop']) assert.deepEqual((await f.call('mt5_deployment', { action, pass_id: 'pass', deployment_id: 'deploy' })).run_record, live);
});

test('published tool descriptions and schemas match the report-reference tools', async t => {
  const f = await fixture(t), definitions = JSON.parse(await readFile(new URL('../../optional-api-v1/packages/mt5/capabilities.json', import.meta.url))).capabilities;
  for (const capability of f.tools) { const entry = definitions.find(item => item.binding.name === capability.name); assert.ok(entry); assert.ok(entry.inputSchema); assert.equal(typeof capability.execute, 'function'); }
});

test('live observer keeps a running deployment through the native heartbeat window without republishing unchanged traces', async () => {
  const host = { context: { pluginId: 'sesame/mt5' } };
  const native = { id: 'deploy', status: 'running', chart_id: '42', output_path: '/fixture', server: 'Demo', login: '7001', symbol: 'EURUSD', build_id: 'build', native_evidence: { verified: true, sequence: 2, observedAt: 1000 } };
  const saves = [], events = [{ seq: 2, build_id: 'build', node_id: 'platform.permissions', value: { trade_allowed: true, dll_allowed: false } }];
  const mt5 = { storage: { list: () => [] }, market: { connected: async () => ({ scope: { login: '7001', server: 'Demo' } }), read: async () => ({ charts: [{ chart_id: '42', symbol: 'EURUSD' }] }) },
    deployments: { flushObservations() {}, list: () => [structuredClone(native)], readTrace: async () => events, save: value => saves.push(structuredClone(value)) } };
  const observer = new NativeRunObserver(host, mt5), realNow = Date.now;
  try {
    Date.now = () => 1000 + 359000;
    await observer.refresh();
    assert.equal(saves.length, 0);
    Date.now = () => 1000 + 361000;
    await observer.refresh();
    assert.equal(saves.length, 1);
    assert.equal(saves[0].status, 'unknown');
    saves.length = 0; events.push({ seq: 3, build_id: 'build', kind: 'lifecycle', value: 'initialized' });
    Date.now = () => 1000 + 362000;
    await observer.refresh();
    assert.equal(saves.length, 1);
    assert.equal(saves[0].status, 'running');
    assert.equal(saves[0].native_evidence.sequence, 3);
  } finally { Date.now = realNow; }
});
