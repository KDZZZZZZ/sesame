import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { atLeastVersion, adapterOperation, executionTools, EXECUTION_CONTRACT } from '../packages/portfolio-execution/adapter-contract.js';
import { createAdapters } from '../packages/portfolio-execution/adapters.js';
import { targetOrders } from '../packages/portfolio-execution/portfolio.js';
import { outcome } from '../packages/portfolio-execution/service.js';
import { createExecutionAdapter as mt5Adapter } from '../packages/mt5/backend/execution-adapter.js';
import { executionReceipt as mt5Receipt } from '../packages/mt5/backend/execution-evidence.js';
import { records as mt5Records } from '../packages/mt5/backend/records.js';
import { createExecutionAdapter as qmtAdapter } from '../packages/qmt/execution-adapter.js';
import { createService as qmtService } from '../packages/qmt/service.js';
import { capability as qmtCapability } from '../packages/qmt/execution.js';
import { records as qmtRecords, closeRecords as closeQmt } from '../packages/qmt/records.js';
import { createTradingContext as qmtContext } from '../packages/qmt/trading-context.js';
import { manifests } from './portfolio-adapter-fixture.mjs';

function declarationHost(backend, version, kind = 'main') {
  const manifest = structuredClone(manifests[backend]), calls = [];
  const host = { context: { kind }, plugins: { read: async (_id, options) => options.part === 'status' ? { state: 'mounted', version } : { ...manifest, version } },
    capabilities: { invoke: async (id, input) => { calls.push({ id, input }); return { type: 'result', value: { contract: EXECUTION_CONTRACT, backend, account: { accountId: 'account', connectionId: 'route', revision: '1' } } }; } } };
  return { host, manifest, calls };
}

test('QMT stable 2.x and later use actual declared contracts, not a 1.x regex or latest-version gate', async () => {
  for (const version of ['1.2.0', '1.10.0', '2.0.0', '2.1.0+build.7', '12.0.0']) {
    const f = declarationHost('qmt', version);
    assert.equal((await adapterOperation(f.host, 'qmt', 'submit')).id, 'qmt_execution_submit');
    assert.equal(f.calls.length, 0, 'declaration inspection never probes a write or claims readiness');
  }
  for (const version of ['1.1.99', '1.2.0-rc.1', '01.2.0', '1.2', '2.0.0oops', 'v2.0.0', '2.0.0-01']) {
    const f = declarationHost('qmt', version);
    await assert.rejects(adapterOperation(f.host, 'qmt', 'submit'), { code: 'PREREQUISITE_REQUIRED' }); assert.equal(f.calls.length, 0);
  }
  assert.equal(atLeastVersion('2.0.0-alpha.10', '2.0.0-alpha.2'), true);
  assert.equal(atLeastVersion('2.0.0-alpha.2', '2.0.0-alpha.10'), false);
  assert.equal(atLeastVersion('2.0.0-alpha', '2.0.0'), false);
  assert.equal(atLeastVersion('2.0.0+ignored', '2.0.0'), true);
});

test('manual and delegated floors are independent; no version bypasses missing declarations or guard inputs', async () => {
  const old = declarationHost('qmt', '1.3.99');
  await adapterOperation(old.host, 'qmt', 'submit');
  await assert.rejects(executionTools(old.host, 'qmt'), { code: 'PREREQUISITE_REQUIRED' });
  const modern = declarationHost('qmt', '2.0.0', 'subagent');
  assert.equal((await executionTools(modern.host, 'qmt')).writes.length, 2);
  await assert.rejects(adapterOperation(modern.host, 'qmt', 'prepare'), { code: 'FORBIDDEN' });
  for (const change of [
    m => { m.services = []; }, m => { m.capabilities = m.capabilities.filter(row => row.id !== 'qmt_execution_submit'); },
    m => { m.capabilities.find(row => row.id === 'qmt_execution_submit').effects = ['backend.read']; },
    m => { m.capabilities.find(row => row.id === 'qmt_execution_submit').inputSchema.properties.intent.properties.user_authorized = { type: 'boolean' }; },
    m => { m.capabilities.find(row => row.id === 'qmt_execution_submit').outputSchema.properties.contract.const = 'other/1'; },
  ]) {
    const f = declarationHost('qmt', '2.0.0'); change(f.manifest);
    await assert.rejects(adapterOperation(f.host, 'qmt', 'submit'), { code: 'PREREQUISITE_REQUIRED' }); assert.equal(f.calls.length, 0);
  }
  const read = declarationHost('qmt', '2.0.0');
  read.manifest.capabilities.find(row => row.id === 'qmt_execution_snapshot').effects = ['external-trading'];
  await assert.rejects(adapterOperation(read.host, 'qmt', 'snapshot'), { code: 'PREREQUISITE_REQUIRED' });
  const mt5 = declarationHost('mt5', '2.1.0');
  await executionTools(mt5.host, 'mt5');
  await assert.rejects(adapterOperation(mt5.host, 'mt5', 'prepare'), { code: 'PREREQUISITE_REQUIRED' });
});

test('normalized services declare disjoint read/write operations with truthful receipt output contracts', () => {
  for (const backend of ['mt5', 'qmt']) {
    const service = manifests[backend].services.find(row => row.contract === EXECUTION_CONTRACT);
    assert.deepEqual(Object.keys(service.operations).sort(), ['cancel', 'command', 'identity', 'prepare', 'recover', 'snapshot', 'submit']);
    for (const [operation, id] of Object.entries(service.operations)) {
      const declaration = manifests[backend].capabilities.find(row => row.id === id);
      assert.equal(declaration.outputSchema.properties.contract.const, EXECUTION_CONTRACT);
      assert.equal(declaration.effects.includes('external-trading'), ['submit', 'cancel'].includes(operation));
      if (['identity', 'snapshot', 'recover', 'command'].includes(operation)) assert.equal(declaration.effects.includes('application-configuration'), false);
    }
  }
  const schema = manifests.mt5.capabilities.find(row => row.id === 'mt5_execution_submit').outputSchema;
  const raw = { status: 'returned', result: { result: { retcode: 10009, order: '9007199254740993' } } };
  const receipt = mt5Receipt(raw);
  assert.equal(Value.Check(schema, receipt), true); assert.deepEqual(receipt.raw, raw);
  assert.equal(Value.Check(schema, { ...receipt, contract: undefined }), false);
  assert.equal(Value.Check(schema, { ...receipt, submissionAttempted: 'yes' }), false);
  assert.equal(outcome('mt5', raw), 'outcome_unknown', 'portfolio cannot interpret a bare SDK retcode');
  assert.equal(outcome('mt5', receipt), 'execution_reported');
});

test('MT5 prepare commandId declaration matches the native guard without rewriting operation identity', async t => {
  const schema = manifests.mt5.capabilities.find(row => row.id === 'mt5_execution_prepare').inputSchema;
  assert.deepEqual(schema.properties.commandId, { type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]{16,128}$' });
  const storageRoot = mkdtempSync(join(tmpdir(), 'portfolio-prepare-parity-'));
  const host = { context: { kind: 'main', sessionId: 'owner', storageRoot } };
  t.after(() => { mt5Records(host).close(); rmSync(storageRoot, { recursive: true, force: true }); });
  const account = { accountId: '42', server: 'Fixture', revision: '1' }, observedAt = 1792575202000;
  const calls = [], config = { version: 1, allow_trading: true, account: { login: account.accountId, server: account.server } };
  let permissionReads = 0;
  const data = {
    account_info: { login: account.accountId, server: account.server, trade_allowed: true, trade_expert: true },
    terminal_info: { connected: true, trade_allowed: true, tradeapi_disabled: false },
    symbol_info: { name: 'EURUSD', point: 0.0001, volume_min: 0.01, volume_max: 10, volume_step: 0.01 },
    positions_get: [], orders_get: [], symbol_info_tick: { time_msc: observedAt, bid: 1.1, ask: 1.1001 },
  };
  const clock = { status: 'verified', source: 'mt5/python/symbol_info_tick', accountId: account.accountId, server: account.server,
    rawTimeMs: observedAt, sourceTimeMs: observedAt, basis: 'utc', offsetMinutes: 0, ruleId: 'fixture', ruleRevision: 'fixture-1' };
  const mt5 = { official: { config, settings: () => structuredClone(config), redact: value => value,
    configure: () => assert.fail('Preparation parity must not change permissions'),
    async call(request) {
      assert.equal(request.server, 'python'); assert.ok(Object.hasOwn(data, request.tool), 'Only scripted native reads are allowed');
      calls.push(request);
      return { id: request.command_id, status: 'returned', result: { result: structuredClone(data[request.tool]), last_error: [1, 'Success'],
        ...(request.tool === 'symbol_info_tick' ? { quote_clock: clock } : {}) } };
    },
  }, market: { async connected() {
    permissionReads++;
    return { scope: config.account, info: { account: { ...config.account, type: 'demo', read_only: false },
      terminal: { server_connected: true, experts_trade_allowed: true, mcp_trade_allowed: true } } };
  } } };
  // No preparation-function injection: this runs the actual native validator
  // and journal through the adapter, with only SDK reads replaced by fixtures.
  const adapter = mt5Adapter(host, mt5, { now: () => observedAt });
  for (const commandId of ['', 'x', 'A'.repeat(15), 'A'.repeat(129), 'A'.repeat(15) + ' ', 'A'.repeat(15) + '/', 'A'.repeat(15) + '\n', 'A'.repeat(15) + '中']) {
    const input = { symbol: 'EURUSD', account, commandId, userAuthorized: true };
    assert.equal(Value.Check(schema, input), false, JSON.stringify(commandId));
    await assert.rejects(adapter.prepare(input), { code: 'invalid_request' });
    assert.equal(calls.length, 0); assert.equal(permissionReads, 0);
  }
  const accepted = ['A'.repeat(16), 'a'.repeat(16), 'Ab0_-'.repeat(4), 'Z'.repeat(128)];
  for (const commandId of accepted) {
    const input = { symbol: 'EURUSD', account, commandId, userAuthorized: true };
    assert.equal(Value.Check(schema, input), true, commandId);
    const prepared = await adapter.prepare(input);
    assert.equal(prepared.preparation.status, 'ready'); assert.equal(prepared.preparation.commandId, commandId);
    const retained = mt5Records(host).get('mt5_trading_preparations', commandId);
    assert.equal(retained.id, commandId); assert.equal(retained.status, 'ready');
  }
  assert.equal(permissionReads, accepted.length);
  assert.deepEqual(mt5Records(host).list('mt5_trading_preparations').map(row => row.id).sort(), [...accepted].sort());
});

test('10025/10028 retain conservative uncertainty shared with positions; no unsupported no-submission inference', () => {
  for (const retcode of [10011, 10012, 10025, 10028, 10031]) {
    const raw = { status: 'returned', result: { result: { retcode, order: '0', deal: '0' } } };
    const receipt = mt5Receipt(raw);
    assert.equal(receipt.status, 'outcome_unknown'); assert.equal(receipt.submissionAttempted, true); assert.deepEqual(receipt.raw, raw);
  }
  assert.equal(mt5Receipt({ status: 'returned', result: { submission_attempted: false, result: { retcode: 10028 } } }).status, 'rejected');
});

function delegated(backend, account) {
  const execution = { pluginId: 'sesame/portfolio-execution', applyTool: 'portfolio_execution_apply', contextTool: 'portfolio_execution_context', account, context: { backend, account } };
  return { provenance: { agent: { pluginId: 'fixture/workflow', status: 'running', sessionId: 'child', taskId: 'task', runId: 'task', input: {
    role: 'executor', runId: 'run', tradingPlan: { id: 'plan', ownerConversationId: 'owner', account }, execution,
  } }, chain: [
    { pluginId: 'fixture/workflow', capabilityId: 'fixture/workflow#apply' },
    { pluginId: 'sesame/portfolio-execution', capabilityId: 'sesame/portfolio-execution#portfolio_execution_apply' },
    { pluginId: `sesame/${backend}`, capabilityId: `sesame/${backend}#${backend}_execution_submit` },
  ] } };
}
const time = 1792575202000;
function observation(backend, account) {
  return { backend, account, symbol: backend === 'mt5' ? 'EURUSD' : '600000.SH', spec: { name: 'EURUSD', volume_min: 0.01, volume_max: 10, volume_step: 0.01, filling_mode: 2 }, positions: [],
    quote: { sourceTimeMs: time, clock: { status: 'verified', ruleRevision: 'fixture-clock' } }, expiresAt: time + 60000 };
}
const intent = backend => ({ operation_id: 'fixture-one', backendCommandId: 'fixture-command-one', user_authorized: true, remark: 'fixture-owned', action: backend === 'mt5' ? 'market' : 'limit', side: 'buy', quantity: backend === 'mt5' ? '0.1' : '100', price_limit: '10.1', ...(backend === 'qmt' ? { limit_price: '10' } : {}) });

test('MT5 normalized submit keeps exact workflow authority separate from host position reduction', async t => {
  const storageRoot = mkdtempSync(join(tmpdir(), 'portfolio-adapter-mt5-')), account = { accountId: '42', server: 'fixture', revision: '1' };
  const host = { context: { kind: 'subagent', sessionId: 'child', storageRoot } }, calls = [];
  t.after(() => { mt5Records(host).close(); rmSync(storageRoot, { recursive: true, force: true }); });
  const official = { settings: () => ({ account: { login: '42', server: 'fixture' }, version: 1 }), call: async args => { calls.push(args); return { status: 'returned', result: { result: { retcode: 10012, order: '0', deal: '0' } } }; } };
  const service = mt5Adapter(host, { official }, { now: () => time }), args = { observation: observation('mt5', account), intent: intent('mt5') };
  const proof = delegated('mt5', account);
  for (const mutate of [
    p => { p.provenance.chain.shift(); }, p => { p.provenance.agent.input.role = 'manager'; },
    p => { p.provenance.chain.at(-1).capabilityId = 'sesame/mt5#mt5_trading_order'; },
    p => { p.provenance.chain[1].capabilityId = 'sesame/mt5#positions_close'; },
  ]) {
    const bad = structuredClone(proof); mutate(bad);
    await assert.rejects(service.submit(args, undefined, bad), { code: 'FORBIDDEN' }); assert.equal(calls.length, 0);
  }
  const receipt = await service.submit(args, undefined, proof);
  assert.equal(receipt.status, 'outcome_unknown'); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].arguments.execution_guard.expected_positions, []);
  assert.equal(calls[0].arguments.execution_guard.max_quote_age_ms, 5000);
  assert.equal(calls[0].arguments.execution_guard.max_quote_to_send_ms, 1000);
  assert.equal(calls[0].arguments.execution_guard.quote_clock_revision, 'fixture-clock');
  assert.equal(mt5Records(host).get('mt5_trading_commands', args.intent.backendCommandId).planId, 'plan');
  await assert.rejects(service.prepare({ ...args, userAuthorized: true }), { code: 'FORBIDDEN' });
});

function qmtFixture(t, kind = 'main') {
  const storageRoot = mkdtempSync(join(tmpdir(), 'portfolio-adapter-qmt-'));
  const host = { context: { kind, sessionId: kind === 'main' ? 'owner' : 'child', storageRoot } };
  const account = { accountId: '00123', connectionId: 'fixture', revision: '2' };
  qmtRecords(host).put('configuration', { id: 'local', version: 2, connection_id: 'fixture', python_path: 'unused-fixture-python', userdata_directory: storageRoot, account_id: account.accountId });
  t.after(() => { closeQmt(host); rmSync(storageRoot, { recursive: true, force: true }); });
  return { host, account };
}

test('QMT normalized submit uses delegated floor authority and native final-mile guards, never replays unknown', async t => {
  const { host, account } = qmtFixture(t, 'subagent'), sends = [];
  const native = qmtService(host, { platform: 'win32', now: () => time, request: async request => { sends.push(request); throw Object.assign(new Error('Fixture transport uncertainty'), { code: 'SOURCE_UNAVAILABLE' }); } });
  t.after(() => native.dispose());
  const adapter = qmtAdapter(host, native, { now: () => time });
  const execute = qmtCapability('qmt_execution_submit', adapter.submit).execute, args = { observation: observation('qmt', account), intent: intent('qmt') }, proof = delegated('qmt', account);
  const forged = structuredClone(proof); forged.provenance.chain.shift();
  await assert.rejects(execute(args, undefined, forged), { code: 'FORBIDDEN' }); assert.equal(sends.length, 0);
  await assert.rejects(execute(args, undefined, proof), { code: 'SOURCE_UNAVAILABLE' }); assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].execution_guard.expected_positions, []); assert.equal(sends[0].execution_guard.max_quote_age_ms, 5000); assert.equal(sends[0].execution_guard.max_quote_to_send_ms, 1000);
  const retained = await execute(args, undefined, proof);
  assert.equal(retained.status, 'outcome_unknown'); assert.equal(sends.length, 1); assert.equal(retained.raw.status, 'outcome_unknown');
});

test('QMT account context exposes unavailable historical orders truthfully and does not execute permission or trading actions', async t => {
  const { host, account } = qmtFixture(t), calls = [];
  const service = { native: async (action) => { calls.push(action); return { connection: { id: account.connectionId, revision: account.revision }, ...(action === 'asset' ? { asset: { account_id: account.accountId } } : { items: [], nextCursor: null }) }; } };
  const value = await qmtContext(host, service, { now: () => time })({ action: 'snapshot', history_days: 30 });
  assert.deepEqual(value.historicalOrders, []); assert.equal(value.historyCoverage.complete, false);
  assert.deepEqual(value.historyCoverage.historicalOrders, { status: 'unavailable', reason: 'native_current_day_only' });
  assert.equal(value.historyCoverage.requestedDays, 30); assert.deepEqual(calls.sort(), ['asset', 'fills', 'orders', 'positions']);
  const schema = manifests.qmt.capabilities.find(row => row.id === 'qmt_trading_context').outputSchema;
  assert.equal(Value.Check(schema, value), true);
  assert.equal(Value.Check(schema, { ...value, historicalOrders: undefined }), false);
  assert.equal(Value.Check(schema, { ...value, historyCoverage: { ...value.historyCoverage, complete: true } }), false);
  assert.equal(Value.Check(schema, { ...value, historyCoverage: { ...value.historyCoverage, historicalOrders: { status: 'complete' } } }), false);
  const adapter = qmtAdapter(host, service, { now: () => time });
  const normalized = await adapter.snapshot({ history_days: 30 });
  assert.equal(Value.Check(manifests.qmt.capabilities.find(row => row.id === 'qmt_execution_snapshot').outputSchema, normalized), true);
  assert.deepEqual(normalized.projection, { positions: [], orders: [] });
  service.native = async action => { if (action === 'fills') throw Object.assign(new Error('Unavailable current-day fills'), { code: 'SOURCE_UNAVAILABLE' }); return { connection: { id: account.connectionId, revision: account.revision }, asset: { account_id: account.accountId }, items: [] }; };
  await assert.rejects(adapter.snapshot({ history_days: 30 }), { code: 'SOURCE_UNAVAILABLE' });
});

test('portfolio consumes semantic quantities and opaque position IDs without native SDK enum or field knowledge', () => {
  const rows = [{ id: 'opaque-long', symbol: 'X', side: 'buy', quantity: '2', availableQuantity: '2' }, { id: 'opaque-short', symbol: 'X', side: 'sell', quantity: '1', availableQuantity: '1' }];
  assert.deepEqual(targetOrders('mt5', { symbol: 'X', quantity: '0' }, rows), [{ action: 'close', side: 'buy', quantity: '1', position_id: 'opaque-short' }, { action: 'close', side: 'sell', quantity: '2', position_id: 'opaque-long' }]);
  assert.throws(() => targetOrders('qmt', { symbol: 'X', quantity: '0' }, [{ id: 'holding', symbol: 'X', side: 'buy', quantity: '100', availableQuantity: '0' }]), { code: 'POSITION_UNAVAILABLE' });
  for (const file of ['adapters.js', 'service.js', 'portfolio.js']) {
    const source = readFileSync(new URL(`../packages/portfolio-execution/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /history_deals_get|history_orders_get|order_send|TRADE_ACTION_|ORDER_FILLING_|10025|10028|can_use_volume|order_status/);
  }
});
