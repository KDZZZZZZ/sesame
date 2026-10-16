import test from 'node:test';
import assert from 'node:assert/strict';
import { marketReadCapabilities } from '../packages/data-access/market-read.js';
import { resourceHost } from './core-v2-fixture.mjs';

const time = value => ({ basis: 'wall', authority: 'Fixture/Broker', value });
const args = () => ({ operation_id: 'frozen-history', title: 'Observed contract fixture', source: { providerId: 'fixture/market#prices', revision: 'fixed', binding: { configuration: { token: 'credential-must-not-persist' } } }, instrument: { sourceId: 'observed-source', instrumentId: 'EXACT' }, spec: { timeframe: '1d', priceBasis: 'last', adjustment: 'none', session: 'regular', calendarRevision: { status: 'unknown', reason: 'No pinned calendar' } }, range: { from: time('2026-01-01T00:00:00'), to: time('2026-02-01T00:00:00') }, include_forming: false, volume_kind: 'real', max_rows: 10 });
const bar = day => ({ id: `bar-${day}`, revision: '1', openTime: time(`2026-01-${String(day).padStart(2, '0')}T09:30:00`), endTime: time(`2026-01-${String(day).padStart(2, '0')}T15:00:00`), open: '9007199254740993', high: '9007199254740994', low: '9007199254740992', close: '9007199254740993.123456789012345', isClosed: true, closure: 'source', volume: { real: { status: 'value', value: { value: '100.25', unit: 'share' } }, tick: { status: 'value', value: '932' } } });
function fixture() {
  const f = resourceHost(); f.pages = [[bar(1), bar(2)], [bar(3)]]; f.reads = 0; f.signals = [];
  f.host.data = { async query(request, options) {
    f.reads++; f.signals.push(options.signal); const index = request.cursor ? Number(request.cursor) : 0;
    const output = { items: structuredClone(f.pages[index]), metadata: { instrument: request.input.instrument, spec: request.input.spec, seriesId: 'series-1', snapshotId: 'snapshot-1', consistency: 'snapshot', coverage: { requested: request.input.range, complete: true }, connection: { id: 'c', revision: '1' }, meta: { origin: 'observed', observedAt: 100 } }, ...(index + 1 < f.pages.length ? { nextCursor: String(index + 1) } : {}) };
    f.change?.(output, index); return output;
  } };
  f.run = (input = args(), signal) => marketReadCapabilities(f.host)[0].execute(input, signal); return f;
}

test('unknown and deliberately unrequested volume remain null; real/tick units never become each other', async () => {
  for (const kind of ['none', 'real', 'tick']) {
    const f = fixture(); if (kind === 'real') f.pages[0][0].volume.real = { status: 'unknown', reason: 'Not observed' };
    const result = await f.run({ ...args(), volume_kind: kind }), rows = f.rows(result.ref);
    if (kind === 'tick') { assert.equal(rows[0].volume, '932'); assert.equal(rows[0].volume_unit, 'tick'); assert.equal(result.volume.missingRows, 0); }
    else { assert.equal(rows[0].volume, null); assert.equal(rows[0].volume_unit, null); assert.ok(result.volume.missingRows > 0);  }
    assert.equal(rows[0].volume_status, kind === 'none' ? 'not_requested' : kind === 'real' ? 'unknown' : 'value');
  }
});

test('partial provider coverage and best-effort pagination stay partial; demo provenance cannot be promoted', async () => {
  for (const mode of ['coverage', 'best_effort', 'demo']) {
    const f = fixture(); f.change = result => { if (mode === 'coverage') result.metadata.coverage.complete = false; if (mode === 'best_effort') result.metadata.consistency = 'best_effort'; if (mode === 'demo') result.metadata.meta.origin = 'demo'; };
    const result = await f.run();
    if (mode === 'demo') { assert.equal(result.provenance.kind, 'demo'); assert.equal(f.artifacts.get(result.evidence.id).manifest.content.provenance.kind, 'demo'); }
    else { assert.equal(result.status, 'partial'); assert.equal(result.coverage.complete, false); assert.equal(result.coverage.paginationComplete, true); }
  }
});

test('cancellation between pages leaves no snapshot and closes the temporary binding', async () => {
  const f = fixture(), controller = new AbortController(); f.change = () => controller.abort();
  await assert.rejects(f.run(args(), controller.signal), { name: 'AbortError' });
  assert.ok(f.signals.every(signal => signal.aborted)); assert.equal(f.artifacts.size, 0); assert.equal(f.records.size, 0);
});

test('byte-identical duplicate Bar IDs are explicit projection deduplication; source responses stay unchanged', async () => {
  const f = fixture(); f.pages[1] = [bar(2), bar(3)]; const result = await f.run();
  assert.equal(result.rowCount, 3); assert.equal(f.rows(result.evidence).duplicateRows, 1); assert.equal(f.rows(result.evidence).pages[1].data.page.items.length, 2);
});

test('equivalent fractional wall bounds are compared without changing their original SourceTime', async () => {
  const f = fixture(), input = args(); input.range.from = time('2026-01-01T09:30:00.000');
  const result = await f.run(input);
  assert.equal(result.rowCount, 3); assert.deepEqual(f.rows(result.ref)[0].datetime, bar(1).openTime);
  assert.deepEqual(result.coverage.requested.from, input.range.from);
});

test('an explicit DST fold in requested bounds is rejected before binding instead of guessing chronology', async () => {
  const f = fixture(), input = args(); input.range.from = { ...input.range.from, fold: 0 };
  await assert.rejects(f.run(input), { code: 'UNSUPPORTED_CAPABILITY' });
  assert.equal(f.reads, 0); assert.equal(f.records.size, 0); assert.equal(f.artifacts.size, 0);
});

test('forward and reverse DST folds in source bars are unsupported, never string-sorted into accepted history', async () => {
  const wall = (value, fold) => ({ basis: 'wall', authority: 'America/New_York', zone: 'America/New_York', value, ...(fold === undefined ? {} : { fold }) });
  for (const [openTime, endTime] of [
    [wall('2026-11-01T01:30:00', 0), wall('2026-11-01T01:15:00', 1)], // 05:30 -> 06:15 UTC, valid source bar
    [wall('2026-11-01T01:15:00', 1), wall('2026-11-01T01:30:00', 0)], // 06:15 -> 05:30 UTC, invalid reverse bar
  ]) {
    const f = fixture(), input = args();
    input.range = { from: wall('2026-11-01T00:00:00'), to: wall('2026-11-01T03:00:00') };
    f.pages = [[{ ...bar(1), openTime, endTime }]];
    await assert.rejects(f.run(input), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.ok(f.signals.every(signal => signal.aborted)); assert.equal(f.records.size, 0); assert.equal(f.artifacts.size, 0);
    assert.deepEqual(f.pages[0][0].openTime, openTime, 'No fold field is removed to force source data through');
  }
});

test('wall-range reads reject a changed source clock or zone before freezing data', async () => {
  for (const changes of [{ authority: 'Other/Broker' }, { zone: 'America/New_York' }, { basis: 'utc', unixMs: 1767259800000 }]) {
    const f = fixture();
    for (const key of ['openTime', 'endTime']) f.pages[0][0][key] = { ...f.pages[0][0][key], ...changes, ...(key === 'endTime' && changes.basis === 'utc' ? { unixMs: changes.unixMs + 3600000 } : {}) };
    await assert.rejects(f.run(), { code: 'INVALID_PROVIDER_DATA' });
    assert.ok(f.signals.every(signal => signal.aborted)); assert.equal(f.records.size, 0); assert.equal(f.artifacts.size, 0);
  }
});

test('a provider-supported UTC query can preserve returned wall SourceTime without a guessed conversion', async () => {
  const f = fixture(), input = args();
  input.range = { from: { basis: 'utc', unixMs: 1767225600000 }, to: { basis: 'utc', unixMs: 1769904000000 } };
  const result = await f.run(input);
  assert.equal(result.rowCount, 3); assert.deepEqual(f.rows(result.ref)[0].datetime, bar(1).openTime);
  assert.deepEqual(result.coverage.requested, input.range);
});
