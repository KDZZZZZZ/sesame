import { isDeepStrictEqual } from 'node:util';
// Native ESM, standard Node APIs only. Import/load do not install or fetch.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { candidateLoad, validateExecutionInventory, attachAsOfFX } from './scripts/data-detail.mjs';
import { PACKAGE, OWNED, LIMIT, HOUR, DataPausedError, fail, hash, abort, config, storage,
  Budget, safePath, readBounded, scan, joinChapter, validMarketSource, PREPARE_TIMEOUT_MS } from './scripts/data-core.mjs';
export { DataPausedError };

async function lock(root) {
  const file = await safePath(root, 'prepare.lock');
  try {
    const fd = await fs.open(file, 'wx');
    await fd.close(); // zero-byte lock cannot push the retained cache over quota
  } catch (e) { if (e.code === 'EEXIST') fail('DATA_BUSY', '另一个准备/清理操作或残留 lock 正占用目录；没有重放下载。'); throw e; }
  return () => fs.unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e; });
}
async function notBusy(root) {
  try { await fs.lstat(await safePath(root, 'prepare.lock')); fail('DATA_BUSY', '数据正在准备或清理；暂停加载。'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
async function exists(root, rel) {
  try { await fs.lstat(await safePath(root, rel)); return true; }
  catch (e) { if (e.code !== 'ENOENT') throw e; return false; }
}
function workerEnvironment(hasProxy) {
  const env = { ...process.env, ...(hasProxy ? { NODE_USE_ENV_PROXY: '1' } : {}), DEBUG: '' };
  // Empty lowercase variables must not suppress a configured uppercase proxy.
  // Normalize ONLY this child environment, never the user's OS/Clash settings.
  for (const [lower, upper] of [['http_proxy', 'HTTP_PROXY'], ['https_proxy', 'HTTPS_PROXY'], ['no_proxy', 'NO_PROXY']]) if (!env[lower] && env[upper]) delete env[lower];
  return env;
}
function worker(root, stage, signal, mode = 'download', timeoutMs = PREPARE_TIMEOUT_MS) {
  abort(signal);
  return new Promise((resolve, reject) => {
    let failure, output = ''; let child;
    // Respect the operator's standard proxy configuration when this Node version
    // supports it. Never print proxy URLs or credentials, or try another feed.
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') { reject(new DataPausedError('TLS_VALIDATION_DISABLED', '拒绝关闭 TLS 校验的取数环境。')); return; }
    const hasProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    if (hasProxy && !process.allowedNodeEnvironmentFlags.has('--use-env-proxy')) { reject(new DataPausedError('PROXY_UNSUPPORTED', '当前 Node 不支持 --use-env-proxy；不能让 fetch 悄悄直连，请使用支持该选项的 Node。')); return; }
    const flags = process.allowedNodeEnvironmentFlags.has('--use-env-proxy') &&
      (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) ? ['--use-env-proxy'] : [];
    try { child = spawn(process.execPath, [...flags, '--max-old-space-size=512', path.join(PACKAGE, 'scripts/data-worker.mjs'), root, stage, mode],
      { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], env: workerEnvironment(hasProxy) }); }
    catch (e) { reject(e); return; }
    const cancel = () => { failure = new DataPausedError('CANCELLED', '准备已取消；没有发布半份数据。'); child.kill('SIGKILL'); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => { failure = new DataPausedError('NETWORK_PAUSED', '显式prepare的25分钟工作预算耗尽；已停止，没有发布半份数据或改源/降为M1。', { phase: 'worker-timeout', timeoutMs, prepareBudgetMs: PREPARE_TIMEOUT_MS }); child.kill('SIGKILL'); }, timeoutMs);
    child.stderr.on('data', chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 16384) { failure = new DataPausedError('OUTPUT_LIMIT', '子进程诊断超过预算；已停止。'); child.kill('SIGKILL'); }
    });
    child.on('error', e => { failure = new DataPausedError('WORKER_PAUSED', `无法运行取数子进程：${e.code || e.message}`); });
    child.on('close', (code, killedSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (failure) { reject(failure); return; }
      if (code === 0) { resolve(); return; }
      try { const e = JSON.parse(output.trim().split('\n').at(-1)); reject(new DataPausedError(e.code, e.message, e.details)); }
      catch { reject(new DataPausedError('DOWNLOAD_PAUSED', 'Dukascopy 解码或取数子进程失败；暂停。', { exitCode: code, signal: killedSignal, diagnostic: output.slice(-2000) })); }
    });
  });
}
function queryFor(ch, symbol, side) {
  return { instrument: symbol.toLowerCase(), dates: { from: ch.from, to: ch.playFrom }, timeframe: 'h1', priceType: side, utcOffset: 0 };
}
async function readSnapshot(root, cfg, configDigest, manifest) {
  if (manifest.schemaVersion !== 1 || manifest.configDigest !== configDigest || !/^snapshot-[a-f0-9-]{36}$/.test(manifest.snapshot)) fail('CONFIG_MISMATCH', '缓存不是当前精确窗口配置；显式 clearData 后才能重新准备。');
  const inventory = await scan(root);
  const downloadBytes = await readBounded(root, `${manifest.snapshot}/download.json`);
  if (hash(downloadBytes) !== manifest.downloadDigest) fail('HASH_MISMATCH', '下载清单 hash 不匹配。');
  const download = JSON.parse(downloadBytes);
  if (download.configDigest !== configDigest || !Array.isArray(download.artifacts) || download.artifacts.length !== 16) fail('HASH_MISMATCH', '来源清单不完整或配置不匹配。');
  const series = {}, references = [];
  const required = [];
  for (const ch of cfg.chapters) for (const symbol of ch.fxSymbol ? [ch.symbol, ch.fxSymbol] : [ch.symbol]) for (const side of ['bid', 'ask']) {
    const key = `${symbol}-${side}`; required.push(key);
    for (const rel of [`${manifest.snapshot}/raw/${key}.bi5`, `${manifest.snapshot}/series/${key}.json`]) {
      const ref = download.artifacts.find(x => x.path === rel);
      if (!ref || download.artifacts.filter(x => x.path === rel).length !== 1) fail('MISSING_DATA', '缺少原始或解析后报价文件；暂停。', { path: rel });
      const bytes = await readBounded(root, rel);
      if (bytes.length !== ref.bytes || hash(bytes) !== ref.digest) fail('HASH_MISMATCH', '真实来源文件 hash/长度不匹配；暂停。', { path: rel });
      references.push(ref);
      if (rel.endsWith('.json')) {
        const r = JSON.parse(bytes); const q = queryFor(ch, symbol, side);
        if (r.symbol !== symbol || r.side !== side || r.digits !== (symbol === ch.symbol ? ch.digits : ch.fxDigits) ||
            !r.query || Object.entries(q).some(([k, v]) => !isDeepStrictEqual(r.query[k],v)) ||
            r.query.ignoreFlats !== true || r.query.volumes !== true || r.query.useCache !== false ||
            !/^\d{4}-\d\d-\d\dT.*Z$/.test(r.observedAt) || !Number.isFinite(Date.parse(r.observedAt))) fail('SOURCE_MISMATCH', '报价文件的 UTC 查询或来源元数据不匹配。', { key });
        if (!Array.isArray(r.sources) || r.sources.length !== 1) fail('SOURCE_MISMATCH', '缺少真实 BI5 来源证据。', { key });
        const source = r.sources[0], rawRef = references.find(x => x.path.endsWith(`/raw/${key}.bi5`));
        const d = new Date(ch.from);
        const url = `${cfg.provider.source}/${symbol}/${d.getUTCFullYear()}/${String(d.getUTCMonth()).padStart(2, '0')}/${side.toUpperCase()}_candles_hour_1.bi5`;
        if (!validMarketSource(source, url, cfg.provider.marketTransport.allowSameOriginHttpsRedirect) || source.path !== rawRef.path || source.digest !== rawRef.digest || source.bytes !== rawRef.bytes || source.httpStatus !== 200 ||
            !Number.isFinite(Date.parse(source.observedAt))) fail('SOURCE_MISMATCH', '原始报价来源 URL/hash/获取时间不匹配。', { key });
        series[key] = r.rows;
      }
    }
  }
  if (Object.keys(download.series).sort().join('|') !== required.sort().join('|')) fail('SOURCE_MISMATCH', '出现非所需窗口品种。');
  const execution = download.execution;
  if (!execution || execution.summary?.kind !== 'quote_ticks' || !Array.isArray(execution.chunks) || !execution.chunks.length || !Array.isArray(execution.raw)) fail('MISSING_DATA', '缺少正式撮合细数据；只有 H1/M1 不能 ready；正式引擎仅接受 quote_ticks。');
  validateExecutionInventory(cfg, execution, manifest.snapshot);
  for (const ref of [...execution.raw, ...execution.chunks]) {
    if (!ref.path.startsWith(`${manifest.snapshot}/execution/`)) fail('UNSAFE_PATH', '细数据引用越界。');
    const bytes = await readBounded(root, ref.path);
    if (bytes.length !== ref.bytes || hash(bytes) !== ref.digest) fail('HASH_MISMATCH', '细报价文件 hash 不匹配。', { path: ref.path });
    if ('kind' in ref && (ref.kind !== execution.summary.kind || !cfg.chapters.some(ch => ch.id === ref.chapterId && [ch.symbol, ch.fxSymbol].includes(ref.symbol)))) fail('SOURCE_MISMATCH', '细数据品种或分辨率不匹配。');
  }
  const joined = cfg.chapters.map(ch => joinChapter(ch, series));
  if (!isDeepStrictEqual(download.chapterCoverage,joined.map(x => x.chapter))) fail('HASH_MISMATCH', '固定章节/周末缺口清单与实际帧不一致。');
  if (!isDeepStrictEqual(manifest.chapterCoverage,download.chapterCoverage)) fail('HASH_MISMATCH', '发布 manifest 的章节缺口记录不一致。');
  const depBytes = await readBounded(root, 'deps/receipt.json');
  if (hash(depBytes) !== manifest.dependencyDigest) fail('HASH_MISMATCH', '依赖出处记录 hash 不匹配。');
  return { storageRoot: root, storageNamespace: OWNED, chapters: Object.freeze(joined.map(x => Object.freeze({ ...x.chapter, watchingOnly: true, executionKind: execution.summary.kind }))), frames: joined.map(x => x.frames), execution,
    digests: { config: configDigest, dependencies: manifest.dependencyDigest, download: manifest.downloadDigest,
      sourceFiles: references, executionFiles: [...execution.raw, ...execution.chunks].map(({path,bytes,digest}) => ({path,bytes,digest})), frames: joined.map(x => hash(JSON.stringify(x.frames))) },
    provenance: { kind: 'derived', inputKind: 'observed', provider: cfg.provider, toolchain: { name: cfg.toolchain.name, version: cfg.toolchain.version,
      sourceCommit: cfg.toolchain.sourceCommit, repository: cfg.toolchain.repository, license: cfg.toolchain.license,
      licenseSource: cfg.toolchain.licenseSource, packages: JSON.parse(depBytes).packages },
      preparedAt: manifest.preparedAt, elapsedMs: manifest.elapsedMs, cacheBytes: inventory.bytes, cacheLimitBytes: LIMIT,
      sources: [...download.raw, ...execution.raw], marketTransport: download.transportSummary, coverage: { policy: 'require every non-weekend hour on every side and FX feed; otherwise pause',
        chapters: download.chapterCoverage, weekendGapsDefinition: 'Only observed Friday->Sunday pairs, 48..50h, all absent hours match declared FX weekend; no weekday gaps', calendar: 'explicit per-window UTC FX weekend convention, not a certified broker calendar', completeAgainstDeclaredCalendar: true, historicalGaplessnessCertified: false },
      decimalProjection: 'native integer price scale via dukascopy-node numeric OHLC; exact scaled-integer check then fixed Decimal strings',
      h1Limitation: 'AGENT VIEWING ONLY, NOT THE FORMAL MATCHING ENGINE; hour opening time; OHLC only observable at time+1h; no within-hour order of quotes, H1 is not an intrahour tick path or certified executable-price stream; execution contains separate fine data',
      audienceOnlyAnchors: cfg.audienceOnlyAnchors, audienceComparison: { originalStoryMarkers: [], status: 'Original narrative markers were not supplied; no invented dialogue or plot timestamps.', officialAnchors: cfg.audienceOnlyAnchors, visibility: 'audience_only' }, playerInputPolicy: 'Do not pass this result wholesale to a role/player: audienceOnlyAnchors, provenance and future frames are controller-only. At decision time T, only completed frames with time+1h <= T may be exposed.' }
  };
}

/** Explicit authorised preparation boundary. Never call from activation/import/load.
 * Caller tool must have obtained fetch/install authorisation before invoking this.
 * Reuses a successful exact snapshot; refresh is explicit clearData + prepareData.
 */
export async function prepareData(storageDirectory, { signal } = {}) {
  const begun = performance.now(); let phase = 'storage', root, release, stage;
  try {
    abort(signal);
    const { value: cfg, digest } = await config();
    if (Number(process.versions.node.split('.')[0]) < 22) fail('NODE_VERSION', '此模块需要 Node.js >=22；不会安装/修改系统 Node。');
    root = await storage(storageDirectory, true); await scan(root); release = await lock(root);
    abort(signal);
    if (await exists(root, 'state.json')) {
      const manifest = JSON.parse(await readBounded(root, 'state.json'));
      const result = await readSnapshot(root, cfg, digest, manifest);
      return { status: 'ready', reused: true, elapsedMs: Math.round(performance.now() - begun), originalPrepareElapsedMs: manifest.elapsedMs,
        cacheBytes: result.provenance.cacheBytes, originalMarketTransport: result.provenance.marketTransport, currentMarketTransport: { attempts: 0, observedBodyBytes: 0, reusedSnapshot: true }, execution: { kind: result.execution.summary.kind, ...result.execution.summary, chunks: result.execution.chunks.length, requestLoad: result.execution.requestLoad, fallback: result.execution.fallback }, chapters: result.chapters.map((ch, i) => ({ id: ch.id, symbol: ch.symbol, leverage: ch.leverage, stopout: ch.stopout, frames: result.frames[i].length, from: ch.from, to: ch.to })), digests: result.digests.frames };
    }
    // Interrupted unpublished projections can be rebuilt from validated HTTP
    // objects; keep the resumable cache and pinned dependencies intact.
    for (const name of await fs.readdir(root)) if (/^snapshot-[a-f0-9-]{36}$/.test(name)) {
      await scan(await safePath(root, name)); await fs.rm(await safePath(root, name), { recursive: true });
    }
    stage = `snapshot-${randomUUID()}`;
    await fs.mkdir(await safePath(root, stage)); phase = 'dependencies';
    const remaining = () => { const ms = PREPARE_TIMEOUT_MS - Math.ceil(performance.now() - begun); if (ms <= 0) fail('NETWORK_PAUSED', '显式prepare的25分钟预算已耗尽；暂停并保留断点。', { phase:'worker-timeout',prepareBudgetMs:PREPARE_TIMEOUT_MS }); return ms; };
    await worker(root, stage, signal, 'dependencies', remaining()); abort(signal);
    const dependency = { digest: hash(await readBounded(root, 'deps/receipt.json')) };
    phase = 'download'; await worker(root, stage, signal, 'download', remaining()); abort(signal);
    phase = 'validation';
    const downloaded = await readBounded(root, `${stage}/download.json`);
    const manifest = { schemaVersion: 1, configDigest: digest, snapshot: stage, downloadDigest: hash(downloaded),
      dependencyDigest: dependency.digest, chapterCoverage: JSON.parse(downloaded).chapterCoverage, preparedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - begun) };
    const result = await readSnapshot(root, cfg, digest, manifest);
    abort(signal); remaining();
    manifest.elapsedMs = Math.round(performance.now() - begun);
    const budget = await Budget.create(root);
    await budget.json(`${stage}/state.next.json`, manifest);
    await fs.rename(await safePath(root, `${stage}/state.next.json`), await safePath(root, 'state.json'));
    stage = null;
    return { status: 'ready', reused: false, elapsedMs: manifest.elapsedMs, cacheBytes: (await scan(root)).bytes,
      marketTransport: result.provenance.marketTransport, dependency: { name: cfg.toolchain.name, version: cfg.toolchain.version, license: cfg.toolchain.license, digest: dependency.digest },
      chapters: result.chapters.map((ch, i) => ({ id: ch.id, symbol: ch.symbol, leverage: ch.leverage, stopout: ch.stopout, frames: result.frames[i].length, from: ch.from, to: ch.to, startIndex: ch.startIndex, endIndex: ch.endIndex })),
      execution: { ...result.execution.summary, chunks: result.execution.chunks.length, requestLoad: result.execution.requestLoad, fallback: result.execution.fallback }, digests: result.digests.frames, note: 'H1 仅观看；正式引擎用 execution 细数据。尚未做宿主安装、角色输入、NautilusTrader 或撮合验证。' };
  } catch (error) {
    if (root && stage) {
      // Our random owned staging directory only; never touch another caller path.
      try { await scan(await safePath(root, stage)); await fs.rm(await safePath(root, stage), { recursive: true, force: true }); }
      catch { /* A safety violation is preserved for explicit operator inspection. */ }
    }
    const e = error instanceof DataPausedError ? error : new DataPausedError(error.code === 'ENOENT' ? 'MISSING_DATA' : 'PREPARE_PAUSED', error.message || String(error));
    e.details = { ...e.details, phase, requestLoad: candidateLoad((await config()).value), elapsedMs: Math.round(performance.now() - begun) }; throw e;
  } finally { if (release) await release(); }
}

/** Pure local read: does not create directories, install, spawn or access network. */
export async function loadData(storageDirectory) {
  try {
    const root = await storage(storageDirectory, false); await notBusy(root); await scan(root);
    const { value: cfg, digest } = await config();
    if (!await exists(root, 'state.json')) fail('NOT_PREPARED', '没有成功的准备快照；请在授权工具调用中显式 prepareData。');
    const result = await readSnapshot(root, cfg, digest, JSON.parse(await readBounded(root, 'state.json')));
    await notBusy(root); return result;
  } catch (e) {
    if (e.code === 'ENOENT') fail('MISSING_DATA', '缓存文件缺失；暂停，不安装、不重抓、不补值。');
    throw e;
  }
}

/** Explicit deletion boundary: only this module's owned cache, not the caller root. */
export async function clearData(storageDirectory) {
  let root;
  try { root = await storage(storageDirectory, false); }
  catch (e) { if (e.code === 'NOT_PREPARED') return { status: 'cleared', deletedBytes: 0 }; throw e; }
  const release = await lock(root);
  try {
    const inventory = await scan(root, '', false);
    for (const entry of await fs.readdir(root)) {
      if (entry === 'prepare.lock') continue;
      await fs.rm(await safePath(root, entry), { recursive: true, force: true });
    }
    return { status: 'cleared', deletedBytes: inventory.bytes, directory: path.join(path.resolve(storageDirectory), OWNED) };
  } finally { await release(); }
}

/** Lazy execution reader. Bounded, verified local slices; never installs/fetches.
 * FX ticks remain independent observed quotes. The engine must never select an
 * FX quote newer than its own event time. Not a simulator or deployment receipt.
 */
export async function loadExecutionSlice(storageDirectory, options = {}) {
  try { return await readExecutionSlice(storageDirectory, options); }
  catch (e) { if (e instanceof DataPausedError) throw e; fail('MISSING_DATA', '本地细数据不可完整验证；暂停，不联网补值。', { cause: e.code || e.name }); }
}
async function readExecutionSlice(storageDirectory, { chapterId, symbol, from, to, maxRows = 100000, diagnosticOnly = false } = {}) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from ||
      !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 500000) fail('INVALID_SLICE', 'from/to 必须是 UTC 毫秒，maxRows 范围为 1..500000。');
  const root = await storage(storageDirectory, false); await notBusy(root); await scan(root);
  const { value: cfg, digest } = await config();
  if (diagnosticOnly === true) { const {inspectCachedHour} = await import('./scripts/data-inspect.mjs'); const result=await inspectCachedHour(root,cfg,{chapterId,symbol,from,to,maxRows});await notBusy(root);return result; }
  if (diagnosticOnly !== false) fail('INVALID_SLICE','diagnosticOnly必须是显式boolean；正式默认路径仍要求完整state。');
  const stateBytes = await readBounded(root, 'state.json'); const state = JSON.parse(stateBytes);
  if (state.schemaVersion !== 1 || state.configDigest !== digest || !Array.isArray(state.chapterCoverage) || state.chapterCoverage.length !== cfg.chapters.length || !/^snapshot-[a-f0-9-]{36}$/.test(state.snapshot)) fail('CONFIG_MISMATCH', '细数据快照配置不匹配。');
  const ch = cfg.chapters.find(c => c.id === chapterId);
  symbol ||= ch?.symbol;
  if (!ch || ![ch.symbol, ch.fxSymbol].includes(symbol) || from < Date.parse(ch.playFrom) || to >= Date.parse(ch.to) + HOUR) fail('INVALID_SLICE', '只可读取指定章节玩法范围内的真实细数据品种。');
  const bytes = await readBounded(root, `${state.snapshot}/download.json`);
  if (hash(bytes) !== state.downloadDigest) fail('HASH_MISMATCH', '细数据清单 hash 不匹配。');
  const execution = JSON.parse(bytes).execution;
  if (!execution?.chunks) fail('MISSING_DATA', '正式撮合细数据缺失；暂停。');
  validateExecutionInventory(cfg, execution, state.snapshot);
  const chunks = execution.chunks.filter(c => c.chapterId === chapterId && c.symbol === symbol && c.firstTime <= to && c.lastTime >= from);
  const rows = [], sources = []; let previous = -Infinity;
  for (const chunk of chunks) {
    if (!chunk.path.startsWith(`${state.snapshot}/execution/quotes/`)) fail('UNSAFE_PATH', '细数据路径越界。');
    const packed = await readBounded(root, chunk.path);
    if (packed.length !== chunk.bytes || hash(packed) !== chunk.digest) fail('HASH_MISMATCH', '细报价块 hash 不匹配。', { path: chunk.path });
    for (const source of chunk.sources) {
      const bytes = await readBounded(root, source.path);
      if (bytes.length !== source.bytes || hash(bytes) !== source.digest) fail('HASH_MISMATCH', '细报价原始来源文件 hash 不匹配。', { path: source.path });
    }
    const block = JSON.parse(gunzipSync(packed, { maxOutputLength: 128 * 1024 * 1024 }));
    if (!Array.isArray(block) || block.length !== chunk.rowCount || block.length > 500000) fail('SOURCE_MISMATCH', '细报价块条数不匹配。');
    let blockPrevious = -Infinity;
    for (const row of block) {
      if (!Number.isSafeInteger(row.time) || row.time < blockPrevious || row.time < Date.parse(chunk.from) || row.time >= Date.parse(chunk.toExclusive)) fail('TIME_MISMATCH', '细报价块原始时间错位。');
      blockPrevious = row.time;
      for (const side of ['bid', 'ask']) {
        const values = chunk.kind === 'quote_ticks' ? [row[side]] : ['open', 'high', 'low', 'close'].map(k => row[side]?.[k]);
        if (values.some(v => typeof v !== 'string' || !new RegExp(`^[0-9]+\\.[0-9]{${chunk.digits}}$`).test(v) || BigInt(v.replace('.', '')) <= 0n)) fail('INVALID_PRICE', '细报价必须使用真实声明精度的 Decimal 字符串。');
      }
      if (chunk.kind === 'quote_ticks' && BigInt(row.ask.replace('.', '')) < BigInt(row.bid.replace('.', ''))) fail('INVALID_PRICE', '本地实际报价 crossed bid/ask；正式引擎应暂停。');
      if (chunk.kind !== 'quote_ticks' && row.time % 60000) fail('TIME_MISMATCH', 'M1 不是 UTC 整分钟。');
      const sourcePaths = Array.isArray(row.source) ? row.source : [row.source];
      if (!isDeepStrictEqual(sourcePaths,chunk.sources.map(x => x.path))) fail('SOURCE_MISMATCH', '细报价记录来源不匹配。');
    }
    if (block[0]?.time !== chunk.firstTime || block.at(-1)?.time !== chunk.lastTime) fail('TIME_MISMATCH', '细报价首尾时间不匹配。');
    for (const row of block) if (row.time >= from && row.time <= to) {
      if (!Number.isSafeInteger(row.time) || row.time < previous) fail('TIME_MISMATCH', '细报价 UTC 时间错位。');
      previous = row.time; rows.push(row);
      if (rows.length > maxRows) fail('SLICE_LIMIT', '真实细数据超过读取预算；缩小 UTC 区间，不会截断或假装完整。', { maxRows });
    }
    sources.push(...chunk.sources);
  }
  await notBusy(root);
  if (hash(await readBounded(root, 'state.json')) !== hash(stateBytes)) fail('SNAPSHOT_CHANGED', '细切片读取期间发布快照发生变化；没有合并不同版本。');
  if (!rows.length) fail('NO_QUOTES', '此区间没有真实报价；正式引擎应暂停报价/撮合，不能沿用未来或伪造报价。', { from, to, symbol });
  return { storageRoot: root, storageNamespace: OWNED, kind: execution.summary.kind === 'quote_ticks' ? 'ticks' : execution.summary.kind, dataKind: execution.summary.kind, symbol, chapterId, from, to, rangeConvention: 'inclusive UTC milliseconds', rows, sources, snapshot: state.snapshot, snapshotDigest: state.downloadDigest, configDigest: state.configDigest,
    chunkDigests: chunks.map(({path,bytes,digest}) => ({path,bytes,digest})),
    fxPolicy: 'Separate observed CHFJPY stream, never look ahead or manufacture same-time quotes', historicalGaplessnessCertified: false };
}

/** Safe bounded H1-only role/Agent view; strips future rows and all audience data.
 * asOf is controller UTC time. An opening-timestamp candle is visible only once
 * that full hour has completed. This does not supply formal-engine quotes.
 */
export function viewingFramesAt(data, { chapterId, asOf, maxFrames = 168 } = {}) {
  if (!Number.isSafeInteger(asOf) || !Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 1000) fail('INVALID_VIEW', '观看必须使用 UTC 毫秒和有界 maxFrames。');
  const i = data.chapters.findIndex(ch => ch.id === chapterId);
  if (i < 0) fail('INVALID_VIEW', '没有该章节。');
  const visible = data.frames[i].filter(f => f.time + HOUR <= asOf).slice(-maxFrames);
  return { chapterId, symbol: data.chapters[i].symbol, leverage: data.chapters[i].leverage, stopout: data.chapters[i].stopout, stopoutUnit: data.chapters[i].stopoutUnit, timeBasis: 'UTC', timeframe: 'H1', watchingOnly: true,
    frames: visible.map(f => ({ time: f.time, bid: { ...f.bid }, ask: { ...f.ask }, ...(f.fx ? { fx: { time: f.fx.time, bid: { ...f.fx.bid }, ask: { ...f.fx.ask } } } : {}) })) };
}

/** Direct handshake with native-engine.js decideAndAdvance(..., options):
 * options.quoteTicks and options.coverage. Input to is EXCLUSIVE; pass from=next
 * H1 frame.time, to=from+1h. This is controller-only, never role/Agent context.
 * Native ledger/margin/liquidity remain the engine's responsibility.
 */
export async function loadNativeStep(storageDirectory, { chapterId, from, to, maxRows = 500000 } = {}) {
  if (!Number.isSafeInteger(from) || from % HOUR || to !== from + HOUR) fail('INVALID_NATIVE_STEP', '原生步必须是 UTC 整小时 [from,from+1h)。');
  const main = await loadExecutionSlice(storageDirectory, { chapterId, from, to: to - 1, maxRows });
  if (main.kind !== 'ticks' || main.dataKind !== 'quote_ticks') fail('UNSUPPORTED_DATA_KIND', 'Nautilus 1.231.0 正式路径只接受 quote_ticks，H1/M1 不能撮合。');
  const { value: cfg } = await config(); const ch = cfg.chapters.find(c => c.id === chapterId);
  let quoteTicks = main.rows, fxSources = [];
  if (ch.fxSymbol) {
    const fx = await loadExecutionSlice(storageDirectory, { chapterId, symbol: ch.fxSymbol, from: Math.max(Date.parse(ch.playFrom), from - 60000), to: to - 1, maxRows });
    if (main.snapshotDigest !== fx.snapshotDigest || main.configDigest !== fx.configDigest) fail('SNAPSHOT_CHANGED', '主品种和FX不能来自不同冻结快照。');
    quoteTicks = attachAsOfFX(quoteTicks, fx.rows); fxSources = fx.sources;
  }
  return { quoteTicks, coverage: { from, to, complete: true, dataKind: 'quote_ticks', snapshot: main.snapshot, snapshotDigest: main.snapshotDigest, configDigest: main.configDigest,
    completeDefinition: 'all exact required native source objects and selected rows locally hash/window-verified; does not certify historical tick gaplessness', historicalGaplessnessCertified: false,
    liquidityAssumption: 'unbounded_top_of_book', liquidityBoundary: 'native prototype assumption, NOT historical available fill size',
    fxMaxAgeMs: 60000, fxPolicy: 'latest observed time<=main UTC ms, age<=60000ms; no interpolation',
    transport: cfg.provider.marketTransport, sourceFiles: [...main.sources, ...fxSources].map(({path,url,bytes,digest,observedAt,transportScheme,tlsAuthenticated}) => ({path,url,bytes,digest,observedAt,transportScheme,tlsAuthenticated})) } };
}
