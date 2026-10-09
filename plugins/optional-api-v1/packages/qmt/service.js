import { randomUUID } from 'node:crypto';
import { check, canonical, digest } from '@sesame/plugin-sdk/protocol';
import { configuration, prerequisite } from './configuration.js';
import { accountRef, accountSummary, accountSnapshot, instrumentRef, summary, instrument, quote, position, metadata } from './mapping.js';

const warning = (code, message) => ({ code, message });
export const descriptors = [
  { id: 'market', contract: 'sesame.market', versions: ['1.0.0'], capabilities: ['instruments.search','instruments.describe','quotes.subscribe'], limits: { transportMode: 'poll', minPollIntervalMs: 1000, maxPageSize: 200, maxInstrumentsPerSubscription: 50, resumable: false, catalogScope: 'configured native mainland stock sector', timeframes: [], priceBases: ['last'], adjustments: ['none'] } },
  { id: 'account', contract: 'sesame.account', versions: ['1.0.0'], capabilities: ['accounts.list','account.snapshot','positions.query'], limits: { maxPageSize: 200, accountTypes: ['STOCK'], currencies: ['CNY'], accountScope: 'one explicitly configured account', eventHistory: false } },
];

/** Test injection supplies only the fixed query boundary, never a runtime/store object. */
export function createService(host, { platform = process.platform, now = Date.now, pollMs = 1000, request } = {}) {
  const bindings = new Map(), pages = new Map(), revisions = new Map(), streams = new Set(), lifetime = new AbortController();
  request ??= (payload, signal) => host.environment.executeWorker('worker.js', payload, { signal, timeoutMs: 30000 });
  const current = () => {
    if (platform !== 'win32') prerequisite(host, 'Use this plugin on native Windows x64 with broker-authorized MiniQMT; macOS and Linux are not QMT hosts');
    const c = configuration(host);
    if (!c.connection_id || !c.python_path) prerequisite(host, 'Inspect and configure an existing compatible Windows Python first');
    return c;
  };
  const connection = c => ({ id: c.connection_id, revision: String(c.version) });
  const fixed = context => {
    const c = current(), bound = bindings.get(context.bindingId);
    check(bound && canonical(bound) === canonical(connection(c)), 'QMT connection configuration changed; bind again', 'CONNECTION_CHANGED');
    return c;
  };
  const instrumentSymbol = (c, ref) => { check(ref?.sourceId === `qmt:${c.connection_id}` && /^\d{6}\.(SH|SZ|BJ)$/.test(ref?.instrumentId ?? ''), 'Instrument belongs to a different source or unsupported market', 'INVALID_ARGUMENT'); return ref.instrumentId; };
  const account = (c, ref) => { check(c.account_id && c.userdata_directory, 'Configure the authorized STOCK account and userdata_mini directory', 'PREREQUISITE_REQUIRED'); check(canonical(ref) === canonical(accountRef(c)), 'Account does not match the configured connection', 'INVALID_ARGUMENT'); };
  async function read(c, action, args, signal) {
    const result = await request({ action, python: c.python_path, config: c, ...args }, AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]));
    check(canonical(connection(configuration(host))) === canonical(connection(c)), 'A late native response cannot cross a configuration change', 'CONNECTION_CHANGED');
    check(result.ok === true && Number.isFinite(result.sample?.from) && Number.isFinite(result.sample?.to) && result.sample.from <= result.sample.to, 'QMT returned an invalid read receipt', 'SOURCE_DATA_INVALID');
    return result;
  }
  function revised(item) {
    const hash = digest(item), key = item.id, prior = revisions.get(key);
    const revision = prior ? (prior.hash === hash ? prior.revision : String(BigInt(prior.revision) + 1n)) : '0';
    revisions.set(key, { hash, revision }); return { ...item, revision };
  }
  async function paged(c, method, input, load) {
    const limit = input.page?.limit;
    check(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'page.limit must be 1–200', 'INVALID_ARGUMENT');
    const filter = { ...input }; delete filter.page;
    const signature = digest({ method, connection: connection(c), filter });
    for (const [key, value] of pages) if (now() - value.at > 60000) pages.delete(key);
    let snapshot, offset = 0;
    if (input.page.cursor) {
      const cursor = pages.get(input.page.cursor);
      check(cursor, 'QMT cursor expired; request a new snapshot', 'CURSOR_EXPIRED');
      check(cursor.signature === signature, 'Cursor filters or connection changed', 'INVALID_CURSOR');
      ({ snapshot, offset } = cursor);
    } else {
      const { rows, meta, extra } = await load();
      check(rows.length <= 20000 && Buffer.byteLength(canonical(rows)) <= 8 * 1024 * 1024, 'Native snapshot exceeds budget', 'RESOURCE_EXHAUSTED');
      snapshot = { id: randomUUID(), rows, meta, extra };
    }
    let nextCursor = null;
    if (offset + limit < snapshot.rows.length) {
      while (pages.size >= 64) pages.delete(pages.keys().next().value);
      nextCursor = randomUUID(); pages.set(nextCursor, { at: now(), signature, snapshot, offset: offset + limit });
    }
    return { data: { items: snapshot.rows.slice(offset, offset + limit), nextCursor, snapshotId: snapshot.id, consistency: 'snapshot' }, meta: snapshot.meta, ...(snapshot.extra ?? {}) };
  }
  const common = {
    bind: async (input, context) => {
      const c = current(); if (input.connection) check(canonical(input.connection) === canonical(connection(c)), 'Selected QMT connection changed', 'CONNECTION_CHANGED');
      bindings.set(context.bindingId, connection(c));
      return { connection: connection(c), health: 'configured', sourceId: `qmt:${c.connection_id}`, limitations: ['Connection is verified on the first native read; no terminal is started.'] };
    },
    unbind: ({ bindingId }) => { bindings.delete(bindingId); },
  };
  const market = { ...common,
    searchInstruments: async (input, context) => {
      const c = fixed(context);
      check(typeof input.query === 'string' && input.query.length <= 100, 'Invalid search query', 'INVALID_ARGUMENT');
      return paged(c, 'search', input, async () => {
        const r = await read(c, 'search', { query: input.query }, context.signal);
        const rows = r.result.items.map(row => summary(c, row)).filter(item => (!input.assetClasses || input.assetClasses.includes(item.assetClass)) && (!input.venues || input.venues.includes(item.venue.value)));
        return { rows, meta: metadata(r, [warning('PARTIAL_CATALOG', `Only the native local sector ${c.sector} is available; no download or global directory completeness is inferred.`)]) };
      });
    },
    describeInstrument: async (input, context) => {
      const c = fixed(context), r = await read(c, 'describe', { symbols: [instrumentSymbol(c, input.instrument)] }, context.signal);
      return { data: instrument(c, r.result.items[0]), meta: metadata(r) };
    },
    subscribeQuotes: async (input, context) => {
      check(!input.resumeToken, 'Quote recovery requires a new snapshot', 'UNSUPPORTED_CAPABILITY');
      check(Array.isArray(input.instruments) && input.instruments.length >= 1 && input.instruments.length <= 50, 'Select 1–50 instruments', 'INVALID_ARGUMENT');
      const c = fixed(context), symbols = input.instruments.map(ref => instrumentSymbol(c, ref));
      check(new Set(symbols).size === symbols.length, 'Duplicate quote instruments', 'INVALID_ARGUMENT');
      const controller = new AbortController(), signal = AbortSignal.any([controller.signal, lifetime.signal, ...(context.signal ? [context.signal] : [])]);
      const fetch = async () => { fixed(context); const r = await read(c, 'quotes', { symbols }, signal); return { quotes: r.result.items.map(row => revised(quote(c, row))), meta: metadata(r, [warning('POLLING_SNAPSHOT', 'Native get_full_tick is polled without overlapping reads; source timestamps determine quote age, not poll time.')]) }; };
      const initial = await fetch(), position = { streamId: randomUUID(), epoch: randomUUID(), seq: '0' };
      let ready = false, task, timer, wake, sequence = 0n;
      const handle = { snapshot: initial, position, consistency: 'bounded', recovery: 'snapshot',
        ready: emit => {
          if (ready || signal.aborted) return; ready = true;
          const event = (type, payload) => { sequence++; emit({ ...position, seq: String(sequence), eventId: randomUUID(), schemaVersion: '1.0.0', type, payload, observedAt: now() }); };
          task = (async () => {
            let prior = canonical(initial.quotes);
            try {
              while (!signal.aborted) {
                await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, pollMs); });
                if (signal.aborted) break;
                const next = await fetch(), body = canonical(next.quotes);
                if (body !== prior) { event('quotes.upsert', next); prior = body; }
              }
            } catch (error) { if (!signal.aborted) event('stream.gap', { reason: { code: error.code ?? 'SOURCE_UNAVAILABLE', message: error.message }, recovery: 'snapshot' }); }
          })();
        },
        close: async () => { controller.abort(); clearTimeout(timer); wake?.(); if (task) await task; signal.removeEventListener('abort', abort); streams.delete(handle); },
      };
      const abort = () => { clearTimeout(timer); wake?.(); };
      signal.addEventListener('abort', abort, { once: true }); streams.add(handle); return handle;
    },
  };
  const accounts = { ...common,
    listAccounts: async (input, context) => {
      const c = fixed(context); account(c, accountRef(c));
      return paged(c, 'accounts', input, async () => { const r = await read(c, 'asset', {}, context.signal); return { rows: [accountSummary(c)], meta: metadata(r, [warning('CONFIGURED_ACCOUNT_ONLY', 'Only the explicitly configured account was queried; other logged-in accounts were not enumerated.')]) }; });
    },
    snapshot: async (input, context) => { const c = fixed(context); account(c, input.account); const r = await read(c, 'asset', {}, context.signal); return { data: accountSnapshot(c, r.result.asset, r.sample), meta: metadata(r, [warning('OBSERVATION_TIME', 'Asset asOf is the actual read time; the SDK does not provide a broker snapshot timestamp.')]) }; },
    queryPositions: async (input, context) => {
      const c = fixed(context); account(c, input.account); const symbols = input.instruments?.map(ref => instrumentSymbol(c, ref));
      return paged(c, 'positions', input, async () => { const r = await read(c, 'positions', {}, context.signal); return { rows: r.result.items.filter(row => !symbols || symbols.includes(row.stock_code)).map(row => revised(position(c, row))).sort((a,b) => a.id.localeCompare(b.id)), meta: metadata(r) }; });
    },
  };
  return { market, account: accounts,
    async native(action, args, signal) {
      check(['search','describe','quotes','asset','positions','orders','fills'].includes(action), 'Only fixed reads are supported', 'UNSUPPORTED_CAPABILITY');
      const c = current(); if (['asset','positions','orders','fills'].includes(action)) account(c, accountRef(c));
      if (['search','positions','orders','fills'].includes(action)) {
        const input = { ...args, page: args.page ?? { limit: 200 } };
        const r = await paged(c, `native:${action}`, input, async () => {
          const result = await read(c, action, { query: args.query ?? '' }, signal);
          return { rows: result.result.items, meta: metadata(result), extra: { coverage: result.result.coverage ?? { scope: 'configured_native_sector', complete_history: false }, ...(result.result.source ? { source: result.result.source } : {}) } };
        });
        return { ...r.data, meta: r.meta, coverage: r.coverage, ...(r.source ? { source: r.source } : {}), connection: connection(c), nativeFieldPolicy: 'Original native fields; order timestamps and price_type are not reinterpreted. Current-day data is not full history.' };
      }
      const r = await read(c, action, args, signal);
      return { ...r.result, connection: connection(c), meta: metadata(r), nativeFieldPolicy: 'Integer IDs and SDK float values remain text. Native order timestamps/price_type are not reinterpreted. No strategy correlation or all-history completeness is claimed.' };
    },
    async dispose() { lifetime.abort(); await Promise.allSettled([...streams].map(stream => stream.close())); bindings.clear(); pages.clear(); revisions.clear(); },
  };
}
