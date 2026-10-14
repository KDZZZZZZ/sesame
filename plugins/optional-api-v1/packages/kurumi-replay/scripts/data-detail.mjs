// Fine data for a separate formal engine, not an H1 matching implementation.
import * as fs from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { cachedMarketFile } from './data-cache.mjs';
import { Budget, LIMIT, HOUR, closedHour, decimal, fail, safePath, scan, validMarketSource } from './data-core.mjs';
const DAY = 24 * HOUR;
const stamp = t => new Date(t).toISOString();
const dateKey = t => stamp(t).replace(/[-:.]/g, '').slice(0, 13);
const scaled = s => BigInt(s.replace('.', ''));
export function aggregateQuotes(quotes, basis) {
  const bid = [], ask = [];
  let group, previous = -Infinity;
  function flush() {
    if (!group) return;
    for (const [side, list] of [['bid', bid], ['ask', ask]]) {
      list.push({ time: group.time, ...group[side], source: { basis, artifacts: [...group.sources] } });
    }
  }
  for (const q of quotes) {
    if (!Number.isSafeInteger(q.time) || q.time < previous) fail('TIME_MISMATCH', '细数据 UTC 时间必须非递减。');
    previous = q.time;
    const hour = Math.floor(q.time / HOUR) * HOUR;
    if (group?.time !== hour) { flush(); group = { time: hour, sources: new Set(), bid: null, ask: null }; }
    for (const side of ['bid', 'ask']) {
      const v = typeof q[side] === 'string' ? { open: q[side], high: q[side], low: q[side], close: q[side] } : q[side];
      if (!group[side]) group[side] = { ...v };
      else {
        const g = group[side];
        if (scaled(v.high) > scaled(g.high)) g.high = v.high;
        if (scaled(v.low) < scaled(g.low)) g.low = v.low;
        g.close = v.close;
      }
    }
    for (const source of Array.isArray(q.source) ? q.source : [q.source]) group.sources.add(source);
  }
  flush(); return { bid, ask };
}
export function assertBi5(bytes, maxDecodedBytes, url) {
  if (bytes.length < 13 || bytes.readUInt32LE(1) > 64 * 1024 * 1024 || (bytes.readBigUInt64LE(5) !== 0xffffffffffffffffn && bytes.readBigUInt64LE(5) > BigInt(maxDecodedBytes))) fail('DECODE_LIMIT', 'BI5 解压长度异常或超过预算；不执行解码。', { url, maxDecodedBytes });
}
export function preflightBi5(bytes, maxDecodedBytes, lzma, url) {
  assertBi5(bytes, maxDecodedBytes, url);
  // FORMAT_ALONE permits an unknown-size all-FF header. Accept it, but enforce
  // an actual streaming decoded-byte budget before dukascopy-node allocates.
  let count = 0;
  lzma.decompressFile(bytes, { writeByte() {
    count++;
    if (count > maxDecodedBytes) fail('DECODE_LIMIT', 'BI5 实际解压流超过预算。', { url, maxDecodedBytes });
  } });
  return count;
}
function urlsFor(duka, symbol, side, timeframe, from, endExclusive, source) {
  // v1.46.4's tick generator advances the end-hour when span <= 1h. Give
  // generator endExclusive-1ms, then independently filter the logical [from,to).
  const end = timeframe === 'tick' ? endExclusive - 1 : endExclusive;
  const urls = duka.generateUrls({ instrument: symbol.toLowerCase(), timeframe, priceType: side,
    startDate: new Date(from), endDate: new Date(end) });
  if (urls.length !== 1) fail('INVALID_QUERY', '细数据一次只取一个原生 H1 tick/M1 day artifact。');
  const u = urls[0];
  if (!u.startsWith('https://datafeed.dukascopy.com/datafeed/') || !u.endsWith(timeframe === 'tick' ? 'h_ticks.bi5' : `${side.toUpperCase()}_candles_min_1.bi5`)) fail('INVALID_QUERY', '上游生成了非预期的数据 URL。');
  return urls.map(u => source + u.slice('https://datafeed.dukascopy.com/datafeed'.length));
}
async function artifact(root, budget, stage, rel, url, query, maxDecodedBytes, lzma, onTransport, allowHttp, allowHttpsRedirect) {
  const r = await cachedMarketFile(root, url, 8 * 1024 * 1024, { budget, onTransport, allowHttp, allowHttpsRedirect, minimumSpacingMs: 250, validate: bytes => { if (bytes.length) preflightBi5(bytes, maxDecodedBytes, lzma, url); } });
  if (r.bytes.length) preflightBi5(r.bytes, maxDecodedBytes, lzma, url);
  const ref = await budget.write(`${stage}/execution/raw/${rel}.bi5`, r.bytes);
  return { buffer: r.bytes, ref: { ...ref, url: r.url, requestedUrl: url, redirectHistory: r.redirectHistory, query, observedAt: r.observedAt, httpStatus: 200, transportScheme: r.transport, tlsAuthenticated: r.tlsAuthenticated, responseHeaders: r.responseHeaders, transport: { attempts: r.attempts, networkBytes: r.networkBytes, reused: r.reused, cache: r.cache },
    sourceFormat: query.timeframe === 'tick' ? 'Dukascopy native bidask quote ticks BI5' : 'Dukascopy native single-side M1 BI5' } };
}
function process(duka, symbol, side, timeframe, buffer, url) {
  if (!buffer.length) return [];
  return duka.processData({ instrument: symbol.toLowerCase(), requestedTimeframe: timeframe, bufferObjects: [{ url, buffer }],
    priceType: side, volumes: true, volumeUnits: 'millions', ignoreFlats: true });
}
export function candidateLoad(cfg) {
  let tickRequests = 0, m1Requests = 0;
  for (const ch of cfg.chapters) {
    const days = new Set(); let hours = 0;
    for (let t = Date.parse(ch.playFrom); t <= Date.parse(ch.to); t += HOUR) if (!closedHour(t, ch)) { hours++; days.add(Math.floor(t / DAY)); }
    const count = ch.fxSymbol ? 2 : 1; tickRequests += hours * count; m1Requests += days.size * 2 * count;
  }
  return { selectedExecutionKind: 'quote_ticks', tickRequests, m1Requests: 0, unsupportedM1AlternativeRequests: m1Requests, preheatH1Requests: 8, estimateKind: 'exact request-count under declared weekend convention; tick bytes/counts unknown until observed' };
}
async function retrieve(root, stage, cfg, duka, lzma, kind, onTransport) {
  const budget = await Budget.create(root);
  const chunks = [], raw = [], derived = {}, summary = { kind, rows: 0, networkBytes: 0, requests: 0, cacheHits: 0, sourceObjects: 0 };
  for (const ch of cfg.chapters) for (const symbol of ch.fxSymbol ? [ch.symbol, ch.fxSymbol] : [ch.symbol]) {
    const digits = symbol === ch.symbol ? ch.digits : ch.fxDigits;
    const first = Date.parse(ch.playFrom), last = Date.parse(ch.to) + HOUR;
    const allHourBid = [], allHourAsk = [];
    const step = kind === 'quote_ticks' ? HOUR : DAY;
    const start = kind === 'quote_ticks' ? first : Math.floor(first / DAY) * DAY;
    for (let t = start; t < last; t += step) {
      const from = Math.max(t, first), to = Math.min(t + step, last);
      if (kind === 'quote_ticks' && closedHour(t, ch)) continue;
      if (kind !== 'quote_ticks') {
        let hasOpenHour = false;
        for (let h = from; h < to; h += HOUR) if (!closedHour(h, ch)) hasOpenHour = true;
        if (!hasOpenHour) continue;
      }
      // Reserve for an entire native tick-hour and fallback M1 before ANY write.
      if (kind === 'quote_ticks' && budget.bytes + cfg.execution.projectionSafetyReserveBytes + 24 * 1024 * 1024 > LIMIT)
        fail('TICK_BUDGET_FALLBACK', 'quote_ticks 接近缓存预算；停止正式路径，不使用 M1。', { retainedBytes: budget.bytes, partialNetworkBytes: summary.networkBytes, partialRequests: summary.requests });
      const rows = [], refs = [], tag = `${symbol}-${dateKey(t)}`;
      if (kind === 'quote_ticks') {
        const query = { instrument: symbol.toLowerCase(), timeframe: 'tick', priceType: 'bid', returnedFields: ['ask', 'bid'], quoteSemantics: 'Native tick record contains both sides; the public processor preserves both',
          dates: { from: stamp(from), toExclusive: stamp(to) }, utcOffset: 0, api: 'dukascopy-node generateUrls + processData public API', urlGenerationDates: { startDate: stamp(from), endDate: stamp(to - 1) } };
        const [url] = urlsFor(duka, symbol, 'bid', 'tick', from, to, cfg.provider.source);
        const a = await artifact(root, budget, stage, tag, url, query, 10 * 1024 * 1024, lzma, onTransport, cfg.provider.marketTransport?.scheme === 'http', cfg.provider.marketTransport.allowSameOriginHttpsRedirect);
        refs.push(a.ref); raw.push(a.ref); summary.networkBytes += a.ref.transport.networkBytes; summary.requests += a.ref.transport.attempts; summary.cacheHits += a.ref.transport.reused ? 1 : 0; summary.sourceObjects++;
        const nums = process(duka, symbol, 'bid', 'tick', a.buffer, url);
        let previous = -Infinity;
        for (const v of nums) if (v[0] >= from && v[0] < to) {
          if (!Number.isSafeInteger(v[0]) || v[0] < previous) fail('TIME_MISMATCH', '原始 tick 时间不是 UTC 非递减毫秒。', { url });
          if (v[1] < v[2]) fail('INVALID_PRICE', '实际来源包含 crossed bid/ask；正式引擎不能撮合。', { url, time: v[0] });
          previous = v[0]; rows.push({ time: v[0], bid: decimal(v[2], digits), ask: decimal(v[1], digits), source: a.ref.path });
        }
      } else {
        const sideMaps = {};
        for (const side of ['bid', 'ask']) {
          const query = { instrument: symbol.toLowerCase(), timeframe: 'm1', priceType: side, dates: { from: stamp(from), toExclusive: stamp(to) },
            utcOffset: 0, ignoreFlats: true, api: 'dukascopy-node generateUrls + processData public API' };
          const [url] = urlsFor(duka, symbol, side, 'm1', t, t + DAY, cfg.provider.source);
          const a = await artifact(root, budget, stage, `${tag}-${side}`, url, query, 16 * 1024 * 1024, lzma, onTransport, cfg.provider.marketTransport?.scheme === 'http', cfg.provider.marketTransport.allowSameOriginHttpsRedirect);
          refs.push(a.ref); raw.push(a.ref); summary.networkBytes += a.ref.transport.networkBytes; summary.requests += a.ref.transport.attempts; summary.cacheHits += a.ref.transport.reused ? 1 : 0; summary.sourceObjects++;
          const numbers = process(duka, symbol, side, 'm1', a.buffer, url);
          sideMaps[side] = new Map();
          for (const v of numbers) if (v[0] >= from && v[0] < to) {
            if (!Number.isSafeInteger(v[0]) || v[0] % 60000 || sideMaps[side].has(v[0])) fail('TIME_MISMATCH', 'M1 时间错位或重复。', { url });
            sideMaps[side].set(v[0], { open: decimal(v[1], digits), high: decimal(v[2], digits), low: decimal(v[3], digits), close: decimal(v[4], digits) });
          }
        }
        const times = [...new Set([...sideMaps.bid.keys(), ...sideMaps.ask.keys()])].sort((a, b) => a - b);
        for (const time of times) {
          if (!sideMaps.bid.has(time) || !sideMaps.ask.has(time)) fail('MISSING_DATA', 'M1 bid/ask 不在同一分钟；暂停，不补值。', { symbol, time });
          rows.push({ time, bid: sideMaps.bid.get(time), ask: sideMaps.ask.get(time), source: refs.map(x => x.path) });
        }
      }
      if (!rows.length) fail('MISSING_DATA', '声明非周末窗口内没有真实细报价；暂停。', { symbol, from: stamp(from), toExclusive: stamp(to), kind });
      if (rows.length > 500000) fail('DECODE_LIMIT', '单细数据块超过 500,000 条；暂停，不截断。');
      const grouped = aggregateQuotes(rows, kind === 'quote_ticks' ? 'H1 derived from observed bidask ticks' : 'H1 derived from observed native M1 bid/ask; not ticks');
      allHourBid.push(...grouped.bid); allHourAsk.push(...grouped.ask);
      const packed = gzipSync(JSON.stringify(rows), { level: 6 });
      if (kind === 'quote_ticks' && budget.bytes + packed.length + cfg.execution.projectionSafetyReserveBytes > LIMIT)
        fail('TICK_BUDGET_FALLBACK', 'quote_ticks 投影超过缓存预算，停止正式路径。', { retainedBytes: budget.bytes, partialNetworkBytes: summary.networkBytes, partialRequests: summary.requests });
      const file = await budget.write(`${stage}/execution/quotes/${tag}.json.gz`, packed);
      chunks.push({ ...file, chapterId: ch.id, symbol, kind, rowCount: rows.length, digits, from: stamp(from), toExclusive: stamp(to),
        firstTime: rows[0].time, lastTime: rows.at(-1).time, sources: refs, quoteTimestampOrder: 'nondecreasing; original duplicate-time order retained',
        missingPolicy: kind === 'quote_ticks' ? 'no quotes fabricated between observed ticks' : 'missing minutes are no-quote intervals; engine must not fill at invented quotes; not a tick path' });
      summary.rows += rows.length;
    }
    derived[`${symbol}-bid`] = allHourBid; derived[`${symbol}-ask`] = allHourAsk;
  }
  return { chunks, raw, derived, summary, fallback: null, requestLoad: candidateLoad(cfg) };
}
export async function downloadDetail(root, stage, cfg, duka, lzma, onTransport) {
  try { return await retrieve(root, stage, cfg, duka, lzma, 'quote_ticks', onTransport); }
  catch (e) {
    if (e.code === 'TICK_BUDGET_FALLBACK' || (e.code === 'CACHE_LIMIT' && e.details?.limit === LIMIT)) {
      fail('QUOTE_TICK_BUDGET', '真实 quote_ticks 超出保留预算；Nautilus 1.231.0 不接受 M1 正式撮合，暂停且保留断点缓存，不宣布可玩。', { ...e.details, nativePlayable: false, m1Used: false });
    }
    throw e;
  }
}

export function validateExecutionInventory(cfg, execution, snapshot) {
  if (execution?.summary?.kind !== 'quote_ticks' || !Array.isArray(execution.chunks) || !Array.isArray(execution.raw)) fail('MISSING_DATA', '缺少正式撮合细数据。');
  const kind = execution.summary.kind, expected = new Map();
  for (const ch of cfg.chapters) for (const symbol of ch.fxSymbol ? [ch.symbol, ch.fxSymbol] : [ch.symbol]) {
    const units = new Map();
    for (let t = Date.parse(ch.playFrom); t <= Date.parse(ch.to); t += HOUR) if (!closedHour(t, ch)) {
      const start = kind === 'quote_ticks' ? t : Math.floor(t / DAY) * DAY;
      units.set(start, true);
    }
    for (const start of units.keys()) {
      const from = Math.max(start, Date.parse(ch.playFrom));
      const to = Math.min(start + (kind === 'quote_ticks' ? HOUR : DAY), Date.parse(ch.to) + HOUR);
      expected.set(`${ch.id}|${symbol}|${stamp(from)}|${stamp(to)}`, false);
    }
  }
  const rawByPath = new Map(execution.raw.map(x => [x.path, x]));
  if (rawByPath.size !== execution.raw.length) fail('SOURCE_MISMATCH', '细数据来源文件重复。');
  const used = new Set(), chunkPaths = new Set(); let rows = 0;
  for (const c of execution.chunks) {
    const key = `${c.chapterId}|${c.symbol}|${c.from}|${c.toExclusive}`;
    if (!expected.has(key) || expected.get(key) || c.kind !== kind || !c.path.startsWith(`${snapshot}/execution/quotes/`) || chunkPaths.has(c.path)) fail('TIME_MISMATCH', '细数据窗口重复、错位或越界。');
    expected.set(key, true); chunkPaths.add(c.path);
    if (!Number.isSafeInteger(c.rowCount) || c.rowCount <= 0 || c.rowCount > 500000 || !Number.isSafeInteger(c.firstTime) || !Number.isSafeInteger(c.lastTime) ||
        c.firstTime < Date.parse(c.from) || c.lastTime >= Date.parse(c.toExclusive) || c.lastTime < c.firstTime) fail('MISSING_DATA', '细报价条数或时间边界无效。');
    if (c.sources?.length !== (kind === 'quote_ticks' ? 1 : 2)) fail('SOURCE_MISMATCH', 'ticks 必须含双侧原始来源；M1 必须含两个真实价格侧。');
    for (const r of c.sources) {
      const actual = rawByPath.get(r.path);
      if (!actual || actual.digest !== r.digest || actual.bytes !== r.bytes || !r.path.startsWith(`${snapshot}/execution/raw/`) ||
          r.httpStatus !== 200 || !Number.isFinite(Date.parse(r.observedAt)) || r.query?.instrument !== c.symbol.toLowerCase() || r.query?.utcOffset !== 0 ||
          r.query?.timeframe !== (kind === 'quote_ticks' ? 'tick' : 'm1') || r.query?.dates?.from !== c.from || r.query?.dates?.toExclusive !== c.toExclusive) fail('SOURCE_MISMATCH', '细报价来源 query/hash/observedAt 不匹配。');
      const d = new Date(c.from);
      const base = `${cfg.provider.source}/${c.symbol}/${d.getUTCFullYear()}/${String(d.getUTCMonth()).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/`;
      const tail = kind === 'quote_ticks' ? `${String(d.getUTCHours()).padStart(2, '0')}h_ticks.bi5` : `${r.query.priceType?.toUpperCase()}_candles_min_1.bi5`;
      if (!validMarketSource(r, base + tail, cfg.provider.marketTransport.allowSameOriginHttpsRedirect)) fail('SOURCE_MISMATCH', '细报价 URL 不是查询对应的真实原生文件。');
      used.add(r.path);
    }
    rows += c.rowCount;
  }
  if ([...expected.values()].some(x => !x) || used.size !== rawByPath.size || rows !== execution.summary.rows) fail('MISSING_DATA', '细数据缺失、存在额外来源或条数不匹配；暂停。');
}

/** Independent CHFJPY stream -> most recent observed quote as of main event.
 * Never interpolate, move a future tick backward, or invent synchronized quotes.
 */
export function attachAsOfFX(main, fx, maxAgeMs = 60000) {
  if (!Array.isArray(main) || !Array.isArray(fx) || maxAgeMs !== 60000) fail('INVALID_NATIVE_STEP', 'Nautilus 协议固定 FX max age = 60000 ms。');
  let cursor = 0, latest, previous = -Infinity;
  for (const q of fx) {
    if (!Number.isSafeInteger(q.time) || q.time < previous) fail('TIME_MISMATCH', 'CHFJPY 必须保留实际 UTC 顺序。');
    previous = q.time;
  }
  previous = -Infinity;
  return main.map(q => {
    if (!Number.isSafeInteger(q.time) || q.time < previous) fail('TIME_MISMATCH', '主报价必须保留实际 UTC 顺序。');
    previous = q.time;
    while (cursor < fx.length && fx[cursor].time <= q.time) latest = fx[cursor++];
    if (!latest || q.time - latest.time > maxAgeMs) fail('FX_STALE', '没有不晚于本事件且年龄 <=60000ms 的真实 CHFJPY 报价；暂停，不补值。', { mainTime: q.time, fxTime: latest?.time, maxAgeMs });
    return { ...q, fx: { time: latest.time, bid: latest.bid, ask: latest.ask, source: latest.source } };
  });
}
