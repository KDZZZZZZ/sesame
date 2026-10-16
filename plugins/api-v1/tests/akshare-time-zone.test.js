import test from 'node:test';
import assert from 'node:assert/strict';
import { AKShareProvider, mapBar, wall as projectWall } from '../../optional-api-v1/packages/akshare/provider.js';
import { marketReadCapabilities } from '../packages/data-access/market-read.js';
import { resourceHost } from './core-v2-fixture.mjs';

const authority = 'Asia/Shanghai';
const timeBasis = { kind: 'wall', authority, zone: authority };
const spec = { timeframe: '1d', priceBasis: 'last', adjustment: 'none', session: 'regular', calendarRevision: { status: 'unknown' } };
const wall = (value, zoned = true) => ({ basis: 'wall', authority, ...(zoned ? { zone: authority } : {}), value });
const range = (zoned = true) => ({ from: wall('2024-09-01T00:00:00', zoned), to: wall('2024-10-01T00:00:00', zoned) });
const instrument = source => ({ sourceId: `akshare:${source}:a-share`, instrumentId: '000001' });
const row = day => ({ date: `2024-09-${day}`, open: '10.0000000000000001', high: '11', low: '9', close: '10.5', volume: '9007199254740993' });
function fixture(source = 'tencent') {
  const calls = [], context = { bindingId: `fixture-${source}` };
  const provider = new AKShareProvider({});
  provider.fetch = async (name, args) => {
    const payload = { interface: name, arguments: args };
    calls.push(payload);
    const rows = ['stock_zh_a_spot_tx', 'stock_info_a_code_name'].includes(payload.interface) ? [{ code: '000001', name: 'Fixture stock' }] : ['02', '03', '04'].map(day => source === 'eastmoney' ? { '日期': row(day).date, '开盘': row(day).open, '最高': row(day).high, '最低': row(day).low, '收盘': row(day).close, '成交量': row(day).volume } : row(day));
    return { interface: payload.interface, observedAt: Date.parse('2024-10-01T00:00:00Z'), akshareVersion: '1.19.1', rows };
  };
  const bound = provider.bind({ configuration: { source } }, context);
  return { provider, context, bound, calls, query: { instrument: instrument(source), spec, range: range(), page: { limit: 1 } } };
}
const checkZone = (bar, expected) => { assert.equal(bar.openTime.zone, expected); assert.equal(bar.endTime.zone, expected); assert.equal(bar.openTime.authority, authority); assert.equal(bar.endTime.authority, authority); };

test('bind, search, describe and canonical daily bars declare one known Shanghai time basis for every source', async () => {
  for (const source of ['eastmoney', 'sina', 'tencent']) {
    const f = fixture(source);
    try {
      assert.deepEqual(f.bound.timeBasis, timeBasis);
      const search = await f.provider.searchInstruments({ query: '000001', page: { limit: 10 } }, f.context);
      const description = await f.provider.describeInstrument({ instrument: f.query.instrument }, f.context);
      assert.deepEqual(search.data.items[0].timeBasis, timeBasis);
      assert.deepEqual(description.data.timeBasis, timeBasis);
      checkZone(mapBar(row('02'), 'tencent', 'canonical', 0), authority);
      // Returned metadata cannot mutate the provider's canonical declaration.
      f.bound.timeBasis.zone = 'untrusted'; description.data.timeBasis.zone = 'untrusted';
      assert.deepEqual(f.provider.bind({ configuration: { source } }, f.context).timeBasis, timeBasis);
    } finally { f.provider.dispose(); }
  }
});

test('zoned and legacy zoneless pages are separate representations with unchanged source values, IDs and revisions', async () => {
  const f = fixture();
  try {
    const zoned = await f.provider.queryBars(f.query, f.context);
    const legacy = await f.provider.queryBars({ ...f.query, range: range(false) }, f.context);
    const zonedAgain = await f.provider.queryBars(f.query, f.context);
    const a = zoned.data.page.items[0], b = legacy.data.page.items[0], c = zonedAgain.data.page.items[0];
    checkZone(a, authority); checkZone(b, undefined); checkZone(c, authority);
    assert.equal(a.id, b.id); assert.equal(a.revision, b.revision); assert.equal(c.revision, a.revision);
    assert.equal(a.openTime.value, b.openTime.value); assert.equal(a.open, '10.0000000000000001');
    assert.deepEqual(legacy.meta.source.timeBasis, timeBasis);
    assert.ok(legacy.meta.warnings.some(warning => warning.includes('without zone') && warning.includes(authority)));
    assert.ok(!zoned.meta.warnings.some(warning => warning.includes('without zone')));
    for (const [first, zonedRequest] of [[zoned, true], [legacy, false]]) {
      const second = await f.provider.queryBars({ ...f.query, range: range(zonedRequest), page: { limit: 1, cursor: first.data.page.nextCursor } }, f.context);
      checkZone(second.data.page.items[0], zonedRequest ? authority : undefined);
      assert.equal(second.data.page.snapshotId, first.data.page.snapshotId);
      assert.equal(second.data.page.items[0].openTime.value, '2024-09-03T09:30:00');
      checkZone({ openTime: second.data.coverage.observedRange.from, endTime: second.data.coverage.observedRange.to }, zonedRequest ? authority : undefined);
    }
    assert.equal(f.calls.length, 3, 'Cursor pages preserve their fixed response without another upstream request');
    await assert.rejects(f.provider.queryBars({ ...f.query, range: range(false), page: { limit: 1, cursor: zoned.data.page.nextCursor } }, f.context), { code: 'INVALID_CURSOR' });
    checkZone(zoned.data.page.items[0], authority, 'A legacy query never mutates an earlier zoned response');
  } finally { f.provider.dispose(); }
});

test('UTC ranges and subscriptions retain canonical zone after a legacy read; explicit mismatches remain unsupported', async () => {
  const f = fixture();
  try {
    await f.provider.queryBars({ ...f.query, range: range(false) }, f.context);
    const utc = { from: { basis: 'utc', unixMs: Date.parse('2024-09-01T00:00:00+08:00') }, to: { basis: 'utc', unixMs: Date.parse('2024-10-01T00:00:00+08:00') } };
    const result = await f.provider.queryBars({ ...f.query, range: utc }, f.context);
    checkZone(result.data.page.items[0], authority); assert.deepEqual(result.data.coverage.requested, utc);
    const stream = await f.provider.subscribeBars({ instrument: f.query.instrument, spec, tailLimit: 2000, includeForming: true }, f.context);
    try { assert.equal(stream.snapshot.bars.length, 3); stream.snapshot.bars.forEach(bar => checkZone(bar, authority)); }
    finally { await stream.close(); }
    for (const change of [{ zone: 'UTC' }, { authority: 'Another clock' }, { fold: 0 }]) {
      const badRange = range(); badRange.from = { ...badRange.from, ...change };
      await assert.rejects(f.provider.queryBars({ ...f.query, range: badRange }, f.context), { code: 'UNSUPPORTED_CAPABILITY' });
    }
  } finally { f.provider.dispose(); }
});


test('UTC projection follows historical Shanghai DST and preserves millisecond half-open bounds', async () => {
  for (const [utc, expected] of [
    ['1991-07-01T00:30:00.001Z', '1991-07-01T09:30:00.001'],
    ['1991-01-01T01:30:00.001Z', '1991-01-01T09:30:00.001'],
    ['2024-09-02T01:30:00.001Z', '2024-09-02T09:30:00.001'],
  ]) assert.equal(projectWall({ basis: 'utc', unixMs: Date.parse(utc) }), expected);
  const f = fixture();
  f.provider.fetch = async name => ({ interface: name, observedAt: 0, akshareVersion: '1.19.1', rows: [{ ...row('02'), date: '1991-07-01' }] });
  try {
    const instant = Date.parse('1991-07-01T00:30:00Z');
    const query = { ...f.query, range: { from: { basis: 'utc', unixMs: instant }, to: { basis: 'utc', unixMs: instant + 1 } } };
    const included = await f.provider.queryBars(query, f.context);
    assert.equal(included.data.page.items.length, 1); checkZone(included.data.page.items[0], authority);
    assert.equal(included.data.page.items[0].openTime.value, '1991-07-01T09:30:00');
    const excluded = await f.provider.queryBars({ ...query, range: { from: { basis: 'utc', unixMs: instant + 1 }, to: { basis: 'utc', unixMs: instant + 2 } } }, f.context);
    assert.equal(excluded.data.page.items.length, 0);
  } finally { f.provider.dispose(); }
});

test('UTC ranges keep their instant ordering across Shanghai clock rollback and spring-forward', async () => {
  const f = fixture();
  f.provider.fetch = async name => ({ interface: name, observedAt: 0, akshareVersion: '1.19.1', rows: ['1991-04-13', '1991-04-14', '1991-09-14', '1991-09-15', '1991-09-16'].map(date => ({ ...row('02'), date })) });
  const query = async (from, to) => f.provider.queryBars({ ...f.query, page: { limit: 20 }, range: { from: { basis: 'utc', unixMs: Date.parse(from) }, to: { basis: 'utc', unixMs: Date.parse(to) } } }, f.context);
  try {
    // Both endpoints are in the repeated hour: wall strings reverse, instants do not.
    assert.deepEqual((await query('1991-09-14T16:45:00Z', '1991-09-14T17:15:00Z')).data.page.items, []);
    // Distinct instants can even have identical wall representations.
    assert.deepEqual((await query('1991-09-14T16:15:00Z', '1991-09-14T17:15:00Z')).data.page.items, []);
    const spanning = await query('1991-09-14T00:30:00Z', '1991-09-15T01:30:00.001Z');
    assert.deepEqual(spanning.data.page.items.map(bar => bar.openTime.value), ['1991-09-14T09:30:00', '1991-09-15T09:30:00']);
    assert.deepEqual((await query('1991-09-15T01:30:00.001Z', '1991-09-16T01:30:00Z')).data.page.items, []);
    assert.deepEqual((await query('1991-04-13T17:30:00Z', '1991-04-13T18:30:00Z')).data.page.items, []);
    const spring = await query('1991-04-13T01:30:00Z', '1991-04-14T00:30:00.001Z');
    assert.deepEqual(spring.data.page.items.map(bar => bar.openTime.value), ['1991-04-13T09:30:00', '1991-04-14T09:30:00']);
    await assert.rejects(query('1991-09-14T17:15:00Z', '1991-09-14T16:45:00Z'), /ascending/);
    for (const value of ['1991-09-15T01:15:00', '1991-04-14T02:15:00']) await assert.rejects(f.provider.queryBars({ ...f.query, range: { from: wall(value), to: { basis: 'utc', unixMs: Date.parse('1991-10-01T00:00:00Z') } } }, f.context), { code: 'UNSUPPORTED_CAPABILITY' });
  } finally { f.provider.dispose(); }
});

test('data-access market_read composes with AKShare query pages and freezes exact zoned, zoneless and UTC evidence', async t => {
  const f = fixture(), resources = resourceHost();
  resources.host.data = { query: async request => {
    assert.equal(request.source.providerId, 'sesame/akshare#market');
    assert.equal(request.operation, 'queryBars');
    const result = await f.provider.queryBars({ ...request.input, page: { limit: request.limit, cursor: request.cursor } }, f.context);
    const { page, ...metadata } = result.data;
    return { items: page.items, nextCursor: page.nextCursor, metadata: { ...metadata, snapshotId: page.snapshotId, consistency: page.consistency, meta: result.meta, connection: f.bound.connection } };
  } };
  const tool = marketReadCapabilities(resources.host)[0];
  try {
    for (const [name, requested] of [['zoned', range()], ['legacy', range(false)], ['utc', { from: { basis: 'utc', unixMs: Date.parse('2024-09-01T00:00:00+08:00') }, to: { basis: 'utc', unixMs: Date.parse('2024-10-01T00:00:00+08:00') } }]]) await t.test(name, async () => {
      const args = { operation_id: `zone-${name}`, title: 'Controlled source fixture', source: { providerId: 'sesame/akshare#market', revision: 'fixture', binding: { configuration: { source: 'tencent' } } }, instrument: instrument('tencent'), spec, range: requested, include_forming: false, volume_kind: 'real', max_rows: 1000 };
      const output = await tool.execute(args);
      assert.equal(output.rowCount, 2); assert.equal(output.status, 'partial');
      const rows = resources.rows(output.ref);
      assert.equal(rows.length, 2); rows.forEach(bar => checkZone({ openTime: bar.datetime, endTime: bar.end_time }, name === 'legacy' ? undefined : authority));
      assert.equal(rows[0].open, '10.0000000000000001'); assert.equal(rows[0].volume, '9007199254740993');
      const retained = resources.rows(output.evidence);
      assert.deepEqual(retained.pages[0].meta.source.timeBasis, timeBasis);
      const before = f.calls.length;
      assert.deepEqual((await tool.execute(args)).ref, output.ref);
      assert.equal(f.calls.length, before);
    });
  } finally { f.provider.unbind(f.context); assert.equal(f.provider.snapshots.size, 0); f.provider.dispose(); }
});
