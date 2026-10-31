import { createHash } from 'node:crypto';
import { SOURCE_CREDENTIAL_FIELDS } from './configuration.js';
import { querySource } from './sources.js';

const HOSTS = new Set(['www.sec.gov', 'data.sec.gov', 'financialmodelingprep.com', 'api.stlouisfed.org', 'oauth.reddit.com', 'publicreporting.cftc.gov']);
const SENSITIVE = /^(?:api[_-]?key|access[_-]?token|token|authorization|password|secret)$/i;
const fail = (condition, message, code = 'INVALID_ARGUMENT') => { if (!condition) throw Object.assign(new Error(message), { code }); };
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
let secQueue = Promise.resolve(), secNextAt = 0;

function publicURL(value) {
  try {
    const address = new URL(value);
    if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password) return null;
    // Snapshot matching keys before deletion; mutating a live URLSearchParams
    // iterator can skip consecutive credential parameters.
    const credentialKeys = Array.from(address.searchParams.keys()).filter(key => SENSITIVE.test(key));
    for (const key of credentialKeys) address.searchParams.delete(key);
    address.hash = '';
    return address.href;
  } catch { return null; }
}

function redact(value, secrets) {
  if (typeof value === 'string') {
    let text = value;
    for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
    if (/^https?:\/\//i.test(text)) text = publicURL(text) ?? '[invalid source URL]';
    return text;
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE.test(key) ? '[redacted]' : redact(item, secrets)]));
  return value;
}

async function secSlot(signal) {
  const task = secQueue.catch(() => {}).then(async () => {
    signal?.throwIfAborted();
    const delay = Math.max(0, secNextAt - Date.now());
    if (delay) await new Promise((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(done, delay);
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      signal?.addEventListener('abort', abort, { once: true });
    });
    signal?.throwIfAborted();
    secNextAt = Date.now() + 210;
  });
  secQueue = task;
  return task;
}

// The SEC slot queue belongs to the module, not one service or request. A new
// facade must not bypass the source-wide request interval.
export function createTransport({ credential, now = Date.now, fetch: fetcher = globalThis.fetch, timeoutMs = 15000 }) {
  return {
    async query(args, signal) {
      const sources = [], secrets = [];
      try {
        for (const field of SOURCE_CREDENTIAL_FIELDS[args.provider]) secrets.push(credential(field));
        const get = async (address, { headers = {}, maxBytes = 2 * 1024 * 1024 } = {}) => {
          fail(address.protocol === 'https:' && HOSTS.has(address.hostname) && !address.username && !address.password && (!address.port || address.port === '443'), 'Unsupported source address.', 'SOURCE_ADDRESS_REJECTED');
          if (address.hostname.endsWith('sec.gov')) await secSlot(signal);
          const controller = new AbortController(), abort = () => controller.abort(signal.reason);
          signal?.addEventListener('abort', abort, { once: true });
          const timer = setTimeout(() => controller.abort(new Error('Source timeout.')), timeoutMs);
          let response;
          try {
            signal?.throwIfAborted();
            response = await fetcher(address, { method: 'GET', headers: { Accept: 'application/json', ...headers }, signal: controller.signal, redirect: 'error' });
            fail(response.ok, `Source HTTP ${response.status}.`, `SOURCE_HTTP_${response.status}`);
            fail(!response.headers?.get('content-length') || Number(response.headers.get('content-length')) <= maxBytes, 'Source response exceeds the byte limit.', 'SOURCE_TOO_LARGE');
            const chunks = []; let size = 0;
            fail(response.body?.getReader, 'Source body is unavailable.', 'SOURCE_PAYLOAD_INVALID');
            const reader = response.body.getReader();
            try {
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                size += part.value.byteLength;
                fail(size <= maxBytes, 'Source response exceeds the byte limit.', 'SOURCE_TOO_LARGE');
                chunks.push(Buffer.from(part.value));
              }
            } catch (error) { await reader.cancel().catch(() => {}); throw error; }
            const bytes = Buffer.concat(chunks);
            let data;
            try { data = JSON.parse(bytes.toString('utf8')); } catch { fail(false, 'Source did not return JSON.', 'SOURCE_PAYLOAD_INVALID'); }
            fail(data && typeof data === 'object' && !data['Error Message'] && !data.error && !data.error_code, 'Source returned an error payload.', 'SOURCE_PAYLOAD_INVALID');
            const source = { url: publicURL(address.href), retrieved_at: new Date(now()).toISOString(), response_sha256: hash(bytes), response_bytes: size };
            sources.push(source);
            return { data, source };
          } catch (error) {
            signal?.throwIfAborted();
            if (controller.signal.aborted) throw Object.assign(new Error('Source timeout.'), { code: 'SOURCE_TIMEOUT' });
            throw error;
          } finally { clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort); }
        };
        const result = await querySource(args.provider, args, { credential, get, publicURL, now });
        return { result, sources, redact: value => redact(value, secrets) };
      } catch (error) {
        signal?.throwIfAborted();
        // Network errors can contain a credential-bearing request URL. Return a
        // closed set of codes, never provider text or the thrown error message.
        const code = /^SOURCE_(?:HTTP_\d{3}|CREDENTIAL_MISSING|TOO_LARGE|PAYLOAD_INVALID|ADDRESS_REJECTED|TIMEOUT)$/.test(error?.code ?? '') ? error.code : 'SOURCE_REQUEST_FAILED';
        return { reason: code, sources };
      }
    },
  };
}
