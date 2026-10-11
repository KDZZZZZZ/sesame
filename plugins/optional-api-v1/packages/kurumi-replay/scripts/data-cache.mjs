// Whole-object resumable HTTP cache. No range fragments are accepted as market
// evidence. The private URL cache survives failed/cancelled snapshot preparation.
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { abort, fail, hash, Budget, safePath, readBounded, fetchBounded, backoffDelay, validMarketSource } from './data-core.mjs';

async function present(root, rel) {
  try { await fs.stat(await safePath(root, rel)); return true; }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
async function removeFile(root, rel, budget) {
  const p = await safePath(root, rel);
  try { const s = await fs.stat(p); if (!s.isFile()) fail('UNSAFE_PATH', '缓存项必须是普通文件。'); await fs.unlink(p); budget.bytes -= s.size; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
async function atomic(root, rel, bytes, budget) {
  const tmp = `${rel}.tmp-${randomUUID()}`;
  const ref = await budget.write(tmp, bytes);
  let old = 0; try { old = (await fs.stat(await safePath(root, rel))).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.rename(await safePath(root, tmp), await safePath(root, rel)); budget.bytes -= old;
  return { ...ref, path: rel };
}
export async function cachedMarketFile(root, url, maxBytes, { signal, budget, validate, fetchOptions, onTransport, allowHttp = false, minimumSpacingMs = 0, allowHttpsRedirect = false } = {}) {
  abort(signal);
  const parsed = new URL(url);
  if (!['https:', ...(allowHttp ? ['http:'] : [])].includes(parsed.protocol) || parsed.host !== 'datafeed.dukascopy.com' || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/datafeed\/(AUDJPY|USDJPY|EURCHF|CHFJPY)\/\d{4}\/\d{2}\/(?:(BID|ASK)_candles_hour_1|\d{2}\/\d{2}h_ticks|\d{2}\/(BID|ASK)_candles_min_1)\.bi5$/.test(parsed.pathname)) fail('SOURCE_MISMATCH', '断点缓存只接受显式允许的原始 Dukascopy 公共 BI5 URL。');
  budget ||= await Budget.create(root);
  const key = hash(url).slice(7), base = `http-cache/${key}`, body = `${base}.bin`, receipt = `${base}.json`, cooldown = `${base}.retry.json`;
  await safePath(root, `${base}.placeholder`, true);
  // Remove ONLY unfinished atomic writes for this exact URL. They have no
  // published receipt and cannot be mistaken for a successfully cached object.
  for (const name of await fs.readdir(await safePath(root, 'http-cache'))) {
    if (name.startsWith(`${key}.`) && /\.(?:bin|json)\.tmp-[a-f0-9-]{36}$/.test(name)) await removeFile(root, `http-cache/${name}`, budget);
  }
  if (await present(root, receipt)) {
    const metaBytes = await readBounded(root, receipt, 16384);
    let meta; try { meta = JSON.parse(metaBytes); } catch { fail('HASH_MISMATCH', '断点缓存收据损坏；暂停，不能猜测来源。'); }
    if (meta.schemaVersion !== 1 || !validMarketSource({ ...meta, transportScheme: meta.scheme }, url, allowHttpsRedirect) || meta.httpStatus !== 200 || !Number.isSafeInteger(meta.bytes) || meta.bytes < 1 || meta.bytes > maxBytes ||
      !/^sha256:[a-f0-9]{64}$/.test(meta.digest) || !Number.isFinite(Date.parse(meta.observedAt)) || !meta.observedAt.endsWith('Z')) fail('SOURCE_MISMATCH', '断点缓存 URL/大小/hash/UTC 来源记录不匹配。');
    if (!await present(root, body)) fail('MISSING_DATA', '断点缓存收据存在，但原始文件缺失；暂停。');
    const bytes = await readBounded(root, body, maxBytes);
    if (bytes.length !== meta.bytes || hash(bytes) !== meta.digest) fail('HASH_MISMATCH', '断点缓存实际文件 SHA-256/大小不匹配；暂停，不复用。');
    validate?.(bytes);
    onTransport?.({ attempts: 0, networkBytes: 0, cacheHit: true, delivered: true });
    return { bytes, observedAt: meta.observedAt, status: 200, attempts: 0, networkBytes: 0, reused: true,
      url: meta.url, requestedUrl: meta.requestedUrl || meta.url, redirectHistory: meta.redirectHistory || [], transport: meta.scheme, tlsAuthenticated: meta.tlsAuthenticated, responseHeaders: meta.responseHeaders,
      cache: { body, receipt, receiptDigest: hash(metaBytes), digest: meta.digest }, originalTransport: meta.transport };
  }
  if (await present(root, body)) await removeFile(root, body, budget); // no receipt, not a validated success
  if (await present(root, cooldown)) {
    const c = JSON.parse(await readBounded(root, cooldown, 16384));
    if (c.url !== url || !Number.isFinite(Date.parse(c.retryAt))) fail('SOURCE_MISMATCH', 'Retry-After 记录不匹配。');
    if (Date.parse(c.retryAt) > Date.now()) fail('NETWORK_PAUSED', '上游 Retry-After 尚未到期；没有提前重试。', { url, retryAt: c.retryAt, attempts: 0, networkBytes: 0, cooldown: true });
    await removeFile(root, cooldown, budget);
  }
  let r;
  if (minimumSpacingMs) await backoffDelay(minimumSpacingMs, signal);
  try { r = await fetchBounded(url, maxBytes, signal, { ...fetchOptions, allowHttpsRedirect }); }
  catch (e) {
    onTransport?.({ attempts: e.details?.attempts || 0, networkBytes: e.details?.networkBytes || 0, cacheHit: false, delivered: false });
    if (e.code === 'NETWORK_PAUSED' && e.details.retryAt) await atomic(root, cooldown, JSON.stringify({ schemaVersion: 1, url, retryAt: e.details.retryAt }) + '\n', budget);
    throw e;
  }
  onTransport?.({ attempts: r.attempts, networkBytes: r.networkBytes, cacheHit: false, delivered: true });
  validate?.(r.bytes);
  // An empty 200 is evidence of no delivered quotes, not a valid everlasting
  // price object. Caller pauses; next explicit prepare is allowed to try again.
  if (!r.bytes.length) return { ...r, reused: false };
  const bodyRef = await atomic(root, body, r.bytes, budget);
  const meta = { schemaVersion: 1, url: r.url, requestedUrl: url, redirectHistory: r.redirectHistory, httpStatus: r.status, observedAt: r.observedAt, bytes: bodyRef.bytes, digest: bodyRef.digest, responseHeaders: r.responseHeaders, scheme: r.transport, tlsAuthenticated: r.tlsAuthenticated,
    transport: { attempts: r.attempts, networkBytes: r.networkBytes, history: r.history } };
  const metaRef = await atomic(root, receipt, JSON.stringify(meta) + '\n', budget);
  return { ...r, reused: false, cache: { body, receipt, receiptDigest: metaRef.digest, digest: bodyRef.digest } };
}
