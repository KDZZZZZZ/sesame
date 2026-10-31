import test from 'node:test';
import assert from 'node:assert/strict';
import { MT5MarketProvider } from '../backend/providers.js';
import { providerCall } from '../backend/sources.js';
import { providerError } from '@sesame/plugin-sdk/protocol';

function fixture(t) {
  let failure;
  const mt5 = {
    official: { config: { account: { login: '123', server: 'Fixture' } }, redact: text => text.replaceAll('fixture-secret', '[redacted]') },
    market: { async read(tool) {
      if (failure) throw failure;
      if (tool === 'get_trading_account_info') return { account: { login: '123', server: 'Fixture' }, terminal: { server_connected: true } };
      return { ok: true, history: [] };
    } },
  };
  const provider = new MT5MarketProvider(mt5), service = { providers: { market: provider } };
  t.after(() => provider.dispose());
  return { service, fail(error) { failure = error; } };
}
const query = binding => ({ instrument: { sourceId: binding.sourceIds[0], instrumentId: 'FIXTURE' },
  spec: { timeframe: '1h', priceBasis: 'bid', adjustment: 'none', session: 'all', calendarRevision: { status: 'unknown' } }, tailLimit: 10 });

for (const [native, code] of [
  [Object.assign(new Error('session expired'), { code: 'mt5_mcp_http', upstreamStatus: 404 }), 'SOURCE_UNAVAILABLE'],
  [Object.assign(new Error('temporarily unavailable'), { code: 'mt5_read_unavailable' }), 'SOURCE_UNAVAILABLE'],
  [Object.assign(new Error('terminal preparing'), { code: 'terminal_preparing' }), 'SOURCE_UNAVAILABLE'],
  [new DOMException('native read timed out', 'TimeoutError'), 'TIMEOUT'],
  [new TypeError('fetch failed', { cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }) }), 'SOURCE_UNAVAILABLE'],
  [Object.assign(new Error('invalid key fixture-secret'), { code: 'mt5_mcp_http', upstreamStatus: 401 }), 'AUTH_REQUIRED'],
]) {
  test(`MT5 subscription setup reports ${code} for ${native.code ?? native.name}`, async t => {
    const f = fixture(t), binding = await providerCall(f.service, 'market', 'bind', { binding: {} });
    f.fail(native);
    await assert.rejects(providerCall(f.service, 'market', 'subscribeBars', { binding, query: query(binding) }), error => {
      const diagnostic = providerError(error);
      assert.equal(diagnostic.code, code);
      assert.equal(diagnostic.message.includes('fixture-secret'), false);
      assert.equal(diagnostic.retry, ['SOURCE_UNAVAILABLE', 'TIMEOUT'].includes(code) ? 'after_delay' : 'never');
      return true;
    });
  });
}

test('MT5 polling failures retain recoverable diagnostics and a new subscription can resume', async t => {
  const f = fixture(t), binding = await providerCall(f.service, 'market', 'bind', { binding: {} });
  const native = await f.service.providers.market.subscribeBars(query(binding), { bindingId: binding.bindingId });
  f.fail(Object.assign(new Error('native session expired fixture-secret'), { code: 'mt5_mcp_http', upstreamStatus: 404 }));
  const event = await new Promise(resolve => native.ready(resolve));
  await native.close();
  assert.equal(event.type, 'stream.gap');
  assert.equal(providerError(event.payload).code, 'SOURCE_UNAVAILABLE');
  assert.equal(event.payload.message.includes('fixture-secret'), false);
  f.fail(null);
  const restored = await providerCall(f.service, 'market', 'subscribeBars', { binding, query: query(binding) });
  try { assert.equal((await restored.events.next()).value.type, 'snapshot'); } finally { await restored.close(); }
});

test('unexpected implementation failures are not mislabeled as retryable MT5 outages', async t => {
  const f = fixture(t), binding = await providerCall(f.service, 'market', 'bind', { binding: {} });
  const bug = new TypeError('invalid adapter implementation'); f.fail(bug);
  await assert.rejects(providerCall(f.service, 'market', 'subscribeBars', { binding, query: query(binding) }), error => error === bug);
});
