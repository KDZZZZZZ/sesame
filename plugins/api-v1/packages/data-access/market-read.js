import { canonical, check, clone, decimal, digest, sourceTime, text } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';

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
  const descriptor = host.providers.list('sesame.market').find(item => item.pluginId === args.provider.pluginId && item.id === args.provider.providerId);
  check(descriptor, 'Load the selected provider first; use data_providers', 'NOT_FOUND');
  check(descriptor.capabilities.includes('bars.history'), 'Provider does not support bars.history', 'UNSUPPORTED_CAPABILITY');
  const bound = await host.providers.bind(args.provider, { ...(args.connection ? { connection: args.connection } : {}), ...(args.configuration ? { configuration: args.configuration } : {}) }, signal);
  try {
    check(!descriptor.instanceId || descriptor.instanceId === bound.instanceId, 'Provider changed after discovery', 'CONNECTION_CHANGED');
    // No bind configuration, descriptor defaults or credentials are copied into
    // evidence. Persist only the resolved public identity and query contract.
    const query = { instrument: args.instrument, spec: args.spec, range: args.range, includeForming: args.include_forming, direction: 'forward' };
    const identity = { provider: args.provider, connection: bound.connection ?? null, instanceId: bound.instanceId ?? null, plugin: descriptor.plugin ?? null };
    const pages = [], rows = [], seen = new Map(), cursors = new Set(); let cursor, snapshotId, seriesId, consistency, origin, receivedRows = 0, byteCount = 0, previous;
    const limit = Math.min(PAGE_SIZE, args.max_rows);
    do {
      signal?.throwIfAborted();
      check(pages.length < MAX_PAGES, 'Market pagination exceeds 200 pages; request a smaller range', 'RESOURCE_EXHAUSTED');
      const result = await host.providers.call(bound.bindingId, 'queryBars', { ...query, page: { limit, ...(cursor ? { cursor } : {}) } }, { signal });
      const data = result.data, page = data?.page;
      check(page && Array.isArray(page.items) && page.items.length <= limit, 'Provider returned an invalid or oversized Bar page', 'INVALID_PROVIDER_DATA');
      text(data.seriesId, 'seriesId'); text(page.snapshotId, 'snapshotId');
      check(['snapshot', 'best_effort'].includes(page.consistency), 'Provider omitted pagination consistency', 'INVALID_PROVIDER_DATA');
      check(page.nextCursor === null || typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 20000, 'Provider returned an invalid cursor', 'INVALID_PROVIDER_DATA');
      check(['observed', 'derived', 'user_input', 'demo'].includes(result.meta?.origin), 'Provider omitted source provenance', 'INVALID_PROVIDER_DATA');
      if (data.instrument) check(canonical(data.instrument) === canonical(args.instrument), 'Provider returned another instrument', 'INSTRUMENT_MISMATCH');
      if (data.spec) check(canonical(data.spec) === canonical(args.spec), 'Provider returned another series specification', 'INVALID_PROVIDER_DATA');
      if (data.coverage?.requested) check(canonical(data.coverage.requested) === canonical(args.range), 'Provider coverage describes another request', 'INVALID_PROVIDER_DATA');
      if (pages.length) check(page.snapshotId === snapshotId && data.seriesId === seriesId && page.consistency === consistency && result.meta.origin === origin, 'Market snapshot changed between pages; restart with a new operation', 'SNAPSHOT_REQUIRED');
      else { snapshotId = page.snapshotId; seriesId = data.seriesId; consistency = page.consistency; origin = result.meta.origin; }
      receivedRows += page.items.length;
      check(receivedRows <= args.max_rows, 'Market rows exceed max_rows; request a smaller range or an explicit larger budget', 'RESOURCE_EXHAUSTED');
      for (const bar of page.items) {
        const row = projectBar(bar, args.volume_kind, args.range, args.include_forming), hash = digest(bar);
        if (seen.has(bar.id)) { check(seen.get(bar.id) === hash, 'A bar changed within the historical snapshot', 'SNAPSHOT_REQUIRED'); continue; }
        if (previous) check(comparable(previous.openTime, bar.openTime) && (compareTime(previous.openTime, bar.openTime) < 0 || compareTime(previous.openTime, bar.openTime) === 0 && previous.id < bar.id), 'Provider pages are not in forward source-time/ID order', 'INVALID_PROVIDER_DATA');
        seen.set(bar.id, hash); previous = bar; rows.push(row);
      }
      // These are public queryBars responses, never the binding input.
      byteCount += Buffer.byteLength(JSON.stringify(result));
      check(byteCount <= MAX_BYTES, 'Market response exceeds 16 MiB; request a smaller range', 'RESOURCE_EXHAUSTED');
      pages.push(clone(result)); cursor = page.nextCursor;
      if (cursor) {
        check(receivedRows < args.max_rows, 'Market rows exceed max_rows; request a smaller range or an explicit larger budget', 'RESOURCE_EXHAUSTED');
        check(!cursors.has(cursor), 'Provider repeated a pagination cursor', 'INVALID_PROVIDER_DATA'); cursors.add(cursor);
      }
    } while (cursor);
    const complete = consistency === 'snapshot' && pages.every(page => page.data.coverage?.complete === true);
    const coverage = { requested: args.range, complete, paginationComplete: true, paginationConsistency: consistency, providerReportsComplete: pages.every(page => page.data.coverage?.complete === true), reason: complete ? null : 'Fixed returned rows do not prove gap-free market coverage; inspect the retained provider coverage reports.' };
    const volume = { kind: args.volume_kind, units: [...new Set(rows.map(row => row.volume_unit).filter(value => value !== null))], missingRows: rows.filter(row => row.volume === null).length, conversion: 'none' };
    const allWarnings = [...new Map(pages.flatMap(page => page.meta.warnings ?? []).map(value => [canonical(value), value])).values()];
    const warnings = allWarnings.slice(0, 50);
    if (allWarnings.length > 50) warnings.push({ code: 'WARNING_PREVIEW_LIMIT', message: 'More provider warnings are retained in the raw responses artifact.' });
    const observed = pages.map(page => page.meta.observedAt);
    check(observed.every(Number.isFinite), 'Provider omitted observation timestamps', 'INVALID_PROVIDER_DATA');
    const summary = { query, ...identity, seriesId, snapshotId, coverage, volume, pageCount: pages.length, rowCount: rows.length, duplicateRows: receivedRows - rows.length, origin, observedAt: { from: Math.min(...observed), to: Math.max(...observed) }, warnings };
    check(Buffer.byteLength(JSON.stringify(summary)) <= 256 * 1024, 'Market metadata exceeds the publication budget', 'RESOURCE_EXHAUSTED');
    return { summary, raw: bounded({ ...summary, pages }), rows: bounded(rows) };
  } finally { await host.providers.unbind(bound.bindingId); }
}

function publish(host, key, args, captured) {
  const { summary, rawBlob, rowsBlob } = captured;
  const calendars = summary.query.spec.calendarRevision.status === 'value' ? [summary.query.spec.calendarRevision.value] : [];
  const rawProvenance = { kind: summary.origin, references: calendars, provider: summary.provider, connection: summary.connection, observedAt: summary.observedAt, coverage: summary.coverage, description: 'Public queryBars responses captured through the bound market provider; no binding configuration is stored.' };
  const raw = host.artifacts.publish({ operationId: `${key}:raw`, manifest: { kind: 'resource', schemaVersion: '1.0.0', content: { type: 'market-bars-snapshot', path: 'responses.json', ...summary, provenance: rawProvenance }, dependencies: calendars, blobs: [{ ...rawBlob, path: 'responses.json', mediaType: 'application/json' }], provenance: rawProvenance } });
  const provenance = { kind: summary.origin === 'demo' ? 'demo' : 'derived', references: [raw], sourceOrigin: summary.origin, provider: summary.provider, connection: summary.connection, observedAt: summary.observedAt, query: summary.query, coverage: summary.coverage, volume: summary.volume, transform: { name: 'market-bars-ohlcv/1', description: 'Project exact OHLC strings and original SourceTime, select explicitly requested volume without unit conversion, and remove byte-identical duplicate Bar IDs. Missing or unrequested volume remains null.', publisher: captured.publisher }, warnings: summary.warnings };
  const ref = host.artifacts.publish({ operationId: `${key}:data`, manifest: { kind: 'data', schemaVersion: '1.0.0', content: { format: 'json-rows', path: 'rows.json', rowCount: summary.rowCount, columns: COLUMNS, provenance }, dependencies: [raw], blobs: [{ ...rowsBlob, path: 'rows.json', mediaType: 'application/json' }], provenance } });
  const datasetId = `market_${key.slice(7)}`, rows = JSON.parse(host.artifacts.readBlob(rowsBlob).toString('utf8'));
  host.datasets.register({ id: datasetId, title: args.title, rows, provenance: { ...provenance, references: [raw, ref], dataRef: ref }, source: 'market_read', conversation_id: host.scope.conversationId ?? null });
  return { ref, dataset_id: datasetId, raw, row_count: rows.length, columns: COLUMNS, sample: rows.slice(0, 5), provider: summary.provider, connection: summary.connection, series_id: summary.seriesId, snapshot_id: summary.snapshotId, coverage: summary.coverage, volume: summary.volume, provenance, warnings: summary.warnings, status: summary.coverage.complete ? 'complete' : 'partial' };
}

export function marketReadTools(host) {
  const { define, Type, string } = host.tools, choice = values => Type.Union(values.map(Type.Literal));
  const sourceTimeSchema = Type.Union([
    Type.Object({ basis: Type.Literal('utc'), unixMs: Type.Integer(), raw: Type.Optional(Type.String()) }, { additionalProperties: false }),
    Type.Object({ basis: Type.Literal('wall'), authority: string('来源时钟身份，不能猜测UTC'), value: Type.String({ pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d+)?$' }), zone: Type.Optional(Type.String()), fold: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1)])) }, { additionalProperties: false }),
  ]);
  const ref = Type.Object({ id: Type.String(), revision: Type.String(), digest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), kind: Type.String(), schemaVersion: Type.Literal('1.0.0') }, { additionalProperties: false });
  return [define('market_read', '通过公开行情提供方查询并冻结历史K线，返回固定DataRef、dataset_id、有界样本与真实来源证据。保留SourceTime、Decimal和显式成交量单位；未知/不请求的量为null，不填0。同一operation_id重试返回成功快照，不重抓；过预算或中途失败不发布部分结果。coverage.complete=false仍是实际返回数据，不证明历史无缺口。当前不解析wall时间的DST fold；范围或K线带fold时明确报UNSUPPORTED_CAPABILITY，不删除fold或猜测时区。', {
    operation_id: Type.String({ minLength: 1, maxLength: 128, description: '本会话此精确查询的幂等ID；重新采集使用新ID' }), title: string('固定数据名称'),
    provider: Type.Object({ pluginId: string('data_providers返回的插件ID'), providerId: string('提供方ID') }, { additionalProperties: false }),
    connection: Type.Optional(Type.Object({ id: string('已发现连接ID'), revision: string('精确连接修订') }, { additionalProperties: false })),
    configuration: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: '仅提供方公开绑定选项；不会存入成果，不在此发送凭据。已有配置默认复用。' })),
    instrument: Type.Object({ sourceId: string('market_instruments返回的来源ID'), instrumentId: string('准确品种ID') }, { additionalProperties: false }),
    spec: Type.Object({ timeframe: string('提供方声明的周期，如1d/1h'), priceBasis: choice(['bid', 'ask', 'mid', 'last']), adjustment: choice(['none', 'forward', 'backward']), session: string('提供方声明的时段'), calendarRevision: Type.Union([Type.Object({ status: Type.Literal('value'), value: ref }, { additionalProperties: false }), Type.Object({ status: choice(['unknown', 'unsupported', 'not_applicable']), reason: Type.Optional(Type.String()) }, { additionalProperties: false })]) }, { additionalProperties: false }),
    range: Type.Object({ from: sourceTimeSchema, to: sourceTimeSchema }, { additionalProperties: false }),
    include_forming: Type.Boolean({ description: '是否明确包含形成中K线；回测通常选false' }),
    volume_kind: choice(['real', 'tick', 'none']),
    max_rows: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000, description: '总行数预算，默认10000；不会截断后冒充完整数据' })),
  }, async (input, signal) => {
    signal?.throwIfAborted();
    const args = { ...input, max_rows: input.max_rows ?? 10000 };
    check(Number.isInteger(args.max_rows) && args.max_rows > 0 && args.max_rows <= 100000, 'max_rows must be 1..100000');
    check(['real', 'tick', 'none'].includes(args.volume_kind) && typeof args.include_forming === 'boolean', 'Explicit volume_kind and include_forming are required');
    orderedTime(args.range.from, 'range start'); orderedTime(args.range.to, 'range end');
    check(comparable(args.range.from, args.range.to) && compareTime(args.range.from, args.range.to) < 0, 'Range requires ascending bounds in one explicit source time basis');
    const key = digest(['market_read', host.scope.conversationId ?? null, args.operation_id]), fingerprint = digest(args);
    return host.storage.idempotentAsync(key, fingerprint, async () => {
      let captured = host.storage.get('market_reads', key, true);
      if (captured) check(captured.fingerprint === fingerprint, 'operation_id already captured another query', 'IDEMPOTENCY_CONFLICT');
      else {
        const snapshot = await capture(host, args, signal); signal?.throwIfAborted();
        captured = { id: key, fingerprint, publisher: host.plugin ?? null, summary: snapshot.summary, rawBlob: host.artifacts.blob(snapshot.raw), rowsBlob: host.artifacts.blob(snapshot.rows) };
        // A completed read stays pinned even if a later publish/register fails.
        // A retry resumes these blobs instead of contacting the source again.
        host.storage.put('market_reads', captured);
      }
      signal?.throwIfAborted();
      return publish(host, key, args, captured);
    });
  })];
}
