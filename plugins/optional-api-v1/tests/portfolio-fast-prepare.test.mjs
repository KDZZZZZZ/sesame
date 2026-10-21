import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { digest } from '@sesame/plugin-sdk/protocol';
import { createService, POLICY } from '../packages/portfolio-execution/service.js';
import { createAdapters } from '../packages/portfolio-execution/adapters.js';
import { createCapabilities } from '../packages/portfolio-execution/index.js';
import { records, closeRecords } from '../packages/portfolio-execution/records.js';

const fixtures = [];
after(() => {
  for (const host of fixtures) {
    closeRecords(host);
    const root = resolve(host.context.storageRoot);
    assert.ok(root.startsWith(resolve(tmpdir(), 'portfolio-fast-')));
    rmSync(root, { recursive: true, force: true });
  }
});

function persisted(host, collection) {
  const db = new DatabaseSync(join(host.context.storageRoot, 'execution.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT value FROM records WHERE collection=?').all(collection).map(row => JSON.parse(row.value)); }
  finally { db.close(); }
}

const quoteClock=(account,time)=>({status:'verified',source:'mt5/python/symbol_info_tick',server:account.server,accountId:account.accountId,
  rawTimeMs:time+10800000,sourceTimeMs:time,basis:'server-wall',offsetMinutes:180,ruleId:'ftmo-demo-current-tick-2026',ruleRevision:'ftmo-demo-current-tick-2026-v1'});
function fixture() {
  let time = 1792575202000;
  const account = { accountId: '8001', server: 'FTMO-Demo', revision: '1' };
  const calls = [], hooks = {};
  const host = {
    context: { kind: 'main', sessionId: 'conv_fast', storageRoot: mkdtempSync(join(tmpdir(), 'portfolio-fast-')) },
    plugins: { read: async () => ({ state: 'mounted', version: '2.1.7', runtime_status: 'ready' }) },
    capabilities: { invoke: async (ref, args, options) => {
      const name = ref.split('#')[1]; calls.push({ name, args: structuredClone(args), options });
      if (name === 'mt5_settings') {
        await hooks.identity?.();
        return { type: 'result', value: { settings: { version: Number(account.revision), account: { login: account.accountId, server: account.server } } } };
      }
      if (name === 'mt5_trading_prepare') {
        assert.match(args.command_id, /^[A-Za-z0-9_-]{16,128}$/);
        assert.equal(args.user_authorized, true);
        assert.deepEqual(args.expected_account, account);
        const pending = [...persisted(host, 'preparations'), ...persisted(host, 'commands')].filter(row => row.status === 'preparing');
        assert.equal(pending.length, 1, 'prepare intent must be durable before permission effects');
        assert.equal(pending[0].submission_attempted, false);
        const began = time;
        await hooks.prepare?.(args, options);
        const value = {
          account: structuredClone(account),
          summary: { login: Number(account.accountId), server: account.server, balance: 10000, equity: 10000, currency: 'USD', trade_allowed: true, trade_expert: true },
          terminal: { connected: true, trade_allowed: true, tradeapi_disabled: false },
          spec: { name: args.symbol, volume_min: 0.01, volume_max: 10, volume_step: 0.01, filling_mode: 2, trade_exemode: 2 },
          positions: [], orders: [], tick: { time_msc: time+10800000, bid: 100, ask: 101 }, quote_clock: quoteClock(account,time),
          readStartedAt: began, capturedAt: time,
          preparation: { commandId: args.command_id, status: 'ready', applicationPermissionChanged: account.revision !== '1', restarted: time - began >= 90000, initialized: false },
        };
        await hooks.prepared?.(value);
        return { type: 'result', value };
      }
      if (name === 'mt5_trade') {
        const row = persisted(host, 'commands').find(value => value.backendCommandId === args.command_id);
        assert.equal(row.status, 'submitting');
        assert.equal(row.submission_attempted, null);
        assert.equal(args.arguments.execution_guard.expected_account, account.accountId);
        assert.equal(args.arguments.execution_guard.expected_server, account.server);
        assert.equal(args.arguments.execution_guard.observed_at, row.signalSourceAt);
        assert.equal(args.arguments.execution_guard.max_quote_age_ms, 5000);
        assert.equal(args.arguments.execution_guard.max_quote_to_send_ms, 1000);
        assert.equal(args.arguments.execution_guard.quote_clock_revision, 'ftmo-demo-current-tick-2026-v1');
        assert.equal('expected_revision' in args.arguments.execution_guard, false);
        const value = await hooks.trade?.(args, options) ?? { status: 'returned', result: { result: { retcode: 10009, order: '7001', deal: '7002' }, execution_timing: { quote_to_send_ms: 1, send_to_receipt_ms: 2 } } };
        return { type: 'result', value };
      }
      throw new Error(`Unexpected preparation call: ${name}`);
    } },
  };
  fixtures.push(host);
  const create = options => createService(host, { now: () => time, ...options });
  return { host, account, calls, hooks, create, service: create(), advance: ms => { time += ms; }, get time() { return time; }, names: () => calls.map(row => row.name) };
}

const preparation = (id = 'prepare-one') => ({ backend: 'mt5', symbol: 'FIXTURE', operation_id: id, user_authorized: true });
const intent = (id = 'execute-one') => ({ ...preparation(id), action: 'market', side: 'buy', quantity: '0.1', price_limit: '102' });

test('prepare is one identity + one backend call, records intent first and never sends an order', async () => {
  const f = fixture();
  const result = await f.service.prepare(preparation());
  assert.equal(result.status, 'prepared'); assert.equal(result.submission_attempted, false);
  assert.ok(result.observation_id); assert.equal(result.account.accountId, f.account.accountId);
  assert.deepEqual(result.orders, []); assert.equal(result.preparation.restarted, false);
  assert.equal(result.quote.sourceTimeMs, f.time); assert.equal(result.quote.source, 'mt5/python/symbol_info_tick');
  assert.equal(result.quote.clock.rawTimeMs, f.time+10800000);
  assert.equal(result.quote.clock.offsetMinutes, 180);
  assert.equal(result.quote.receivedAt, f.time); assert.equal(result.quote.requestMs, null);
  assert.deepEqual(f.names(), ['mt5_settings', 'mt5_trading_prepare']);
  assert.deepEqual(await f.service.prepare(preparation()), result);
  closeRecords(f.host);
  assert.deepEqual(await f.create().prepare(preparation()), result);
  assert.equal(f.calls.length, 2);
  await assert.rejects(f.service.prepare({ ...preparation(), symbol: 'OTHER' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('long terminal preparation finishes before the last tick starts the quote/decision clock', async () => {
  const f = fixture(), began = f.time;
  f.hooks.prepare = () => { f.advance(95000); f.account.revision = '2'; };
  const result = await f.service.prepare(preparation());
  assert.equal(result.status, 'prepared'); assert.equal(result.preparation.restarted, true);
  assert.equal(result.account.revision, '2'); assert.equal(result.quote.sourceTimeMs, began + 95000);
  assert.equal(result.expiresAt, began + 95000 + POLICY.maxDecisionAgeMs);
  assert.equal(result.timing.preparation_request_ms, 95000);
  assert.equal(result.observation_request_ms, 95000);
  assert.ok(POLICY.maxPreparationMs > 90000); assert.equal(POLICY.maxReadMs, 10000);
});

test('preparation receives its separate timeout while identity and final dispatch retain short bounds', async t => {
  const f = fixture(), timeouts = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => { timeouts.push(milliseconds); return new AbortController().signal; });
  assert.equal((await f.service.execute(intent())).status, 'execution_reported');
  assert.deepEqual(timeouts, [POLICY.maxReadMs, POLICY.maxPreparationMs, POLICY.maxReadMs, POLICY.maxReadMs]);
});

test('total request timing includes initial identity latency rather than just the preparation call', async () => {
  const f = fixture(); f.hooks.identity = () => { f.advance(100); }; f.hooks.prepare = () => { f.advance(200); };
  const prepared = await f.service.prepare(preparation());
  assert.equal(prepared.timing.preparation_request_ms, 200); assert.equal(prepared.timing.total_request_ms, 300);
  const executed = await f.service.execute(intent());
  assert.equal(executed.timing.preparation_request_ms, 200); assert.equal(executed.timing.wrapper_to_receipt_ms, 400);
  assert.equal(executed.timing.model_round_trip_ms, 0);
});

test('fast execution prepares then submits within one call, freezes original intent and final-checks the new revision', async () => {
  const f = fixture(), args = intent(), began = f.time;
  f.hooks.prepare = () => { f.advance(95000); f.account.revision = '2'; };
  const result = await f.service.execute(args);
  assert.equal(result.status, 'execution_reported'); assert.equal(result.submission_attempted, true);
  assert.equal(result.account.revision, '2'); assert.ok(result.observationId);
  assert.equal(result.fingerprint, digest(args)); assert.equal(result.signalSourceAt, began + 95000);
  assert.equal(result.timing.model_round_trip_ms, 0); assert.equal(result.timing.preparation_request_ms, 95000);
  assert.equal(result.timing.signal_age_at_start_ms, 0); assert.equal(result.timing.quote_to_send_ms, 1);
  assert.deepEqual(f.names(), ['mt5_settings', 'mt5_trading_prepare', 'mt5_settings', 'mt5_trade']);
  assert.deepEqual(result.intent, { priceLimit: '102', limitPrice: null, positionId: null, stopLoss: null, takeProfit: null });
  assert.equal(f.calls.at(-1).args.arguments.request.volume, 0.1);
  closeRecords(f.host);
  assert.deepEqual(await f.create().execute(args), result); assert.equal(f.calls.length, 4);
  await assert.rejects(f.service.execute({ ...args, quantity: '0.2' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('concurrent identical fast requests share one preparation and one submit without nested-lock deadlock', { timeout: 3000 }, async () => {
  const f = fixture(), args = intent();
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.hooks.prepare = async () => { enter(); await gate; };
  const first = f.service.execute(args); await entered;
  const second = f.service.execute(args); release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 'execution_reported'); assert.deepEqual(a, b);
  assert.equal(f.names().filter(name => name === 'mt5_trading_prepare').length, 1);
  assert.equal(f.names().filter(name => name === 'mt5_trade').length, 1);
  assert.deepEqual(f.names(), ['mt5_settings', 'mt5_trading_prepare', 'mt5_settings', 'mt5_trade']);
});

test('simultaneous prepare calls return the same saved observation and do not repeat permission work', async () => {
  const f = fixture(), args = preparation();
  const [a, b] = await Promise.all([f.service.prepare(args), f.service.prepare(args)]);
  assert.equal(a.status, 'prepared'); assert.deepEqual(a, b);
  assert.equal(f.names().filter(name => name === 'mt5_trading_prepare').length, 1);
  assert.equal(f.names().filter(name => name === 'mt5_trade').length, 0);
});

test('new main-only authority cannot be acquired by delegated workflows, false authorization or another conversation', async () => {
  for (const mode of ['unauthorized', 'subagent', 'workflow']) {
    const f = fixture(), args = mode === 'unauthorized' ? { ...preparation(), user_authorized: false } : preparation();
    if (mode === 'subagent') f.host.context.kind = 'subagent';
    const service = f.create(mode === 'workflow' ? { authorize: () => {}, ownerConversationId: 'conv_fast' } : undefined);
    await assert.rejects(service.prepare(args), { code: 'FORBIDDEN' });
    await assert.rejects(service.execute({ ...intent(), user_authorized: args.user_authorized }), { code: 'FORBIDDEN' });
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); await f.service.prepare(preparation()); await f.service.execute(intent());
  const count = f.calls.length; f.host.context.sessionId = 'foreign-conversation';
  await assert.rejects(f.create().prepare(preparation()), { code: 'FORBIDDEN' });
  await assert.rejects(f.create().execute(intent()), { code: 'FORBIDDEN' }); assert.equal(f.calls.length, count);
});

test('cross-account preparation or a configuration change after preparation rejects before any send', async () => {
  const f = fixture(); f.hooks.prepared = value => { value.account.accountId = '8002'; value.summary.login = 8002; };
  const mismatch = await f.service.execute(intent());
  assert.equal(mismatch.status, 'rejected'); assert.equal(mismatch.submission_attempted, false);
  assert.equal(mismatch.error.code, 'ACCOUNT_MISMATCH'); assert.match(mismatch.error.message, /different account/);
  assert.equal(f.names().includes('mt5_trade'), false);
  const g = fixture(); g.hooks.prepared = () => { g.account.revision = '3'; };
  const changed = await g.service.execute(intent());
  assert.equal(changed.status, 'rejected'); assert.equal(changed.submission_attempted, false);
  assert.equal(changed.error.code, 'CONNECTION_CHANGED'); assert.equal(g.names().includes('mt5_trade'), false);
});

test('an unknown prior same-account order blocks permission preparation and native dispatch even after revision changes', async () => {
  const f = fixture();
  records(f.host).put('commands', { id: 'unknown-prior', kind: 'order', backend: 'mt5', account: { ...f.account, revision: '0' }, conversationId: 'foreign-conversation', status: 'outcome_unknown' });
  const prepared = await f.service.prepare(preparation()), sent = await f.service.execute(intent());
  for (const result of [prepared, sent]) {
    assert.equal(result.status, 'rejected'); assert.equal(result.submission_attempted, false);
    assert.equal(result.error.code, 'UNRESOLVED_ORDER'); assert.match(result.error.details.reason, /unknown-prior/);
  }
  assert.deepEqual(f.names(), ['mt5_settings', 'mt5_settings']);
});

test('stale and future ticks retain source/received time and measured age, reject and cannot replay preparation', async () => {
  for (const offset of [-5001, 1, 7200000]) {
    const f = fixture(); f.hooks.prepared = value => { value.tick.time_msc += offset; value.quote_clock.rawTimeMs+=offset; value.quote_clock.sourceTimeMs+=offset; };
    const args = intent(), result = await f.service.execute(args);
    assert.equal(result.status, 'rejected'); assert.equal(result.submission_attempted, false);
    assert.equal(result.error.code, 'STALE_QUOTE'); assert.equal(result.error.details.reason, offset > 0 ? 'future_quote' : 'stale_quote');
    assert.equal(result.error.details.sourceTimeMs, f.time + offset); assert.equal(result.error.details.receivedAt, f.time);
    assert.equal(result.error.details.ageMs, -offset); assert.equal(result.error.details.source, 'mt5/python/symbol_info_tick');
    assert.equal(records(f.host).list('observations').length, 0);
    assert.deepEqual(await f.service.execute(args), result);
    assert.deepEqual(f.names(), ['mt5_settings', 'mt5_trading_prepare']);
  }
});

test('native preparation errors preserve code, message and diagnostic details without a fake success', async () => {
  const f = fixture();
  f.hooks.prepare = () => { throw Object.assign(new Error('Python account_info IPC channel missing'), { code: 'MT5_PYTHON_UNAVAILABLE', details: { nativeCode: -10004, method: 'account_info', retryable: false } }); };
  const result = await f.service.prepare(preparation());
  assert.equal(result.status, 'rejected'); assert.equal(result.submission_attempted, false);
  assert.equal(result.error.code, 'MT5_PYTHON_UNAVAILABLE'); assert.equal(result.error.message, 'Python account_info IPC channel missing');
  assert.equal(result.error.details.nativeCode, -10004); assert.equal(result.error.details.method, 'account_info');
  assert.equal(result.observation_id, undefined);
  assert.deepEqual(await f.service.prepare(preparation()), result); assert.equal(f.calls.length, 2);
});

test('unverified or inconsistent MT5 clock proof never creates an observation or sends', async () => {
  for(const [change,code] of [
    [value=>{delete value.quote_clock;},'QUOTE_CLOCK_UNVERIFIED'],
    [value=>{value.quote_clock.status='unverified';value.quote_clock.reason='unsupported_period';},'QUOTE_CLOCK_UNVERIFIED'],
    [value=>{value.quote_clock.accountId='another-account';},'ACCOUNT_MISMATCH'],
    [value=>{value.quote_clock.server='another-server';},'ACCOUNT_MISMATCH'],
    [value=>{value.quote_clock.rawTimeMs++;},'SOURCE_DATA_INVALID'],
    [value=>{value.quote_clock.sourceTimeMs++;},'SOURCE_DATA_INVALID'],
    [value=>{value.quote_clock.ruleRevision='';},'SOURCE_DATA_INVALID'],
    [value=>{value.quote_clock.basis='utc';},'SOURCE_DATA_INVALID'],
  ]) {
    const f=fixture();f.hooks.prepared=change;
    const result=await f.service.execute(intent());
    assert.equal(result.status,'rejected');assert.equal(result.error.code,code);assert.equal(result.submission_attempted,false);
    assert.equal(records(f.host).list('observations').length,0);assert.equal(f.names().includes('mt5_trade'),false);
  }
});

test('pure observation consumes the provider clock envelope without modifying the raw SDK tick', async () => {
  const f=fixture(),tick={time_msc:f.time+10800000,bid:100,ask:101},proof=quoteClock(f.account,f.time),before=structuredClone(tick),calls=[];
  const host={context:{kind:'main'},plugins:f.host.plugins,capabilities:{invoke:async(ref,args)=>{
    const name=ref.split('#')[1];calls.push({name,args});
    if(name==='mt5_settings')return {type:'result',value:{settings:{version:1,account:{login:f.account.accountId,server:f.account.server}}}};
    if(name==='mt5_catalog')return {type:'result',value:{items:[{server:'python',tools:[{name:'order_send',callable:true,inputSchema:{properties:{execution_guard:{}}}}]}]}};
    assert.equal(name,'mt5_python');
    const values={account_info:{login:f.account.accountId,server:f.account.server},terminal_info:{connected:true},symbol_info:{name:'FIXTURE'},positions_get:[],symbol_info_tick:tick};
    return {type:'result',value:{status:'returned',result:{result:values[args.tool],...(args.tool==='symbol_info_tick'?{quote_clock:proof}:{})}}};
  }}};
  const result=await createAdapters(host,{now:()=>f.time}).snapshot('mt5','FIXTURE');
  assert.equal(result.quote.sourceTimeMs,f.time);assert.deepEqual(result.quote.clock,proof);assert.deepEqual(tick,before);
  assert.equal(calls.filter(c=>c.args.tool==='symbol_info_tick').length,1);
  proof.status='unverified';proof.reason='unknown_server';
  await assert.rejects(createAdapters(host,{now:()=>f.time}).snapshot('mt5','FIXTURE'),{code:'QUOTE_CLOCK_UNVERIFIED'});
  assert.equal(calls.some(c=>c.name==='mt5_trade'||c.name==='mt5_trading_prepare'),false);
});

test('an incomplete preparation receipt or malformed source clock cannot be reported as prepared', async () => {
  for (const change of [value => { value.preparation.status = 'failed'; }, value => { value.positions = [null]; }, value => { value.tick.time_msc = 123; }]) {
    const f = fixture(); f.hooks.prepared = change;
    const result = await f.service.prepare(preparation());
    assert.equal(result.status, 'rejected'); assert.equal(result.submission_attempted, false);
    assert.equal(result.error.code, 'SOURCE_DATA_INVALID'); assert.equal(result.observation_id, undefined);
    assert.equal(records(f.host).list('observations').length, 0);
  }
});

test('an interrupted preparation and an unknown native send have distinct durable outcomes', async () => {
  const f = fixture(), controller = new AbortController();
  f.hooks.prepare = () => { controller.abort(new DOMException('Preparation interrupted', 'AbortError')); };
  const interrupted = await f.service.execute(intent(), controller.signal);
  assert.equal(interrupted.status, 'rejected'); assert.equal(interrupted.submission_attempted, false);
  assert.equal(f.names().includes('mt5_trade'), false);
  const g = fixture(); g.hooks.trade = () => { throw new Error('Native reply lost'); };
  const unknown = await g.service.execute(intent());
  assert.equal(unknown.status, 'outcome_unknown'); assert.equal(unknown.submission_attempted, null);
  assert.match(unknown.error.message, /Native reply lost/);
  assert.deepEqual(await g.service.execute(intent()), unknown);
  const next = await g.service.execute(intent('another'));
  assert.equal(next.status, 'rejected'); assert.equal(next.error.code, 'UNRESOLVED_ORDER');
  assert.equal(g.names().filter(name => name === 'mt5_trade').length, 1);
});

test('raw native rejection preserves the final quote guard instead of claiming submission success', async () => {
  const f = fixture();
  f.hooks.trade = () => ({ status: 'returned', result: { submission_attempted: false, result: { retcode: 10021 }, error: { reason: 'future_quote', source_time_ms: f.time + 1000, received_at: f.time, age_ms: -1000 } } });
  const result = await f.service.execute(intent());
  assert.equal(result.status, 'rejected'); assert.equal(result.submission_attempted, false);
  assert.equal(result.receipt.result.error.reason, 'future_quote');
  assert.equal(result.receipt.result.error.source_time_ms, f.time + 1000);
  const g = fixture();
  g.hooks.trade = () => ({ status: 'returned', result: { result: { retcode: 10006, comment: 'Broker rejected the request' } } });
  const brokerRejected = await g.service.execute(intent());
  assert.equal(brokerRejected.status, 'rejected'); assert.equal(brokerRejected.submission_attempted, true);
  assert.equal(brokerRejected.receipt.result.result.retcode, 10006);
});

test('incomplete or conflicting fast input is rejected before any backend preparation', async () => {
  const f = fixture();
  for (const args of [
    { ...intent(), observation_id: 'observation' }, { ...intent(), quantity: undefined },
    { ...intent(), side: undefined }, { ...intent(), symbol: undefined },
    { ...intent(), action: 'limit' }, { ...intent(), action: 'close' },
    { ...intent(), backend: 'qmt' },
  ]) await assert.rejects(f.service.execute(args), error => error.details.submission_attempted === false && typeof error.details.reason === 'string');
  assert.equal(f.calls.length, 0);
});

test('QMT preparation uses only its existing read-only snapshot and cannot change permissions', async () => {
  const f = fixture(), reads = [], account = { accountId: 'qmt-account', connectionId: 'qmt-route', revision: '1' };
  f.host.plugins.read = async () => ({ state: 'mounted', runtime_status: 'ready', version: '1.6.0' });
  f.host.capabilities.invoke = async (ref, args) => {
    const name = ref.split('#')[1]; reads.push([name, args.action]);
    if (name === 'qmt_environment') return { type: 'result', value: { configuration: { account_id: account.accountId, connection_id: account.connectionId, version: account.revision } } };
    assert.equal(name, 'qmt_read');
    const connection = { id: account.connectionId, revision: account.revision };
    const value = args.action === 'describe' ? { items: [{ symbol: '600000.SH', detail: {} }] }
      : args.action === 'asset' ? { asset: { account_id: account.accountId } }
        : args.action === 'positions' ? { items: [], nextCursor: null }
          : args.action === 'quotes' ? { items: [{ symbol: '600000.SH', tick: { time: f.time, bidPrice: [100], askPrice: [101] } }] } : undefined;
    assert.ok(value); return { type: 'result', value: { connection, ...value } };
  };
  const result = await f.create().prepare({ ...preparation(), backend: 'qmt', symbol: '600000.SH' });
  assert.equal(result.status, 'prepared'); assert.deepEqual(result.preparation, { backend: 'qmt', mode: 'read-only', permissionsChanged: false });
  assert.equal(reads.every(([name, action]) => name === 'qmt_read' || name === 'qmt_environment' && action === 'inspect'), true);
  assert.equal(result.submission_attempted, false);
});

test('observe remains a pure snapshot read and an observed execution never calls prepare', async () => {
  const f = fixture(), adapter = createAdapters(f.host, { now: () => f.time });
  let snapshots = 0;
  adapter.snapshot = async (_backend, symbol) => { snapshots++; return { account: structuredClone(f.account), symbol, spec: { volume_min: 0.01, volume_max: 10, volume_step: 0.01, filling_mode: 2 }, positions: [], quote: { sourceTimeMs: f.time, receivedAt: f.time, clock:quoteClock(f.account,f.time), bid: '100', ask: '101' }, capturedAt: f.time, captureMs: 1 }; };
  adapter.prepare = () => { throw new Error('Pure observation must not prepare'); };
  const service = f.create({ adapters: adapter }), observed = await service.observe({ backend: 'mt5', symbol: 'FIXTURE' });
  assert.equal(snapshots, 1); assert.equal(f.calls.length, 0);
  const { backend: _backend, symbol: _symbol, ...args } = intent();
  const result = await service.execute({ ...args, observation_id: observed.observation_id });
  assert.equal(result.status, 'execution_reported'); assert.deepEqual(f.names(), ['mt5_settings', 'mt5_trade']);
});

test('public declarations expose prepare and enforce exactly one execution source', () => {
  const root = new URL('../packages/portfolio-execution/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('plugin.json', root), 'utf8'));
  const declaration = JSON.parse(readFileSync(new URL('capabilities.json', root), 'utf8'));
  const prep = declaration.capabilities.find(value => value.id === 'manual_trade_prepare');
  const execution = declaration.capabilities.find(value => value.id === 'manual_trade_execute');
  assert.equal(prep.execution, 'run'); assert.ok(manifest.main_tool_names.includes(prep.id));
  assert.ok(createCapabilities({}).some(value => value.name === prep.binding.name));
  assert.ok(Value.Check(prep.inputSchema, preparation()));
  assert.equal(Value.Check(prep.inputSchema, { ...preparation(), user_authorized: false }), false);
  assert.ok(Value.Check(execution.inputSchema, intent()));
  const { backend: _backend, symbol: _symbol, ...args } = intent();
  assert.ok(Value.Check(execution.inputSchema, { ...args, observation_id: 'stored-observation' }));
  for (const input of [{ ...intent(), observation_id: 'both' }, { ...args, observation_id: 'partial', backend: 'mt5' }, args, { ...args, backend: 'mt5' }]) {
    assert.equal(Value.Check(execution.inputSchema, input), false);
  }
  assert.equal(createService({ context: { kind: 'main' }, capabilities: {} }).inspect().backends[0].minimumPluginVersion, '2.1.7');
});
