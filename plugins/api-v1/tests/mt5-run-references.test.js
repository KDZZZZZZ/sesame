import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Type } from '@sesame/plugin-sdk/schema';
import { NativeRunObserver } from '../../optional-api-v1/packages/mt5/backend/run-observer.js';
import { createTools as testerTools } from '../../optional-api-v1/packages/mt5/tools/tester/index.js';
import { createTools as deploymentTools } from '../../optional-api-v1/packages/mt5/tools/deployment/index.js';

function fixture() {
  const rows = new Map([
    ['mt5-tester-pass', { id: 'mt5-tester-pass', version: 2, producer: { id: 'sesame/mt5' } }],
    ['mt5-deployment-deploy', { id: 'mt5-deployment-deploy', version: 3, producer: { id: 'sesame/mt5' } }],
    ['mt5-tester-unowned', { id: 'mt5-tester-unowned', version: 1, producer: { id: 'another/plugin' } }],
  ]);
  const string = description => Type.String({ description, minLength: 1, maxLength: 20000 });
  const host = { plugin: { id: 'sesame/mt5' }, scope: { conversationId: 'main' }, workspace: {},
    configuration: {}, storage: { idempotent: (_id, _digest, action) => action() },
    records: { list: () => [...rows.values()], read: id => { assert.ok(rows.has(id)); return structuredClone(rows.get(id)); } },
    tools: { Type, string, optional: description => Type.Optional(string(description)),
      define: (name, description, properties, execute) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) } };
  const job = { id: 'job', status: 'succeeded', passes: [{ id: 'pass' }, { id: 'legacy' }] }, deployment = { id: 'deploy', status: 'running' };
  const mt5 = { official: {}, tester: { pending: new Map(), list: () => [{ id: job.id }], get: () => structuredClone(job), queue: () => structuredClone(job), start: async () => {}, stop: () => structuredClone(job) },
    deployments: { list: () => [structuredClone(deployment)], candidates: () => [], preparations: () => [], check: async () => ({ ready: true }), requestMount: async () => structuredClone(deployment), stop: async () => ({ ...deployment, status: 'stopped' }) } };
  mt5.runObserver = new NativeRunObserver(host, mt5);
  const tools = [...testerTools(host, mt5), ...deploymentTools(host, mt5)], call = (name, args) => tools.find(tool => tool.name === name).execute(args);
  return { rows, host, mt5, tools, call, job };
}

test('run reference pins the real current version and never invents legacy or foreign records', () => {
  const f = fixture();
  assert.deepEqual(f.mt5.runObserver.reference('tester', 'pass'), { id: 'mt5-tester-pass', version: 2 });
  f.rows.get('mt5-tester-pass').version = 4;
  assert.deepEqual(f.mt5.runObserver.reference('tester', 'pass'), { id: 'mt5-tester-pass', version: 4 });
  assert.equal(f.mt5.runObserver.reference('tester', 'legacy'), null);
  assert.equal(f.mt5.runObserver.reference('tester', 'unowned'), null);
});

test('backtest responses expose report record references without mutating native evidence', async () => {
  const f = fixture(), ref = { id: 'mt5-tester-pass', version: 2 };
  for (const action of ['start', 'get', 'wait', 'stop']) {
    const args = action === 'start' ? { action, command_id: 'fixture-start-command', build_id: 'build', config: {} } : { action, backtest_id: 'job' };
    const result = await f.call('mt5_backtest', args);
    assert.deepEqual(result.passes[0].run_record, ref); assert.equal(result.passes[1].run_record, null);
  }
  assert.deepEqual((await f.call('mt5_backtest', { action: 'list' }))[0].run_records, [{ pass_id: 'pass', record: ref }, { pass_id: 'legacy', record: null }]);
  assert.equal(Object.hasOwn(f.job.passes[0], 'run_record'), false);
});

test('deployment responses distinguish the checked backtest record from the live record', async () => {
  const f = fixture(), live = { id: 'mt5-deployment-deploy', version: 3 };
  assert.deepEqual((await f.call('mt5_deployment', { action: 'list' })).items[0].run_record, live);
  assert.deepEqual((await f.call('mt5_deployment', { action: 'check', pass_id: 'pass' })).run_record, { id: 'mt5-tester-pass', version: 2 });
  for (const action of ['mount', 'stop']) assert.deepEqual((await f.call('mt5_deployment', { action, pass_id: 'pass', deployment_id: 'deploy' })).run_record, live);
});

test('published tool descriptions and schemas match the report-reference tools', async () => {
  const f = fixture(), definitions = JSON.parse(await readFile(new URL('../../optional-api-v1/packages/mt5/tools.json', import.meta.url)));
  for (const tool of f.tools) assert.deepEqual(JSON.parse(JSON.stringify({ ...tool, execute: undefined })), definitions.find(item => item.name === tool.name));
});
