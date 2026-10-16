import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../capabilities.json' with { type: 'json' };
import { CCXTProvider } from '../provider.js';
import { createCapabilities } from '../index.js';

test('CCXT only declares implemented market operations and retains candle subscriptions', () => {
  const source = manifest.sources.find(source => source.id === 'market');
  for (const operation of Object.keys(source.operations)) assert.equal(typeof CCXTProvider.prototype[operation], 'function', operation);
  assert.equal(source.operations.subscribeBars, 'market_subscribeBars');
  assert.equal(source.operations.subscribeQuotes, undefined);
  assert.deepEqual(createCapabilities({}).map(c => c.name).sort(), manifest.capabilities.map(c => c.binding.name).sort());
  assert.ok(!source.presentation?.capabilities?.includes('quotes.subscribe'));
});
