import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@sesame/plugin-sdk/protocol';
import { alignEventOutcomes } from '../packages/investment-research/src/event-outcomes.js';

const ref = id => ({ id, revision: 'r1', digest: digest(id), kind: 'data', schemaVersion: '1.0.0' });
const stamp = minute => new Date(Date.parse('2026-01-01T00:00:00Z') + minute * 60000).toISOString();
const event = (id = 'one', minute = 0, instrument = 'TARGET') => ({ event_id: id, instrument, event_at: stamp(minute), published_at: stamp(minute), retrieved_at: stamp(100) });
const price = (minute, close, instrument = 'TARGET', extra = {}) => ({ instrument, observed_at: stamp(minute), close, unit: 'USD', available_at: stamp(minute), ...extra });
const input = extra => ({ events_ref: ref('events'), market_ref: ref('prices'), selection: 'Explicit synthetic software fixture, not real events or a searched sample', price_basis: 'Fixture unadjusted closed price; no dividends or fees', price_time_semantics: 'closed_bar_close', as_of: stamp(120), anchor: 'event_at', entry: 'last_at_or_before', tolerance_seconds: 0, windows: [{ id: 'ten_minutes', seconds: 600 }], baseline: { kind: 'instrument', instrument: 'BASE' }, ...extra });
const market = () => [price(0, 100), price(10, 110), price(0, 200, 'BASE'), price(10, 210, 'BASE')];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} vs ${expected}`);

test('fixed event/price endpoints give auditable gross and benchmark returns, without inventing availability', () => {
  const result = alignEventOutcomes(input(), [event()], market()), row = result.rows[0];
  near(row.return_fraction, .1); near(row.baseline.return_fraction, .05); near(row.baseline.excess_return_fraction, .05);
  assert.equal(row.entry.price, 100); assert.equal(row.exit.price, 110); assert.equal(row.status, 'complete');
  assert.deepEqual(row.source_refs, [ref('events'), ref('prices')]);
  assert.equal(row.availability.published_at, stamp(0)); assert.equal(row.availability.retrieved_at, stamp(100));
  assert.equal(row.availability.first_available_at, null); assert.equal(row.availability.eligible_for_point_in_time_validation, false);
  assert.equal(result.point_in_time_status, 'not_established'); assert.ok(row.flags.includes('retrieved_after_event'));
  assert.equal(Object.hasOwn(result, 'confidence'), false); assert.equal(Object.hasOwn(row, 'probability'), false);
});

test('availability anchor stays missing when only publication and later acquisition are known', () => {
  const result = alignEventOutcomes(input({ anchor: 'first_available_at' }), [event()], market());
  assert.equal(result.rows[0].return_fraction, null);
  assert.deepEqual(result.rows[0].missing, ['anchor_availability_unknown']);
  const provided = alignEventOutcomes(input(), [{ ...event(), first_available_at: stamp(0) }], market()).rows[0];
  assert.equal(provided.availability.first_available_at_status, 'declared_not_verified');
  assert.equal(provided.availability.eligible_for_point_in_time_validation, false);
  const unknownRetrieval = { ...event() }; delete unknownRetrieval.retrieved_at;
  const genericAsOf = alignEventOutcomes(input(), [unknownRetrieval], market(), { events: { as_of: stamp(0) } }).rows[0];
  assert.equal(genericAsOf.availability.retrieved_at, null, 'A generic source as_of may be a cutoff and must not be relabeled retrieval time');
});

test('explicit tolerance bounds weekend/session gaps and baseline never silently shifts timestamps', () => {
  const missing = alignEventOutcomes(input(), [event()], [price(0, 100), price(12, 110), price(0, 200, 'BASE'), price(10, 210, 'BASE')]).rows[0];
  assert.ok(missing.missing.includes('target_exit_missing')); assert.equal(missing.return_fraction, null);
  const shifted = alignEventOutcomes(input({ tolerance_seconds: 120 }), [event()], [price(0, 100), price(12, 110), price(0, 200, 'BASE'), price(10, 210, 'BASE')]).rows[0];
  near(shifted.return_fraction, .1); assert.equal(shifted.exit.observed_at, stamp(12));
  assert.equal(shifted.status, 'partial'); assert.ok(shifted.missing.includes('baseline_exit_missing')); assert.equal(shifted.baseline.excess_return_fraction, null);
});

test('unknown, zero, nonfinite and changed-unit prices remain gaps instead of silently selecting another value', () => {
  for (const close of [null, 0, -1, '110', Infinity]) {
    const row = alignEventOutcomes(input({ baseline: { kind: 'none' } }), [event()], [price(0, 100), price(10, close)]).rows[0];
    assert.equal(row.return_fraction, null); assert.ok(row.missing.includes('target_nonpositive_or_missing_price'));
  }
  const row = alignEventOutcomes(input(), [event()], [price(0, 100), price(10, 110, 'TARGET', { unit: 'cents' }), ...market().filter(p => p.instrument === 'BASE')]).rows[0];
  assert.equal(row.return_fraction, null); assert.ok(row.missing.includes('target_unit_missing_or_changed'));
});

test('cutoff excludes observations and later available prices, while unelapsed windows are pending', () => {
  const result = alignEventOutcomes(input({ as_of: stamp(20) }), [event()], [price(0, 100), price(10, 110, 'TARGET', { available_at: stamp(30) }), price(40, 120)]);
  assert.deepEqual(result.excluded_market_rows, { observed_after_as_of: 1, available_after_as_of: 1 });
  assert.equal(result.rows[0].return_fraction, null); assert.ok(result.rows[0].flags.includes('retrieved_after_as_of'));
  const future = alignEventOutcomes(input({ as_of: stamp(5) }), [event()], market()).rows[0];
  assert.equal(future.status, 'pending'); assert.ok(future.missing.includes('window_not_elapsed'));
});

test('overlapping event windows carry IDs and multiple horizons are never independent votes', () => {
  const result = alignEventOutcomes(input({ baseline: { kind: 'none' }, windows: [{ id: 'ten', seconds: 600 }, { id: 'twenty', seconds: 1200 }] }), [event('one'), event('two', 5), event('other', 0, 'OTHER')], [price(0, 100), price(5, 105), price(10, 110), price(15, 115), price(20, 120), price(25, 125), price(0, 50, 'OTHER'), price(10, 55, 'OTHER'), price(20, 60, 'OTHER')]);
  assert.deepEqual(result.rows[0].overlap_event_ids, ['two']); assert.deepEqual(result.rows[2].overlap_event_ids, ['one']);
  assert.ok(result.rows[0].flags.includes('overlapping_event_windows'));
  assert.equal(result.rows[4].overlap_event_ids.length, 0); assert.equal(result.counts.overlapping, 4);
  assert.match(result.interpretation, /dependent/);
});

test('flat field mapping permits source-specific names; entry policy and price time meaning stay explicit', () => {
  const result = alignEventOutcomes(input({ fields: { events: { id: 'id', instrument: 'symbol', event_at: 'release' }, market: { instrument: 'symbol', time: 'closed_at', price: 'settle', unit: 'currency' } }, baseline: { kind: 'none' }, entry: 'first_at_or_after', tolerance_seconds: 60 }), [{ id: 'e', symbol: 'ABC', release: stamp(0) }], [{ symbol: 'ABC', closed_at: stamp(1), settle: 10, currency: 'USD' }, { symbol: 'ABC', closed_at: stamp(10), settle: 11, currency: 'USD' }]);
  near(result.rows[0].return_fraction, .1); assert.equal(result.rows[0].entry.observed_at, stamp(1));
  assert.ok(result.rows[0].flags.includes('entry_availability_unknown'));
  assert.throws(() => alignEventOutcomes(input({ price_time_semantics: 'bar_open' }), [], []), /actual bar-close times/);
});

test('ambiguous timestamps, duplicate identities, unbounded inputs and nonfixed refs are rejected', () => {
  assert.throws(() => alignEventOutcomes(input(), [event()], [price(0, 100), price(0, 100)]), /Duplicate instrument/);
  assert.throws(() => alignEventOutcomes(input(), [event(), event()], market()), /unique event ID/);
  assert.throws(() => alignEventOutcomes(input(), [{ ...event(), event_at: '2026-01-01' }], market()), /explicit timezone/);
  assert.throws(() => alignEventOutcomes(input(), [{ ...event(), event_at: '2026-02-30T00:00:00Z' }], market()), /real timestamp/);
  assert.throws(() => alignEventOutcomes(input({ events_ref: { id: 'mutable' } }), [], []), /complete fixed DataRefs/);
  assert.throws(() => alignEventOutcomes(input(), Array.from({ length: 257 }, (_, i) => event(String(i))), []), /256/);
  assert.throws(() => alignEventOutcomes(input({ windows: Array.from({ length: 9 }, (_, i) => ({ id: 'w' + i, seconds: 1 })) }), [], []), /1..8/);
  assert.throws(() => alignEventOutcomes(input(), [event()], [price(10, 100, 'TARGET', { available_at: stamp(0) })]), /precedes its price observation/);
});

test('empty selection is transparent and repeated fixed inputs yield identical packets', () => {
  const empty = alignEventOutcomes(input(), [], market()); assert.equal(empty.counts.events, 0); assert.deepEqual(empty.rows, []);
  assert.deepEqual(alignEventOutcomes(input(), [event()], market()), alignEventOutcomes(input(), [event()], market()));
});
