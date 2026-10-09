import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { providerCapabilities, validateRead, validateFinancialData } from '@sesame/plugin-sdk/protocol';
import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { configure, inspect, environment } from '../packages/qmt/configuration.js';
import { createService, descriptors } from '../packages/qmt/service.js';
import { accountRef, instrumentRef, quote, accountSnapshot } from '../packages/qmt/mapping.js';
import { createTools } from '../packages/qmt/index.js';
import { execute } from '../packages/qmt/worker.js';

function storage(directory) {
  const rows = new Map(), operations = new Map();
  return { directory, get: (kind, id) => structuredClone(rows.get(`${kind}:${id}`)), put(kind, value) { rows.set(`${kind}:${value.id}`, structuredClone(value)); return structuredClone(value); },
    idempotent(key, fingerprint, action) { const prior = operations.get(key); if (prior) { assert.equal(prior.fingerprint, fingerprint, 'Idempotency conflict'); return structuredClone(prior.result); } const result = action(); operations.set(key, { fingerprint, result }); return result; },
  };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'qmt-contract-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const python = join(directory, 'python.exe'), userdata = join(directory, 'userdata_mini'); await writeFile(python, 'fixture'); await mkdir(userdata);
  const host = { storage: storage(directory), configuration: { exclusive: fn => fn() }, environment: { executeWorker() { throw new Error('No real SDK calls in a contract fixture'); } } };
  const config = await configure(host, { operation_id: 'configure', expected_version: 1, changes: { python_path: python, userdata_directory: userdata, account_id: '001234567890', market_port: 58610, broker: 'Fixture broker' } });
  return { host, config };
}
const receipt = (result, from = 1700000000000) => ({ ok: true, result, sample: { from, to: from + 10 } });
async function bind(service, kind, id = kind) { return await service[kind].bind({}, { bindingId: id }); }
const tick = { time: '1700000000000', lastPrice: '10.125', bidPrice: ['10.12'], askPrice: ['10.13'], bidVol: ['25'], askVol: ['10'] };

test('QMT manifest/tools agree and declare only implemented read capabilities', async t => {
  const { host } = await fixture(t);
  host.tools = { Type, string: description => Type.String({ description, minLength: 1, maxLength: 20000 }), define: (name, description, properties, execute) => ({ name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) };
  const tools = createTools(host), manifest = JSON.parse(await readFile(new URL('../packages/qmt/plugin.json', import.meta.url)));
  assert.deepEqual(tools.map(tool => tool.name), manifest.tool_names);
  const declared = JSON.parse(await readFile(new URL('../packages/qmt/tools.json', import.meta.url)));
  assert.deepEqual(tools.map(tool => JSON.parse(JSON.stringify(tool.parameters))), declared.map(tool => tool.parameters));
  for (const d of descriptors) providerCapabilities(d.contract, d.capabilities);
  const shape = tools.find(tool => tool.name === 'qmt_read').parameters;
  assert.equal(Value.Check(shape, { action: 'orders' }), true);
  assert.equal(Value.Check(shape, { action: 'order_stock', code: 'anything' }), false);
  assert.equal(Value.Check(shape, { action: 'quotes', symbols: ['600000.SH'] }), true);
});

test('configuration preserves native account IDs, is idempotent and rejects stale changes', async t => {
  const { host, config } = await fixture(t);
  assert.equal(config.account_id, '001234567890'); assert.equal(config.version, 2);
  const args = { operation_id: 'change-sector', expected_version: 2, changes: { sector: '沪深A股' } };
  const next = await configure(host, args); assert.deepEqual(await configure(host, args), next);
  await assert.rejects(configure(host, { ...args, operation_id: 'stale' }), { code: 'STALE_REVISION' });
  assert.equal(inspect(host).sdk_verified, false);
});

test('unsupported platform returns real prerequisites before any SDK process', async t => {
  const { host } = await fixture(t), service = createService(host, { platform: 'darwin' });
  await assert.rejects(bind(service, 'market'), { code: 'PREREQUISITE_REQUIRED' });
  if (process.platform !== 'win32') {
    await assert.rejects(environment(host, { action: 'verify' }), { code: 'PREREQUISITE_REQUIRED' });
    await assert.rejects(execute({ python: '/fixture', action: 'verify' }, { directory: host.storage.directory }), { code: 'PREREQUISITE_REQUIRED' });
  }
});

test('catalog pages freeze the native snapshot and bind cursors to exact filters', async t => {
  const { host, config } = await fixture(t); let calls = 0, clock = 0;
  const service = createService(host, { platform: 'win32', now: () => clock, request: async () => { calls++; return receipt({ items: [{ symbol: '600000.SH', name: '浦发' }, { symbol: '000001.SZ', name: '平安' }] }); } });
  t.after(() => service.dispose()); await bind(service, 'market');
  const first = await service.market.searchInstruments({ query: '', page: { limit: 1 } }, { bindingId: 'market' });
  assert.equal(first.data.items[0].ref.sourceId, `qmt:${config.connection_id}`); assert.equal(first.meta.warnings.some(x => x.code === 'PARTIAL_CATALOG'), true);
  const second = await service.market.searchInstruments({ query: '', page: { limit: 2, cursor: first.data.nextCursor } }, { bindingId: 'market' });
  assert.equal(calls, 1); assert.equal(second.data.snapshotId, first.data.snapshotId); assert.equal(second.data.items.length, 1);
  await assert.rejects(service.market.searchInstruments({ query: 'x', page: { limit: 1, cursor: first.data.nextCursor } }, { bindingId: 'market' }), { code: 'INVALID_CURSOR' });
  clock = 61000;
  await assert.rejects(service.market.searchInstruments({ query: '', page: { limit: 1, cursor: first.data.nextCursor } }, { bindingId: 'market' }), { code: 'CURSOR_EXPIRED' });
});

test('late responses and old bindings are rejected after account configuration changes', async t => {
  const { host } = await fixture(t); let finish;
  const service = createService(host, { platform: 'win32', request: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => service.dispose()); await bind(service, 'market');
  const pending = service.market.searchInstruments({ query: '', page: { limit: 20 } }, { bindingId: 'market' });
  await configure(host, { operation_id: 'switch', expected_version: 2, changes: { account_id: '009999' } });
  finish(receipt({ items: [] })); await assert.rejects(pending, { code: 'CONNECTION_CHANGED' });
  await assert.rejects(service.market.searchInstruments({ query: '', page: { limit: 20 } }, { bindingId: 'market' }), { code: 'CONNECTION_CHANGED' });
});

test('quote source time, zero prices and unverified depth units remain distinct', async t => {
  const { config } = await fixture(t);
  const q = quote(config, { symbol: '600000.SH', tick: { ...tick, bidPrice: ['0'] } });
  assert.equal(q.time.unixMs, 1700000000000); assert.equal(q.bid.status, 'unknown'); assert.equal(q.bidSize.status, 'unknown'); assert.equal(q.last.value, '10.125');
  const wall = quote(config, { symbol: '600000.SH', tick: { timetag: '20261009 10:01:02.003', lastPrice: '10' } });
  assert.equal(wall.time.basis, 'wall'); assert.equal(wall.time.value, '2026-10-09T10:01:02.003');
  assert.throws(() => quote(config, { symbol: '600000.SH', tick: { lastPrice: '10' } }), { code: 'SOURCE_DATA_INVALID' });
});

test('quote subscription emits only after ready, revises corrections, serializes reads and closes owned polling', async t => {
  const { host, config } = await fixture(t); let calls = 0, active = 0, peak = 0;
  const service = createService(host, { platform: 'win32', pollMs: 5, request: async () => {
    active++; peak = Math.max(peak, active); const price = calls++ < 2 ? '10' : '11';
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return receipt({ items: [{ symbol: '600000.SH', tick: { ...tick, lastPrice: price } }] });
  } });
  t.after(() => service.dispose()); await bind(service, 'market');
  const handle = await service.market.subscribeQuotes({ instruments: [instrumentRef(config, '600000.SH')] }, { bindingId: 'market' });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 1);
  let delivered; const event = new Promise(resolve => { handle.ready(value => { delivered = value; resolve(); }); });
  await Promise.race([event, new Promise((_, reject) => setTimeout(() => reject(new Error('No quote correction')), 1000).unref())]);
  assert.equal(delivered.type, 'quotes.upsert'); assert.equal(delivered.seq, '1'); assert.equal(delivered.payload.quotes[0].revision, '1'); assert.equal(delivered.payload.quotes[0].time.unixMs, 1700000000000); assert.equal(peak, 1);
  await handle.close(); const count = calls; await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls, count); assert.equal(active, 0);
});

test('zero cash is real while missing balance and P&L remain unknown; shares and integer account identities persist', async t => {
  const { host, config } = await fixture(t);
  const service = createService(host, { platform: 'win32', request: async args => args.action === 'asset' ? receipt({ asset: { account_id: config.account_id, cash: '0', total_asset: '123.456' } }) : receipt({ items: [{ account_id: config.account_id, stock_code: '600000.SH', volume: '9007199254740993', can_use_volume: '0', avg_price: '10.001' }] }) });
  t.after(() => service.dispose()); await bind(service, 'account');
  const result = await service.account.snapshot({ account: accountRef(config) }, { bindingId: 'account' });
  validateRead(result, descriptors[1], 'fixture', { id: config.connection_id, revision: '2' }); validateFinancialData(result.data);
  assert.deepEqual(result.data.available.value, { value: '0', currency: 'CNY' }); assert.equal(result.data.balance.status, 'unknown'); assert.equal(result.data.unrealizedPnl.status, 'unknown'); assert.equal(result.data.margin.used.status, 'not_applicable');
  const positions = await service.account.queryPositions({ account: accountRef(config), page: { limit: 20 } }, { bindingId: 'account' });
  validateFinancialData(positions.data); assert.equal(positions.data.items[0].quantity.value, '9007199254740993'); assert.equal(positions.data.items[0].availableQuantity.value.value, '0');
  await assert.rejects(service.account.snapshot({ account: { ...accountRef(config), accountId: 'other' } }, { bindingId: 'account' }), { code: 'INVALID_ARGUMENT' });
});

test('ambiguous native lists stay errors; raw orders preserve time, price type and day-only coverage', async t => {
  const { host } = await fixture(t);
  const service = createService(host, { platform: 'win32', request: async args => {
    if (args.action === 'positions') throw Object.assign(new Error('None is ambiguous'), { code: 'AMBIGUOUS_SOURCE_RESULT' });
    return receipt({ items: [{ order_id: '9007199254740993', order_time: '93001', price_type: '999' }], coverage: { scope: 'current_trading_day', complete_history: false, raw_time_unit: 'source_native_uninterpreted' } });
  } });
  t.after(() => service.dispose());
  await assert.rejects(service.native('positions', {}), { code: 'AMBIGUOUS_SOURCE_RESULT' });
  const result = await service.native('orders', {}); assert.equal(result.items[0].order_id, '9007199254740993'); assert.equal(result.items[0].order_time, '93001'); assert.equal(result.coverage.complete_history, false);
  assert.equal(result.nextCursor, null); assert.equal(result.consistency, 'snapshot');
  await assert.rejects(service.native('order_stock', {}), { code: 'UNSUPPORTED_CAPABILITY' });
});

test('raw order pagination preserves a frozen list and its current-day coverage', async t => {
  const { host } = await fixture(t); let reads = 0;
  const service = createService(host, { platform: 'win32', request: async () => { reads++; return receipt({ items: [{ order_id: '1' }, { order_id: '2' }], coverage: { scope: 'current_trading_day', complete_history: false } }); } });
  t.after(() => service.dispose());
  const first = await service.native('orders', { page: { limit: 1 } });
  const next = await service.native('orders', { page: { limit: 1, cursor: first.nextCursor } });
  assert.equal(reads, 1); assert.equal(next.items[0].order_id, '2'); assert.equal(next.snapshotId, first.snapshotId); assert.deepEqual(next.coverage, first.coverage);
});
