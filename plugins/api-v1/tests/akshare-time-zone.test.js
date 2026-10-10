import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AKShareProvider, descriptor, mapBar } from '../../optional-api-v1/packages/akshare/provider.js';
import { marketReadTools } from '../packages/data-access/market-read.js';

const authority = 'Asia/Shanghai';
const timeBasis = { kind: 'wall', authority, zone: authority };
const spec = { timeframe: '1d', priceBasis: 'last', adjustment: 'none', session: 'regular', calendarRevision: { status: 'unknown' } };
const wall = (value, zoned = true) => ({ basis: 'wall', authority, ...(zoned ? { zone: authority } : {}), value });
const range = (zoned = true) => ({ from: wall('2024-09-01T00:00:00', zoned), to: wall('2024-10-01T00:00:00', zoned) });
const instrument = source => ({ sourceId: `akshare:${source}:a-share`, instrumentId: '000001' });
const row = day => ({ date: `2024-09-${day}`, open: '10.0000000000000001', high: '11', low: '9', close: '10.5', volume: '9007199254740993' });
function fixture(source = 'tencent') {
  const calls = [], context = { bindingId: `fixture-${source}` };
  const provider = new AKShareProvider({ environment: { executeWorker: async (_entry, payload) => {
    calls.push(payload);
    const rows = ['stock_zh_a_spot_tx', 'stock_info_a_code_name'].includes(payload.interface) ? [{ code: '000001', name: 'Fixture stock' }] : ['02', '03', '04'].map(day => source === 'eastmoney' ? { '日期': row(day).date, '开盘': row(day).open, '最高': row(day).high, '最低': row(day).low, '收盘': row(day).close, '成交量': row(day).volume } : row(day));
    return { interface: payload.interface, observedAt: Date.parse('2024-10-01T00:00:00Z'), akshareVersion: '1.19.1', rows };
  } } });
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

const hostRoot = process.env.SESAME_HOST_ROOT;
test('unchanged data-access market_read freezes zoned, legacy and UTC requests through real public host ports', { skip: !hostRoot }, async t => {
  const load = path => import(pathToFileURL(join(hostRoot, path)));
  const { Store } = await load('modules/agent/store.js');
  const { ContractArtifacts } = await load('modules/plugins/artifacts.js');
  const { ProviderRegistry } = await load('modules/plugins/providers.js');
  const { createHostContext } = await load('modules/plugins/context.js');
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'sesame-akshare-zone-host-')));
  const store = new Store(join(directory, 'state')), registry = new ProviderRegistry();
  const f = fixture(), plugin = { id: 'sesame/akshare', version: '1.0.5', digest: `sha256:${'a'.repeat(64)}` };
  f.provider.unbind(f.context);
  const dispose = registry.register(plugin, descriptor, f.provider);
  const runtime = { store, providers: registry, contractArtifacts: new ContractArtifacts(store) };
  const host = createHostContext(runtime, { id: 'sesame/data-access', version: '2.3.0', digest: `sha256:${'d'.repeat(64)}` });
  const tool = marketReadTools(host)[0];
  try {
    for (const [name, requested] of [['zoned', range()], ['legacy', range(false)], ['utc', { from: { basis: 'utc', unixMs: Date.parse('2024-09-01T00:00:00+08:00') }, to: { basis: 'utc', unixMs: Date.parse('2024-10-01T00:00:00+08:00') } }]]) await t.test(name, async () => {
      const args = { operation_id: `zone-${name}`, title: 'Controlled source fixture', provider: { pluginId: plugin.id, providerId: 'market' }, configuration: { source: 'tencent' }, instrument: instrument('tencent'), spec, range: requested, include_forming: false, volume_kind: 'real', max_rows: 1000 };
      const output = (await tool.execute('fixture', args)).details;
      assert.equal(output.row_count, 2); assert.equal(output.status, 'partial');
      const rows = runtime.contractArtifacts.data(output.ref).rows;
      assert.equal(rows.length, 2); rows.forEach(bar => checkZone({ openTime: bar.datetime, endTime: bar.end_time }, name === 'legacy' ? undefined : authority));
      assert.equal(rows[0].open, '10.0000000000000001'); assert.equal(rows[0].volume, '9007199254740993');
      assert.deepEqual(store.get('dataset', output.dataset_id).rows, rows);
      const raw = runtime.contractArtifacts.read(output.raw), blob = raw.manifest.blobs.find(item => item.path === 'responses.json');
      const retained = JSON.parse(runtime.contractArtifacts.readBlob(blob));
      assert.deepEqual(retained.pages[0].meta.source.timeBasis, timeBasis);
      const before = f.calls.length;
      assert.deepEqual((await tool.execute('fixture-retry', args)).details.ref, output.ref);
      assert.equal(f.calls.length, before); assert.equal(registry.bindings.size, 0); assert.equal(f.provider.snapshots.size, 0);
    });
  } finally { await dispose(); store.close(); await rm(directory, { recursive: true, force: true }); }
});
