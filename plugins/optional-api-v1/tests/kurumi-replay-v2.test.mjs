import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { invokeValue } from '@sesame/plugin-sdk/capabilities';
const hostRoot = new URL('../../../../mt5agent/', import.meta.url);
const { Store } = await import(new URL('modules/agent/store.js', hostRoot));
const { Runtime } = await import(new URL('modules/agent/runtime.js', hostRoot));
const { createHostContextV2 } = await import(new URL('modules/plugins/host-v2/context.js', hostRoot));
const H = 3600000, T = Date.UTC(2010, 0, 4), book = price => ({ open: price, high: price, low: price, close: price });

test('Kurumi API 2 uses actual Runtime Runs, sources, resources and canvas without starting a model or native installer', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kurumi-v2-')), store = new Store(join(root, 'state'));
  const runtime = new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: join(root, 'empty') });
  await runtime.init();
  t.after(async () => { await runtime.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const path = join(runtime.workspaces.root('conv_main'), 'kurumi');
  await cp(new URL('../packages/kurumi-replay/', import.meta.url), path, { recursive: true, filter: path => !path.includes('.core-sqlite-roundtrip') });
  const checked = await runtime.plugins.manager.test('conv_main', { path });
  assert.equal(checked.passed, true, JSON.stringify(checked));
  await runtime.plugins.manager.install('conv_main', { path, digest: checked.digest });
  runtime.plugins.activate('conv_main', 'sesame/kurumi-replay');
  const entry = runtime.plugins.entry('sesame/kurumi-replay'), host = createHostContextV2(runtime, entry, 'conv_main');
  const local = file => import(pathToFileURL(join(entry.root, file)));
  const { getService } = await local('service.js'), { records } = await local('records.js'), { createRun } = await local('native-engine.js');
  const service = getService(host);
  const call = (id, input, options) => invokeValue(host, `sesame/kurumi-replay#${id}`, input, options);

  await t.test('strict declarations activate with no network, model or fallback engine', async () => {
    assert.equal(entry.apiVersion, '2');
    assert.equal((await call('kurumi_status', {})).prepared, false);
    assert.equal(runtime.runs.list().length, 0);
    assert.equal((await host.data.sources({ providerId: 'sesame/kurumi-replay#market' })).items.length, 1);
    const native = await call('native_run', { action: 'status' });
    assert.equal(native.ready, false);
    assert.equal(runtime.runs.list()[0].capabilityId, 'sesame/kurumi-replay#native_run');
    assert.equal(runtime.runs.list()[0].status, 'completed');
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      await assert.rejects(call('kurumi_prepare', { action: 'prepare' }), { code: 'UNSUPPORTED_NATIVE_PLATFORM' });
      assert.equal(service.getState(), null);
    }
  });

  const chapters = ['AUDJPY', 'GBPJPY', 'EURCHF'].map((symbol, index) => ({ id: String(index), symbol, startIndex: 1, endIndex: 3 }));
  const frames = chapters.map((_, chapter) => Array.from({ length: 4 }, (_, index) => ({ time: T + (chapter * 10 + index) * H, bid: book('100.000000000000000001'), ask: book('100.000000000000000002'), ...(chapter === 2 ? { fx: { time: T + (chapter * 10 + index) * H, bid: book('150.1'), ask: book('150.2') } } : {}) })));
  const digests = { fixture: 'explicit-synthetic-financial-view-only' }, state = createRun('fixture-replay', chapters, digests);
  service.data = { chapters, frames, digests, provenance: { kind: 'demo' } };
  records(host).put('challenge', { id: 'continuous', revision: 1, engine: state, model: null, settings: { decisionIntervalHours: 4 }, commands: {}, control: { phase: 'paused', running: false, remaining: 0, active: null, attempt: 0 } });
  const source = (await host.data.sources({ providerId: 'sesame/kurumi-replay#market' })).items[0].ref;
  const instrument = { sourceId: 'kurumi:fixture-replay', instrumentId: 'AUDJPY' };
  const spec = { timeframe: '1h', priceBasis: 'bid', adjustment: 'none', session: 'all', calendarRevision: { status: 'unknown' } };
  const query = { instrument, spec, range: { from: { basis: 'utc', unixMs: T }, to: { basis: 'utc', unixMs: T + 2 * H } } };

  await t.test('static data pages retain precise prices and source boundaries; subscriptions close without leaking listeners', async () => {
    const first = await host.data.query({ source, operation: 'queryBars', input: query, limit: 1 });
    assert.equal(first.items[0].close, '100.000000000000000001'); assert.ok(first.nextCursor);
    const second = await host.data.query({ source, operation: 'queryBars', input: query, limit: 1, cursor: first.nextCursor });
    assert.equal(second.metadata.snapshotId, first.metadata.snapshotId); assert.equal(second.nextCursor, undefined);
    assert.equal(service.sources.market.bindings.size, 0);
    await assert.rejects(host.data.query({ source, operation: 'queryBars', input: { ...query, range: { ...query.range, to: { basis: 'utc', unixMs: T + 4 * H } } } }), { code: 'FUTURE_DATA_FORBIDDEN' });
    const controller = new AbortController();
    const subscription = await host.data.watch({ source, operation: 'subscribeBars', input: { instrument, spec, tailLimit: 10 } }, { signal: controller.signal });
    const iterator = subscription.events[Symbol.asyncIterator](), initial = await iterator.next();
    assert.equal(initial.value.type, 'snapshot'); assert.equal(initial.value.snapshot.bars.length, 2);
    assert.equal(service.listeners.size, 1);
    const pending = iterator.next(); controller.abort(); await subscription.close(); await pending.catch(() => {});
    assert.equal(service.listeners.size, 0); assert.equal(service.sources.market.bindings.size, 0);
    const accountSource = (await host.data.sources({ providerId: 'sesame/kurumi-replay#account' })).items[0].ref;
    const account = await host.data.query({ source: accountSource, operation: 'snapshot', input: { account: { connectionId: 'kurumi-simulation', accountId: state.id } } });
    assert.equal(account.items[0].balance.value.value, '300000');
  });

  await t.test('published evidence uses actual ResourceRefs and canvas consumes the declared source', async () => {
    const exported = await call('kurumi_export', { operation_id: 'fixture_export_0000001' });
    const manifest = await host.resources.read(exported.data, { part: 'manifest' });
    assert.equal(manifest.content.format, 'json-rows');
    const content = await host.resources.read(exported.data, { part: 'content', entry: 'rows.json' });
    assert.equal(JSON.parse(content.content)[0].runId, state.id);
    const repeated = await call('kurumi_export', { operation_id: 'fixture_export_0000001' });
    assert.deepEqual(repeated.data, exported.data);
    const displayed = await call('kurumi_display', {});
    assert.equal(displayed.binding.source.providerId, source.providerId);
    assert.ok(displayed.instanceId);
    assert.equal(displayed.layout.charts.find(chart => chart.id === 'kurumi-h1').binding.source.revision, entry.digest);
    assert.ok((await readFile(join(host.context.storageRoot, 'replay.sqlite'))).length > 0);
  });
  await t.test('main commentary reads the real public message source and role tools reject unrelated callers', async () => {
    const id='fixture-main-response';
    store.put('message',{id,conversation_id:'conv_main',role:'assistant',status:'streaming',created_at:new Date().toISOString(),content:[{type:'text',text:'Synthetic visible commentary'}],segments:[{type:'thinking',text:'never expose reasoning'},{type:'text',text:'Synthetic visible commentary'}]});
    store.update('conversation','conv_main',{active_response_message_id:id});
    const diagnostic=await call('kurumi_narration',{action:'diagnose'});
    assert.equal(diagnostic.messageId,id);assert.equal(diagnostic.status,'public_read_available');
    assert.deepEqual(diagnostic.observedContentShape,[{type:'text',textType:'string'}]);
    await assert.rejects(call('kurumi_observe',{}),{code:'SCOPE_DENIED'});
    store.update('conversation','conv_main',{active_response_message_id:null});
  });
  assert.equal(runtime.runs.list({ kind: 'agent' }).length, 0);
});
