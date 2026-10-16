import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../capabilities.json' with { type: 'json' };
import { createCapabilities } from '../index.js';

test('the public AKShare catalog covers every callable query interface with argument guidance', async () => {
  const catalog = await createCapabilities({}).find(c => c.name === 'akshare_catalog').execute({});
  const advertised = manifest.capabilities.find(c => c.id === 'akshare_query').inputSchema.properties.interface.anyOf.map(s => s.const);
  assert.deepEqual(catalog.interfaces.map(row => row.name).sort(), advertised.sort());
  const quote = catalog.interfaces.find(row => row.name === 'stock_bid_ask_em');
  assert.equal(quote.arguments.symbol, '6 digit A-share code');
  assert.match(quote.source, /observation|snapshot/i);
});
