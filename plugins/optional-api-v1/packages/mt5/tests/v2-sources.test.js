import test from 'node:test';
import assert from 'node:assert/strict';
import { MT5MarketProvider, MT5AccountProvider } from '../backend/providers.js';
import { datasetQuery, providerCall } from '../backend/sources.js';

function fixture() {
  const calls = [], mt5 = { official: { config: { version: 1, account: { login: '123', server: 'Fixture' } } }, options: { market: { intervalMs: 100000 } }, market: { async read(tool, args) {
    calls.push({ tool, args });
    if (tool === 'get_trading_account_info') return { account: { login: '123', server: 'Fixture', currency: 'USD' }, terminal: { server_connected: true } };
    if (tool === 'get_marketwatch_symbols') return { symbols: [{ symbol: 'AAA', description: 'Invented A', digits: 2 }, { symbol: 'BBB', description: 'Invented B', digits: 2 }] };
    throw new Error(`Unexpected external read: ${tool}`);
  } } };
  return { calls, mt5, providers: { market: new MT5MarketProvider(mt5), account: new MT5AccountProvider(mt5) } };
}

test('dataset queries distinguish an explicit unknown ID from the dataset directory', () => {
  const dataset = { id: 'dataset-fixed', title: 'Synthetic rows', rows: [{ value: '7' }] };
  const service = { mt5: { storage: { get: (_type, id) => id === dataset.id ? dataset : null, list: () => [dataset] } } };
  assert.deepEqual(datasetQuery({}, service, {}).items, [{ id: dataset.id, title: dataset.title, rowCount: 1 }]);
  assert.deepEqual(datasetQuery({}, service, { query: { datasetId: dataset.id } }).items, dataset.rows);
  assert.throws(() => datasetQuery({}, service, { query: { datasetId: 'missing-dataset' } }), { code: 'NOT_FOUND' });
});
test('declared market source keeps one exact binding and snapshot across pages and releases it', async () => {
  const service = fixture(), binding = await providerCall(service, 'market', 'bind', { binding: {} });
  assert.deepEqual(binding.connection, { id: 'mt5-terminal', revision: '1' });
  assert.equal(binding.timeBasis.kind, 'wall');
  const first = await providerCall(service, 'market', 'searchInstruments', { binding, query: {}, page: { limit: 1 } });
  assert.equal(first.items.length, 1); assert.ok(first.nextCursor); assert.equal(first.metadata.consistency, 'snapshot');
  const second = await providerCall(service, 'market', 'searchInstruments', { binding, query: {}, page: { limit: 1, cursor: first.nextCursor } });
  assert.equal(second.items.length, 1); assert.equal(second.nextCursor, undefined);
  assert.equal(first.metadata.snapshotId, second.metadata.snapshotId);
  assert.equal(service.calls.filter(call => call.tool === 'get_marketwatch_symbols').length, 1);
  await providerCall(service, 'market', 'unbind', { binding });
  assert.equal(service.providers.market.bindings.size, 0);
  await assert.rejects(providerCall(service, 'market', 'searchInstruments', { binding, query: {}, page: { limit: 1 } }), { code: 'CONNECTION_CHANGED' });
});
test('a source binding cannot silently cross configured account revisions', async () => {
  const service = fixture(), binding = await providerCall(service, 'account', 'bind', { binding: {} });
  service.mt5.official.config.version = 2;
  await assert.rejects(providerCall(service, 'account', 'listAccounts', { binding, query: {}, page: { limit: 1 } }), { code: 'CONNECTION_CHANGED' });
  assert.equal(service.calls.length, 0);
  service.providers.account.dispose();
});

for (const { domain, operation, snapshot, update } of [
  { domain: 'market', operation: 'subscribeBars', snapshot: { seriesId: 'series-1', bars: [{ id: 'bar-1', revision: '1' }] }, update: { type: 'bars.upsert', payload: { seriesId: 'series-1', bars: [{ id: 'bar-1', revision: '2' }] } } },
  { domain: 'account', operation: 'subscribeAccount', snapshot: { account: { connectionId: 'terminal-1', accountId: 'account-1' }, positions: [] }, update: { type: 'positions.upsert', payload: { items: [{ id: 'position-1' }] } } },
]) {
  test(`${domain}.${operation} exposes the source stream contract and releases its provider`, async () => {
    const controller = new AbortController(), binding = { bindingId: `${domain}-binding` }, query = { fixture: operation };
    const position = { streamId: `${domain}-stream`, epoch: 'epoch-1', seq: '0' };
    let emit, closed = 0;
    const service = { providers: { [domain]: { async [operation](input, context) {
      assert.deepEqual(input, query); assert.equal(context.bindingId, binding.bindingId); assert.equal(context.signal, controller.signal);
      return { snapshot, position, consistency: 'best_effort', recovery: 'snapshot', ready(callback) { emit = callback; }, close() { closed++; } };
    } } } };
    const stream = await providerCall(service, domain, operation, { binding, query }, controller.signal);
    try {
      assert.deepEqual(await stream.events.next(), { done: false, value: { type: 'snapshot', snapshot, position, consistency: 'best_effort', recovery: 'snapshot' } });
      const event = { ...position, seq: '1', eventId: 'epoch-1:1', schemaVersion: '1.0.0', observedAt: 1, ...update };
      emit(event);
      assert.deepEqual(await stream.events.next(), { done: false, value: event });
      const pending = stream.events.next();
      if (domain === 'market') await stream.close();
      else controller.abort();
      assert.deepEqual(await pending, { done: true });
      emit({ ...event, seq: '2' });
      assert.deepEqual(await stream.events.next(), { done: true });
    } finally { await stream.close(); }
    assert.equal(closed, 1);
  });
}
