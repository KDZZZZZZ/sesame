// All hand-written quote fixtures below are SYNTHETIC UNIT TEST INPUTS, never
// downloads, role inputs, installed content, market evidence or published data.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { prepareData, loadData, clearData, loadExecutionSlice } from '../data.js';
import { config, storage, scan, Budget, hash, safePath, decimal, HOUR, LIMIT, closedHour, joinChapter } from '../scripts/data-core.mjs';
import { unpackTar, verifyDependencies } from '../scripts/data-install.mjs';
import { aggregateQuotes, candidateLoad, validateExecutionInventory, assertBi5, preflightBi5 } from '../scripts/data-detail.mjs';

const cfg = (await config()).value;
const failure = code => e => e.paused === true && e.code === code;
async function temp(t) {
  const p = await fs.mkdtemp(path.join(os.tmpdir(), 'kurumi-data-unit-'));
  t.after(() => fs.rm(p, { recursive: true, force: true })); return p;
}
const fixture = time => ({ time, open: '1.00000', high: '1.00100', low: '0.99900', close: '1.00050' });
function shortChapter() {
  return { ...cfg.chapters[2], from: '2015-01-12T00:00:00.000Z', to: '2015-01-12T01:00:00.000Z', fxDigits: 5 };
}
function fixtureSeries(ch) {
  const rows = [fixture(Date.parse(ch.from)), fixture(Date.parse(ch.to))];
  return Object.fromEntries(['EURCHF-bid', 'EURCHF-ask', 'CHFJPY-bid', 'CHFJPY-ask'].map(k => [k, structuredClone(rows)]));
}

test('exact requested UTC windows, play origins and inclusive endpoints', () => {
  assert.deepEqual(cfg.chapters.map(x => [x.symbol, x.from, x.to, x.playFrom]), [
    ['AUDJPY', '2014-05-12T00:00:00.000Z', '2014-05-30T21:00:00.000Z', '2014-05-14T00:00:00.000Z'],
    ['USDJPY', '2014-12-01T00:00:00.000Z', '2014-12-08T21:00:00.000Z', '2014-12-04T00:00:00.000Z'],
    ['EURCHF', '2015-01-08T00:00:00.000Z', '2015-01-16T21:00:00.000Z', '2015-01-12T00:00:00.000Z']
  ]);
  for (const ch of cfg.chapters) assert.equal(Date.parse(ch.from) % HOUR, 0);
  assert.equal(cfg.chapters[2].fxSymbol, 'CHFJPY');
  assert.equal(cfg.audienceOnlyAnchors[0].time, '2014-12-05T13:30:00.000Z');
  assert.equal(cfg.audienceOnlyAnchors[1].time, '2015-01-15T09:30:00.000Z');
  assert.ok(cfg.audienceOnlyAnchors.every(x => x.visibility.startsWith('audience_only')));
});
test('tick and M1 request load is counted, not invented observed byte load', () => {
  const r = candidateLoad(cfg);
  assert.equal(r.tickRequests, 615); assert.equal(r.m1Requests, 0); assert.equal(r.unsupportedM1AlternativeRequests, 58); assert.equal(r.preheatH1Requests, 8);
  assert.equal(cfg.execution.h1Role, 'Agent viewing only; not the formal matching engine');
  assert.equal(cfg.cacheLimitBytes, LIMIT); assert.equal(LIMIT, 1024 ** 3);
});
test('real calendar timestamps: fixed May/December UTC weekend distinction', () => {
  assert.equal(closedHour(Date.parse('2014-05-30T20:00:00Z'), cfg.chapters[0]), false);
  assert.equal(closedHour(Date.parse('2014-05-30T21:00:00Z'), cfg.chapters[0]), true);
  assert.equal(closedHour(Date.parse('2014-12-05T21:00:00Z'), cfg.chapters[1]), false);
  assert.equal(closedHour(Date.parse('2014-12-05T22:00:00Z'), cfg.chapters[1]), true);
  assert.equal(closedHour(Date.parse('2014-12-07T21:00:00Z'), cfg.chapters[1]), true);
  assert.equal(closedHour(Date.parse('2014-12-07T22:00:00Z'), cfg.chapters[1]), false);
});
test('synthetic fixture: EURCHF joins CHFJPY at exactly the same UTC hour', () => {
  const ch = shortChapter(), result = joinChapter(ch, fixtureSeries(ch));
  assert.equal(result.frames.length, 2); assert.equal(result.chapter.startIndex, 0); assert.equal(result.chapter.endIndex, 1);
  assert.equal(result.frames[0].time, Date.parse(ch.from)); assert.deepEqual(result.frames[0].fx.bid, result.frames[0].bid);
});
test('synthetic fixture: missing CHFJPY hour pauses, not stale fill or silently dropped EURCHF', () => {
  const ch = shortChapter(), series = fixtureSeries(ch); series['CHFJPY-ask'].pop();
  assert.throws(() => joinChapter(ch, series), failure('MISSING_DATA'));
});
test('synthetic fixture: all feeds missing a weekday hour still pauses', () => {
  const ch = shortChapter(), series = fixtureSeries(ch);
  for (const k of Object.keys(series)) series[k].pop();
  assert.throws(() => joinChapter(ch, series), failure('MISSING_DATA'));
});
test('synthetic fixture: millisecond/hour mismatch and duplicate H1 rejected', () => {
  const ch = shortChapter(), series = fixtureSeries(ch); series['CHFJPY-bid'][0].time += 1;
  assert.throws(() => joinChapter(ch, series), failure('TIME_MISMATCH'));
  const second = fixtureSeries(ch); second['EURCHF-bid'][1].time = second['EURCHF-bid'][0].time;
  assert.throws(() => joinChapter(ch, second), failure('TIME_MISMATCH'));
});
test('fixed Decimal strings preserve Dukascopy native precision without exponents', () => {
  assert.equal(decimal(98.001, 3), '98.001'); assert.equal(decimal(1.20001, 5), '1.20001');
  assert.throws(() => decimal(NaN, 3), failure('INVALID_PRICE'));
  assert.throws(() => decimal(1.123456, 3), failure('INVALID_PRICE'));
});
test('synthetic ticks: H1 projection uses observed bidask quotes, preserves source and duplicate timestamps', () => {
  const t = Date.parse('2015-01-15T09:30:00Z');
  const quotes = [{ time: t, bid: '1.20000', ask: '1.20010', source: 'test-only.bi5' },
    { time: t, bid: '0.90000', ask: '0.90100', source: 'test-only.bi5' },
    { time: t + 1, bid: '1.00000', ask: '1.00100', source: 'test-only.bi5' }];
  const r = aggregateQuotes(quotes, 'test-only observed fixture');
  assert.equal(r.bid[0].open, '1.20000'); assert.equal(r.bid[0].low, '0.90000'); assert.equal(r.bid[0].close, '1.00000');
  assert.equal(r.ask[0].low, '0.90100'); assert.deepEqual(r.bid[0].source.artifacts, ['test-only.bi5']);
  assert.equal(r.bid[0].time, Date.parse('2015-01-15T09:00:00Z'));
});
test('synthetic M1: missing minute not fabricated while real H1 extrema retained', () => {
  const t = Date.parse('2015-01-15T09:00:00Z');
  const a = fixture(t), b = fixture(t + 120000);
  const r = aggregateQuotes([{ time: a.time, bid: a, ask: a, source: ['bid-fixture', 'ask-fixture'] },
    { time: b.time, bid: b, ask: b, source: ['bid-fixture', 'ask-fixture'] }], 'test-only M1, not ticks');
  assert.equal(r.bid.length, 1); assert.equal(r.bid[0].source.basis, 'test-only M1, not ticks');
  assert.deepEqual(r.bid[0].source.artifacts, ['bid-fixture', 'ask-fixture']);
});
test('missing formal detail cannot be made ready by H1', () => {
  assert.throws(() => validateExecutionInventory(cfg, { summary: { kind: 'quote_ticks', rows: 0 }, chunks: [], raw: [] }, 'snapshot-fixture'), failure('MISSING_DATA'));
});
test('loadData with no preparation is pure local read and makes no directory', async t => {
  const dir = path.join(await temp(t), 'uncreated');
  await assert.rejects(loadData(dir), failure('NOT_PREPARED'));
  await assert.rejects(fs.stat(dir), { code: 'ENOENT' });
});
test('pre-aborted prepare does not install, fetch or create storage', async t => {
  const dir = path.join(await temp(t), 'uncreated'); const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareData(dir, { signal: controller.signal }), failure('CANCELLED'));
  await assert.rejects(fs.stat(dir), { code: 'ENOENT' });
});
test('hashing actual bytes catches modification', async t => {
  const dir = await temp(t); const root = await storage(dir, true); const b = await Budget.create(root);
  const f = await b.write('test.bin', Buffer.from('fixture-one'));
  assert.equal(f.digest, hash(await fs.readFile(path.join(root, f.path))));
  await fs.writeFile(path.join(root, f.path), 'fixture-two');
  assert.notEqual(f.digest, hash(await fs.readFile(path.join(root, f.path))));
});
async function corruptFixture(t, missing = false) {
  const dir = await temp(t), root = await storage(dir, true), snapshot = `snapshot-${randomUUID()}`;
  const { digest } = await config(); const b = await Budget.create(root);
  const ref = await b.write(`${snapshot}/raw/AUDJPY-bid.bi5`, 'NOT MARKET DATA: hash-check-only fixture');
  const artifacts = [ref, ...Array.from({ length: 15 }, (_, i) => ({ path: `unused-fixture-${i}`, bytes: 0, digest: hash('') }))];
  const file = await b.json(`${snapshot}/download.json`, { configDigest: digest, artifacts, series: {}, testOnly: true });
  await b.json('state.json', { schemaVersion: 1, configDigest: digest, snapshot, downloadDigest: file.digest });
  if (missing) await fs.unlink(path.join(root, ref.path)); else await fs.writeFile(path.join(root, ref.path), 'MODIFIED TEST FIXTURE');
  return dir;
}
test('loadData pauses on raw SHA256 mismatch before exposing any frames', async t => {
  await assert.rejects(loadData(await corruptFixture(t)), failure('HASH_MISMATCH'));
});
test('loadData pauses on missing raw file and never downloads replacement', async t => {
  await assert.rejects(loadData(await corruptFixture(t, true)), failure('MISSING_DATA'));
});
test('1 GiB hard retained file-byte quota; sparse file rejected without reading it; clear works over quota', async t => {
  const dir = await temp(t), root = await storage(dir, true);
  const f = await fs.open(path.join(root, 'large.test'), 'w'); await f.truncate(LIMIT + 1); await f.close();
  await assert.rejects(scan(root), failure('CACHE_LIMIT'));
  await assert.rejects(loadData(dir), failure('CACHE_LIMIT'));
  assert.equal((await clearData(dir)).status, 'cleared'); assert.equal((await scan(root)).bytes, 0);
});
test('Budget refuses a write BEFORE it would exceed quota', async t => {
  const dir = await temp(t), root = await storage(dir, true);
  const f = await fs.open(path.join(root, 'large.test'), 'w'); await f.truncate(LIMIT); await f.close();
  const b = await Budget.create(root);
  await assert.rejects(b.write('extra.test', 'x'), failure('CACHE_LIMIT'));
  await assert.rejects(fs.stat(path.join(root, 'extra.test')), { code: 'ENOENT' });
});
test('symlink/path traversal cannot read/write/clear outside the caller directory', async t => {
  const dir = await temp(t), outside = await temp(t), root = await storage(dir, true);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'must remain');
  await assert.rejects(safePath(root, '../outside'), failure('UNSAFE_PATH'));
  await fs.symlink(outside, path.join(root, 'link'), 'dir');
  await assert.rejects(scan(root), failure('UNSAFE_PATH'));
  await assert.rejects(clearData(dir), failure('UNSAFE_PATH'));
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'must remain');
});
test('clearData deletes only owned cache and preserves caller siblings', async t => {
  const dir = await temp(t); const root = await storage(dir, true);
  await fs.writeFile(path.join(dir, 'caller.txt'), 'keep'); await fs.writeFile(path.join(root, 'own.txt'), 'remove');
  await clearData(dir); assert.equal(await fs.readFile(path.join(dir, 'caller.txt'), 'utf8'), 'keep');
  await assert.rejects(loadData(dir), failure('NOT_PREPARED'));
});
test('prepare/load do not enter an already busy directory', async t => {
  const dir = await temp(t), root = await storage(dir, true); await fs.writeFile(path.join(root, 'prepare.lock'), 'test-only');
  await assert.rejects(prepareData(dir), failure('DATA_BUSY'));
  await assert.rejects(loadData(dir), failure('DATA_BUSY'));
});
test('execution slices require bounded UTC milliseconds and known gameplay intervals', async t => {
  await assert.rejects(loadExecutionSlice(await temp(t), { from: '2015-01-15', to: 1 }), failure('INVALID_SLICE'));
});
function tarFixture(name, body = 'test only', type = '0') {
  const content = Buffer.from(body), h = Buffer.alloc(512);
  h.write(name); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
  h.fill(32, 148, 156); h.write(type, 156); h.write('ustar\0', 257);
  const sum = h.reduce((a, v) => a + v, 0); h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return gzipSync(Buffer.concat([h, content, Buffer.alloc((512 - content.length % 512) % 512), Buffer.alloc(1024)]));
}
test('bounded tar extraction rejects traversal and links, accepts ordinary npm file', () => {
  assert.equal(unpackTar(tarFixture('package/test.txt'))[0].path, 'test.txt');
  assert.throws(() => unpackTar(tarFixture('package/../escape')), failure('UNSAFE_PATH'));
  assert.throws(() => unpackTar(tarFixture('package/link', '', '2')), failure('UNSAFE_PATH'));
});
test('BI5 decoded-length/dictionary budgets checked before third-party decoder', () => {
  const b = Buffer.alloc(13); b.writeUInt32LE(8 * 1024 * 1024, 1); b.writeBigUInt64LE(100n, 5);
  assertBi5(b, 100, 'test-only');
  b.writeBigUInt64LE(101n, 5); assert.throws(() => assertBi5(b, 100, 'test-only'), failure('DECODE_LIMIT'));
});
test('real pinned dukascopy-node public UTC URL generator', { skip: !process.env.KURUMI_DUKASCOPY_PACKAGE_PATH }, () => {
  const require = createRequire(import.meta.url), d = require(process.env.KURUMI_DUKASCOPY_PACKAGE_PATH);
  const from = Date.parse('2014-05-14T00:00:00Z');
  const urls = d.generateUrls({ instrument: 'audjpy', timeframe: 'tick', priceType: 'bid', startDate: new Date(from), endDate: new Date(from + HOUR - 1) });
  assert.deepEqual(urls, ['https://datafeed.dukascopy.com/datafeed/AUDJPY/2014/04/14/00h_ticks.bi5']);
  const h1 = d.generateUrls({ instrument: 'eurchf', timeframe: 'h1', priceType: 'ask', startDate: new Date(cfg.chapters[2].from), endDate: new Date(cfg.chapters[2].playFrom) });
  assert.deepEqual(h1, ['https://datafeed.dukascopy.com/datafeed/EURCHF/2015/00/ASK_candles_hour_1.bi5']);
});
test('real private pinned dependencies verify full installed tree', { skip: !process.env.KURUMI_REAL_DEPENDENCY_STORAGE }, async () => {
  const root = await storage(process.env.KURUMI_REAL_DEPENDENCY_STORAGE, false);
  assert.equal((await verifyDependencies(root, cfg)).packages.length, 25);
});
test('OPT-IN genuine prepared source hashes/time joins/fine data (not a synthetic success)', { skip: !process.env.KURUMI_REAL_STORAGE }, async () => {
  const d = await loadData(process.env.KURUMI_REAL_STORAGE);
  assert.equal(d.chapters.length, 3); assert.equal(d.provenance.kind, 'derived'); assert.equal(d.provenance.inputKind, 'observed');
  assert.equal(d.execution.summary.kind,'quote_ticks');
  assert.deepEqual(d.chapters.map(({leverage,stopout})=>[leverage,stopout]),[['500','0.2'],['25','0.5'],['25','0.3']]);
  assert.ok(Object.isFrozen(d.chapters));assert.ok(d.chapters.every(Object.isFrozen));
  for (let i = 0; i < 3; i++) {
    assert.equal(d.frames[i][d.chapters[i].startIndex].time, Date.parse(cfg.chapters[i].playFrom));
    for (const f of d.frames[i]) { assert.equal(f.time % HOUR, 0); assert.equal(typeof f.bid.open, 'string'); if (i === 2) assert.ok(f.fx.ask.open); }
  }
  const r = await loadExecutionSlice(process.env.KURUMI_REAL_STORAGE, { chapterId: 1, from: Date.parse(cfg.chapters[0].playFrom), to: Date.parse(cfg.chapters[0].playFrom) + HOUR - 1, maxRows: 500000 });
  assert.ok(r.rows.length); assert.equal(r.kind,'ticks');assert.equal(r.dataKind,d.execution.summary.kind);
});

test('role/Agent H1 view excludes future hours, fine quotes, source metadata and audience anchors', async () => {
  const { viewingFramesAt } = await import('../data.js');
  const t = Date.parse('2015-01-15T09:00:00Z');
  const fake = { chapters: [{ id: 3, symbol: 'EURCHF' }], frames: [[{ time: t - HOUR, bid: fixture(0), ask: fixture(0), source: 'test-only' },
    { time: t, bid: fixture(0), ask: fixture(0) }]], provenance: { audienceOnlyAnchors: cfg.audienceOnlyAnchors }, execution: { future: true } };
  const view = viewingFramesAt(fake, { chapterId: 3, asOf: t + 30 * 60000 });
  assert.equal(view.frames.length, 1); assert.equal(view.frames[0].time, t - HOUR);
  assert.equal(view.provenance, undefined); assert.equal(view.execution, undefined); assert.equal(view.frames[0].source, undefined);
  assert.equal(view.watchingOnly, true);
});
test('real pinned decoder on SYNTHETIC binary tick confirms source ask/bid order and UTC ms', { skip: !process.env.KURUMI_DUKASCOPY_PACKAGE_PATH }, () => {
  const require = createRequire(import.meta.url); const d = require(process.env.KURUMI_DUKASCOPY_PACKAGE_PATH);
  const lzmaPath = path.resolve(path.dirname(process.env.KURUMI_DUKASCOPY_PACKAGE_PATH), '../../lzma-purejs-requirejs/main.js');
  const lzma = require(lzmaPath), raw = Buffer.alloc(20);
  raw.writeInt32BE(1234, 0); raw.writeInt32BE(98010, 4); raw.writeInt32BE(98000, 8); raw.writeFloatBE(1, 12); raw.writeFloatBE(2, 16);
  const compressed = Buffer.from(lzma.compressFile(raw));
  assert.equal(preflightBi5(compressed, 20, lzma, 'synthetic tick fixture only'), 20);
  assert.throws(() => preflightBi5(compressed, 19, lzma, 'synthetic tick fixture only'), failure('DECODE_LIMIT'));
  const url = 'https://datafeed.dukascopy.com/datafeed/AUDJPY/2014/04/14/00h_ticks.bi5';
  const rows = d.processData({ instrument: 'audjpy', requestedTimeframe: 'tick', bufferObjects: [{ url, buffer: compressed }],
    priceType: 'bid', volumes: true, volumeUnits: 'millions', ignoreFlats: true });
  assert.equal(rows[0][0], Date.parse('2014-05-14T00:00:00Z') + 1234);
  assert.equal(rows[0][1], 98.01); assert.equal(rows[0][2], 98);
});

// Network reliability tests use local/stub HTTP, not historical market evidence.
const { fetchBounded, retryAfterMilliseconds, backoffDelay } = await import('../scripts/data-core.mjs');
const { cachedMarketFile } = await import('../scripts/data-cache.mjs');
const testUrl = 'https://datafeed.dukascopy.com/datafeed/AUDJPY/2014/04/14/00h_ticks.bi5';
test('Retry-After parses seconds and UTC HTTP date with no early retry', () => {
  const n = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(retryAfterMilliseconds('3', n), 3000);
  assert.equal(retryAfterMilliseconds('Thu, 01 Jan 2026 00:00:05 GMT', n), 5000);
  assert.equal(retryAfterMilliseconds('nonsense', n), null);
});
test('503/429 finite GET backoff respects server minimum, then records actual bytes/attempts', async () => {
  let calls = 0; const delays = [];
  const r = await fetchBounded(testUrl, 100, undefined, { fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response('', { status: 503, headers: { 'Retry-After': '2' } });
    if (calls === 2) return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
    return new Response('SYNTHETIC HTTP TEST BODY');
  }, sleep: async n => delays.push(n) });
  assert.equal(calls, 3); assert.deepEqual(delays, [2000, 2000]);
  assert.equal(r.attempts, 3); assert.equal(r.networkBytes, r.bytes.length);
});
test('network reset gets at most four attempts, never a resolution change', async () => {
  let calls = 0; const delays = [];
  await assert.rejects(fetchBounded(testUrl, 100, undefined, { fetchImpl: async () => {
    calls++; throw Object.assign(new Error('TEST RESET'), { cause: { code: 'ECONNRESET' } });
  }, sleep: async ms => delays.push(ms) }), e => failure('NETWORK_PAUSED')(e) && e.details.attempts === 4);
  assert.equal(calls, 4); assert.deepEqual(delays, [1000, 2000, 4000]);
});
test('404 is a pause with one GET, not infinite retry or empty/zero data', async () => {
  let calls = 0;
  await assert.rejects(fetchBounded(testUrl, 100, undefined, { fetchImpl: async () => { calls++; return new Response('', { status: 404 }); }, sleep: async () => assert.fail('must not sleep') }), failure('NETWORK_PAUSED'));
  assert.equal(calls, 1);
});
test('truncated body is discarded, retried and honestly counted', async () => {
  let calls = 0;
  const r = await fetchBounded(testUrl, 100, undefined, { fetchImpl: async () => new Response(++calls === 1 ? 'x' : 'abcde', { headers: { 'Content-Length': '5' } }), sleep: async () => {} });
  assert.equal(r.bytes.toString(), 'abcde'); assert.equal(r.networkBytes, 6); assert.equal(r.attempts, 2);
});
test('cancellation interrupts a real backoff delay immediately, no further GET', async () => {
  const c = new AbortController(); let calls = 0;
  const began = performance.now(); const timer = setTimeout(() => c.abort(), 20);
  try { await assert.rejects(fetchBounded(testUrl, 100, c.signal, { fetchImpl: async () => { calls++; return new Response('', { status: 503 }); } }), failure('CANCELLED')); }
  finally { clearTimeout(timer); }
  assert.equal(calls, 1); assert.ok(performance.now() - began < 500);
});
test('long Retry-After pauses and persists cooldown, without an early second prepare GET', async t => {
  const root = await storage(await temp(t), true); let calls = 0;
  const opts = { fetchImpl: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '600' } }); }, sleep: async () => assert.fail('too long: pause instead of sleeping/clipping') };
  await assert.rejects(cachedMarketFile(root, testUrl, 100, { fetchOptions: opts }), e => failure('NETWORK_PAUSED')(e) && e.details.retryAfterMs === 600000);
  await assert.rejects(cachedMarketFile(root, testUrl, 100, { fetchOptions: opts }), e => failure('NETWORK_PAUSED')(e) && e.details.cooldown === true && e.details.attempts === 0);
  assert.equal(calls, 1);
});
test('successful URL/body/size/SHA verified cache survives failed stage cleanup and avoids redownload', async t => {
  const dir = await temp(t), root = await storage(dir, true); let calls = 0, checks = 0;
  const options = { fetchOptions: { fetchImpl: async () => { calls++; return new Response('SYNTHETIC CACHE FIXTURE ONLY'); } }, validate: () => checks++ };
  const first = await cachedMarketFile(root, testUrl, 100, options);
  const stage = path.join(root, `snapshot-${randomUUID()}`); await fs.mkdir(stage); await fs.writeFile(path.join(stage, 'test-only'), 'projection that was never published'); await fs.rm(stage, { recursive: true });
  const second = await cachedMarketFile(root, testUrl, 100, options);
  assert.equal(calls, 1); assert.equal(checks, 2); assert.equal(second.reused, true); assert.equal(second.attempts, 0); assert.equal(second.networkBytes, 0);
  assert.equal(first.cache.digest, second.cache.digest); assert.equal(first.observedAt, second.observedAt);
  await assert.rejects(loadData(dir), failure('NOT_PREPARED')); // cached bytes alone MUST NOT make a ready snapshot
});
test('cache tampering pauses before reuse, even if GET adapter could download again', async t => {
  const root = await storage(await temp(t), true); let calls = 0;
  const options = { fetchOptions: { fetchImpl: async () => { calls++; return new Response('SYNTHETIC TEST CACHE'); } } };
  const r = await cachedMarketFile(root, testUrl, 100, options);
  await fs.writeFile(path.join(root, r.cache.body), 'CHANGED TEST CACHE');
  await assert.rejects(cachedMarketFile(root, testUrl, 100, options), failure('HASH_MISMATCH'));
  assert.equal(calls, 1);
});
test('cache URL metadata mismatch is rejected rather than treating SHA alone as provenance', async t => {
  const root = await storage(await temp(t), true);
  const options = { fetchOptions: { fetchImpl: async () => new Response('SYNTHETIC TEST CACHE') } };
  const r = await cachedMarketFile(root, testUrl, 100, options);
  const meta = JSON.parse(await fs.readFile(path.join(root, r.cache.receipt))); meta.url = testUrl.replace('/00h_', '/01h_');
  await fs.writeFile(path.join(root, r.cache.receipt), JSON.stringify(meta));
  await assert.rejects(cachedMarketFile(root, testUrl, 100, options), failure('SOURCE_MISMATCH'));
});
test('pre-cancelled cache resume performs neither GET nor disk writes', async t => {
  const root = await storage(await temp(t), true), c = new AbortController(); c.abort();
  await assert.rejects(cachedMarketFile(root, testUrl, 100, { signal: c.signal, fetchOptions: { fetchImpl: async () => assert.fail('must not GET') } }), failure('CANCELLED'));
  assert.equal((await scan(root)).files.length, 0);
});
test('clear removes resumable raw and dependency cache as well as projections', async t => {
  const dir = await temp(t), root = await storage(dir, true);
  await cachedMarketFile(root, testUrl, 100, { fetchOptions: { fetchImpl: async () => new Response('SYNTHETIC TEST CACHE') } });
  assert.ok((await scan(root)).bytes > 0); await clearData(dir); assert.equal((await scan(root)).bytes, 0);
});
test('Node native fetch actually uses environment HTTP_PROXY; NO_PROXY is honored (local servers only)', { skip: !process.allowedNodeEnvironmentFlags.has('--use-env-proxy') }, async t => {
  const { createServer } = await import('node:http'), { execFile } = await import('node:child_process'), { promisify } = await import('node:util');
  let proxyHits = 0, directHits = 0;
  const proxy = createServer((req, res) => { proxyHits++; assert.equal(req.url, 'http://kurumi-unit.invalid/check'); res.end('LOCAL PROXY UNIT TEST ONLY'); });
  const direct = createServer((req, res) => { if (req.headers.host === 'kurumi-unit.invalid') res.end('LOCAL PROXY UNIT TEST ONLY'); else { directHits++; res.end('LOCAL NO_PROXY UNIT TEST ONLY'); } });
  const { connect } = await import('node:net'); const tunnels = [];
  proxy.on('connect', (req, socket, head) => {
    proxyHits++; assert.equal(req.url, 'kurumi-unit.invalid:80');
    const upstream = connect({ host: '127.0.0.1', port: direct.address().port }, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); tunnels.push(socket, upstream);
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r)); await new Promise(r => direct.listen(0, '127.0.0.1', r));
  t.after(() => { for (const s of tunnels) s.destroy(); proxy.closeAllConnections(); direct.closeAllConnections(); proxy.close(); direct.close(); });
  const core = new URL('../scripts/data-core.mjs', import.meta.url).href;
  const env = { ...process.env, HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`, HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`, http_proxy: `http://127.0.0.1:${proxy.address().port}`, https_proxy: `http://127.0.0.1:${proxy.address().port}`, NODE_USE_ENV_PROXY: '1', ALL_PROXY: '', all_proxy: '', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' };
  const script = `import {fetchBounded} from ${JSON.stringify(core)}; for(const url of ['http://kurumi-unit.invalid/check','http://127.0.0.1:${direct.address().port}/check']) { const r=await fetchBounded(url,100,undefined,{policy:{maxAttempts:1}}); console.log(r.bytes.toString()); }`;
  const r = await promisify(execFile)(process.execPath, ['--use-env-proxy', '--input-type=module', '-e', script], { env, timeout: 10000 });
  assert.ok(r.stdout.includes('LOCAL PROXY UNIT TEST ONLY')); assert.ok(r.stdout.includes('LOCAL NO_PROXY UNIT TEST ONLY'));
  assert.equal(proxyHits, 1); assert.equal(directHits, 1);
});

test('explicit fixed HTTP is labelled unauthenticated; no silent HTTPS claim or generic HTTP permission', async t => {
  const root = await storage(await temp(t), true), url = testUrl.replace('https:', 'http:');
  const fetchOptions = { fetchImpl: async () => new Response('SYNTHETIC HTTP ONLY TEST BODY') };
  await assert.rejects(cachedMarketFile(root, url, 100, { fetchOptions }), failure('SOURCE_MISMATCH'));
  const r = await cachedMarketFile(root, url, 100, { allowHttp: true, fetchOptions });
  assert.equal(r.transport, 'http'); assert.equal(r.tlsAuthenticated, false);
  const meta = JSON.parse(await fs.readFile(path.join(root, r.cache.receipt)));
  assert.equal(meta.url, url); assert.equal(meta.scheme, 'http'); assert.equal(meta.tlsAuthenticated, false);
  assert.equal(cfg.provider.marketTransport.selection.includes('fixed explicit'), true);
  assert.equal(cfg.execution.formalEngine.onlyDataKind, 'quote_ticks'); assert.equal(cfg.execution.fallback, null);
});
test('native CHFJPY as-of join preserves main duplicates and does not leak future FX', async () => {
  const { attachAsOfFX } = await import('../scripts/data-detail.mjs');
  const main = [{ time: 100, bid: '1.00000', ask: '1.00001' }, { time: 100, bid: '1.00001', ask: '1.00002' }, { time: 200, bid: '1.00002', ask: '1.00003' }];
  const fx = [{ time: 90, bid: '110.001', ask: '110.002' }, { time: 150, bid: '110.003', ask: '110.004' }, { time: 201, bid: '999.000', ask: '999.001' }];
  const r = attachAsOfFX(main, fx);
  assert.deepEqual(r.map(x => x.time), [100, 100, 200]); assert.deepEqual(r.map(x => x.fx.time), [90, 90, 150]);
  assert.equal(r[2].fx.bid, '110.003');
  assert.throws(() => attachAsOfFX([{ time: 60091 }], fx.slice(0, 1)), failure('FX_STALE'));
  assert.throws(() => attachAsOfFX([{ time: 89 }], fx), failure('FX_STALE'));
});
test('declared weekend gaps are exact timestamp pairs for native-engine, not generic gap tolerance', () => {
  const ch = { ...cfg.chapters[0], from: '2014-05-16T20:00:00.000Z', playFrom: '2014-05-16T20:00:00.000Z', to: '2014-05-18T22:00:00.000Z', digits: 5 };
  const rows = [fixture(Date.parse(ch.from)), fixture(Date.parse('2014-05-18T21:00:00Z')), fixture(Date.parse(ch.to))];
  const d = joinChapter(ch, { 'AUDJPY-bid': rows, 'AUDJPY-ask': rows });
  assert.equal(d.chapter.weekendGaps.length, 1);
  assert.equal(d.chapter.weekendGaps[0].from, Date.parse(ch.from)); assert.equal(d.chapter.weekendGaps[0].to, Date.parse('2014-05-18T21:00:00Z'));
});
test('OPT-IN genuine supplied HTTP SNB BI5: actual SHA, 973 ticks, UTC ms, bidask and public decoder', { skip: !process.env.KURUMI_REAL_HTTP_PROBE || !process.env.KURUMI_DUKASCOPY_PACKAGE_PATH }, async () => {
  const bytes = await fs.readFile(process.env.KURUMI_REAL_HTTP_PROBE);
  assert.equal(bytes.length, 6162); assert.equal(hash(bytes), 'sha256:3c8a29abfba0ffff4d7d40f70d9968fb6514136419dc0c6949ed638cad82a148');
  const require = createRequire(import.meta.url), d = require(process.env.KURUMI_DUKASCOPY_PACKAGE_PATH);
  const url = 'http://datafeed.dukascopy.com/datafeed/EURCHF/2015/00/15/09h_ticks.bi5';
  const rows = d.processData({ instrument: 'eurchf', requestedTimeframe: 'tick', bufferObjects: [{ url, buffer: bytes }], priceType: 'bid', volumes: true, volumeUnits: 'millions', ignoreFlats: true });
  assert.equal(rows.length, 973); assert.equal(rows[0][0], Date.parse('2015-01-15T09:00:00Z') + 6042);
  assert.equal(decimal(rows[0][1], 5), '1.20102'); assert.equal(decimal(rows[0][2], 5), '1.20094');
  assert.equal(rows.at(-1)[0], Date.parse('2015-01-15T09:00:00Z') + 3551782);
  assert.equal(decimal(rows.at(-1)[1], 5), '1.02857'); assert.equal(decimal(rows.at(-1)[2], 5), '1.02542');
  assert.ok(rows.every((r, i) => Number.isSafeInteger(r[0]) && (!i || r[0] >= rows[i-1][0]) && r[1] >= r[2]));
});

test('HTTP exact-file HTTPS redirect records both URLs; a failed HTTPS follow is NOT repeated', async () => {
  const url = testUrl.replace('https:', 'http:'), calls = [];
  const r = await fetchBounded(url, 100, undefined, { allowHttpsRedirect: true, fetchImpl: async u => {
    calls.push(u); return u === url ? new Response(null, { status: 301, headers: { location: testUrl } }) : new Response('SYNTHETIC TLS RESPONSE TEST');
  }});
  assert.deepEqual(calls, [url, testUrl]); assert.equal(r.url, testUrl); assert.equal(r.requestedUrl, url);
  assert.equal(r.transport, 'https'); assert.equal(r.tlsAuthenticated, true); assert.equal(r.redirectHistory[0].status, 301);
  let n = 0;
  await assert.rejects(fetchBounded(url, 100, undefined, { allowHttpsRedirect: true, fetchImpl: async u => {
    n++; if (u === url) return new Response(null, { status: 301, headers: { location: testUrl } }); const e = new TypeError('SYNTHETIC RESET'); e.cause = {code:'ECONNRESET'}; throw e;
  }}), e => e.code === 'NETWORK_PAUSED' && e.details.attempts === 2 && e.details.url === testUrl);
  assert.equal(n, 2);
});
test('HTTP redirect cannot switch origin/path or escape to a different source', async () => {
  let n = 0;
  await assert.rejects(fetchBounded(testUrl.replace('https:', 'http:'), 100, undefined, { allowHttpsRedirect: true, fetchImpl: async () => {
    n++; return new Response(null, { status: 301, headers: { location: 'https://other.invalid/foo.bi5' } });
  }}), e => e.code === 'NETWORK_PAUSED' && e.details.status === 301);
  assert.equal(n, 1);
});

test('resumed same-file HTTPS-follow cache retains effective URL and explicit TLS label', async t => {
  const root = await storage(await temp(t), true), requested = testUrl.replace('https:', 'http:'); let calls = 0;
  const options = { allowHttp: true, allowHttpsRedirect: true, fetchOptions: { fetchImpl: async u => {
    calls++; return u === requested ? new Response(null, {status:301,headers:{location:testUrl}}) : new Response('SYNTHETIC CACHE TLS FOLLOW BODY');
  }}};
  const first = await cachedMarketFile(root, requested, 100, options), second = await cachedMarketFile(root, requested, 100, options);
  assert.equal(calls, 2); assert.equal(first.url, testUrl); assert.equal(second.url, testUrl); assert.equal(second.requestedUrl, requested);
  assert.equal(second.tlsAuthenticated, true); assert.equal(second.transport, 'https'); assert.equal(second.reused, true);
  await assert.rejects(cachedMarketFile(root, requested, 100, {...options,allowHttpsRedirect:false}), failure('SOURCE_MISMATCH'));
});

test('HTTPS native fetch tunnels through environment proxy AND still rejects an untrusted certificate (local fixture)', async t => {
  if (!process.allowedNodeEnvironmentFlags.has('--use-env-proxy')) return t.skip('Node native env proxy unsupported');
  const {execFile} = await import('node:child_process'), {promisify} = await import('node:util');
  const {createServer: tlsServer} = await import('node:https'), {createServer: proxyServer} = await import('node:http'), {connect} = await import('node:net');
  const run=promisify(execFile),dir=await fs.mkdtemp('/tmp/kurumi-tls-proxy-unit-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dir,'openssl.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Kurumi synthetic local TLS fixture\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n');
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',path.join(dir,'openssl.cnf'),'-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem')],{timeout:10000});
  const origin=tlsServer({key:await fs.readFile(path.join(dir,'key.pem')),cert:await fs.readFile(path.join(dir,'cert.pem'))},(_,res)=>res.end('SYNTHETIC LOCAL VALIDATED TLS TEST ONLY'));
  const proxy=proxyServer();let connects=0;const sockets=[];
  await new Promise(r=>origin.listen(0,'127.0.0.1',r));
  proxy.on('connect',(req,socket,head)=>{connects++;assert.equal(req.url,`127.0.0.1:${origin.address().port}`);const upstream=connect({host:'127.0.0.1',port:origin.address().port},()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());sockets.push(socket,upstream);});
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const s of sockets)s.destroy();origin.closeAllConnections();proxy.closeAllConnections();origin.close();proxy.close();});
  const proxyUrl=`http://127.0.0.1:${proxy.address().port}`,core=new URL('../scripts/data-core.mjs',import.meta.url).href;
  const env={...process.env,HTTP_PROXY:proxyUrl,HTTPS_PROXY:proxyUrl,http_proxy:proxyUrl,https_proxy:proxyUrl,NO_PROXY:'',no_proxy:'',NODE_USE_ENV_PROXY:'1',NODE_EXTRA_CA_CERTS:path.join(dir,'cert.pem')};
  const script=`import {fetchBounded} from ${JSON.stringify(core)};try{const r=await fetchBounded('https://127.0.0.1:${origin.address().port}/',100,undefined,{policy:{maxAttempts:1}});console.log(JSON.stringify({ok:true,body:r.bytes.toString(),tlsAuthenticated:r.tlsAuthenticated}));}catch(e){console.log(JSON.stringify({ok:false,code:e.code,cause:e.details?.cause}));}`;
  const trusted=JSON.parse((await run(process.execPath,['--use-env-proxy','--input-type=module','-e',script],{env,timeout:10000})).stdout);
  assert.equal(trusted.ok,true);assert.equal(trusted.tlsAuthenticated,true);assert.equal(trusted.body,'SYNTHETIC LOCAL VALIDATED TLS TEST ONLY');
  const untrustedEnv={...env};delete untrustedEnv.NODE_EXTRA_CA_CERTS;
  const untrusted=JSON.parse((await run(process.execPath,['--use-env-proxy','--input-type=module','-e',script],{env:untrustedEnv,timeout:10000})).stdout);
  assert.equal(untrusted.ok,false);assert.match(untrusted.cause,/SELF_SIGNED|CERT|VERIFY/);assert.equal(connects,2);
  // Local test CA is trusted ONLY by the first local fixture child. Production
  // market workers never get this CA, rejectUnauthorized:false or TLS-disable.
});

test('frozen chapter leverage/stopout are fractions, not global25/50; bounded25-minute explicit prepare', async () => {
  const {PREPARE_TIMEOUT_MS}=await import('../scripts/data-core.mjs');
  assert.deepEqual(cfg.chapters.map(({leverage,stopout})=>[leverage,stopout]),[['500','0.2'],['25','0.5'],['25','0.3']]);
  assert.equal(PREPARE_TIMEOUT_MS,1500000);assert.equal(cfg.preparation.timeoutMs,PREPARE_TIMEOUT_MS);assert.equal(cfg.preparation.downloadConcurrency,1);
  const ch=shortChapter(),joined=joinChapter(ch,fixtureSeries(ch));assert.equal(joined.chapter.leverage,'25');assert.equal(joined.chapter.stopout,'0.3');
  const {viewingFramesAt}=await import('../data.js');const view=viewingFramesAt({chapters:[joined.chapter],frames:[joined.frames]},{chapterId:3,asOf:Date.parse(ch.to)+HOUR});
  assert.equal(view.leverage,'25');assert.equal(view.stopout,'0.3');
});

test('OPT-IN GENUINE cached SNB: pure local loadExecutionSlice diagnostic, inclusive endpoints, no partial-ready publication', {skip:!process.env.KURUMI_REAL_CACHE_STORAGE}, async()=>{
  const dir=process.env.KURUMI_REAL_CACHE_STORAGE,root=path.join(dir,'kurumi-data-v1'),before=(await fs.readdir(root)).sort();
  const oldFetch=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw new Error('Diagnostic must NEVER fetch');};
  try{
    const hour=Date.parse('2015-01-15T09:00:00Z'),options={chapterId:3,symbol:'EURCHF',from:hour,to:hour+HOUR-1,maxRows:500000,diagnosticOnly:true};
    const full=await loadExecutionSlice(dir,options);assert.equal(full.kind,'inspection_ticks');assert.equal(full.dataKind,'quote_ticks');assert.equal(full.formalReady,false);assert.equal(full.complete,false);assert.equal(full.rows.length,973);
    assert.equal(full.sources[0].digest,'sha256:3c8a29abfba0ffff4d7d40f70d9968fb6514136419dc0c6949ed638cad82a148');assert.equal(full.sources[0].bytes,6162);assert.equal(full.sources[0].tlsAuthenticated,false);
    assert.equal(full.rows[0].time,hour+6042);assert.equal(full.rows[0].bid,'1.20094');assert.equal(full.rows[0].ask,'1.20102');assert.equal(full.rows.at(-1).time,hour+3551782);
    const instant=await loadExecutionSlice(dir,{...options,from:full.rows[0].time,to:full.rows[0].time});assert.deepEqual(instant.rows,full.rows.filter(r=>r.time===full.rows[0].time));
    await assert.rejects(loadExecutionSlice(dir,{...options,maxRows:972}),failure('SLICE_LIMIT'));
    await assert.rejects(loadExecutionSlice(dir,{...options,to:hour+6041}),failure('NO_QUOTES'));
    assert.equal(network,0);assert.deepEqual((await fs.readdir(root)).sort(),before);
    if(!before.includes('state.json'))await assert.rejects(loadData(dir),failure('NOT_PREPARED'));
  }finally{globalThis.fetch=oldFetch;}
});
