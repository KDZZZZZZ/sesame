import { createHash, randomUUID } from 'node:crypto';
import { records } from './records.js';
import { publishRows } from './resource-files.js';
import { KINDS } from './schema.js';
import { SOURCE_KINDS, dateOnly, selectProvider, timestamp } from './sources.js';

const fail = (condition, message, code = 'INVALID_ARGUMENT') => { if (!condition) throw Object.assign(new Error(message), { code }); };
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const identityKeys = ['kind', 'provider', 'symbol', 'cik', 'statement', 'period', 'series_id', 'market_code', 'metric', 'subreddit'];
const identity = query => JSON.stringify(identityKeys.map(key => key === 'period' && query.provider === 'fmp' && query.kind === 'fundamentals' ? query.period ?? 'annual' : query[key] ?? null));

function compact(value) {
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}… [presentation shortened; full value is in the dataset]` : value;
  if (Array.isArray(value)) return value.slice(0, 40).map(compact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, compact(item)]));
  return value;
}

function page(rows, offset = 0, limit = 20) {
  const result = [];
  let bytes = 0, presentationTruncated = false;
  for (const row of rows.slice(offset, offset + limit)) {
    const text = JSON.stringify(row);
    let displayed = text.length > 24000 ? compact(row) : row;
    if (Buffer.byteLength(JSON.stringify(displayed)) > 60000) displayed = { presentation_truncated: true, record_sha256: hash(text), preview_json: Buffer.from(text).subarray(0, 8000).toString('utf8'), note: 'Full record is retained in the registered dataset.' };
    const size = Buffer.byteLength(JSON.stringify(displayed));
    if (result.length && bytes + size > 64000) break;
    result.push(displayed); bytes += size;
    presentationTruncated ||= displayed !== row;
  }
  return { rows: result, total: rows.length, offset, next_offset: offset + result.length < rows.length ? offset + result.length : null, presentation_truncated: presentationTruncated };
}

function selected(rows, args) {
  return rows.filter(row => {
    const observed = typeof row.observed_at === 'string' ? row.observed_at.slice(0, 10) : null;
    if (args.start && (!observed || observed < args.start)) return false;
    if (args.end && (!observed || observed > args.end)) return false;
    if (args.as_of && (!row.content_available_at || Date.parse(row.content_available_at) > Date.parse(args.as_of))) return false;
    return true;
  }).sort((a, b) => String(b.observed_at ?? '').localeCompare(String(a.observed_at ?? '')) || String(b.available_at ?? '').localeCompare(String(a.available_at ?? ''))).slice(0, args.limit);
}

function validate(input, now) {
  const args = { ...input, limit: input.limit ?? 20 };
  fail(KINDS.includes(args.kind), 'Unsupported research kind.');
  args.provider = selectProvider(args);
  fail(SOURCE_KINDS[args.provider]?.includes(args.kind), 'The provider does not support this research kind.');
  if (args.market_code !== undefined) fail(args.provider === 'cftc' && typeof args.market_code === 'string' && /^[A-Za-z0-9]{6}$/.test(args.market_code), 'market_code is a six-character CFTC contract market code and applies only to cot.');
  if (args.period !== undefined) fail(args.provider === 'fmp' && args.kind === 'fundamentals' && ['annual', 'quarter'].includes(args.period), 'period is annual or quarter and applies only to FMP fundamentals.');
  fail(Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 100, 'limit must be 1..100.');
  for (const key of ['start', 'end']) if (args[key] !== undefined) fail(dateOnly(args[key]), `${key} must be a real YYYY-MM-DD date.`);
  fail(!args.start || !args.end || args.start <= args.end, 'start must not follow end.');
  if (args.as_of !== undefined) {
    fail(timestamp(args.as_of), 'as_of requires a valid timestamp with an explicit timezone.');
    args.as_of = timestamp(args.as_of);
    fail(Date.parse(args.as_of) <= now, 'as_of cannot be in the future.');
  }
  if (args.symbol !== undefined) {
    fail(typeof args.symbol === 'string' && /^[A-Za-z0-9^][A-Za-z0-9.^:_/-]{0,39}$/.test(args.symbol), 'Invalid single symbol.');
    args.symbol = args.symbol.toUpperCase();
  }
  if (args.cik !== undefined) fail(typeof args.cik === 'string' && /^\d{1,10}$/.test(args.cik), 'Invalid SEC CIK.');
  if (args.provider === 'sec') {
    fail(args.cik || args.symbol, 'SEC queries require cik or symbol.');
    fail(!args.statement || args.statement === 'companyfacts', 'SEC fundamentals use statement=companyfacts; choose FMP for normalized statements.');
    if (args.metric) fail(/^[A-Za-z][A-Za-z0-9:_-]{0,149}$/.test(args.metric), 'Invalid SEC concept.');
  } else if (args.provider === 'fred') {
    fail(typeof args.series_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(args.series_id), 'macro requires series_id.');
  } else if (args.provider === 'cftc') {
    fail(args.market_code, 'cot requires market_code, e.g. 088691 for COMEX gold.');
    args.market_code = args.market_code.toUpperCase();
  } else fail(args.symbol, 'This source requires symbol.');
  if (args.provider === 'fmp' && args.kind === 'fundamentals') {
    args.statement ??= 'income';
    args.period ??= 'annual';
    fail(['income', 'balance', 'cashflow'].includes(args.statement), 'FMP fundamentals require income, balance or cashflow.');
  }
  if (args.provider === 'reddit') {
    args.subreddit ??= 'stocks';
    fail(['stocks', 'investing', 'wallstreetbets'].includes(args.subreddit), 'Unsupported research subreddit.');
  }
  return args;
}

// All evidence and access observations use the existing records repository.
// Historical reuse is resolved before transport asks for current credentials.
export function createEvidence(host, { now = Date.now, transport }) {
  const evidenceRef = id => ({ datasetId: id, source: { providerId: `${host.context.pluginId}#evidence`, revision: host.context.pluginRevision }, query: { dataset_id: id } });
  const snapshots = () => records(host).list('research_snapshots').sort((a, b) => b.retrieved_at.localeCompare(a.retrieved_at));
  const unavailable = (args, code, sources = []) => ({ status: 'source_unavailable', provider: args.provider, kind: args.kind, reason: code, rows: [], dataset_id: null, raw_dataset_id: null, sources, retrieved_at: new Date(now()).toISOString(), warnings: ['No research conclusion can be drawn from this unavailable source.'] });
  const recordAccess = (args, result) => {
    // One latest observation per endpoint/statement period, with its exact query
    // scope. It is historical evidence, not a provider-wide health assertion.
    const query = Object.fromEntries([...identityKeys, 'start', 'end', 'as_of', 'limit'].filter(key => args[key] !== undefined).map(key => [key, args[key]]));
    records(host).put('research_access', { id: [args.provider, args.kind, args.statement ?? '', args.period ?? ''].join(':'), query, checked_at: new Date(now()).toISOString(), status: result.status, reason: result.reason ?? null, row_count: result.total ?? null, ...(result.series ? { series: result.series } : {}) });
    return result;
  };

  const saveDataset = async data => {
    const dependencies = (data.input_ids ?? []).map(id => records(host).get('datasets', id).ref);
    const ref = await publishRows(host, data, dependencies);
    return records(host).put('datasets', { ...data, ref, producer_plugin_id: host.context.pluginId });
  };
  return {
    status(configuration) {
      return {
        ...configuration,
        sources: configuration.sources.map(source => ({ ...source, last_checks: records(host).list('research_access').filter(row => row.query.provider === source.provider).sort((a, b) => b.checked_at.localeCompare(a.checked_at)).map(({ id, ...row }) => row) })),
        recent_snapshots: snapshots().slice(0, 20).map(row => ({ dataset_id: row.id, raw_dataset_id: row.raw_dataset_id, query: row.query, retrieved_at: row.retrieved_at, row_count: row.row_count })),
      };
    },
    read({ dataset_id: id, offset = 0, limit = 20 }) {
      fail(typeof id === 'string' && /^financial-research-[a-f0-9-]+(?:-raw)?$/.test(id), 'Invalid research dataset ID.');
      fail(Number.isInteger(offset) && offset >= 0 && offset <= 10000 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'Invalid evidence page.');
      const base = id.endsWith('-raw') ? id.slice(0, -4) : id;
      const record = records(host).get('research_snapshots', base, true);
      fail(record && (record.id === id || record.raw_dataset_id === id), 'Research evidence not found.', 'NOT_FOUND');
      const dataset = records(host).get('datasets',id);
      return { status: 'saved_evidence', dataset_id: id, ref: dataset.ref, evidence: evidenceRef(id), provenance: dataset.provenance, ...(dataset.provenance.series ? { series: dataset.provenance.series } : {}), ...page(dataset.rows, offset, limit), warnings: record.warnings };
    },
    queryEvidence({ dataset_id: id }, { cursor, limit }) {
      fail(typeof id === 'string' && /^financial-research-[a-f0-9-]+(?:-raw)?$/.test(id), 'Invalid research dataset ID.');
      fail(cursor === undefined || /^(0|[1-9]\d*)$/.test(cursor), 'Invalid evidence cursor.');
      const offset = cursor === undefined ? 0 : Number(cursor);
      fail(Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 1000, 'Invalid evidence page.');
      const dataset = records(host).get('datasets', id), { rows, ...metadata } = dataset;
      fail(offset <= rows.length, 'Evidence cursor exceeds the saved dataset.');
      const end = Math.min(rows.length, offset + limit);
      return { items: rows.slice(offset, end), ...(end < rows.length ? { nextCursor: String(end) } : {}),
        metadata: { ...metadata, producer_plugin_id: host.context.pluginId, inputs: (dataset.input_ids ?? []).map(datasetId => ({ datasetId, query: { dataset_id: datasetId } })) } };
    },
    async query(input, signal) {
      signal?.throwIfAborted();
      const args = validate(input, now());
      if (args.as_of && ['fmp', 'reddit', 'cftc'].includes(args.provider)) {
        const record = snapshots().find(row => identity(row.query) === identity(args) && Date.parse(row.retrieved_at) <= Date.parse(args.as_of));
        if (!record) return unavailable(args, 'HISTORICAL_SNAPSHOT_UNAVAILABLE');
        const dataset = records(host).get('datasets',record.id), rows = selected(dataset.rows, args);
        return { status: rows.length ? 'saved_evidence' : 'partial', provider: args.provider, kind: args.kind, dataset_id: record.id, raw_dataset_id: record.raw_dataset_id, evidence: evidenceRef(record.id), raw_evidence: evidenceRef(record.raw_dataset_id), ref: dataset.ref, raw_ref: records(host).get('datasets', record.raw_dataset_id).ref, ...page(rows, 0, args.limit), retrieved_at: record.retrieved_at, as_of: args.as_of, sources: record.sources, coverage: { ...record.coverage, saved_query: record.query, returned: rows.length }, warnings: [...record.warnings, 'Reused the latest saved matching snapshot acquired before the cutoff; its original bounded coverage still applies.'] };
      }

      const { result, sources, redact: redactResult, reason } = await transport.query(args, signal);
      signal?.throwIfAborted();
      if (reason) return recordAccess(args, unavailable(args, reason, sources));

      const rows = redactResult(selected(result.candidates, args));
      const metadata = result.series ? { series: redactResult(result.series) } : {};
      const retrievedAt = new Date(now()).toISOString(), id = `financial-research-${randomUUID()}`, rawId = `${id}-raw`;
      const warnings = [...result.warnings];
      const excludedByCutoff = args.as_of ? result.candidates.filter(row => !row.content_available_at || Date.parse(row.content_available_at) > Date.parse(args.as_of)).length : 0;
      if (excludedByCutoff) warnings.push(`${excludedByCutoff} source records were excluded because this content was not shown to be available by as_of.`);
      if (rows.some(row => row.available_at === null)) warnings.push('Some source publication times are unknown. Their content is known only from this retrieval onward.');
      const coverage = { requested_limit: args.limit, returned: rows.length, source_candidates: result.candidates.length, excluded_by_cutoff: excludedByCutoff, limited: result.limited || rows.length < result.candidates.length, as_of: args.as_of ?? null };
      const provenance = { kind: 'observed', source_kind: 'external', as_of: retrievedAt, provider: args.provider, sources, query: args, retrieved_at: retrievedAt, coverage, ...metadata, untrusted_source_text: true, precision: 'Source numbers and decimal strings are retained as received; JSON numbers retain JSON numeric precision.' };
      await saveDataset({ id: rawId, title: `${args.kind} raw source evidence`, rows: rows.map((row, index) => ({ index, source_url: row.source_url, retrieved_at: row.retrieved_at, available_at: row.available_at, content_available_at: row.content_available_at, availability: row.availability, raw: row.data })), provenance: { ...provenance, retention: 'Selected eligible source records; secrets redacted. Full response hashes identify the fetched payloads; excluded future records are not retained in this dataset.' } });
      await saveDataset({ id, title: `${args.kind} ${args.symbol ?? args.cik ?? args.series_id ?? args.market_code}`, rows, input_ids: [rawId], provenance });
      records(host).put('research_snapshots', { id, raw_dataset_id: rawId, query: args, retrieved_at: retrievedAt, row_count: rows.length, sources, coverage, warnings });
      return recordAccess(args, { status: !rows.length || coverage.limited ? 'partial' : 'ok', provider: args.provider, kind: args.kind, dataset_id: id, raw_dataset_id: rawId, evidence: evidenceRef(id), raw_evidence: evidenceRef(rawId), ref: records(host).get('datasets',id).ref, raw_ref: records(host).get('datasets',rawId).ref, ...page(rows, 0, args.limit), retrieved_at: retrievedAt, sources, coverage, ...metadata, warnings });
    },
  };
}
