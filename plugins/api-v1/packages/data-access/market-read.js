import { canonical, check, clone, decimal, digest, sourceTime, text } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';
import { publicSource, snapshotOperation } from './capture.js';

const PAGE_SIZE = 500, MAX_PAGES = 200, MAX_BYTES = 16 * 1024 * 1024;
const COLUMNS = ['id', 'revision', 'datetime', 'end_time', 'open', 'high', 'low', 'close', 'volume', 'volume_unit', 'volume_kind', 'volume_status', 'is_closed', 'closure'];
const comparable = (a, b) => a.basis === b.basis && (a.basis === 'utc' || a.authority === b.authority && a.zone === b.zone);
const timeValue = value => value.basis === 'utc' ? value.unixMs : value.value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const compareTime = (a, b) => timeValue(a) < timeValue(b) ? -1 : timeValue(a) > timeValue(b) ? 1 : 0;
const bounded = value => { const bytes = JSON.stringify(value); check(Buffer.byteLength(bytes) <= MAX_BYTES, 'Market snapshot exceeds 16 MiB; request a smaller range', 'RESOURCE_EXHAUSTED'); return bytes; };
const orderedTime = (value, path) => {
  sourceTime(value, path);
  check(value.basis !== 'wall' || value.fold === undefined, 'market_read does not resolve wall-time DST folds. Select provider-supported UTC source times or an unambiguous range; do not remove fold or guess an offset.', 'UNSUPPORTED_CAPABILITY');
};

function projectBar(bar, volumeKind, range, includeForming) {
  text(bar.id, 'bar.id'); check(typeof bar.revision === 'string' && /^(0|[1-9][0-9]*)$/.test(bar.revision), 'Bar revision must be an unsigned integer string', 'INVALID_PROVIDER_DATA');
  orderedTime(bar.openTime, 'bar.openTime'); orderedTime(bar.endTime, 'bar.endTime');
  check(comparable(bar.openTime, bar.endTime) && compareTime(bar.openTime, bar.endTime) < 0, 'Bar time bounds are invalid', 'INVALID_PROVIDER_DATA');
  check(typeof bar.isClosed === 'boolean' && (includeForming || bar.isClosed), 'Provider returned an invalid or excluded forming bar', 'INVALID_PROVIDER_DATA');
  check(bar.closure === undefined || ['source', 'calendar', 'unknown'].includes(bar.closure), 'Provider returned an invalid closure basis', 'INVALID_PROVIDER_DATA');
  check(range.from.basis !== 'wall' || comparable(bar.openTime, range.from), 'Provider returned a different time basis, wall-clock authority or zone from the requested wall range', 'INVALID_PROVIDER_DATA');
  if (comparable(bar.openTime, range.from)) check(compareTime(bar.openTime, range.from) >= 0 && compareTime(bar.openTime, range.to) < 0, 'Provider returned a bar outside the requested range', 'INVALID_PROVIDER_DATA');
  for (const key of ['open', 'high', 'low', 'close']) decimal(bar[key], `bar.${key}`);
  check(['open', 'close'].every(key => Decimal.compare(bar.low, bar[key]) <= 0 && Decimal.compare(bar[key], bar.high) <= 0), 'Provider returned invalid OHLC bounds', 'INVALID_PROVIDER_DATA');
  let volume = null, unit = null, status = 'not_requested';
  if (volumeKind !== 'none') {
    const value = bar.volume?.[volumeKind];
    check(value && ['value', 'unknown', 'unsupported', 'not_applicable'].includes(value.status), 'Provider omitted the selected volume status', 'INVALID_PROVIDER_DATA');
    status = value.status;
    if (status === 'value') {
      volume = decimal(volumeKind === 'real' ? value.value?.value : value.value, 'bar.volume');
      check(Decimal.compare(volume, '0') >= 0, 'Volume cannot be negative', 'INVALID_PROVIDER_DATA');
      if (volumeKind === 'real') { unit = value.value?.unit; text(unit, 'bar.volume.unit'); }
      else { check(/^(0|[1-9][0-9]*)$/.test(volume), 'Tick volume must be an integer count', 'INVALID_PROVIDER_DATA'); unit = 'tick'; }
    } else check(!Object.hasOwn(value, 'value'), 'Unknown volume cannot carry a numeric value', 'INVALID_PROVIDER_DATA');
  }
  return { id: bar.id, revision: bar.revision, datetime: clone(bar.openTime), end_time: clone(bar.endTime), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume, volume_unit: unit, volume_kind: volumeKind, volume_status: status, is_closed: bar.isClosed, closure: bar.closure ?? 'unknown' };
}


async function capture(host, args, signal) {
  const query = { instrument: args.instrument, spec: args.spec, range: args.range, includeForming: args.include_forming, direction: 'forward' };
  const controller = new AbortController(), combined = AbortSignal.any([controller.signal, signal].filter(Boolean));
  const pages = [], rows = [], seen = new Map();
  let cursor, snapshotId, seriesId, consistency, origin, connection, previous, receivedRows = 0, byteCount = 0;
  const limit = Math.min(PAGE_SIZE, args.max_rows);
  try {
    do {
      combined.throwIfAborted();
      check(pages.length < MAX_PAGES, 'Market pagination exceeds 200 pages; request a smaller range', 'RESOURCE_EXHAUSTED');
      const response = await host.data.query({ source: args.source, operation: 'queryBars', input: query, limit, ...(cursor ? { cursor } : {}) }, { signal: combined });
      const metadata = response.metadata;
      check(metadata && Array.isArray(response.items) && response.items.length <= limit, 'Source returned an invalid Bar page', 'INVALID_PROVIDER_DATA');
      const { meta, ...data } = metadata;
      const page = { items: response.items, snapshotId: data.snapshotId, consistency: data.consistency, nextCursor: response.nextCursor ?? null };
      text(data.seriesId, 'seriesId'); text(page.snapshotId, 'snapshotId');
      check(['snapshot', 'best_effort'].includes(page.consistency), 'Source omitted pagination consistency', 'INVALID_PROVIDER_DATA');
      check(['observed', 'derived', 'user_input', 'demo'].includes(meta?.origin), 'Source omitted provenance', 'INVALID_PROVIDER_DATA');
      if (data.instrument) check(canonical(data.instrument) === canonical(args.instrument), 'Source returned another instrument', 'INSTRUMENT_MISMATCH');
      if (data.spec) check(canonical(data.spec) === canonical(args.spec), 'Source returned another series specification', 'INVALID_PROVIDER_DATA');
      if (data.coverage?.requested) check(canonical(data.coverage.requested) === canonical(args.range), 'Source coverage describes another request', 'INVALID_PROVIDER_DATA');
      if (pages.length) check(page.snapshotId === snapshotId && data.seriesId === seriesId && page.consistency === consistency && meta.origin === origin && canonical(data.connection ?? null) === canonical(connection), 'Market snapshot changed between pages; restart with a new operation', 'SNAPSHOT_REQUIRED');
      else { snapshotId = page.snapshotId; seriesId = data.seriesId; consistency = page.consistency; origin = meta.origin; connection = data.connection ?? null; }
      receivedRows += response.items.length;
      check(receivedRows <= args.max_rows, 'Market rows exceed max_rows; request a smaller range', 'RESOURCE_EXHAUSTED');
      for (const bar of response.items) {
        const row = projectBar(bar, args.volume_kind, args.range, args.include_forming), hash = digest(bar);
        if (seen.has(bar.id)) { check(seen.get(bar.id) === hash, 'A bar changed within the snapshot', 'SNAPSHOT_REQUIRED'); continue; }
        if (previous) check(comparable(previous.openTime, bar.openTime) && (compareTime(previous.openTime, bar.openTime) < 0 || compareTime(previous.openTime, bar.openTime) === 0 && previous.id < bar.id), 'Source pages are not in forward source-time/ID order', 'INVALID_PROVIDER_DATA');
        seen.set(bar.id, hash); previous = bar; rows.push(row);
      }
      byteCount += Buffer.byteLength(JSON.stringify(response));
      check(byteCount <= MAX_BYTES, 'Market response exceeds 16 MiB', 'RESOURCE_EXHAUSTED');
      // Host cursors are temporary leases, not evidence. Keep the native public metadata and actual rows.
      pages.push({ data: { ...data, page: { items: clone(response.items), snapshotId, consistency } }, meta: clone(meta) });
      cursor = response.nextCursor;
      check(!cursor || receivedRows < args.max_rows, 'More rows exist beyond max_rows; no truncated result was published', 'RESOURCE_EXHAUSTED');
    } while (cursor);
    const complete = consistency === 'snapshot' && pages.every(page => page.data.coverage?.complete === true);
    const coverage = { requested: args.range, complete, paginationComplete: true, paginationConsistency: consistency, providerReportsComplete: pages.every(page => page.data.coverage?.complete === true), reason: complete ? null : 'Fixed returned rows do not prove gap-free market coverage; inspect retained coverage.' };
    const volume = { kind: args.volume_kind, units: [...new Set(rows.map(row => row.volume_unit).filter(value => value !== null))], missingRows: rows.filter(row => row.volume === null).length, conversion: 'none' };
    const allWarnings = [...new Map(pages.flatMap(page => page.meta.warnings ?? []).map(value => [canonical(value), value])).values()];
    const warnings = allWarnings.slice(0, 50), observed = pages.map(page => page.meta.observedAt);
    check(observed.every(Number.isFinite), 'Source omitted observation timestamps', 'INVALID_PROVIDER_DATA');
    const summary = { title: args.title, query, source: publicSource(args.source), connection, seriesId, snapshotId, coverage, volume, pageCount: pages.length, rowCount: rows.length, duplicateRows: receivedRows - rows.length, origin, observedAt: { from: Math.min(...observed), to: Math.max(...observed) }, warnings, transform: { name: 'market-bars-ohlcv/1', description: 'Preserve exact OHLC strings and SourceTime, select explicit volume without unit conversion, remove byte-identical repeated Bar IDs.' } };
    check(Buffer.byteLength(JSON.stringify(summary)) <= 128 * 1024, 'Market metadata exceeds the publication budget', 'RESOURCE_EXHAUSTED');
    bounded(rows); bounded({ ...summary, pages });
    return { rows, summary, evidence: { ...summary, pages }, dependencies: args.spec.calendarRevision.status === 'value' ? [args.spec.calendarRevision.value] : [] };
  } finally { controller.abort(); }
}

export function marketReadCapabilities(host) {
  return [{ name: 'market_read', execute: async (input, signal) => {
    const args = { ...input, max_rows: input.max_rows ?? 10000 };
    check(Number.isInteger(args.max_rows) && args.max_rows > 0 && args.max_rows <= 100000, 'max_rows must be 1..100000');
    check(['real', 'tick', 'none'].includes(args.volume_kind) && typeof args.include_forming === 'boolean', 'Explicit volume_kind and include_forming are required');
    orderedTime(args.range.from, 'range start'); orderedTime(args.range.to, 'range end');
    check(comparable(args.range.from, args.range.to) && compareTime(args.range.from, args.range.to) < 0, 'Range requires ascending bounds in one explicit source time basis');
    const result = await snapshotOperation(host, args.operation_id, args, () => capture(host, args, signal), signal);
    return { ...result, coverage: result.provenance.coverage, volume: result.provenance.volume, status: result.provenance.coverage.complete ? 'complete' : 'partial' };
  } }];
}
