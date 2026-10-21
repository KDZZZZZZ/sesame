import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { tradingPermissions } from '../backend/trading-permissions.js';
import { records } from '../backend/records.js';
import { MT5Official } from '../backend/official.js';

const enable = (extra = {}) => ({ action: 'enable', command_id: 'prepare-fixture-trading-01', expected_version: 8, ...extra });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mt5-permissions-')), events = [];
  const host = { context: { storageRoot: directory, sessionId: 'conv_permissions', kind: 'main' }, events: { emit: event => events.push(event) } };
  const config = {
    version: 8, account: { login: '7001', server: 'Fixture-Demo', password: 'fixture-account-password' },
    allow_trading: true, servers: { terminal: { token: 'fixture-terminal-token' } }, tester_agent: {}, startup_ini: '',
  };
  const info = { account: { login: '7001', server: 'Fixture-Demo', type: 'demo', read_only: false }, terminal: { server_connected: true, experts_trade_allowed: false, mcp_trade_allowed: true } };
  const official = Object.assign(Object.create(MT5Official.prototype), { config });
  let reads = 0, preparations = 0;
  const mt5 = { official, market: { async connected() { reads++; return { scope: { login: '7001', server: 'Fixture-Demo' }, info: structuredClone(info) }; } } };
  const prepare = async () => { preparations++; info.terminal.experts_trade_allowed = true; return { restarted: true, verified: true }; };
  t.after(async () => {
    records(host).close();
    assert.equal(resolve(directory, '..'), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  return { host, mt5, config, info, events, store: records(host), prepare,
    reads: () => reads, preparations: () => preparations,
    invoke: (args, signal, ports) => tradingPermissions(host, mt5, args, signal, ports ?? { prepare }) };
}

test('reading reports each actual permission separately without changing settings, preparing or creating receipts', async t => {
  const f = await fixture(t), original = structuredClone(f.config);
  f.config.allow_trading = false;
  const result = await f.invoke({ action: 'read' });
  assert.equal(result.configuration_version, 8);
  assert.deepEqual(result.account, { login: '7001', server: 'Fixture-Demo', type: 'demo', read_only: false });
  assert.deepEqual(result.application, { allow_trading: false });
  assert.deepEqual(result.terminal, { connected: true, experts_trade_allowed: false, mcp_trade_allowed: true });
  assert.deepEqual(f.config, { ...original, allow_trading: false });
  assert.equal(f.preparations(), 0); assert.equal(f.reads(), 1);
  assert.deepEqual(f.store.list('configuration_change'), []); assert.deepEqual(f.events, []);
  delete f.info.account.read_only; delete f.info.terminal.mcp_trade_allowed;
  const unknown = await f.invoke({ action: 'read' });
  assert.equal(unknown.account.read_only, null); assert.equal(unknown.terminal.mcp_trade_allowed, null);
});

test('enable calls the existing preparation once and verifies real permissions under the same account and version', async t => {
  const f = await fixture(t), receipt = await f.invoke(enable());
  assert.equal(receipt.status, 'applied'); assert.equal(receipt.result.verified, true); assert.equal(receipt.result.restarted, true);
  assert.equal(receipt.result.before.terminal.experts_trade_allowed, false); assert.equal(receipt.result.after.terminal.experts_trade_allowed, true);
  assert.deepEqual(receipt.result.before.account, receipt.result.after.account);
  assert.equal(f.reads(), 2); assert.equal(f.preparations(), 1); assert.equal(f.config.version, 8);
  assert.equal(receipt.fingerprint, undefined);
  assert.deepEqual(await f.invoke(enable()), receipt);
  assert.equal(f.reads(), 2); assert.equal(f.preparations(), 1);
  assert.equal(f.store.list('configuration_change').length, 1);
});

test('an already enabled terminal is re-read and never restarted', async t => {
  const f = await fixture(t); f.info.terminal.experts_trade_allowed = true;
  const result = await f.invoke(enable());
  assert.equal(result.status, 'applied'); assert.equal(result.result.restarted, false); assert.equal(result.result.verified, true);
  assert.equal(f.preparations(), 0); assert.equal(f.reads(), 2);
});

test('strict action branches and subagents are rejected before native reads or writes', async t => {
  const f = await fixture(t);
  for (const args of [null, [], {}, { action: 'read', command_id: 'not-permitted' }, enable({ extra: true }), enable({ command_id: 'short' }), enable({ expected_version: 0 }), enable({ expected_version: 1.5 }), enable({ action: 'disable' })]) {
    await assert.rejects(f.invoke(args), { code: 'invalid_request' });
  }
  f.host.context.kind = 'subagent';
  for (const args of [{ action: 'read' }, enable()]) await assert.rejects(f.invoke(args), { code: 'FORBIDDEN' });
  assert.equal(f.preparations(), 0); assert.equal(f.reads(), 0); assert.deepEqual(f.store.list('configuration_change'), []);
});

test('the command identity rejects different inputs, operations and sessions', async t => {
  const f = await fixture(t); await f.invoke(enable());
  await assert.rejects(f.invoke(enable({ expected_version: 9 })), { code: 'idempotency_conflict' });
  f.host.context.sessionId = 'conv_other';
  await assert.rejects(f.invoke(enable()), { code: 'idempotency_conflict' });
  f.host.context.sessionId = 'conv_permissions';
  const row = f.store.get('configuration_change', enable().command_id);
  f.store.put('configuration_change', { ...row, fingerprint: 'a-configuration-operation' });
  await assert.rejects(f.invoke(enable()), { code: 'idempotency_conflict' });
  assert.equal(f.preparations(), 1);
});

test('stale configuration and a missing application permission fail without preparation', async t => {
  for (const [adjust, code] of [[f => { f.config.version = 9; }, 'version_conflict'], [f => { f.config.allow_trading = false; }, 'mt5_permission_denied']]) {
    const f = await fixture(t); adjust(f);
    await assert.rejects(f.invoke(enable()), { code });
    const repeated = await f.invoke(enable());
    assert.equal(repeated.status, 'failed'); assert.equal(repeated.error.code, code);
    assert.equal(f.preparations(), 0); assert.equal(f.reads(), 0);
  }
});

test('MCP authorization, read-only and unknown account permissions cannot be repaired by the algorithm switch', async t => {
  for (const [adjust, code] of [
    [f => { f.info.terminal.mcp_trade_allowed = false; }, 'mcp_trading_not_authorized'],
    [f => { f.info.account.read_only = true; }, 'mt5_account_read_only'],
    [f => { delete f.info.account.read_only; }, 'mt5_account_read_only'],
    [f => { f.info.terminal.server_connected = false; }, 'mt5_offline'],
  ]) {
    const f = await fixture(t); adjust(f);
    await assert.rejects(f.invoke(enable()), { code });
    assert.equal(f.preparations(), 0);
    assert.equal((await f.invoke(enable())).status, 'failed');
  }
});

test('changed actual or configured account is rejected both before and after preparation', async t => {
  for (const when of ['before', 'after']) for (const target of ['actual', 'configured']) {
    const f = await fixture(t);
    const change = () => { (target === 'actual' ? f.info.account : f.config.account).login = '7002'; };
    if (when === 'before') change();
    let calls = 0;
    await assert.rejects(f.invoke(enable(), undefined, { prepare: async () => { calls++; change(); return f.prepare(); } }), { code: 'mt5_account_mismatch' });
    assert.equal(calls, when === 'before' ? 0 : 1);
    const result = await f.invoke(enable());
    assert.equal(result.status, 'failed'); assert.equal(result.result.verified, false);
  }
});

test('permission preparation cannot apply after a configuration version or account type changes', async t => {
  for (const [change, code] of [[f => { f.config.version++; }, 'version_conflict'], [f => { f.info.account.type = 'real'; }, 'mt5_account_mismatch']]) {
    const f = await fixture(t);
    await assert.rejects(f.invoke(enable(), undefined, { prepare: async () => { const result = await f.prepare(); change(f); return result; } }), { code });
    const failed = await f.invoke(enable());
    assert.equal(failed.status, 'failed'); assert.equal(failed.result.verified, false); assert.equal(failed.result.restarted, true);
  }
});

test('helper success alone is insufficient when the readback remains disabled or loses account permission', async t => {
  for (const [change, code] of [
    [f => { f.info.terminal.experts_trade_allowed = false; }, 'native_config_not_applied'],
    [f => { f.info.terminal.mcp_trade_allowed = false; }, 'mcp_trading_not_authorized'],
    [f => { f.info.account.read_only = true; }, 'mt5_account_read_only'],
  ]) {
    const f = await fixture(t);
    await assert.rejects(f.invoke(enable(), undefined, { prepare: async () => { change(f); return { restarted: true, verified: true }; } }), { code });
    const receipt = await f.invoke(enable());
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.result.verified, false); assert.ok(receipt.result.after);
  }
});

test('a permission read cannot return a mixed observation from changed configuration', async t => {
  const f = await fixture(t), read = f.mt5.market.connected;
  f.mt5.market.connected = async () => { const result = await read(); f.config.version++; return result; };
  await assert.rejects(f.invoke({ action: 'read' }), { code: 'version_conflict' });
  assert.equal(f.preparations(), 0); assert.deepEqual(f.store.list('configuration_change'), []);
});

test('an unverified helper result retains real readback but is not marked applied', async t => {
  const f = await fixture(t);
  await assert.rejects(f.invoke(enable(), undefined, { prepare: async () => {
    f.info.terminal.experts_trade_allowed = true;
    return { restarted: true, verified: false };
  } }), { code: 'native_config_not_applied' });
  const receipt = await f.invoke(enable());
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.result.verified, false);
  assert.equal(receipt.result.after.terminal.experts_trade_allowed, true);
});

test('native errors are redacted in thrown errors, audit receipts and repeat responses', async t => {
  const f = await fixture(t), secrets = [f.config.account.password, f.config.servers.terminal.token];
  let calls = 0;
  const prepare = async () => { calls++; throw Object.assign(new Error(`Failure ${secrets[0]} ${JSON.stringify(secrets[1])}`), { code: 'fixture_native_failure', status: 409 }); };
  await assert.rejects(f.invoke(enable(), undefined, { prepare }), error => {
    assert.equal(error.code, 'fixture_native_failure'); assert.equal(error.status, 409);
    for (const secret of secrets) assert.ok(!error.message.includes(secret));
    assert.match(error.message, /\[redacted\]/); return true;
  });
  const repeated = await f.invoke(enable(), undefined, { prepare });
  assert.equal(repeated.status, 'failed'); assert.equal(repeated.result.restarted, null);
  for (const secret of secrets) assert.ok(!JSON.stringify([repeated, f.store.list('configuration_change'), f.events]).includes(secret));
  assert.equal(calls, 1);
});

test('historical running and unknown receipts are returned without replay', async t => {
  const f = await fixture(t); await f.invoke(enable());
  const row = f.store.get('configuration_change', enable().command_id), beforeReads = f.reads();
  for (const status of ['running', 'unknown']) {
    f.store.put('configuration_change', { ...row, status, result: { before: row.result.before, after: null, restarted: null, verified: false } });
    assert.equal((await f.invoke(enable())).status, status);
  }
  assert.equal(f.preparations(), 1); assert.equal(f.reads(), beforeReads);
});

test('concurrent duplicate commands observe running state while a different command cannot enter the configuration lock', async t => {
  const f = await fixture(t); let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const active = f.invoke(enable(), undefined, { prepare: async () => { started(); await new Promise(resolve => { release = resolve; }); return f.prepare(); } });
  await entered;
  assert.equal((await f.invoke(enable())).status, 'running');
  await assert.rejects(f.invoke(enable({ command_id: 'prepare-concurrent-other-01' })), { code: 'mt5_busy' });
  release();
  assert.equal((await active).status, 'applied'); assert.equal(f.preparations(), 1);
  assert.equal(f.store.list('configuration_change').length, 1);
});

test('cancellation before work prevents dispatch but cancellation after preparation starts cannot interrupt cleanup and verification', async t => {
  const f = await fixture(t), stopped = new AbortController(); stopped.abort();
  await assert.rejects(f.invoke(enable(), stopped.signal), { name: 'AbortError' });
  assert.equal(f.reads(), 0); assert.deepEqual(f.store.list('configuration_change'), []);
  const active = new AbortController(); let cleanup = false;
  const receipt = await f.invoke(enable(), active.signal, { prepare: async () => {
    active.abort();
    try { return await f.prepare(); } finally { cleanup = true; }
  } });
  assert.equal(cleanup, true); assert.equal(receipt.status, 'applied'); assert.equal(receipt.result.verified, true);
});

test('cancellation during the initial observation is recorded without entering terminal preparation', async t => {
  const f = await fixture(t), controller = new AbortController(), read = f.mt5.market.connected;
  f.mt5.market.connected = async () => { const result = await read(); controller.abort(); return result; };
  await assert.rejects(f.invoke(enable(), controller.signal), { code: 'operation_canceled' });
  const receipt = await f.invoke(enable());
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.result.verified, false); assert.equal(receipt.result.restarted, false);
  assert.equal(f.preparations(), 0);
});

test('readback failure is redacted and never reported as successful preparation', async t => {
  const f = await fixture(t), read = f.mt5.market.connected;
  f.mt5.market.connected = async () => {
    if (f.preparations()) throw new Error(`readback ${f.config.servers.terminal.token}`);
    return read();
  };
  await assert.rejects(f.invoke(enable()), error => !error.message.includes(f.config.servers.terminal.token));
  const result = await f.invoke(enable());
  assert.equal(result.status, 'failed'); assert.equal(result.result.verified, false); assert.equal(result.result.restarted, true);
});
