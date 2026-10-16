import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '@sesame/plugin-sdk/protocol';
import { fixtureHost } from './mt5-conformance-fixture.js';
import { NativeRunObserver } from '../../optional-api-v1/packages/mt5/backend/run-observer.js';
import { MT5AccountProvider } from '../../optional-api-v1/packages/mt5/backend/providers.js';
import { mt5ConnectionRef } from '../../optional-api-v1/packages/mt5/backend/contract-mapping.js';
import { targetProfile } from '../../optional-api-v1/packages/mt5/backend/target.js';
import { Deployments } from '../../optional-api-v1/packages/mt5/backend/deployments.js';
import { createCapabilities } from '../../optional-api-v1/packages/mt5/tools/deployment/index.js';

async function runFixture(t) {
  const f = await fixtureHost(t);
  const source = await f.publishSource(JSON.parse(await readFile(new URL('../packages/strategy-authoring/examples/close-threshold.svl.json', import.meta.url), 'utf8')));
  const target = await targetProfile(f.host);
  const translation = await f.publish('strategy.translation', { source, target,
    nativeParameterMap: { instrument: { binding: 'instrument' }, threshold: { nativeInput: 'Threshold' } }, environment: {} });
  const bytes = Buffer.from('Synthetic frozen EX5; never executed'), build = { id: 'build-connection', project_id: 'project', revision: 1, ex5_sha256: digest(bytes), manifest_digest: digest('manifest') };
  const directory = join(f.store.directory, 'mt5/builds', build.id);
  await mkdir(join(directory, 'Experts'), { recursive: true });
  await writeFile(join(directory, 'Experts/Strategy.ex5'), bytes);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ compiler_sha256: digest('compiler'), files: {} }));
  f.store.put('mt5_build', build); f.store.put('mt5_revision', { id: 'project:1', translation });
  const endpoint = 'http://127.0.0.1:22346/mcp';
  f.mt5.official.config = { version: 7, servers: { terminal: { url: endpoint } }, account: { server: 'Fixture-Demo', login: '7001' } };
  return { ...f, endpoint, observer: new NativeRunObserver(f.host, f.mt5), native: { id: 'deployment', build_id: build.id,
    server: 'Fixture-Demo', login: '7001', symbol: 'EURUSD', period: 'M1', parameters: { Threshold: '101.25' }, conversation_id: 'conv',
    created_at: '2026-10-15T12:00:00Z', status: 'running', chart_id: '42', artifact_digest: build.ex5_sha256,
    native_evidence: { verified: true, sequence: 1, observedAt: 1000 } } };
}

test('API2 live run publication and provider share stable account identity across unrelated configuration changes', async t => {
  const f = await runFixture(t), body = await f.observer.definition('deployment', f.native);
  const expected = mt5ConnectionRef('Fixture-Demo', '7001', f.endpoint);
  assert.deepEqual(body.accounts[0].connection, expected);
  assert.deepEqual(body.accounts[0].provider, { pluginId: 'sesame/mt5', providerId: 'account' });
  assert.deepEqual((await f.readArtifact(body.environment)).manifest.content.connection, expected);
  const provider = new MT5AccountProvider({ ...f.mt5, options: {}, market: { read: () => assert.fail('Binding must not query a terminal') } });
  t.after(() => provider.dispose());
  assert.deepEqual(provider.bind({ connection: expected }, { bindingId: 'binding' }).connection, expected);
  f.mt5.official.config.version++;
  assert.equal(provider.binding({ bindingId: 'binding' }).account.accountId, body.accounts[0].account.accountId);
  f.mt5.official.config.account.login = '7002';
  assert.throws(() => provider.binding({ bindingId: 'binding' }), { code: 'CONNECTION_CHANGED' });
});

test('API2 Tester publication freezes its numeric environment revision without a live account binding', async t => {
  const f = await runFixture(t);
  f.mt5.official.config.version = 99;
  const body = await f.observer.definition('tester', { id: 'pass', build_id: f.native.build_id, connection_version: 7,
    config: { symbol: 'EURUSD', period: 'M1', parameters: { Threshold: '101.25' } }, conversation_id: 'conv' });
  assert.deepEqual(body.accounts, []);
  assert.deepEqual((await f.readArtifact(body.environment)).manifest.content.connection, { id: 'mt5-terminal', revision: '7' });
  await assert.rejects(f.observer.definition('tester', { id: 'missing-revision', build_id: f.native.build_id,
    config: { symbol: 'EURUSD', period: 'M1', parameters: { Threshold: '101.25' } }, conversation_id: 'conv' }), /frozen MT5 connection version/);
});

test('saved native definitions remain immutable and changed diagnostic timestamps do not republish observations', async t => {
  const f = await runFixture(t), first = await f.observer.deployment(f.native);
  const publications = f.artifacts.size;
  const repeated = await f.observer.deployment({ ...f.native, updated_at: '2026-10-16T00:00:00Z', diagnostics: 'Changed logging only',
    temporary_paths: ['local-temp'], native_evidence: { ...f.native.native_evidence, observedAt: 2000 } });
  assert.equal(repeated.version, first.version); assert.equal(f.artifacts.size, publications);
  assert.equal(first.body.observation.validUntil - first.body.observation.observedAt, 360000);
  const changed = await f.observer.deployment({ ...f.native, native_evidence: { ...f.native.native_evidence, sequence: 2 } });
  assert.equal(changed.version, first.version + 1);
  const saved = { accounts: [{ connection: { id: 'mt5-terminal', revision: '7' } }] };
  f.store.put('native_run_inputs', { id: 'mt5-deployment-saved', body: saved });
  assert.deepEqual(await f.observer.definition('deployment', { id: 'saved' }), saved);
});

test('missing deployment pass is rejected before reading a record and failed preparation is never replayed', async t => {
  const f = await fixtureHost(t);
  f.store.put('mt5_build', { id: 'build' }); f.store.put('mt5_pass', { id: 'pass', build_id: 'build' });
  f.store.put('mt5_preparation', { id: 'old', request_key: 'request-replay-0001', source_pass_id: 'pass', login: '7001', server: 'Demo', source_artifact_digest: 'hash', status: 'failed', stage: 'staging', reason: 'chart file too large' });
  let native = 0;
  const service = new Deployments({ storage: f.store, official: { redact: x => x, deploymentAccess: () => ({ blocked_reason: null }), config: { account: { login: '7001', server: 'Demo' } } },
    market: { connected: async () => ({ scope: { login: '7001', server: 'Demo' }, info: { terminal: { experts_trade_allowed: true, mcp_trade_allowed: true }, account: {} } }) } });
  t.after(() => service.close());
  const tool = createCapabilities(f.host, { deployments: service }).find(capability => capability.name === 'mt5_deployment');
  await assert.rejects(tool.execute({ action: 'check' }), /check 需要 pass_id/);
  service.check = async () => ({ ready: false, reasons: ['终端尚未识别冻结构建，需要自动准备'], login: '7001', server: 'Demo', artifact_digest: 'hash' });
  service.stage = async () => { native++; };
  await assert.rejects(service.requestMount('pass', 'request-replay-0001', { login: '7001', server: 'Demo', artifact_digest: 'hash' }, f.store),
    error => error.code === 'deployment_preparation_replay' && /未重新执行/.test(error.message) && /chart file too large/.test(error.message));
  assert.equal(native, 0);
});
