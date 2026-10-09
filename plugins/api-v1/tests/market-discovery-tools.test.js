import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Type } from '@sesame/plugin-sdk/schema';
import { canonical, check } from '@sesame/plugin-sdk/protocol';
import { createTools as dataTools } from '../packages/data-access/tools.js';
import { createTools as canvasTools } from '../packages/canvas-control/tools.js';
import { compute } from '../packages/canvas-control/resources/close-line.js';

function fixture() {
  const provider = { pluginId: 'fixture/quotes', providerId: 'broker-bars' }, connection = { id: 'already-configured', revision: '17' };
  const descriptor = { id: provider.providerId, pluginId: provider.pluginId, contract: 'sesame.market', capabilities: ['instruments.search', 'instruments.describe', 'bars.history', 'bars.subscribe'], sessions: ['all'], priceBases: ['bid'], adjustments: ['none'] };
  const instrument = { ref: { sourceId: 'opaque-provider-source', instrumentId: 'EURUSD.pro' }, symbol: 'EURUSD.pro', name: 'Euro / US Dollar', timeBasis: { kind: 'wall', authority: 'Fixture-Broker' }, calendar: { status: 'unknown', reason: 'No frozen broker calendar' }, features: { timeframes: ['1h', '15m'], priceBases: ['bid'], adjustments: ['none'] }, volume: { hasReal: false, hasTick: true } };
  const meta = { observedAt: 123, receivedAt: 124, origin: 'observed', freshness: 'unknown', consistency: 'best_effort', warnings: ['Fixture catalog only'] };
  const bindings = new Set(), events = []; let failRead = null, more = false, next = 0;
  const string = description => Type.String({ description, minLength: 1, maxLength: 20000 });
  const host = { scope: { conversationId: 'main' }, workspace: {}, tools: { Type, string, optional: description => Type.Optional(string(description)), define: (name, description, properties, execute) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) },
    layout: { inspect: () => ({ version: 5, charts: [] }), apply: input => { events.push(['layout', structuredClone(input)]); return input; } },
    providers: {
      list: contract => !contract || contract === descriptor.contract ? [structuredClone(descriptor)] : [],
      bind: async (ref, input, signal) => { signal?.throwIfAborted(); assert.deepEqual(ref, provider); check(!input.connection || canonical(input.connection) === canonical(connection), 'Connection changed', 'CONNECTION_CHANGED'); const bindingId = 'ephemeral-' + ++next; bindings.add(bindingId); events.push(['bind', bindingId, structuredClone(input)]); return { bindingId, connection, health: 'connecting', sourceIds: [instrument.ref.sourceId] }; },
      call: async (id, method, input, options) => { assert.ok(bindings.has(id)); options.signal?.throwIfAborted(); events.push([method, structuredClone(input)]); if (failRead) throw failRead; if (method === 'searchInstruments') return { data: { items: [{ ref: instrument.ref, symbol: instrument.symbol, name: instrument.name }], nextCursor: more ? 'native-cursor-requires-binding' : null, snapshotId: 'source-snapshot' }, meta }; assert.equal(method, 'describeInstrument'); assert.deepEqual(input.instrument, instrument.ref); return { data: structuredClone(instrument), meta }; },
      unbind: async id => { assert.ok(bindings.delete(id)); events.push(['unbind', id]); },
    } };
  const tools = [...dataTools(host), ...canvasTools(host)], call = (name, input, signal) => tools.find(tool => tool.name === name).execute(input, signal);
  return { host, provider, connection, descriptor, instrument, meta, bindings, events, tools, call, fail: value => { failRead = value; }, more: value => { more = value; } };
}

test('discovery exposes provider identity and exact current connection without leaking a closed cursor', async () => {
  const f = fixture();
  assert.deepEqual(f.call('data_providers', { contract: 'sesame.market' }).providers[0].provider, f.provider);
  assert.deepEqual(f.call('canvas_inspect', {}).market_providers[0].provider, f.provider);
  assert.equal(f.events.length, 0, 'Listing must not connect a provider');
  f.more(true);
  const result = await f.call('market_instruments', { action: 'search', provider: f.provider, query: 'EURUSD', limit: 10 });
  assert.deepEqual(result.connection, f.connection); assert.deepEqual(result.items[0].ref, f.instrument.ref);
  assert.equal(result.has_more, true); assert.equal(result.pagination, 'bounded_search_refine_query');
  assert.equal(JSON.stringify(result).includes('native-cursor'), false); assert.equal(JSON.stringify(result).includes('ephemeral-'), false);
  assert.deepEqual(result.meta, f.meta); assert.equal(f.bindings.size, 0);
  assert.deepEqual(f.events[1], ['searchInstruments', { query: 'EURUSD', page: { limit: 10 } }]);
});

test('description preserves source time and unknown calendar, then H1/M15 chart bindings use exact declarations', async () => {
  const f = fixture(), args = { provider: f.provider, connection: f.connection, instrument: f.instrument.ref };
  const described = await f.call('market_instruments', { ...args, action: 'describe' });
  assert.deepEqual(described.instrument.timeBasis, f.instrument.timeBasis); assert.deepEqual(described.series_options.calendarRevision, f.instrument.calendar);
  const charts = [];
  for (const timeframe of ['1h', '15m']) {
    const result = await f.call('canvas_binding', { ...args, timeframe });
    assert.deepEqual(result.binding, { provider: f.provider, connection: f.connection, instrument: f.instrument.ref, spec: { timeframe, priceBasis: 'bid', adjustment: 'none', session: 'all', calendarRevision: f.instrument.calendar } });
    assert.equal(result.chart.volume, true); assert.equal(result.validation.marketDataRead, false); assert.equal(result.validation.rendered, false);
    charts.push(result.chart);
  }
  await f.call('canvas_apply', { command_id: 'discovered-charts-command', expected_version: 5, operations: charts.map(chart => ({ op: 'add', chart })) });
  assert.equal(f.events.filter(event => event[0] === 'layout').length, 1); assert.equal(f.bindings.size, 0);
  assert.ok(!f.events.some(event => /subscribe|queryBars|trade/.test(event[0])), 'Binding descriptions must not start data streams or trade');
});

test('unsupported, ambiguous and stale bindings fail without persisting layout or leaking provider handles', async () => {
  const f = fixture(), args = { provider: f.provider, instrument: f.instrument.ref, timeframe: '1h' };
  await assert.rejects(f.call('canvas_binding', { ...args, timeframe: 'H1' }), { code: 'UNSUPPORTED_CAPABILITY' });
  await assert.rejects(f.call('canvas_binding', { ...args, price_basis: 'last' }), { code: 'UNSUPPORTED_CAPABILITY' });
  await assert.rejects(f.call('canvas_binding', { ...args, connection: { ...f.connection, revision: 'old' } }), { code: 'CONNECTION_CHANGED' });
  f.descriptor.sessions = ['all', 'regular'];
  await assert.rejects(f.call('canvas_binding', args), /Choose session explicitly/);
  assert.equal((await f.call('canvas_binding', { ...args, session: 'regular' })).binding.spec.session, 'regular');
  assert.equal(f.bindings.size, 0); assert.equal(f.events.filter(event => event[0] === 'layout').length, 0);
});

test('provider read errors and cancellation still close the temporary binding', async () => {
  const f = fixture(), args = { action: 'describe', provider: f.provider, instrument: f.instrument.ref };
  f.fail(Object.assign(new Error('source unavailable'), { code: 'SOURCE_UNAVAILABLE' }));
  await assert.rejects(f.call('market_instruments', args), { code: 'SOURCE_UNAVAILABLE' }); assert.equal(f.bindings.size, 0);
  f.fail(new DOMException('Canceled native read', 'AbortError'));
  await assert.rejects(f.call('canvas_binding', { provider: f.provider, instrument: f.instrument.ref, timeframe: '1h' }), { name: 'AbortError' }); assert.equal(f.bindings.size, 0);
});

test('provider replacement between listing and binding cannot apply an old descriptor', async () => {
  const f = fixture(); f.descriptor.instanceId = 'provider-before-update';
  await assert.rejects(f.call('canvas_binding', { provider: f.provider, instrument: f.instrument.ref, timeframe: '1h' }), { code: 'CONNECTION_CHANGED' });
  await assert.rejects(f.call('market_instruments', { action: 'search', provider: f.provider, query: 'EURUSD' }), { code: 'CONNECTION_CHANGED' });
  assert.equal(f.bindings.size, 0); assert.equal(f.events.some(([method]) => ['searchInstruments', 'describeInstrument'].includes(method)), false);
});

test('indicator example retains exact Decimal and SourceTime, including a forming bar', () => {
  const time = { basis: 'wall', authority: 'Fixture-Broker', value: '2026-10-09T12:00:00' };
  const output = compute({ inputs: { price: { rows: [{ id: 'stable-bar', openTime: time, close: '1.1234567890123456789', isClosed: false }] } }, parameters: {} });
  assert.equal(output.status, 'ready'); assert.deepEqual(output.series[0].points[0], { key: 'stable-bar', time, value: { status: 'value', value: '1.1234567890123456789' } });
  assert.equal(compute({ inputs: { price: { rows: [] } } }).status, 'not_ready');
});

test('discovery and canvas public schemas match the shipped definitions', async () => {
  const f = fixture();
  for (const [name, create] of [['canvas-control', canvasTools], ['data-access', dataTools]]) {
    const expected = JSON.parse(await readFile(new URL(`../packages/${name}/tools.json`, import.meta.url)));
    assert.deepEqual(JSON.parse(JSON.stringify(create(f.host).map(({ execute, ...tool }) => tool))), expected);
  }
});
