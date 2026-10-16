import { check } from './capture.js';
import { marketReadCapabilities } from './market-read.js';

export function marketCapabilities(host) {
  return [
    ...marketReadCapabilities(host),
    { name: 'data_providers', execute: async input => {
      const page = await host.data.sources(input);
      return { ...page, items: page.items.filter(item => ['sesame.market/1', 'sesame.account/1'].includes(item.contract)) };
    } },
    { name: 'market_instruments', execute: async (args, signal) => {
      check(args.action !== 'describe' || args.instrument, 'Describe requires the exact InstrumentRef from search');
      const input = args.action === 'describe' ? { instrument: args.instrument } : { query: args.query ?? '', ...(args.assetClasses ? { assetClasses: args.assetClasses } : {}), ...(args.venues ? { venues: args.venues } : {}) };
      const result = await host.data.query({ source: args.source, operation: args.action === 'describe' ? 'describeInstrument' : 'searchInstruments', input, limit: args.limit ?? 20, ...(args.cursor ? { cursor: args.cursor } : {}) }, { signal });
      if (args.action === 'describe') {
        const instrument = result.items[0];
        check(instrument?.ref?.sourceId === args.instrument.sourceId && instrument.ref.instrumentId === args.instrument.instrumentId, 'Source described another instrument');
        return { source: args.source, instrument, metadata: result.metadata ?? {} };
      }
      return result;
    } },
  ];
}
