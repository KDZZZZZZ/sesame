import { BinanceClient } from './client.js';
import { createRecords } from './records.js';
import { Market, intervals } from './market.js';
import { Streams } from './streams.js';
import { Account } from './account.js';
import { Execution } from './execution.js';
import { connection } from './common.js';

export function createService(host, options = {}) {
  const records = options.records ?? createRecords(host.context.storageRoot);
  const client = new BinanceClient(options), market = new Market(client, records, options), streams = new Streams(market, options), account = new Account(client, market, options), execution = new Execution(host, client, market, account, records, options);
  return { client, market, streams, account, execution,
    executionFor: caller => new Execution(caller, client, market, account, records, { ...options, locks: execution.locks }),
    catalog() {
      const config = client.config();
      return { backend: 'binance', market: 'spot', configuredEnvironment: config.environment, credentials: { apiKey: Boolean(config.apiKey), apiSecret: Boolean(config.secret) }, connections: ['production', 'testnet'].map(environment => ({ environment, connection: connection(environment), sourceId: connection(environment).id })), timeframes: Object.keys(intervals), accountSource: 'sesame/binance#account', marketSource: 'sesame/binance#market', trading: ['market', 'limit', 'reduce-quantity-amend', 'cancel', 'order-status'], portfolioExecutionSupported: false };
    },
    async dispose() { await streams.dispose(); await Promise.allSettled(execution.locks.values()); await market.dispose(); account.dispose(); records.close(); return { closed: true }; },
  };
}
