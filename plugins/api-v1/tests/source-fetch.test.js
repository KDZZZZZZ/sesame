import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createSourceFetcher } from '../packages/web-sources/fetch.js';

const code = value => error => error.code === value;

function fixture(handler = () => ({ body: 'page' }), options = {}) {
  const calls = [];
  const request = (options, callback) => {
    calls.push(options);
    const req = new EventEmitter();
    let response, closed = false;
    const cleanup = () => options.signal.removeEventListener('abort', abort);
    const abort = () => req.destroy(options.signal.reason);
    req.destroy = error => {
      if (closed) return req;
      closed = true; cleanup();
      if (error) req.emit('error', error);
      response?.destroy(); return req;
    };
    req.end = () => queueMicrotask(async () => {
      try {
        options.signal.throwIfAborted();
        const result = await handler(options);
        if (closed) return;
        if (result.error) { req.destroy(result.error); return; }
        response = Readable.from(result.chunks ?? [Buffer.from(result.body ?? '')]);
        response.statusCode = result.status ?? 200;
        response.headers = result.headers ?? { 'content-type': 'text/html' };
        response.once('close', cleanup);
        callback(response);
      } catch (error) { req.destroy(error); }
    });
    options.signal.addEventListener('abort', abort, { once: true });
    return req;
  };
  return { calls, fetch: createSourceFetcher({ env: {}, request, httpRequest: request, ...options }) };
}

test('HTTPS preserves the original DNS, HTTP and TLS identity by default', async () => {
  const f = fixture();
  assert.equal((await f.fetch('https://example.com:8443/news?q=a')).text, 'page');
  assert.equal(f.calls[0].hostname, 'example.com');
  assert.equal(f.calls[0].port, 8443);
  assert.equal(f.calls[0].headers.Host, 'example.com:8443');
  assert.equal(f.calls[0].servername, 'example.com');
  assert.equal(f.calls[0].path, '/news?q=a');
  assert.equal(f.calls[0].checkServerIdentity('ignored', { subjectaltname: 'DNS:example.com' }), undefined);
  assert.equal(f.calls[0].checkServerIdentity('ignored', { subjectaltname: 'DNS:attacker.example' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
});

test('HTTP and HTTPS allow private, loopback, IPv6 and proxy Fake-IP addresses without an opt-in', async () => {
  const f = fixture();
  for (const host of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.77.91.52', '192.168.1.1', '198.18.0.1', '[::1]', '[::ffff:127.0.0.1]', '[fc00::1]', 'localhost', 'router.local']) {
    for (const protocol of ['http:', 'https:']) {
      assert.equal((await f.fetch(protocol + '//' + host + ':8080/')).text, 'page');
      assert.equal(f.calls.at(-1).hostname, new URL(protocol + '//' + host).hostname.replace(/^\[|\]$/g, ''));
      assert.equal(f.calls.at(-1).port, 8080);
    }
  }
});

test('unsupported protocols and embedded credentials remain rejected, including after redirects', async () => {
  const f = fixture();
  for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'https://user:password@example.com/', 'http://user@localhost/']) {
    await assert.rejects(f.fetch(url), /HTTP\/HTTPS|凭据/);
  }
  assert.equal(f.calls.length, 0);
  for (const location of ['file:///etc/passwd', 'http://secret@localhost/']) {
    const redirect = fixture(() => ({ status: 302, headers: { location } }));
    await assert.rejects(redirect.fetch('https://example.com/'), /HTTP\/HTTPS|凭据/);
    assert.equal(redirect.calls.length, 1);
  }
});

test('cross-origin private redirects work and redirect loops remain bounded', async () => {
  const f = fixture(options => options.hostname === 'example.com'
    ? { status: 302, headers: { location: 'http://10.0.0.1:9000/result' } } : { body: 'private source' });
  const result = await f.fetch('https://example.com/');
  assert.equal(result.text, 'private source');
  assert.equal(result.url, 'http://10.0.0.1:9000/result');
  assert.deepEqual(f.calls.map(c => c.hostname), ['example.com', '10.0.0.1']);
  const loop = fixture(() => ({ status: 302, headers: { location: '/again' } }));
  await assert.rejects(loop.fetch('https://example.com/'), code('source_redirect_error'));
  assert.equal(loop.calls.length, 4);
});

test('HTTP, DNS and connection failures retain diagnostics without replaying the request', async () => {
  const denied = fixture(() => ({ status: 403 }));
  await assert.rejects(denied.fetch('https://example.com/'), error => error.code === 'source_http_error' && /403/.test(error.message));
  assert.equal(denied.calls.length, 1);
  for (const [failure, expected] of [['ENOTFOUND', 'source_dns_error'], ['EAI_AGAIN', 'source_dns_error'], ['ECONNRESET', 'source_network_error']]) {
    const f = fixture(() => ({ error: Object.assign(new Error('connection failed'), { code: failure }) }));
    await assert.rejects(f.fetch('https://example.com/'), code(expected));
    assert.equal(f.calls.length, 1);
  }
});

test('NO_PROXY hostname rules preserve explicit proxy configuration', async () => {
  for (const pattern of ['example.com', '.example.com', '*.example.com', '*example.com', '*', 'www.example.com:443']) {
    const host = pattern === 'example.com' ? 'example.com' : 'www.example.com';
    const f = fixture(undefined, { env: { https_proxy: 'http://127.0.0.1:7897', NO_PROXY: pattern } });
    await f.fetch('https://' + host + '/');
    assert.equal(f.calls[0].agent.options.proxyEnv.no_proxy, '*');
  }
  const f = fixture(undefined, { env: { https_proxy: 'http://127.0.0.1:7897', no_proxy: 'example.com:444' } });
  await f.fetch('https://example.com/');
  assert.equal(f.calls[0].agent.options.proxyEnv.no_proxy, 'example.com:444');
});

test('certificate verification failures retain TLS diagnostics and never retry', async () => {
  for (const [codeValue, message] of [
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'self signed certificate'],
    ['INVALID_CA', 'invalid authority'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'invalid hostname'],
    [undefined, 'certificate verification failed'],
  ]) {
    const f = fixture(() => ({ error: Object.assign(new Error(message), { code: codeValue }) }));
    await assert.rejects(f.fetch('https://example.com/'), code('source_tls_error'));
    assert.equal(f.calls.length, 1, message);
  }
});

test('native HTTPS proxy CONNECT delegates hostname resolution to the configured proxy', async () => {
  const targets = [];
  const proxy = createServer();
  proxy.on('connect', (req, socket) => { targets.push(req.url); socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  try {
    const fetch = createSourceFetcher({ env: { HTTPS_PROXY: 'http://127.0.0.1:' + proxy.address().port } });
    await assert.rejects(fetch('https://example.com:8443/'));
    assert.deepEqual(targets, ['example.com:8443']);
  } finally { await new Promise(resolve => proxy.close(resolve)); }
});

test('response size is bounded without connection retries', async () => {
  const f = fixture(() => ({ chunks: [Buffer.alloc(2 * 1024 * 1024), Buffer.from('overflow')] }));
  await assert.rejects(f.fetch('https://example.com/'), code('source_too_large'));
  assert.equal(f.calls.length, 1);
});

test('deadline bounds the request and cancellation preserves the caller reason', async () => {
  const f = fixture(async () => { await delay(50); return { body: 'late' }; }, { timeoutMs: 10 });
  await assert.rejects(f.fetch('https://example.com/'), code('source_timeout'));
  assert.equal(f.calls.length, 1);
  const controller = new AbortController(), reason = new Error('caller canceled');
  const canceled = fixture(async () => { await delay(50); return { body: 'late' }; });
  const pending = canceled.fetch('https://example.com/', controller.signal);
  setTimeout(() => controller.abort(reason), 5);
  await assert.rejects(pending, error => error === reason);
});

test('default sources allow real local HTTP and ignore obsolete restricted options', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/') { res.writeHead(302, { Location: '/result' }); res.end(); }
    else { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('local source'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  try {
    const fetch = createSourceFetcher({ env: {} });
    for (const legacy of [undefined, { unrestricted: false }]) {
      const data = await fetch(url, undefined, legacy);
      assert.equal(data.text, 'local source');
      assert.equal(data.url, url + 'result');
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
