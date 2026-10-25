import { runWorker } from './worker-call.js';
import { check, canonical } from '@sesame/plugin-sdk/protocol';
import { configuration, prerequisite } from './configuration.js';
import { accountRef, metadata } from './mapping.js';

/** Exact configured connection and the fixed native read boundary. */
export function createConnection(host, { platform = process.platform, request, state }) {
  const { bindings, lifetime } = state;
  request ??= (payload, signal) => runWorker(host, payload, { signal, timeoutMs: 30000 });
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
  const paged = (c, method, input, load) => state.paged(connection(c), method, input, load, fixed);
  const common = {
    bind: async (input, context) => {
      const c = current(); if (input.connection) check(canonical(input.connection) === canonical(connection(c)), 'Selected QMT connection changed', 'CONNECTION_CHANGED');
      bindings.set(context.bindingId, connection(c));
      return { connection: connection(c), health: 'configured', sourceId: `qmt:${c.connection_id}`, limitations: ['Connection is verified on the first native read; no terminal is started.'] };
    },
    unbind: ({ bindingId }) => state.unbind(bindingId),
  };
  async function native(action, args, signal) {
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
  }

  return { current, connection, fixed, instrumentSymbol, account, read, paged, common, native };
}
