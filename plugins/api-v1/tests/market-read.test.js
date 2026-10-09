import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from '@sesame/plugin-sdk/schema';
import { canonical, clone, digest, check } from '@sesame/plugin-sdk/protocol';
import { marketReadTools } from '../packages/data-access/market-read.js';
import { fixedRows } from '../../optional-api-v1/packages/vnpy/index.js';

const time = value => ({ basis: 'wall', authority: 'Fixture/Broker', value });
const args = () => ({ operation_id: 'frozen-history', title: 'Observed fixture contract', provider: { pluginId: 'fixture/market', providerId: 'prices' }, connection: { id: 'configured', revision: '7' }, instrument: { sourceId: 'observed-source', instrumentId: 'EXACT' }, spec: { timeframe: '1d', priceBasis: 'last', adjustment: 'none', session: 'regular', calendarRevision: { status: 'unknown', reason: 'No pinned calendar' } }, range: { from: time('2026-01-01T00:00:00'), to: time('2026-02-01T00:00:00') }, include_forming: false, volume_kind: 'real', max_rows: 10 });
const bar = day => ({ id: `bar-${day}`, revision: '1', openTime: time(`2026-01-${String(day).padStart(2, '0')}T09:30:00`), endTime: time(`2026-01-${String(day).padStart(2, '0')}T15:00:00`), open: '9007199254740993', high: '9007199254740994', low: '9007199254740992', close: '9007199254740993.123456789012345', isClosed: true, closure: 'source', volume: { real: { status: 'value', value: { value: '100.25', unit: 'share' } }, tick: { status: 'value', value: '932' }, default: 'real' } });
const string = description => Type.String({ description, minLength: 1, maxLength: 20000 });
const tools = { Type, string, define: (name, description, properties, execute) => ({ name, description, parameters: Type.Object(properties, { additionalProperties: false }), execute }) };

function fixture() {
  const calls = [], bindings = new Set(), stored = new Map(), completed = new Map(), pending = new Map(), blobs = new Map(), published = new Map(), artifacts = new Map(), datasets = new Map();
  const f = { pages: [[bar(1), bar(2)], [bar(3)]], overrides: (_result, _page) => {}, failRegister: false, failRead: null, calls, bindings, stored, blobs, artifacts, datasets, bindCount: 0, unbindCount: 0 };
  const host = { tools, scope: { conversationId: 'main' }, plugin: { id: 'sesame/data-access', version: '2.2.0', digest: `sha256:${'a'.repeat(64)}` },
    storage: {
      get: (kind, id) => stored.has(`${kind}:${id}`) ? clone(stored.get(`${kind}:${id}`)) : undefined,
      put: (kind, record) => { stored.set(`${kind}:${record.id}`, clone(record)); return record; },
      idempotentAsync: async (key, fingerprint, action) => {
        const prior = completed.get(key) ?? pending.get(key);
        if (prior) { check(prior.fingerprint === fingerprint, 'Idempotency conflict', 'IDEMPOTENCY_CONFLICT'); return prior.promise ? prior.promise : clone(prior.value); }
        const promise = Promise.resolve().then(action).then(value => { completed.set(key, { fingerprint, value: clone(value) }); return value; }).finally(() => pending.delete(key));
        pending.set(key, { fingerprint, promise }); return promise;
      },
    },
    providers: {
      list: () => [{ pluginId: 'fixture/market', id: 'prices', contract: 'sesame.market', instanceId: 'instance-1', capabilities: ['bars.history'], plugin: { id: 'fixture/market', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}` } }],
      bind: async (_ref, input) => { f.bindCount++; calls.push(['bind', clone(input)]); bindings.add('binding'); return { bindingId: 'binding', connection: args().connection, instanceId: 'instance-1' }; },
      call: async (id, method, input, options) => {
        assert.ok(bindings.has(id)); assert.equal(method, 'queryBars'); options.signal?.throwIfAborted(); calls.push(['query', clone(input)]);
        const index = input.page.cursor ? Number(input.page.cursor.slice(5)) : 0;
        if (f.failRead?.index === index) throw f.failRead.error;
        const result = { data: { instrument: input.instrument, spec: input.spec, seriesId: 'series-1', page: { items: clone(f.pages[index]), nextCursor: index + 1 < f.pages.length ? `page-${index + 1}` : null, snapshotId: 'snapshot-1', consistency: 'snapshot' }, coverage: { requested: input.range, complete: true, observedRange: input.range, gaps: [] } }, meta: { provider: args().provider, connection: args().connection, instanceId: 'instance-1', observedAt: 100, receivedAt: 200 + index, freshness: 'delayed', origin: 'observed', consistency: 'best_effort', warnings: ['Observed contract fixture, not a live market run'] } };
        f.overrides(result, index); return result;
      },
      unbind: async id => { assert.ok(bindings.delete(id)); f.unbindCount++; calls.push(['unbind']); },
    },
    artifacts: {
      blob: input => { const bytes = Buffer.from(input), hash = digest(bytes); blobs.set(hash, bytes); return { digest: hash, size: bytes.length }; },
      readBlob: ref => { const bytes = blobs.get(ref.digest); assert.equal(bytes.length, ref.size); assert.equal(digest(bytes), ref.digest); return bytes; },
      publish: input => {
        const prior = published.get(input.operationId);
        if (prior) { assert.equal(prior.hash, digest(input)); return clone(prior.ref); }
        for (const ref of input.manifest.dependencies) assert.ok(artifacts.has(ref.id));
        const ref = { id: `artifact-${artifacts.size}`, revision: 'revision-1', digest: digest(input.manifest), kind: input.manifest.kind, schemaVersion: '1.0.0' };
        artifacts.set(ref.id, clone({ ref, manifest: input.manifest })); published.set(input.operationId, { ref, hash: digest(input) }); return ref;
      },
      read: ref => { const artifact = artifacts.get(ref.id); assert.equal(canonical(ref), canonical(artifact.ref)); return clone(artifact); },
    },
    datasets: { register: input => { if (f.failRegister) throw new Error('Dataset register failed after artifact publication'); datasets.set(input.id, clone(input)); return input; } },
  };
  f.host = host; f.run = (input = args(), signal) => marketReadTools(host)[0].execute(input, signal);
  f.rows = ref => { const { content, blobs: listed } = host.artifacts.read(ref).manifest; return JSON.parse(host.artifacts.readBlob(listed.find(blob => blob.path === content.path))); };
  return f;
}

test('stable multi-page history preserves Decimal/SourceTime and produces a dataset and vnpy-ready fixed reference', async () => {
  const f = fixture(), input = args(); input.configuration = { source: 'native', token: 'credential-marker-must-not-persist', credentials: { password: 'nested-private-marker' } };
  const result = await f.run(input), rows = f.rows(result.ref), raw = f.rows(result.raw);
  assert.equal(result.status, 'complete'); assert.equal(result.row_count, 3); assert.equal(raw.pages.length, 2);
  assert.equal(result.coverage.paginationComplete, true); assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.connection, input.connection); assert.deepEqual(rows[0].datetime, bar(1).openTime);
  assert.equal(rows[0].close, bar(1).close); assert.equal(rows[0].volume, '100.25'); assert.equal(rows[0].volume_unit, 'share');
  assert.deepEqual(f.datasets.get(result.dataset_id).rows, rows); assert.equal(result.provenance.kind, 'derived');
  assert.deepEqual(f.host.artifacts.read(result.ref).manifest.dependencies, [result.raw]);
  const native = fixedRows(f.host, result.ref, {}, 'Fixture/Broker'); assert.equal(native.rows[0].datetime, bar(1).openTime.value); assert.equal(native.rows[0].volume, '100.25');
  const evidence = JSON.stringify([...f.stored.values(), ...f.artifacts.values(), ...f.datasets.values()]) + [...f.blobs.values()].join('');
  assert.equal(evidence.includes(input.configuration.token), false); assert.equal(evidence.includes(input.configuration.credentials.password), false);
  assert.deepEqual(f.calls[0][1].configuration, input.configuration, 'Binding receives its options; evidence does not');
  assert.equal(f.bindings.size, 0); assert.equal(f.unbindCount, 1);
});

test('concurrent and later identical operations return the same snapshot without rebinding or reading', async () => {
  const f = fixture(); const [first, second] = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(first, second); assert.deepEqual(await f.run(), first);
  assert.equal(f.bindCount, 1); assert.equal(f.calls.filter(([name]) => name === 'query').length, 2);
  await assert.rejects(f.run({ ...args(), max_rows: 11 }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(f.bindCount, 1);
});

test('post-read publication failure resumes its retained snapshot rather than refetching newer data', async () => {
  const f = fixture(); f.failRegister = true;
  await assert.rejects(f.run(), /Dataset register failed/); assert.equal(f.stored.size, 1); assert.equal(f.artifacts.size, 2);
  f.failRegister = false; f.pages[0][0].close = '9007199254740994';
  const result = await f.run(); assert.equal(f.rows(result.ref)[0].close, bar(1).close);
  assert.equal(f.bindCount, 1); assert.equal(f.artifacts.size, 2); assert.equal(f.bindings.size, 0);
});

test('mid-read errors, snapshot drift, budget exhaustion and cursor loops publish nothing and close the binding', async () => {
  const cases = [
    { code: 'SOURCE_UNAVAILABLE', setup: f => { f.failRead = { index: 1, error: Object.assign(new Error('Actual upstream failure'), { code: 'SOURCE_UNAVAILABLE' }) }; } },
    { code: 'SNAPSHOT_REQUIRED', setup: f => { f.overrides = (result, index) => { if (index) result.data.page.snapshotId = 'changed-snapshot'; }; } },
    { code: 'RESOURCE_EXHAUSTED', input: { max_rows: 2 }, setup: () => {} },
    { code: 'INVALID_PROVIDER_DATA', setup: f => { f.overrides = result => { result.data.page.nextCursor = 'page-1'; }; } },
    { code: 'SNAPSHOT_REQUIRED', setup: f => { f.pages[1] = [{ ...bar(1), revision: '2' }]; } },
  ];
  for (const scenario of cases) {
    const f = fixture(); scenario.setup(f);
    await assert.rejects(f.run({ ...args(), ...scenario.input }), { code: scenario.code });
    assert.equal(f.bindings.size, 0, scenario.code); assert.equal(f.unbindCount, 1);
    assert.equal(f.artifacts.size, 0); assert.equal(f.datasets.size, 0); assert.equal(f.stored.size, 0);
  }
});

test('a failed read can retry the same request; only a successful completed read pins bytes', async () => {
  const f = fixture(); f.failRead = { index: 1, error: new Error('Interrupted before all pages') };
  await assert.rejects(f.run(), /Interrupted/); f.failRead = null;
  const result = await f.run(); assert.equal(result.row_count, 3); assert.equal(f.bindCount, 2); assert.equal(f.unbindCount, 2);
});

test('unknown and deliberately unrequested volume remain null; real/tick units never become each other', async () => {
  for (const kind of ['none', 'real', 'tick']) {
    const f = fixture(); if (kind === 'real') f.pages[0][0].volume.real = { status: 'unknown', reason: 'Not observed' };
    const result = await f.run({ ...args(), volume_kind: kind }), rows = f.rows(result.ref);
    if (kind === 'tick') { assert.equal(rows[0].volume, '932'); assert.equal(rows[0].volume_unit, 'tick'); assert.equal(result.volume.missingRows, 0); }
    else { assert.equal(rows[0].volume, null); assert.equal(rows[0].volume_unit, null); assert.ok(result.volume.missingRows > 0); assert.throws(() => fixedRows(f.host, result.ref, {}, 'Fixture/Broker'), /missing fields are never filled with zero/); }
    assert.equal(rows[0].volume_status, kind === 'none' ? 'not_requested' : kind === 'real' ? 'unknown' : 'value');
  }
});

test('partial provider coverage and best-effort pagination stay partial; demo provenance cannot be promoted', async () => {
  for (const mode of ['coverage', 'best_effort', 'demo']) {
    const f = fixture(); f.overrides = result => { if (mode === 'coverage') result.data.coverage.complete = false; if (mode === 'best_effort') result.data.page.consistency = 'best_effort'; if (mode === 'demo') result.meta.origin = 'demo'; };
    const result = await f.run();
    if (mode === 'demo') { assert.equal(result.provenance.kind, 'demo'); assert.equal(f.host.artifacts.read(result.raw).manifest.content.provenance.kind, 'demo'); }
    else { assert.equal(result.status, 'partial'); assert.equal(result.coverage.complete, false); assert.equal(result.coverage.paginationComplete, true); }
  }
});

test('cancellation between pages leaves no snapshot and closes the temporary binding', async () => {
  const f = fixture(), controller = new AbortController(); f.overrides = () => controller.abort();
  await assert.rejects(f.run(args(), controller.signal), { name: 'AbortError' });
  assert.equal(f.bindings.size, 0); assert.equal(f.unbindCount, 1); assert.equal(f.artifacts.size, 0); assert.equal(f.stored.size, 0);
});

test('byte-identical duplicate Bar IDs are explicit projection deduplication; source responses stay unchanged', async () => {
  const f = fixture(); f.pages[1] = [bar(2), bar(3)]; const result = await f.run();
  assert.equal(result.row_count, 3); assert.equal(f.rows(result.raw).duplicateRows, 1); assert.equal(f.rows(result.raw).pages[1].data.page.items.length, 2);
});

test('equivalent fractional wall bounds are compared without changing their original SourceTime', async () => {
  const f = fixture(), input = args(); input.range.from = time('2026-01-01T09:30:00.000');
  const result = await f.run(input);
  assert.equal(result.row_count, 3); assert.deepEqual(f.rows(result.ref)[0].datetime, bar(1).openTime);
  assert.deepEqual(result.coverage.requested.from, input.range.from);
});
