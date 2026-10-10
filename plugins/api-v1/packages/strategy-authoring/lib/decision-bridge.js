import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const sameToken = (actual, expected) => {
  const a = Buffer.from(actual ?? ''), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
const view = job => ({ id: job.id, requestId: job.request.requestId, status: job.status, output: job.output, decision: job.decision ?? null, error: job.error ?? null, failurePolicy: job.request.program.failurePolicy });

/** The optional local backend bridge belongs to this plugin, not the frontend
 * contracts. Model work is queued; the HTTP request never waits for inference. */
export async function startDecisionBridge(decisions) {
  const token = randomBytes(32).toString('base64url'), bearer = `Bearer ${token}`;
  const server = createServer(async (request, response) => {
    const reply = (status, value) => { if (!response.destroyed) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value)); } };
    // A native local backend has no browser Origin. Do not turn CORS into a
    // privilege to let arbitrary web pages consume the user's model account.
    if (request.headers.origin || !sameToken(request.headers.authorization, bearer)) { reply(401, { code: 'UNAUTHORIZED' }); request.resume(); return; }
    if (!['POST', 'GET'].includes(request.method)) { reply(405, { code: 'METHOD_NOT_ALLOWED' }); request.resume(); return; }
    let size = 0; const chunks = [];
    try {
      for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) { reply(413, { code: 'RESOURCE_EXHAUSTED' }); request.destroy(); return; } chunks.push(chunk); }
      const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      const url = new URL(request.url, 'http://127.0.0.1'), parts = url.pathname.split('/').filter(Boolean);
      if (request.method === 'GET' && url.pathname === '/health') return reply(200, { status: 'ready', protocol: 'sesame.decision/1', serverTime: Date.now() });
      if (request.method === 'POST' && url.pathname === '/requests') return reply(202, view(decisions.submit(data)));
      if (parts[0] === 'requests' && parts.length === 2 && request.method === 'GET') return reply(200, view(decisions.get(decodeURIComponent(parts[1]))));
      if (request.method === 'POST' && url.pathname === '/cancel') return reply(200, view(decisions.cancel(data.jobId, data.reason ?? 'Backend canceled request', data.asOf)));
      if (request.method === 'POST' && url.pathname === '/invalidate') {
        const job = decisions.get(data.jobId);
        return reply(200, decisions.invalidate(job.request.scope, data.reason ?? 'Backend context changed', data.evidence ?? job.request.inputs.map(input => input.ref), data.asOf));
      }
      if (request.method === 'POST' && url.pathname === '/timeline') {
        const job = decisions.get(data.jobId);
        return reply(200, decisions.timeline(job.request.scope, data.asOf));
      }
      reply(404, { code: 'NOT_FOUND' });
    } catch (error) { reply(error.code === 'RESOURCE_EXHAUSTED' ? 429 : 422, { code: error.code ?? 'INVALID_REQUEST', message: 'Invalid decision request or unavailable job. Check the fixed input contract.' }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000; server.maxConnections = 32;
  await new Promise((resolve, reject) => { const failed = error => { server.removeListener('listening', ready); reject(error); }; const ready = () => { server.removeListener('error', failed); resolve(); }; server.once('error', failed); server.once('listening', ready); server.listen(0, '127.0.0.1'); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return { endpoint, token, protocol: 'sesame.decision/1', async close() { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}
