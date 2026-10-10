import { Agent, request as httpsRequest } from 'node:https';
import { Agent as HttpAgent, request as plainHttpRequest } from 'node:http';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { ApiError, requireValue } from './support.js';

const MAX_BYTES = 2 * 1024 * 1024;
const hostname = target => target.hostname.replace(/^\[|\]$/g, '');
const tlsFailure = error => /CERT|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED|INVALID_CA|ISSUER|CRL/i.test(error.code ?? '') || /certificate|\bTLS\b|\bSSL\b/i.test(error.message ?? '');

function proxyEnvironment(target, env) {
  const host = hostname(target).toLowerCase();
  const bypass = (env.no_proxy ?? env.NO_PROXY ?? '').split(',').some(value => {
    const entry = value.trim().toLowerCase();
    if (entry === '*') return true;
    const match = /^(.*?)(?::(\d+))?$/.exec(entry);
    if (!match || match[2] && match[2] !== (target.port || (target.protocol === 'http:' ? '80' : '443'))) return false;
    const pattern = match[1];
    return pattern === host || pattern.startsWith('*.') && host.endsWith(pattern.slice(1)) ||
      pattern.startsWith('.') && host.endsWith(pattern) || pattern.startsWith('*') && host.endsWith(pattern.slice(1));
  });
  return { ...env, ...(bypass ? { no_proxy: '*' } : {}) };
}

export function createSourceFetcher({ request = httpsRequest, httpRequest = plainHttpRequest, env = process.env, timeoutMs = 30000 } = {}) {
  async function read(target, signal) {
    signal.throwIfAborted();
    let agent;
    try { agent = new (target.protocol === 'http:' ? HttpAgent : Agent)({ proxyEnv: proxyEnvironment(target, env), keepAlive: false }); }
    catch { throw new ApiError(502, 'source_proxy_error', '来源代理配置无效；请检查 HTTP(S) 代理设置'); }
    try {
      return await new Promise((resolve, reject) => {
        const host = hostname(target);
        const send = target.protocol === 'http:' ? httpRequest : request;
        const req = send({ protocol: target.protocol, hostname: host, port: Number(target.port) || (target.protocol === 'http:' ? 80 : 443),
          servername: isIP(host) ? '' : host, checkServerIdentity: (_name, cert) => checkServerIdentity(host, cert),
          path: `${target.pathname}${target.search}`, agent, signal,
          headers: { Host: target.host, 'User-Agent': 'Sesame-Research/0.1', Accept: 'text/*,application/json,application/xml', 'Accept-Encoding': 'identity' },
        }, response => {
          if (response.statusCode !== 200) {
            resolve({ status: response.statusCode, headers: response.headers, text: '' }); response.destroy(); return;
          }
          let bytes = 0; const chunks = [];
          response.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > MAX_BYTES) {
              const error = new ApiError(502, 'source_too_large', '来源超过 2 MiB');
              reject(error); req.destroy(error);
            }
            else chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('aborted', () => reject(Object.assign(new Error('响应传输中断'), { code: 'ECONNRESET' })));
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject); req.end();
      });
    } finally { agent.destroy(); }
  }

  return async function fetchSource(url, signal) {
    const activeSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
    try {
      let target = new URL(url);
      for (let redirects = 0; redirects <= 3; redirects++) {
        activeSignal.throwIfAborted();
        requireValue(!target.username && !target.password && ['http:', 'https:'].includes(target.protocol), '只支持 HTTP/HTTPS 来源，URL 不得包含凭据');
        const response = await read(target, activeSignal);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          requireValue(redirects < 3 && response.headers.location, '来源重定向过多', 502, 'source_redirect_error');
          target = new URL(response.headers.location, target); continue;
        }
        requireValue(response.status === 200, `来源返回 HTTP ${response.status}`, 502, 'source_http_error');
        return { url: target.href, content_type: response.headers['content-type'] ?? '', text: response.text };
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (activeSignal.aborted) throw new ApiError(504, 'source_timeout', '来源请求超时（包含 DNS、代理连接与响应读取）');
      if (error instanceof ApiError) throw error;
      if (['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(error.code)) throw new ApiError(502, 'source_dns_error', `来源 DNS 解析失败（${error.code}）`);
      const tls = tlsFailure(error);
      const code = /^[A-Z0-9_]+$/.test(error.code ?? '') ? `（${error.code}）` : '';
      throw new ApiError(502, tls ? 'source_tls_error' : 'source_network_error', `来源${tls ? ' TLS 连接' : '网络连接'}失败${code}`);
    }
  };
}

export const fetchSource = createSourceFetcher();
