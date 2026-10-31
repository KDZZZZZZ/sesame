import { randomUUID } from 'node:crypto';
import { digest } from '@sesame/plugin-sdk/protocol';
import { check } from './workflow-mechanics.js';
import { checkedArtifact, dataRef, readRows, uniqueRefs } from './research-artifacts.js';

export const EVENT_OUTCOMES_METHOD = 'fixed-event-window-returns/1.0.0';
const MAX_EVENTS = 256, MAX_MARKET_ROWS = 50000, MAX_BYTES = 8 * 1024 * 1024;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
const valid = (ok, message) => check(ok, 'INVALID_EVENT_OUTCOMES', message);
const iso = value => new Date(value).toISOString();
const defaults = {
  events: { id: 'event_id', instrument: 'instrument', event_at: 'event_at', published_at: 'published_at', first_available_at: 'first_available_at', retrieved_at: 'retrieved_at', source_url: 'source_url' },
  market: { instrument: 'instrument', time: 'observed_at', price: 'close', unit: 'unit', available_at: 'available_at' },
};

function timestamp(value, name, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  valid(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value), `${name} needs an ISO timestamp with explicit timezone, or null when unknown.`);
  const date = value.slice(0, 10), parts = date.split('-').map(Number), day = new Date(`${date}T00:00:00Z`), result = Date.parse(value);
  valid(Number.isFinite(result) && day.getUTCFullYear() === parts[0] && day.getUTCMonth() + 1 === parts[1] && day.getUTCDate() === parts[2], `${name} is not a real timestamp.`);
  return result;
}
function mappings(input) {
  valid(input.fields === undefined || object(input.fields), 'fields must be a field mapping object.');
  const result = structuredClone(defaults);
  for (const [group, supplied] of Object.entries(input.fields ?? {})) {
    valid(Object.hasOwn(defaults, group) && object(supplied), 'Only events and market field mappings are supported.');
    for (const [name, key] of Object.entries(supplied)) {
      valid(Object.hasOwn(defaults[group], name) && typeof key === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(key), 'Map known fields to explicit flat column names; nested source records need a separately frozen normalization.');
      result[group][name] = key;
    }
  }
  return result;
}
function parameters(input) {
  valid(object(input) && dataRef(input.events_ref) && dataRef(input.market_ref), 'events_ref and market_ref must be complete fixed DataRefs; inline rows and live dataset IDs are not accepted.');
  valid(text(input.selection) && text(input.price_basis), 'Describe the selected event population and the input price basis.');
  valid(['closed_bar_close', 'price_observation'].includes(input.price_time_semantics), 'Declare price_time_semantics as closed_bar_close or price_observation. Bar-open timestamps must be normalized to actual bar-close times in a fixed input first.');
  valid(['event_at', 'first_available_at'].includes(input.anchor), 'Select event_at or first_available_at explicitly.');
  valid(['last_at_or_before', 'first_at_or_after'].includes(input.entry), 'Select an explicit entry endpoint rule.');
  valid(Number.isSafeInteger(input.tolerance_seconds) && input.tolerance_seconds >= 0 && input.tolerance_seconds <= 604800, 'tolerance_seconds must be 0..604800; no implicit holiday/session interpolation.');
  valid(Array.isArray(input.windows) && input.windows.length > 0 && input.windows.length <= 8, 'Select 1..8 outcome windows.');
  const ids = new Set();
  for (const window of input.windows) {
    valid(object(window) && typeof window.id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(window.id) && !ids.has(window.id), 'Window IDs must be unique.');
    valid(Number.isSafeInteger(window.seconds) && window.seconds > 0 && window.seconds <= 31 * 86400, 'Window seconds must be 1..2678400.'); ids.add(window.id);
  }
  valid(object(input.baseline) && ['none', 'instrument'].includes(input.baseline.kind), 'Declare baseline kind none or instrument.');
  valid(input.baseline.kind === 'none' ? input.baseline.instrument === undefined : text(input.baseline.instrument), 'An instrument baseline needs its exact instrument; none must not name one.');
  return { asOf: timestamp(input.as_of, 'as_of'), fields: mappings(input) };
}
function lowerBound(rows, time) {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid].time < time) lo = mid + 1; else hi = mid; }
  return lo;
}
function endpoint(rows, requested, rule, tolerance) {
  let index = lowerBound(rows, requested);
  if (rule === 'last_at_or_before' && rows[index]?.time !== requested) index--;
  const item = rows[index];
  return item && Math.abs(item.time - requested) <= tolerance ? item : null;
}
function point(item) {
  return item ? { row_index: item.index, observed_at: iso(item.time), price: Number.isFinite(item.price) ? item.price : null, unit: item.unit ?? null, available_at: item.available === null ? null : iso(item.available) } : null;
}
function measured(start, end, prefix) {
  const missing = [];
  if (!start) missing.push(`${prefix}_entry_missing`);
  if (!end) missing.push(`${prefix}_exit_missing`);
  if (!start || !end) return { value: null, missing };
  if (end.time <= start.time) missing.push(`${prefix}_window_not_positive`);
  if (![start.price, end.price].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) missing.push(`${prefix}_nonpositive_or_missing_price`);
  if (!text(start.unit) || start.unit !== end.unit) missing.push(`${prefix}_unit_missing_or_changed`);
  const value = missing.length ? null : end.price / start.price - 1;
  if (value !== null && !Number.isFinite(value)) missing.push(`${prefix}_nonfinite_return`);
  return { value: missing.length ? null : value, missing };
}

/** Retrospective endpoint arithmetic. No event matching, knowledge validation, forecast or data acquisition. */
export function alignEventOutcomes(input, events, market, source = {}, signal) {
  const config = parameters(input), { fields, asOf } = config;
  valid(Array.isArray(events) && events.length <= MAX_EVENTS && events.every(object), `At most ${MAX_EVENTS} event rows are supported.`);
  valid(Array.isArray(market) && market.length <= MAX_MARKET_ROWS && market.every(object), `At most ${MAX_MARKET_ROWS} market rows are supported.`);
  const groups = new Map(), excluded = { observed_after_as_of: 0, available_after_as_of: 0 }, seen = new Set();
  for (const [index, raw] of market.entries()) {
    signal?.throwIfAborted();
    const instrument = raw[fields.market.instrument], time = timestamp(raw[fields.market.time], `market[${index}].time`);
    valid(text(instrument), `market[${index}] needs an instrument.`);
    const key = JSON.stringify([instrument, time]);
    valid(!seen.has(key), 'Duplicate instrument/timestamp market rows are ambiguous; freeze a resolved source version first.'); seen.add(key);
    const available = timestamp(raw[fields.market.available_at], `market[${index}].available_at`, true);
    valid(available === null || available >= time, `market[${index}].available_at precedes its price observation.`);
    if (time > asOf) { excluded.observed_after_as_of++; continue; }
    if (available !== null && available > asOf) { excluded.available_after_as_of++; continue; }
    if (!groups.has(instrument)) groups.set(instrument, []);
    groups.get(instrument).push({ index, time, available, price: raw[fields.market.price], unit: raw[fields.market.unit] });
  }
  for (const group of groups.values()) group.sort((a, b) => a.time - b.time);
  const rows = [], eventIds = new Set(), tolerance = input.tolerance_seconds * 1000;
  for (const [eventIndex, raw] of events.entries()) {
    signal?.throwIfAborted();
    const id = raw[fields.events.id], instrument = raw[fields.events.instrument];
    valid(text(id) && id.length <= 128 && !eventIds.has(id) && text(instrument), 'Each event needs a unique event ID (max 128 characters) and an instrument.'); eventIds.add(id);
    const at = timestamp(raw[fields.events.event_at], `events[${eventIndex}].event_at`);
    const published = timestamp(raw[fields.events.published_at], `events[${eventIndex}].published_at`, true);
    const available = timestamp(raw[fields.events.first_available_at], `events[${eventIndex}].first_available_at`, true);
    // A recently downloaded old article cannot acquire historical availability from its publication date.
    const retrievedValue = raw[fields.events.retrieved_at] ?? source.events?.retrieved_at;
    const retrieved = timestamp(retrievedValue, `events[${eventIndex}].retrieved_at`, true);
    const anchor = input.anchor === 'event_at' ? at : available;
    const availability = { published_at: published === null ? null : iso(published), first_available_at: available === null ? null : iso(available), retrieved_at: retrieved === null ? null : iso(retrieved), first_available_at_status: available === null ? 'unknown' : 'declared_not_verified', point_in_time_status: 'not_established', eligible_for_point_in_time_validation: false, retrieved_after_event: retrieved === null ? null : retrieved > at };
    for (const window of input.windows) {
      const expectedExit = anchor === null ? null : anchor + window.seconds * 1000;
      const missing = [], flags = [];
      if (anchor === null) missing.push('anchor_availability_unknown');
      if (anchor !== null && anchor > asOf) missing.push('anchor_after_as_of');
      if (expectedExit !== null && expectedExit > asOf) missing.push('window_not_elapsed');
      if (available === null) flags.push('event_first_available_unknown');
      else flags.push('event_first_available_unverified');
      if (retrieved !== null && retrieved > at) flags.push('retrieved_after_event');
      if (retrieved !== null && retrieved > asOf) flags.push('retrieved_after_as_of');
      if (available !== null && available > asOf) flags.push('event_available_after_as_of');
      if (published !== null && available !== null && available < published) flags.push('availability_precedes_publication');
      let start = null, end = null, outcome = null, baselineStart = null, baselineEnd = null, baselineReturn = null;
      if (!missing.length) {
        const prices = groups.get(instrument) ?? [];
        start = endpoint(prices, anchor, input.entry, tolerance);
        end = endpoint(prices, expectedExit, 'first_at_or_after', tolerance);
        const result = measured(start, end, 'target'); outcome = result.value; missing.push(...result.missing);
        for (const [label, item] of [['entry', start], ['exit', end]]) {
          if (item && item.available === null) flags.push(`${label}_availability_unknown`);
          if (item && item.available !== null && item.available > item.time) flags.push(`${label}_availability_lagged`);
        }
        if (start?.available !== null && start?.available > anchor) flags.push('entry_price_not_available_at_anchor');
        if (input.baseline.kind === 'instrument' && start && end) {
          const base = groups.get(input.baseline.instrument) ?? [];
          baselineStart = endpoint(base, start.time, 'first_at_or_after', 0);
          baselineEnd = endpoint(base, end.time, 'first_at_or_after', 0);
          const result = measured(baselineStart, baselineEnd, 'baseline'); baselineReturn = result.value; missing.push(...result.missing);
        }
      }
      const status = missing.length ? missing.includes('window_not_elapsed') ? 'pending' : outcome === null ? 'missing' : 'partial' : 'complete';
      rows.push({ event_id: id, event_row_index: eventIndex, instrument, event_at: iso(at), source_url: typeof raw[fields.events.source_url] === 'string' ? raw[fields.events.source_url].slice(0, 4096) : null,
        availability, window: { id: window.id, seconds: window.seconds, anchor: input.anchor, anchor_at: anchor === null ? null : iso(anchor), requested_exit_at: expectedExit === null ? null : iso(expectedExit), entry_rule: input.entry, exit_rule: 'first_at_or_after', tolerance_seconds: input.tolerance_seconds },
        entry: point(start), exit: point(end), return_fraction: outcome, return_unit: 'fraction', baseline: { kind: input.baseline.kind, instrument: input.baseline.instrument ?? null, alignment: 'exact_target_endpoint_times', entry: point(baselineStart), exit: point(baselineEnd), return_fraction: baselineReturn, excess_return_fraction: outcome !== null && baselineReturn !== null ? outcome - baselineReturn : null, status: input.baseline.kind === 'none' ? 'not_requested' : baselineReturn === null ? 'missing' : 'complete' },
        status, missing, flags, overlap_event_ids: [], source_refs: uniqueRefs([input.events_ref, input.market_ref]) });
    }
  }
  // Report intersecting same-instrument windows, never count them as independent votes.
  for (let i = 0; i < rows.length; i++) {
    const left = rows[i]; if (!left.entry || !left.exit) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const right = rows[j];
      if (left.event_id === right.event_id || left.instrument !== right.instrument || !right.entry || !right.exit) continue;
      if (Date.parse(left.entry.observed_at) <= Date.parse(right.exit.observed_at) && Date.parse(right.entry.observed_at) <= Date.parse(left.exit.observed_at)) {
        if (!left.overlap_event_ids.includes(right.event_id)) left.overlap_event_ids.push(right.event_id);
        if (!right.overlap_event_ids.includes(left.event_id)) right.overlap_event_ids.push(left.event_id);
      }
    }
    left.overlap_event_ids.sort();
    if (left.overlap_event_ids.length) left.flags.push('overlapping_event_windows');
  }
  const counts = { events: events.length, outcomes: rows.length, complete: rows.filter(row => row.status === 'complete').length, partial: rows.filter(row => row.status === 'partial').length, missing: rows.filter(row => row.status === 'missing').length, pending: rows.filter(row => row.status === 'pending').length, overlapping: rows.filter(row => row.overlap_event_ids.length).length };
  return { type: 'sesame.investment-research.event-outcomes', schemaVersion: '1.0.0', method: EVENT_OUTCOMES_METHOD, parameters: structuredClone(input), source_provenance: source, counts, excluded_market_rows: excluded, point_in_time_status: 'not_established', interpretation: 'Retrospective gross endpoint returns, not a causal effect, validated historical knowledge set, independent sample count, trading backtest or prediction probability. No costs, reinvestment, FX conversion or session interpolation are added. Event selection and price basis are supplied by the caller; they are recorded, not certified as preregistered. Multiple windows and overlapping events are dependent.', rows };
}

export async function eventOutcomes(host, input, signal) {
  parameters(input);
  const eventsArtifact = await checkedArtifact(host, input.events_ref), marketArtifact = await checkedArtifact(host, input.market_ref);
  valid(eventsArtifact.manifest.content?.rowCount <= MAX_EVENTS && marketArtifact.manifest.content?.rowCount <= MAX_MARKET_ROWS, 'Narrow the frozen inputs to the event and price row budgets before calling.');
  const events = await readRows(host, input.events_ref, { signal, manifest: eventsArtifact.manifest, maxBytes: MAX_BYTES });
  const market = await readRows(host, input.market_ref, { signal, manifest: marketArtifact.manifest, maxBytes: MAX_BYTES });
  const provenance = { events: eventsArtifact.manifest.content.provenance ?? {}, market: marketArtifact.manifest.content.provenance ?? {} };
  const packet = alignEventOutcomes(input, events, market, provenance, signal);
  const bytes = JSON.stringify([packet]);
  valid(Buffer.byteLength(bytes) <= 16 * 1024 * 1024, 'Outcome details exceed the 16 MiB output budget; select fewer events or windows.');
  const dependencies = uniqueRefs([input.events_ref, input.market_ref]);
  const kind = Object.values(provenance).some(value => ['demo', 'synthetic'].includes(value.kind) || value.source_kind === 'synthetic') ? 'demo' : 'derived';
  const outputProvenance = { kind, transform: EVENT_OUTCOMES_METHOD, parameters_digest: digest(input), data_hash: digest(bytes), references: dependencies, point_in_time_status: 'not_established' };
  const root = await host.resources.create({ kind: 'directory', lifetime: 'durable', name: `event-outcomes-${randomUUID()}` }, { signal });
  try {
    await host.resources.create({ kind: 'file', lifetime: 'durable', parent: root, name: 'rows.json', source: { content: bytes } }, { signal });
    const { ref } = await host.resources.publish(root, { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: 1, columns: Object.keys(packet), provenance: outputProvenance }, dependencies, provenance: outputProvenance, blobs: [{ entry: 'rows.json', path: 'rows.json', mediaType: 'application/json' }] }, { signal });
    return { result_ref: ref, method: EVENT_OUTCOMES_METHOD, counts: packet.counts, point_in_time_status: 'not_established', status: packet.counts.events === 0 ? 'no_events' : packet.counts.complete === packet.counts.outcomes ? 'complete' : 'partial' };
  } finally { await host.resources.remove(root, { expectedVersion: root.version, mode: 'permanent' }); }
}
