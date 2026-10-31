import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceSnapshot } from '../packages/data-access/capture.js';
import { marketReadCapabilities } from '../packages/data-access/market-read.js';
import { resourceHost } from './core-v2-fixture.mjs';

const time = value => ({ basis: 'wall', authority: 'Fixture/Broker', value });
const args = () => ({ operation_id: 'frozen-history', title: 'Observed contract fixture', source: { providerId: 'fixture/market#prices', revision: 'fixed', binding: { configuration: { token: 'credential-must-not-persist' } } }, instrument: { sourceId: 'observed-source', instrumentId: 'EXACT' }, spec: { timeframe: '1d', priceBasis: 'last', adjustment: 'none', session: 'regular', calendarRevision: { status: 'unknown', reason: 'No pinned calendar' } }, range: { from: time('2026-01-01T00:00:00'), to: time('2026-02-01T00:00:00') }, include_forming: false, volume_kind: 'real', max_rows: 10 });
const bar = day => ({ id: `bar-${day}`, revision: '1', openTime: time(`2026-01-${String(day).padStart(2, '0')}T09:30:00`), endTime: time(`2026-01-${String(day).padStart(2, '0')}T15:00:00`), open: '9007199254740993', high: '9007199254740994', low: '9007199254740992', close: '9007199254740993.123456789012345', isClosed: true, closure: 'source', volume: { real: { status: 'value', value: { value: '100.25', unit: 'share' } } } });
function fixture() {
  const f = resourceHost(); f.pages = [[bar(1), bar(2)], [bar(3)]]; f.reads = 0; f.signals = [];
  f.host.data = { async query(request, options) {
    f.reads++; f.signals.push(options.signal); const index = request.cursor ? Number(request.cursor) : 0;
    const output = { items: structuredClone(f.pages[index]), metadata: { instrument: request.input.instrument, spec: request.input.spec, seriesId: 'series-1', snapshotId: 'snapshot-1', consistency: 'snapshot', coverage: { requested: request.input.range, complete: true }, connection: { id: 'c', revision: '1' }, meta: { origin: 'observed', observedAt: 100 } }, ...(index + 1 < f.pages.length ? { nextCursor: String(index + 1) } : {}) };
    f.change?.(output, index); return output;
  } };
  f.run = (input = args(), signal) => marketReadCapabilities(f.host)[0].execute(input, signal); return f;
}

test('market snapshot freezes every page with exact decimals and SourceTime without persisting credentials or cursors', async () => {
  const f = fixture(), result = await f.run(), rows = f.rows(result.ref), evidence = f.rows(result.evidence);
  assert.equal(result.rowCount, 3); assert.equal(result.status, 'complete'); assert.equal(evidence.pages.length, 2);
  assert.equal(rows[0].close, bar(1).close); assert.deepEqual(rows[0].datetime, bar(1).openTime); assert.equal(rows[0].volume, '100.25');
  assert.deepEqual(f.artifacts.get(result.ref.id).manifest.dependencies, [result.evidence]);
  assert.equal(JSON.stringify([...f.records.values(), ...f.publications, evidence]).includes('credential-must-not-persist'), false);
  assert.ok(f.signals.every(signal => signal.aborted), 'capture closes its cursor lifetime');
});

test('snapshot retry after publication failure uses pinned bytes and rejects operation identity drift', async () => {
  const f = fixture(); f.host.failPublication = manifest => manifest.kind === 'data';
  await assert.rejects(f.run(), /Publication interrupted/); assert.equal(f.reads, 2);
  f.host.failPublication = undefined; f.pages[0][0].close = '9007199254740994';
  const [first, second] = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(first, second); assert.equal(f.rows(first.ref)[0].close, bar(1).close); assert.equal(f.reads, 2);
  await assert.rejects(f.run({ ...args(), max_rows: 11 }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('snapshot drift, invalid OHLC, budget truncation and unknown numeric volume never publish', async () => {
  for (const scenario of [
    { code: 'SNAPSHOT_REQUIRED', change: (page, i) => { if (i) page.metadata.snapshotId = 'drift'; } },
    { code: 'INVALID_PROVIDER_DATA', change: page => { page.items[0].high = '1'; } },
    { code: 'RESOURCE_EXHAUSTED', input: { max_rows: 2 } },
    { code: 'INVALID_PROVIDER_DATA', change: page => { page.items[0].volume.real = { status: 'unknown', value: '0' }; } },
  ]) {
    const f = fixture();f.change = scenario.change;
    await assert.rejects(f.run({ ...args(), ...scenario.input }), { code: scenario.code }); assert.equal(f.publications.length, 0);
    assert.ok(f.signals.every(signal => signal.aborted));
  }
});

test('generic snapshots pin declared dependencies and cannot relabel demo source evidence', async () => {
  const f = resourceHost(), raw = await f.host.resources.create({ kind: 'file', source: { content: '[]' } });
  const dependency = (await f.host.resources.publish(raw, { kind: 'data', schemaVersion: '1.0.0', content: { path: 'rows.json', provenance: { kind: 'demo' } }, blobs: [{ path: 'rows.json' }] })).ref;
  let reads = 0; f.host.data = { query: async () => { reads++;return { items: [{ exact: '9007199254740993.1' }], metadata: { provenance: { kind: 'demo' } } }; } };
  const input = { source: { providerId: 'host#datasets', revision: 'host:2' }, operationId: 'sample', title: 'Sample', input: { datasetId: 'sample' }, dependencies: [dependency] };
  const result = await sourceSnapshot(f.host, input); assert.equal(result.provenance.kind, 'demo');
  assert.deepEqual(f.artifacts.get(result.evidence.id).manifest.dependencies, [dependency]);
  assert.deepEqual(f.artifacts.get(result.ref.id).manifest.dependencies, [result.evidence, dependency]);
  assert.equal(f.rows(result.ref)[0].exact, '9007199254740993.1');
  await assert.rejects(sourceSnapshot(f.host, { ...input, operationId: 'incorrect', provenanceKind: 'observed' }), /Provenance differs/);
  assert.equal(reads, 2);
});

test('observed source registration cannot be relabelled derived to manufacture an input dependency graph', async () => {
  const f = resourceHost();
  f.host.data = { query: async () => ({ items: [{ value: 1 }], metadata: { provenance: { kind: 'observed' } } }) };
  await assert.rejects(sourceSnapshot(f.host, { source: { providerId: 'host#datasets', revision: 'host:2' }, operationId: 'no-relabel', input: {}, title: 'Observed', provenanceKind: 'derived' }), /Provenance differs/);
  assert.equal(f.publications.length, 0);
});

test('generic snapshot maxRows cannot silently publish a preview as a complete dataset', async () => {
  const f = resourceHost();f.host.data = { query: async () => ({ items: [{ a: 1 }], nextCursor: 'more', metadata: { provenance: { kind: 'observed' } } }) };
  await assert.rejects(sourceSnapshot(f.host, { operationId: 'bounded', source: { providerId: 'host#datasets', revision: 'host:2' }, input: {}, title: 'Full data', maxRows: 1 }), { code: 'RESOURCE_EXHAUSTED' });
  assert.equal(f.publications.length, 0);
});
