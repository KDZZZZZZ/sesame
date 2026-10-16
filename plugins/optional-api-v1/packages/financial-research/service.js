import { records } from './records.js';
import { publishRows } from './resource-files.js';
import { createHash, randomUUID } from 'node:crypto';
import { CONFIG_FIELDS, KINDS } from './schema.js';
import { SOURCE_KINDS, dateOnly, querySource, selectProvider, timestamp } from './sources.js';

const DEFAULTS = Object.freeze({ fmp_key_env: 'FMP_API_KEY', fred_key_env: 'FRED_API_KEY', sec_user_agent_env: 'SEC_USER_AGENT', reddit_token_env: 'REDDIT_ACCESS_TOKEN', reddit_user_agent_env: 'REDDIT_USER_AGENT' });
const NEEDS = Object.freeze({ sec: ['sec_user_agent_env'], fmp: ['fmp_key_env'], fred: ['fred_key_env'], reddit: ['reddit_token_env', 'reddit_user_agent_env'] });
const HOSTS = new Set(['www.sec.gov', 'data.sec.gov', 'financialmodelingprep.com', 'api.stlouisfed.org', 'oauth.reddit.com']);
const SENSITIVE = /^(?:api[_-]?key|access[_-]?token|token|authorization|password|secret)$/i;
const fail = (condition, message, code = 'INVALID_ARGUMENT') => { if (!condition) throw Object.assign(new Error(message), { code }); };
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const identityKeys = ['kind', 'provider', 'symbol', 'cik', 'statement', 'series_id', 'metric', 'subreddit'];
const identity = query => JSON.stringify(identityKeys.map(key => query[key] ?? null));
let secQueue = Promise.resolve(), secNextAt = 0;

function publicURL(value) {
  try {
    const address = new URL(value);
    if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password) return null;
    // Snapshot matching keys before deletion; mutating a live URLSearchParams
    // iterator can skip consecutive credential parameters.
    const credentialKeys = Array.from(address.searchParams.keys()).filter(key => SENSITIVE.test(key));
    for (const key of credentialKeys) address.searchParams.delete(key);
    address.hash = '';
    return address.href;
  } catch { return null; }
}

function redact(value, secrets) {
  if (typeof value === 'string') {
    let text = value;
    for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
    if (/^https?:\/\//i.test(text)) text = publicURL(text) ?? '[invalid source URL]';
    return text;
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE.test(key) ? '[redacted]' : redact(item, secrets)]));
  return value;
}

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
  } else fail(args.symbol, 'This source requires symbol.');
  if (args.provider === 'fmp' && args.kind === 'fundamentals') {
    args.statement ??= 'income';
    fail(['income', 'balance', 'cashflow'].includes(args.statement), 'FMP fundamentals require income, balance or cashflow.');
  }
  if (args.provider === 'reddit') {
    args.subreddit ??= 'stocks';
    fail(['stocks', 'investing', 'wallstreetbets'].includes(args.subreddit), 'Unsupported research subreddit.');
  }
  return args;
}

async function secSlot(signal) {
  const task = secQueue.catch(() => {}).then(async () => {
    signal?.throwIfAborted();
    const delay = Math.max(0, secNextAt - Date.now());
    if (delay) await new Promise((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(done, delay);
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      signal?.addEventListener('abort', abort, { once: true });
    });
    signal?.throwIfAborted();
    secNextAt = Date.now() + 210;
  });
  secQueue = task;
  return task;
}

export function createService(host, { now = Date.now, fetch: fetcher = globalThis.fetch, env = process.env, timeoutMs = 15000 } = {}) {
  const evidenceRef = id => ({ datasetId: id, source: { providerId: `${host.context.pluginId}#evidence`, revision: host.context.pluginRevision }, query: { dataset_id: id } });
  const config = () => ({ ...DEFAULTS, ...records(host).get('research_config', 'default', true)?.values });
  const credential = field => {
    const value = env[config()[field]];
    fail(typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value), 'A required source environment variable is unavailable.', 'SOURCE_CREDENTIAL_MISSING');
    return value.trim();
  };
  const snapshots = () => records(host).list('research_snapshots').sort((a, b) => b.retrieved_at.localeCompare(a.retrieved_at));
  const unavailable = (args, code, sources = []) => ({ status: 'source_unavailable', provider: args.provider, kind: args.kind, reason: code, rows: [], dataset_id: null, raw_dataset_id: null, sources, retrieved_at: new Date(now()).toISOString(), warnings: ['No research conclusion can be drawn from this unavailable source.'] });

  const saveDataset = async data => {const dependencies=(data.input_ids??[]).map(id=>records(host).get('datasets',id).ref);const ref=await publishRows(host,data,dependencies);return records(host).put('datasets',{...data,ref,producer_plugin_id:host.context.pluginId});};
  const service = {
    status() {
      const settings = config();
      return {
        plugin_id: 'sesame/financial-research', configuration: settings,
        sources: Object.entries(SOURCE_KINDS).map(([provider, kinds]) => ({ provider, kinds, configured: NEEDS[provider].every(field => { try { credential(field); return true; } catch { return false; } }), required_environment_names: NEEDS[provider].map(field => settings[field]) })),
        recent_snapshots: snapshots().slice(0, 20).map(row => ({ dataset_id: row.id, raw_dataset_id: row.raw_dataset_id, query: row.query, retrieved_at: row.retrieved_at, row_count: row.row_count })),
      };
    },
    configure(input) {
      fail(host.context?.kind === 'main', 'Research configuration requires the main conversation.', 'MAIN_ONLY');
      fail(Object.keys(input).every(key => CONFIG_FIELDS.includes(key)), 'Only source environment-variable names can be configured.');
      for (const value of Object.values(input)) fail(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value), 'Pass an environment-variable name, never a credential value.');
      records(host).put('research_config', { id: 'default', values: { ...config(), ...input }, updated_at: new Date(now()).toISOString() });
      return service.status();
    },
    read({ dataset_id: id, offset = 0, limit = 20 }) {
      fail(typeof id === 'string' && /^financial-research-[a-f0-9-]+(?:-raw)?$/.test(id), 'Invalid research dataset ID.');
      fail(Number.isInteger(offset) && offset >= 0 && offset <= 10000 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'Invalid evidence page.');
      const base = id.endsWith('-raw') ? id.slice(0, -4) : id;
      const record = records(host).get('research_snapshots', base, true);
      fail(record && (record.id === id || record.raw_dataset_id === id), 'Research evidence not found.', 'NOT_FOUND');
      const dataset = records(host).get('datasets',id);
      return { status: 'saved_evidence', dataset_id: id, ref: dataset.ref, evidence: evidenceRef(id), provenance: dataset.provenance, ...page(dataset.rows, offset, limit), warnings: record.warnings };
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
      if (args.as_of && ['fmp', 'reddit'].includes(args.provider)) {
        const record = snapshots().find(row => identity(row.query) === identity(args) && Date.parse(row.retrieved_at) <= Date.parse(args.as_of));
        if (!record) return unavailable(args, 'HISTORICAL_SNAPSHOT_UNAVAILABLE');
        const dataset = records(host).get('datasets',record.id), rows = selected(dataset.rows, args);
        return { status: rows.length ? 'saved_evidence' : 'partial', provider: args.provider, kind: args.kind, dataset_id: record.id, raw_dataset_id: record.raw_dataset_id, evidence: evidenceRef(record.id), raw_evidence: evidenceRef(record.raw_dataset_id), ref: dataset.ref, raw_ref: records(host).get('datasets', record.raw_dataset_id).ref, ...page(rows, 0, args.limit), retrieved_at: record.retrieved_at, as_of: args.as_of, sources: record.sources, coverage: { ...record.coverage, saved_query: record.query, returned: rows.length }, warnings: [...record.warnings, 'Reused the latest saved matching snapshot acquired before the cutoff; its original bounded coverage still applies.'] };
      }

      const sources = [], secrets = [];
      let result;
      try {
        for (const field of NEEDS[args.provider]) secrets.push(credential(field));
        const get = async (address, { headers = {}, maxBytes = 2 * 1024 * 1024 } = {}) => {
          fail(address.protocol === 'https:' && HOSTS.has(address.hostname) && !address.username && !address.password && (!address.port || address.port === '443'), 'Unsupported source address.', 'SOURCE_ADDRESS_REJECTED');
          if (address.hostname.endsWith('sec.gov')) await secSlot(signal);
          const controller = new AbortController(), abort = () => controller.abort(signal.reason);
          signal?.addEventListener('abort', abort, { once: true });
          const timer = setTimeout(() => controller.abort(new Error('Source timeout.')), timeoutMs);
          let response;
          try {
            signal?.throwIfAborted();
            response = await fetcher(address, { method: 'GET', headers: { Accept: 'application/json', ...headers }, signal: controller.signal, redirect: 'error' });
            fail(response.ok, `Source HTTP ${response.status}.`, `SOURCE_HTTP_${response.status}`);
            fail(!response.headers?.get('content-length') || Number(response.headers.get('content-length')) <= maxBytes, 'Source response exceeds the byte limit.', 'SOURCE_TOO_LARGE');
            const chunks = []; let size = 0;
            fail(response.body?.getReader, 'Source body is unavailable.', 'SOURCE_PAYLOAD_INVALID');
            const reader = response.body.getReader();
            try {
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                size += part.value.byteLength;
                fail(size <= maxBytes, 'Source response exceeds the byte limit.', 'SOURCE_TOO_LARGE');
                chunks.push(Buffer.from(part.value));
              }
            } catch (error) { await reader.cancel().catch(() => {}); throw error; }
            const bytes = Buffer.concat(chunks);
            let data;
            try { data = JSON.parse(bytes.toString('utf8')); } catch { fail(false, 'Source did not return JSON.', 'SOURCE_PAYLOAD_INVALID'); }
            fail(data && typeof data === 'object' && !data['Error Message'] && !data.error && !data.error_code, 'Source returned an error payload.', 'SOURCE_PAYLOAD_INVALID');
            const source = { url: publicURL(address.href), retrieved_at: new Date(now()).toISOString(), response_sha256: hash(bytes), response_bytes: size };
            sources.push(source);
            return { data, source };
          } catch (error) {
            signal?.throwIfAborted();
            if (controller.signal.aborted) throw Object.assign(new Error('Source timeout.'), { code: 'SOURCE_TIMEOUT' });
            throw error;
          } finally { clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort); }
        };
        result = await querySource(args.provider, args, { credential, get, publicURL });
      } catch (error) {
        signal?.throwIfAborted();
        // Network errors can contain a credential-bearing request URL. Return a
        // closed set of codes, never provider text or the thrown error message.
        const code = /^SOURCE_(?:HTTP_\d{3}|CREDENTIAL_MISSING|TOO_LARGE|PAYLOAD_INVALID|ADDRESS_REJECTED|TIMEOUT)$/.test(error?.code ?? '') ? error.code : 'SOURCE_REQUEST_FAILED';
        return unavailable(args, code, sources);
      }

      signal?.throwIfAborted();
      const rows = redact(selected(result.candidates, args), secrets);
      const retrievedAt = new Date(now()).toISOString(), id = `financial-research-${randomUUID()}`, rawId = `${id}-raw`;
      const warnings = [...result.warnings];
      const excludedByCutoff = args.as_of ? result.candidates.filter(row => !row.content_available_at || Date.parse(row.content_available_at) > Date.parse(args.as_of)).length : 0;
      if (excludedByCutoff) warnings.push(`${excludedByCutoff} source records were excluded because this content was not shown to be available by as_of.`);
      if (rows.some(row => row.available_at === null)) warnings.push('Some source publication times are unknown. Their content is known only from this retrieval onward.');
      const coverage = { requested_limit: args.limit, returned: rows.length, source_candidates: result.candidates.length, excluded_by_cutoff: excludedByCutoff, limited: result.limited || rows.length < result.candidates.length, as_of: args.as_of ?? null };
      const provenance = { kind: 'observed', source_kind: 'external', as_of: retrievedAt, provider: args.provider, sources, query: args, retrieved_at: retrievedAt, coverage, untrusted_source_text: true, precision: 'Source numbers and decimal strings are retained as received; JSON numbers retain JSON numeric precision.' };
      await saveDataset({ id: rawId, title: `${args.kind} raw source evidence`, rows: rows.map((row, index) => ({ index, source_url: row.source_url, retrieved_at: row.retrieved_at, available_at: row.available_at, content_available_at: row.content_available_at, availability: row.availability, raw: row.data })), provenance: { ...provenance, retention: 'Selected eligible source records; secrets redacted. Full response hashes identify the fetched payloads; excluded future records are not retained in this dataset.' } });
      await saveDataset({ id, title: `${args.kind} ${args.symbol ?? args.cik ?? args.series_id}`, rows, input_ids: [rawId], provenance });
      records(host).put('research_snapshots', { id, raw_dataset_id: rawId, query: args, retrieved_at: retrievedAt, row_count: rows.length, sources, coverage, warnings });
      return { status: !rows.length || coverage.limited ? 'partial' : 'ok', provider: args.provider, kind: args.kind, dataset_id: id, raw_dataset_id: rawId, evidence: evidenceRef(id), raw_evidence: evidenceRef(rawId), ref: records(host).get('datasets',id).ref, raw_ref: records(host).get('datasets',rawId).ref, ...page(rows, 0, args.limit), retrieved_at: retrievedAt, sources, coverage, warnings };
    },
  };
  return service;
}
