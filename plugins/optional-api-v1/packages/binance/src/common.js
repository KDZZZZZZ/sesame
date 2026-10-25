import { createHash } from 'node:crypto';
import { check, digest, decimal } from '@sesame/plugin-sdk/protocol';
import { Decimal } from '@sesame/plugin-sdk/decimal';

export { check, digest, decimal, Decimal };
export const value = value => ({ status: 'value', value });
export const unknown = reason => ({ status: 'unknown', reason });
export const na = () => ({ status: 'not_applicable' });
export const utc = unixMs => { check(Number.isSafeInteger(unixMs) && unixMs >= 0, 'Invalid Binance timestamp', 'INVALID_PROVIDER_DATA'); return { basis: 'utc', unixMs }; };
export const ENVIRONMENTS = Object.freeze({
  production: { public: 'https://data-api.binance.vision', signed: 'https://api.binance.com', websocket: 'wss://data-stream.binance.vision' },
  testnet: { public: 'https://testnet.binance.vision', signed: 'https://testnet.binance.vision', websocket: 'wss://stream.testnet.binance.vision' },
});
export const environment = name => { check(Object.hasOwn(ENVIRONMENTS, name), 'Choose production or testnet explicitly', 'INVALID_ARGUMENT'); return name; };
export const sourceId = env => `binance:${environment(env)}:spot`;
export const connection = env => ({ id: sourceId(env), revision: 'spot-v1' });
export function settings(env = process.env) {
  const name = environment(env.BINANCE_ENVIRONMENT || 'testnet');
  return { environment: name, apiKey: env.BINANCE_API_KEY || '', secret: env.BINANCE_API_SECRET || '' };
}
export function credentialIdentity(config) {
  check(config.apiKey && config.secret, 'Configure Binance API key and HMAC secret in 配置与密钥', 'AUTH_REQUIRED');
  // A connection revision is an opaque key identity, never the key or signature.
  return { connectionId: sourceId(config.environment), revision: createHash('sha256').update(config.apiKey).update('\0').update(config.secret).digest('hex') };
}
export const same = (a, b) => digest(a) === digest(b);
export function amount(text, positive = false) {
  check(typeof text === 'string' && text.length <= 64 && /^(0|[1-9]\d*)(\.\d+)?$/.test(text), 'Use an exact nonnegative decimal string', 'INVALID_ARGUMENT');
  check(!positive || Decimal.compare(text, '0') > 0, 'Amount must be positive', 'INVALID_ARGUMENT');
  return text;
}
export function nativeId(id) {
  check(typeof id === 'string' && /^\d{1,30}$/.test(id) || Number.isSafeInteger(id) && id >= 0, 'Native identifier is not exact', 'INVALID_PROVIDER_DATA');
  return String(id);
}
export const metadata = (observedAt, freshness = 'live', extra = {}) => ({ observedAt, freshness, origin: 'observed', consistency: 'bounded', warnings: [], ...extra });
export const safeError = error => ({ code: error?.code ?? 'SOURCE_UNAVAILABLE', message: String(error?.safeMessage ?? 'Binance operation did not complete'), ...(error?.nativeCode === undefined ? {} : { nativeCode: error.nativeCode }), ...(error?.retryAt === undefined ? {} : { retryAt: error.retryAt }) });
export function failure(code, message, details = {}) { return Object.assign(new Error(message), { code, safeMessage: message, ...details }); }
export const abortableDelay = (ms, signal) => new Promise((resolve, reject) => {
  signal?.throwIfAborted();
  const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
  signal?.addEventListener('abort', abort, { once: true });
});
