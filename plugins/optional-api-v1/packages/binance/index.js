import { capability } from '@sesame/plugin-sdk/capabilities';
import { createService } from './src/service.js';

const services = new Map();
export function createCapabilities(host) {
  const key = host.context.storageRoot;
  const service = () => { if (!services.has(key)) services.set(key, createService(host)); return services.get(key); };
  const execution = () => service().executionFor(host);
  return [
    capability('binance_catalog', () => service().catalog()),
    capability('binance_account', (_args, signal) => service().account.read(signal)),
    capability('binance_order', (args, signal) => execution().order(args, signal)),
    capability('binance_order_test', (args, signal) => execution().order(args, signal, true)),
    capability('binance_order_status', (args, signal) => execution().status(args, signal)),
    capability('binance_cancel', (args, signal) => execution().mutate('cancel', args, signal)),
    capability('binance_amend', (args, signal) => execution().mutate('amend', args, signal)),
    ...['identity', 'snapshot', 'prepare', 'submit', 'recover', 'command', 'cancel'].map(operation => capability(`binance_execution_${operation}`, (args, signal) => execution()[operation](args, signal))),
    capability('market_bind', ({ binding }, signal) => service().market.bind(binding, signal)),
    capability('market_unbind', async ({ binding }) => { await service().streams.unbind(binding); service().market.unbind(binding); return { closed: true }; }),
    capability('market_searchInstruments', ({ binding, query, page }, signal) => service().market.search(binding, query, page, signal)),
    capability('market_describeInstrument', ({ binding, query }, signal) => service().market.describe(binding, query, signal)),
    capability('market_queryBars', ({ binding, query, page }, signal) => service().market.queryBars(binding, query, page, signal)),
    capability('market_subscribeBars', ({ binding, query }, signal) => service().streams.bars(binding, query, signal)),
    capability('market_subscribeQuotes', ({ binding, query }, signal) => service().streams.quotes(binding, query, signal)),
    capability('account_bind', ({ binding }, signal) => service().account.bind(binding, signal)),
    capability('account_unbind', ({ binding }) => { service().account.unbind(binding); return { closed: true }; }),
    capability('account_listAccounts', ({ binding, query, page }, signal) => service().account.list(binding, query, page, signal)),
    capability('account_snapshot', ({ binding, query }, signal) => service().account.snapshot(binding, query, signal)),
    capability('account_queryOrders', ({ binding, query, page }, signal) => service().account.orders(binding, query, page, signal)),
    capability('account_queryFills', ({ binding, query, page }, signal) => service().account.fills(binding, query, page, signal)),
    capability('binance_dispose', async () => { const current = services.get(key); services.delete(key); return current ? current.dispose() : { closed: true }; }),
  ];
}
