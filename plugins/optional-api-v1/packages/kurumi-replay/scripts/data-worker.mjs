// Node subprocess isolates uninterruptible third-party LZMA processing. Parent
// kills this process on abort/timeout. Only this explicitly invoked worker loads
// the storage-local pinned dukascopy-node public APIs.
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { downloadDetail, preflightBi5 } from './data-detail.mjs';
import { Budget, HOUR, config, hash, safePath, decimal, fail, joinChapter } from './data-core.mjs';

import { cachedMarketFile } from './data-cache.mjs';
import { installDependencies } from './data-install.mjs';

const marketTransport = { scope: 'this preparation: native H1 + fine data, quote_ticks only; no M1 fallback; excludes npm', attempts: 0, observedBodyBytes: 0, cacheHits: 0, objectsDeliveredOrReused: 0 };
function transport(t) { marketTransport.attempts += t.attempts; marketTransport.observedBodyBytes += t.networkBytes; marketTransport.cacheHits += t.cacheHit ? 1 : 0; marketTransport.objectsDeliveredOrReused += t.delivered ? 1 : 0; }
async function run(root, stage, mode) {
  const { value: cfg, digest: configDigest } = await config();
  if (mode === 'dependencies') { await installDependencies(root, stage, cfg); return; }
  const require = createRequire(path.join(root, 'deps', 'loader.cjs'));
  const duka = require(path.join(root, 'deps/node_modules/dukascopy-node/dist/index.js'));
  const lzma = require(path.join(root, 'deps/node_modules/lzma-purejs-requirejs/main.js'));
  const packageJson = JSON.parse(await fs.readFile(await safePath(root, 'deps/node_modules/dukascopy-node/package.json'), 'utf8'));
  if (packageJson.version !== cfg.toolchain.version) fail('DEPENDENCY_MISMATCH', 'dukascopy-node 精确版本不匹配。');
  const budget = await Budget.create(root); const series = {}, artifacts = [], raw = [], records = {};
  for (const ch of cfg.chapters) for (const symbol of ch.fxSymbol ? [ch.symbol, ch.fxSymbol] : [ch.symbol]) for (const side of ['bid', 'ask']) {
    const query = { instrument: symbol.toLowerCase(), dates: { from: ch.from, to: ch.playFrom },
      timeframe: 'h1', priceType: side, utcOffset: 0, volumes: true, volumeUnits: 'millions', ignoreFlats: true, format: 'json',
      useCache: false, batchSize: 1, pauseBetweenBatchesMs: 1000, retryCount: 0, retryOnEmpty: false, failAfterRetryCount: true };
    const validated = duka.validateConfigNode(query);
    if (!validated.isValid) fail('INVALID_QUERY', '公开 Dukascopy API 拒绝查询。', { errors: validated.validationErrors });
    const [startDate, endDate] = duka.normaliseDates({ instrument: query.instrument, startDate: new Date(ch.from), endDate: new Date(query.dates.to), timeframe: 'h1', utcOffset: 0 });
    if (+startDate !== Date.parse(ch.from) || +endDate !== Date.parse(query.dates.to)) fail('TIME_MISMATCH', '上游修改了查询日期；暂停。');
    const urls = duka.generateUrls({ instrument: query.instrument, timeframe: 'h1', priceType: side, startDate, endDate });
    if (urls.length !== 1 || !urls.every(url => /^https:\/\/datafeed\.dukascopy\.com\/datafeed\/[A-Z]+\/\d{4}\/\d{2}\/(BID|ASK)_candles_hour_1\.bi5$/.test(url))) fail('INVALID_QUERY', '仅允许本窗口的原生 H1 月度文件；不允许 M1/tick。');
    const buffers = [], sources = [];
    for (const canonicalUrl of urls) {
      const url = cfg.provider.source + canonicalUrl.slice('https://datafeed.dukascopy.com/datafeed'.length);
      const response = await cachedMarketFile(root, url, 2 * 1024 * 1024, { budget, minimumSpacingMs: 250, allowHttpsRedirect: cfg.provider.marketTransport.allowSameOriginHttpsRedirect, allowHttp: cfg.provider.marketTransport?.scheme === 'http', onTransport: transport, validate: bytes => { if (bytes.length) preflightBi5(bytes, 4 * 1024 * 1024, lzma, url); } });
      if (!response.bytes.length) fail('MISSING_DATA', 'Dukascopy 返回空 H1 月度文件；暂停。', { url });
      // LZMA header states unpacked bytes: bound it before third-party decoder.
      preflightBi5(response.bytes, 4 * 1024 * 1024, lzma, url);
      const ref = await budget.write(`${stage}/raw/${symbol}-${side}.bi5`, response.bytes);
      const record = { ...ref, url: response.url, requestedUrl: url, redirectHistory: response.redirectHistory, observedAt: response.observedAt, httpStatus: response.status, transportScheme: response.transport, tlsAuthenticated: response.tlsAuthenticated, responseHeaders: response.responseHeaders, canonicalUrl, format: 'Dukascopy BI5/LZMA native monthly H1', query, transport: { attempts: response.attempts, networkBytes: response.networkBytes, reused: response.reused, cache: response.cache } };
      sources.push(record); raw.push(record); artifacts.push(ref); buffers.push({ url, buffer: response.bytes });
    }
    const numbers = duka.processData({ instrument: query.instrument, requestedTimeframe: 'h1', bufferObjects: buffers, priceType: side, volumes: true, volumeUnits: 'millions', ignoreFlats: true });
    const digits = symbol === ch.symbol ? ch.digits : ch.fxDigits;
    const rows = numbers.filter(row => row[0] >= +startDate && row[0] < +endDate).map(row => ({ time: row[0],
      open: decimal(row[1], digits), high: decimal(row[2], digits), low: decimal(row[3], digits), close: decimal(row[4], digits), source: { basis: 'native preheat H1', artifacts: sources.map(x => x.path) } }));
    const record = { schemaVersion: 1, symbol, side, query, digits, observedAt: new Date().toISOString(), sources, rows };
    records[`${symbol}-${side}`] = record;
  }
  const detail = await downloadDetail(root, stage, cfg, duka, lzma, transport);
  // Rebuild budget after detail worker writes, then publish actual source-derived
  // H1 viewing rows. Formal matching consumes detail.chunks, not these extremes.
  const finalBudget = await Budget.create(root);
  for (const [key, record] of Object.entries(records)) {
    record.rows.push(...detail.derived[key]);
    record.watchingOnly = true;
    record.projection = { warmup: 'native H1', gameplay: detail.summary.kind, fineSources: detail.chunks.filter(x => x.symbol === record.symbol).map(x => ({ path: x.path, digest: x.digest })) };
    const ref = await finalBudget.json(`${stage}/series/${key}.json`, record);
    artifacts.push(ref); series[key] = { ...ref, rowCount: record.rows.length, query: record.query, observedAt: record.observedAt };
  }
  const joined = cfg.chapters.map(ch => joinChapter(ch, Object.fromEntries(Object.entries(records).map(([k, r]) => [k, r.rows]))));
  await finalBudget.json(`${stage}/download.json`, { schemaVersion: 1, configDigest, series, artifacts, raw, chapterCoverage: joined.map(x => x.chapter), transportSummary: marketTransport, execution: { chunks: detail.chunks, raw: detail.raw, summary: detail.summary, fallback: detail.fallback, requestLoad: detail.requestLoad, forFormalEngine: true, h1WatchingOnly: true } });
}
run(process.argv[2], process.argv[3], process.argv[4]).catch(async e => {
  const error = { code: e.code || 'DOWNLOAD_PAUSED', message: e.message || String(e), details: { ...e.details, marketTransport }, paused: true };
  console.error(JSON.stringify(error)); process.exitCode = 1;
});
