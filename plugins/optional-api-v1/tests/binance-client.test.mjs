import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response } from './binance-fixture.mjs';

test('HMAC requests use the selected fixed origin and never put the key in a URL', async t => {
  const f = await fixture(t); const account = await f.service.account.read();
  assert.equal(account.account.accountId, '12345');
  const signed = f.calls.find(row => row.path === '/api/v3/account');
  assert.equal(signed.origin, 'https://testnet.binance.vision'); assert.ok(signed.params.signature); assert.equal(signed.params.recvWindow, '5000');
  assert.equal(JSON.stringify(account).includes(f.env.BINANCE_API_SECRET), false);
  assert.equal(JSON.stringify(account).includes(f.env.BINANCE_API_KEY), false);
});
test('clock skew rejection recalibrates and retries exactly once', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.path === '/api/v3/account', run: () => response({ code: -1021 }, 400) });
  await f.service.account.read();
  assert.equal(f.calls.filter(row => row.path === '/api/v3/time').length, 2);
  assert.equal(f.calls.filter(row => row.path === '/api/v3/account').length, 2);
});
test('repeated clock rejection terminates instead of retrying indefinitely', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.path === '/api/v3/account', once: false, run: () => response({ code: -1021 }, 400) });
  await assert.rejects(f.service.account.read(), { code: 'INVALID_ARGUMENT' });
  assert.equal(f.calls.filter(row => row.path === '/api/v3/account').length, 2);
});
test('HTTP 429/418 share a cooldown and respect Retry-After without request storms', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.path === '/api/v3/exchangeInfo', run: () => response({ code: -1003 }, 429, { 'Retry-After': '12' }) });
  await assert.rejects(f.service.market.catalog('testnet'), error => error.code === 'RATE_LIMITED' && error.retryAt === f.clock.now() + 12000);
  const count = f.calls.length;
  await assert.rejects(f.service.client.request('testnet', 'GET', '/api/v3/time'), { code: 'RATE_LIMITED' }); assert.equal(f.calls.length, count);
  f.clock.advance(12001); await f.service.market.catalog('testnet');
  f.overrides.push({ match: row => row.path === '/api/v3/time', run: () => response({ code: -1003 }, 418, { 'Retry-After': '120' }) });
  await assert.rejects(f.service.client.serverTime('testnet', undefined, true), error => error.code === 'RATE_LIMITED' && error.retryAt >= f.clock.now() + 120000);
});
test('signed POST transport errors and HTTP 5xx are unknown and never replayed', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.method === 'POST', run: () => { throw new Error('secret=' + f.env.BINANCE_API_SECRET); } });
  await assert.rejects(f.service.client.request('testnet', 'POST', '/api/v3/order', { symbol: 'BTCUSDT' }, { signed: true }), error => error.code === 'OPERATION_OUTCOME_UNKNOWN' && !error.message.includes(f.env.BINANCE_API_SECRET));
  assert.equal(f.calls.filter(row => row.method === 'POST').length, 1);
  f.overrides.push({ match: row => row.method === 'POST', run: () => response({ code: -1000 }, 500) });
  await assert.rejects(f.service.client.request('testnet', 'POST', '/api/v3/order', {}, { signed: true }), { code: 'OPERATION_OUTCOME_UNKNOWN' });
  assert.equal(f.calls.filter(row => row.method === 'POST').length, 2);
});
test('credential rotation and environment changes reject a pinned identity before sending', async t => {
  const f = await fixture(t), identity = f.service.client.identity();
  f.env.BINANCE_ENVIRONMENT = 'production';
  await assert.rejects(f.service.client.request('testnet', 'GET', '/api/v3/account', {}, { signed: true, expectedIdentity: identity }), { code: 'CONNECTION_CHANGED' });
  f.env.BINANCE_ENVIRONMENT = 'testnet'; f.env.BINANCE_API_SECRET = 'different-fixture-secret';
  await assert.rejects(f.service.client.request('testnet', 'GET', '/api/v3/account', {}, { signed: true, expectedIdentity: identity }), { code: 'CONNECTION_CHANGED' });
  assert.equal(f.calls.length, 0);
});
test('public production requests work without credentials and cannot use arbitrary origins', async t => {
  const f = await fixture(t, { publicOnly: true });
  await f.service.market.catalog('production'); assert.equal(f.calls[0].origin, 'https://data-api.binance.vision');
  assert.equal(f.calls[0].headers['X-MBX-APIKEY'], undefined);
  await assert.rejects(f.service.client.request('http://elsewhere', 'GET', '/api/v3/time'), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.service.account.read(), { code: 'AUTH_REQUIRED' });
});

test('hidden-value placeholders fail before contacting Binance', async t => {
  const f = await fixture(t);
  f.env.BINANCE_API_KEY = '[redacted]';
  await assert.rejects(f.service.account.read(), error => error.code === 'AUTH_REQUIRED' && /placeholders/.test(error.message));
  assert.equal(f.calls.length, 0);
});

test('large native account and order identifiers preserve every digit from JSON', async t => {
  const f = await fixture(t);
  f.overrides.push({ match: row => row.path === '/api/v3/account', run: () => new Response('{"uid":9007199254740993,"accountType":"SPOT","balances":[],"canTrade":true}') });
  const account = await f.service.account.read();
  assert.equal(account.account.accountId, '9007199254740993');
  f.overrides.push({ match: row => row.path === '/api/v3/order', run: () => new Response('{"orderId":9007199254740995,"time":1700000000000}') });
  const order = await f.service.client.request('testnet', 'GET', '/api/v3/order', { symbol: 'BTCUSDT' }, { signed: true });
  assert.equal(order.orderId, '9007199254740995');
  assert.equal(order.time, 1700000000000, 'ordinary timestamps remain numeric');
});

test('oversized responses stop reading at the byte limit', async t => {
  const f = await fixture(t); let canceled = false, reads = 0;
  f.overrides.push({ match: row => row.path === '/api/v3/exchangeInfo', run: () => new Response(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { canceled = true; },
  })) });
  await assert.rejects(f.service.market.catalog('production'), { code: 'RESOURCE_EXHAUSTED' });
  assert.equal(canceled, true); assert.ok(reads <= 10);
});
