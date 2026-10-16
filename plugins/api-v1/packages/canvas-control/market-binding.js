import { check, canonical } from '@sesame/plugin-sdk/protocol';

export async function marketProviders(host) {
  const items = []; let cursor;
  do {
    const page = await host.data.sources({ contract: 'sesame.market/1', limit: 200, ...(cursor ? { cursor } : {}) });
    items.push(...page.items); cursor = page.nextCursor;
    check(items.length <= 1000, 'Too many market source declarations', 'RESOURCE_EXHAUSTED');
  } while (cursor);
  return items;
}

function select(requested, choices, name) {
  check(Array.isArray(choices) && choices.every(value => typeof value === 'string'), `Source ${name} declaration is invalid`, 'INVALID_PROVIDER_DATA');
  if (requested !== undefined) {
    check(!choices.length || choices.includes(requested), `Unsupported ${name}: ${requested}. Declared choices: ${choices.join(', ')}`, 'UNSUPPORTED_CAPABILITY');
    return requested;
  }
  check(choices.length === 1, `Choose ${name} explicitly. Declared choices: ${choices.join(', ') || '(none)'}`, 'INVALID_ARGUMENT');
  return choices[0];
}

export function bindingTool(host) {
  return { name: 'canvas_binding', execute: async (args, signal) => {
    const descriptor = (await marketProviders(host)).find(item => item.ref.providerId === args.source.providerId);
    check(descriptor?.available, 'Market source is not available; load its plugin first', 'NOT_FOUND');
    check(descriptor.ref.revision === args.source.revision, 'Source declaration changed; discover its current revision', 'STALE_REVISION');
    check(descriptor.operations.queryBars || descriptor.operations.subscribeBars || descriptor.operations.watchBars, 'Source has no candle/bar operation', 'UNSUPPORTED_CAPABILITY');
    const result = await host.data.query({ source: args.source, operation: 'describeInstrument', input: { instrument: args.instrument }, limit: 1 }, { signal });
    check(result.items.length === 1 && !result.nextCursor, 'Source description must identify exactly one instrument', 'INVALID_PROVIDER_DATA');
    const instrument = result.items[0], features = instrument.features ?? {};
    check(canonical(instrument.ref) === canonical(args.instrument), 'Source described another instrument', 'INSTRUMENT_MISMATCH');
    check(features.timeframes?.includes(args.timeframe), `Unsupported timeframe ${args.timeframe}`, 'UNSUPPORTED_CAPABILITY');
    const connection = result.metadata?.connection;
    if (args.source.binding?.connection) check(canonical(connection) === canonical(args.source.binding.connection), 'Source connection revision changed', 'CONNECTION_CHANGED');
    const source = structuredClone(args.source);
    if (connection) {
      check(descriptor.configSchema.properties?.connection && typeof connection.id === 'string' && typeof connection.revision === 'string', 'Source must declare a reusable connection binding', 'INVALID_PROVIDER_DATA');
      source.binding = { ...source.binding, connection: structuredClone(connection) };
    } else check(!source.binding || Object.keys(source.binding).length === 0, 'Configured charts require a persistent connection revision', 'UNSUPPORTED_CAPABILITY');
    const spec = { timeframe: args.timeframe, priceBasis: select(args.price_basis, features.priceBases ?? [], 'price_basis'), adjustment: select(args.adjustment, features.adjustments ?? [], 'adjustment'), session: select(args.session, features.sessions ?? [], 'session'), calendarRevision: instrument.calendar ?? { status: 'unknown', reason: 'Source did not publish a calendar revision' } };
    check(['value', 'unknown', 'not_applicable', 'unsupported'].includes(spec.calendarRevision.status), 'Source calendar must have an explicit value status', 'INVALID_PROVIDER_DATA');
    const binding = { source, instrument: instrument.ref, spec };
    return { binding, chart: { symbol: instrument.symbol, binding, volume: true }, instrument, metadata: result.metadata ?? {}, validation: { scope: 'source_description', marketDataRead: false, rendered: false }, operations: descriptor.operations };
  } };
}
