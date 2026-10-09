import { promises as fs, existsSync } from 'node:fs';
import { basename, join, resolve, win32 } from 'node:path';
import { winePrefix, wineCommand, wineEnvironment } from './platform.js';
import { runTesterProcess } from './tester-process.js';
import { translationBinding } from './parameters.js';
import { pythonPath } from './process.js';
import { ApiError, digest, id, now, requireValue } from './support.js';
import { testerConfig, stableJSON, SDK_VERSION, projectFiles, riskLimits } from './contracts.js';
import { testerProxyLines, waitForTradingConnection } from './connection.js';

export const TEST_ACTIVE = ['queued', 'preparing', 'running', 'collecting', 'canceling'];
const decode = bytes => bytes.toString(bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
const windowsPath = path => process.platform === 'win32' ? path : `Z:${resolve(path).replaceAll('/', '\\')}`;
const terminalText = (path, offset = 0) => fs.readFile(path).then(bytes => bytes.subarray(bytes.length >= offset ? offset : 0).toString(bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '')).catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
const date = value => value.replaceAll('-', '.');
const decimal = value => typeof value === 'string' && /^-?\d+(?:\.\d{1,8})?$/.test(value) && Number.isFinite(Number(value));

export function testerInputs(log, pass) {
  let block = null, found;
  for (const line of log.split(/\r?\n/)) {
    if (line.includes('started with inputs:')) block = {};
    else if (block) {
      const input = /\t\s{2,}([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (input) block[input[1]] = input[2].trim();
      else { if (block.Product_RunId === pass.id) found = block; block = null; }
    }
  }
  if (block?.Product_RunId === pass.id) found = block;
  requireValue(found, '原生日志缺少本次任务的完整输入参数');
  const expected = testerFiles(pass, { login: '', password: '', server: '' }).inputs;
  for (const [key, value] of Object.entries(expected)) requireValue(Object.hasOwn(found, key) && (typeof value === 'number' ? Number(found[key]) === value : String(value) === found[key]), `Tester 实际参数 ${key} 与请求不一致`);
  return found;
}

export function testVariants(config, space = {}) {
  testerConfig(config);
  requireValue(space && typeof space === 'object' && !Array.isArray(space) && Object.keys(space).length <= 10, '参数搜索域最多 10 个维度');
  let variants = [config.parameters];
  for (const [key, values] of Object.entries(space)) {
    requireValue(Array.isArray(values) && values.length > 0 && new Set(values.map(v => stableJSON(v))).size === values.length, '搜索域需要非空、无重复的参数值');
    requireValue(variants.length * values.length <= 64, '一次最多穷举 64 组参数，请缩小搜索域');
    variants = variants.flatMap(parameters => values.map(value => testerConfig({ ...config, parameters: { ...parameters, [key]: value } }).parameters));
  }
  return variants;
}

export function testerFiles(pass, account, startupIni = '') {
  const c = pass.config, r = pass.risk_limits;
  const inputs = { ...c.parameters, Product_RunId: pass.id, Product_MaxRiskPct: r.max_risk_per_trade_pct,
    Product_MaxDailyLossPct: r.max_daily_loss_pct, Product_MaxPositions: r.max_open_positions, Product_MaxLots: r.max_lots };
  const ini = ['[Common]', `Login=${account.login}`, `Password=${account.password}`, `Server=${account.server}`, 'KeepPrivate=1', ...testerProxyLines(startupIni),
    '[Experts]', 'Enabled=0', 'AllowLiveTrading=0', 'AllowDllImport=0',
    '[Tester]', `Expert=MT5Agent\\${pass.build_id}.ex5`, `ExpertParameters=${pass.id}.set`, `Symbol=${c.symbol}`, `Period=${c.period}`,
    `Model=${c.model}`, 'Optimization=0', 'ForwardMode=0', `FromDate=${date(c.from_date)}`, `ToDate=${date(c.to_date)}`,
    `Deposit=${c.deposit}`, `Currency=${c.currency}`, `Leverage=${c.leverage}`, 'ExecutionMode=0', 'ProfitInPips=0',
    'Visual=0', 'UseLocal=1', 'UseRemote=0', 'UseCloud=0', 'ShutdownTerminal=1', `Report=${pass.id}.htm`, 'ReplaceReport=0', ''].join('\r\n');
  return { ini, set: Object.entries(inputs).map(([key, value]) => `${key}=${value}`).join('\r\n') + '\r\n', inputs };
}

async function boundedFile(path, limit = 32 * 1024 * 1024) {
  const stat = await fs.lstat(path);
  requireValue(stat.isFile(), `Tester 输出 ${basename(path)} 不是普通文件`);
  requireValue(stat.size <= limit, `Tester 输出 ${basename(path)} 为 ${stat.size} 字节，超过 ${limit} 字节限制`);
  return fs.readFile(path);
}

export function parseTesterResult(pass, resultBytes, equityBytes, traceBytes) {
  let result, equity, trace;
  try {
    result = JSON.parse(decode(resultBytes));
    const lines = bytes => decode(bytes).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    equity = lines(equityBytes); trace = lines(traceBytes);
  } catch { throw new ApiError(422, 'tester_output_invalid', 'Tester 结果文件未完成或不是有效 JSON'); }
  requireValue(result.schema_version === 1 && result.completed === true && result.run_id === pass.id && result.build_id === pass.build_id, 'Tester 完成标记或产物身份不匹配');
  requireValue(result.sdk_version === SDK_VERSION && Number.isSafeInteger(result.terminal_build) && typeof result.trace_truncated === 'boolean' && typeof result.equity_truncated === 'boolean', 'Tester SDK 或引擎元数据无效');
  requireValue(result.symbol === pass.config.symbol && result.period === `PERIOD_${pass.config.period}` && result.time_basis === 'broker_server_unspecified', 'Tester 实际品种、周期或时间口径不匹配');
  const m = result.metrics;
  requireValue(m && ['start_equity', 'end_equity', 'net_profit'].every(k => decimal(m[k])) && m.currency === pass.config.currency && Number(m.start_equity) === pass.config.deposit, 'Tester 实际初始资金或统计无效');
  requireValue(['return_pct', 'max_drawdown_pct'].every(k => Number.isFinite(m[k])) && Number.isSafeInteger(m.trade_count) && m.trade_count >= 0 && (m.win_rate_pct === null || Number.isFinite(m.win_rate_pct) && m.win_rate_pct >= 0 && m.win_rate_pct <= 100), 'Tester 统计字段无效');
  requireValue(Array.isArray(result.deals) && result.deals.length <= 100000 && equity.length > 0 && equity.length <= 50000 && trace.length <= 200000, 'Tester 账本或曲线数量无效');
  for (const point of equity) requireValue(typeof point.time === 'string' && decimal(point.equity) && decimal(point.balance), 'Tester 权益记录无效');
  const tickets = new Set();
  for (const deal of result.deals) {
    requireValue(['ticket', 'order', 'position_id', 'time_msc'].every(k => typeof deal[k] === 'string' && /^\d+$/.test(deal[k])) && !tickets.has(deal.ticket) && ['time', 'type', 'entry', 'reason', 'symbol'].every(k => typeof deal[k] === 'string') && ['volume', 'price', 'profit', 'commission', 'swap', 'fee'].every(k => decimal(deal[k])), 'Tester 成交字段无效或票据重复');
    tickets.add(deal.ticket);
  }
  for (let index = 0; index < trace.length; index++) requireValue(trace[index].build_id === pass.build_id && trace[index].seq === index + 1 && typeof trace[index].kind === 'string', 'Tester 埋点身份或序列不匹配');
  return { result, equity, trace };
}

export class Tester {
  constructor(mt5) { this.mt5 = mt5; this.storage = mt5.storage; this.pending = new Map(); this.tail = Promise.resolve(); }
  init() {
    for (const pass of this.storage.list('mt5_pass')) if (TEST_ACTIVE.includes(pass.status)) this.storage.put('mt5_pass', { ...pass, status: 'unknown', error: '应用重启，先核对原生进程与归档文件；未自动重放。', completed_at: now() });
    for (const job of this.storage.list('mt5_backtest')) if (TEST_ACTIVE.includes(job.status)) this.update(job.id, { status: 'unknown', error: '应用重启，未自动重放回测。', completed_at: now() });
    return this;
  }
  available() { return Boolean(this.mt5.native && existsSync(pythonPath(this.mt5.native)) && ['linux', 'win32', 'darwin'].includes(process.platform)); }
  authorize(owner) {
    const p = this.mt5.official.policy?.('sesame/mt5', owner);
    requireValue(p?.state !== 'disabled' && (!owner || !p || p.loaded), '请先启用并加载 MT5 回测插件', 403, 'plugin_disabled');
  }
  get(key) { return { ...this.storage.get('mt5_backtest', key), passes: this.storage.list('mt5_pass').filter(p => p.backtest_id === key) }; }
  list(projectId) { return this.storage.list('mt5_backtest').filter(j => !projectId || j.project_id === projectId); }
  update(key, changes) { const value = this.storage.update('mt5_backtest', key, changes); this.mt5.runObserver?.backtest(this.get(key)); return value; }
  queue(buildId, config, parameterSpace = {}, owner = null, frozenRiskLimits = null) {
    this.authorize(owner); requireValue(!this.closing && this.available(), '本机 Tester 执行环境不可用', 503, 'tester_unavailable');
    requireValue(!this.storage.list('mt5_pass').some(p => p.status === 'unknown' && (p.process_id || p.cleanup_failed)), '先前 Tester 的原生清理状态未确认；请先核对该回测实例，再创建新任务', 409, 'tester_recovery_required');
    const build = this.storage.get('mt5_build', buildId);
    requireValue(build.status === 'succeeded' && build.ex5_sha256 && build.sdk_version === SDK_VERSION, '需要使用当前 SDK 编译成功的冻结构建');
    const project = this.storage.get('mt5_project', build.project_id), variants = testVariants(config, parameterSpace).map(parameters => translationBinding(this.mt5.host, this.mt5, buildId, { ...config, parameters })?.native ?? parameters);
    const source = this.storage.get('mt5_revision', `${build.project_id}:${build.revision}`);
    const checked = projectFiles(source.files), implementation = this.mt5.validateSource(project, checked);
    if (checked.engine) requireValue(build.engine_digest === checked.engine.digest && build.generated_digest === checked.engine.generated_digest, '构建与已校验源码身份不一致，请重新编译', 409, 'engine_mismatch');
    requireValue(implementation.status !== 'draft', `此构建的策略模块待实现：${implementation.pending_modules.join(', ')}。请完成模块代码和 strategy.json 声明后保存、重新编译。`, 409, 'strategy_incomplete');
    const account = this.mt5.official.config.account;
    requireValue(account.login && account.server && account.password, '请在 MT5 连接中配置回测账户', 409, 'mt5_account_required');
    const ownership = owner ? this.mt5.host.workspace.owner(owner) ?? {} : {};
    const job = { ...ownership, id: id('bt'), version: 1, conversation_id: owner, project_id: build.project_id, build_id: buildId, revision: build.revision,
      artifact_digest: build.ex5_sha256, connection_version: this.mt5.official.config.version, config: testerConfig(config), parameter_space: structuredClone(parameterSpace), risk_limits: riskLimits(frozenRiskLimits ?? project.test_risk_limits),
      status: 'queued', pass_count: variants.length, completed_pass_count: 0, best_pass_id: null, error: null, created_at: now(), updated_at: now(), completed_at: null };
    return this.storage.transaction(() => {
      this.storage.put('mt5_backtest', job, 'mt5.backtest.updated');
      variants.forEach((parameters, index) => this.storage.put('mt5_pass', { ...ownership, id: id('pass'), backtest_id: job.id, build_id: buildId, label: `P${String(index + 1).padStart(3, '0')}`,
        status: 'queued', connection_version: job.connection_version, config: { ...job.config, parameters }, risk_limits: job.risk_limits, artifact_digest: build.ex5_sha256,
        parameters, metrics: null, dataset_ids: [], error: null, diagnostics: '', created_at: now(), completed_at: null }));
      const result = this.get(job.id); this.mt5.runObserver?.backtest(result); return result;
    });
  }
  start(key) {
    if (this.pending.has(key)) return this.pending.get(key).promise;
    if (this.get(key).status !== 'queued') return Promise.resolve(this.get(key));
    const controller = new AbortController();
    const promise = this.tail.then(() => this.run(key, controller.signal)).finally(() => this.pending.delete(key));
    this.pending.set(key, { controller, promise }); this.tail = promise.catch(() => {}); return promise;
  }
  stop(key, owner = null) {
    this.authorize(owner); const job = this.get(key);
    requireValue(!owner || !job.conversation_id || job.conversation_id === owner, '只能停止当前会话的回测', 403);
    if (!TEST_ACTIVE.includes(job.status)) return job;
    this.pending.get(key)?.controller.abort(); this.update(key, { status: 'canceling' }); return this.get(key);
  }
  async run(key, signal) {
    let failure;
    for (const pass of this.get(key).passes) {
      if (signal.aborted) break;
      this.update(key, { status: 'running' });
      try { await this.execute(pass, signal); }
      catch (error) {
        failure = this.mt5.official.redact(error.message);
        this.storage.put('mt5_pass', { ...this.storage.get('mt5_pass', pass.id), status: error.code === 'runtime_cleanup_failed' ? 'unknown' : signal.aborted ? 'canceled' : 'failed', error: failure, ...(error.code === 'runtime_cleanup_failed' ? { cleanup_failed: true } : {}), completed_at: now() });
      }
      this.update(key, { completed_pass_count: this.get(key).passes.filter(p => p.status === 'succeeded').length });
    }
    for (const pass of this.get(key).passes) if (pass.status === 'queued') this.storage.put('mt5_pass', { ...pass, status: 'canceled', error: '任务已取消', completed_at: now() });
    const passes = this.get(key).passes, cleanupFailed = passes.some(p => p.cleanup_failed), success = passes.every(p => p.status === 'succeeded');
    const ranked = success ? passes.slice().sort((a, b) => Number(b.metrics.net_profit) - Number(a.metrics.net_profit) || a.id.localeCompare(b.id)) : [];
    this.update(key, { status: cleanupFailed ? 'unknown' : signal.aborted ? 'canceled' : success ? 'succeeded' : 'failed', best_pass_id: ranked[0]?.id ?? null, error: signal.aborted ? '任务已取消' : failure ?? null, completed_at: now() });
    return this.get(key);
  }
  async execute(pass, signal) {
    signal.throwIfAborted();
    requireValue(pass.connection_version === this.mt5.official.config.version, '回测连接配置已改变，请创建新任务');
    this.storage.put('mt5_pass', { ...pass, status: 'preparing' });
    const archive = join(this.storage.directory, 'mt5/backtests', pass.id), runner = pass.owner_run_id ? join(this.mt5.host.workspace.taskRoot(pass.owner_run_id), 'native', 'tester-terminal') : join(this.storage.directory, 'mt5/tester-terminal');
    await fs.mkdir(archive, { recursive: true, mode: 0o700 });
    await fs.mkdir(join(runner, 'Config'), { recursive: true, mode: 0o700 });
    for (const name of ['terminal64.exe', 'metatester64.exe', 'MetaEditor64.exe']) {
      const path = name === 'MetaEditor64.exe' ? this.mt5.native.editor : join(this.mt5.native.directory, name), destination = join(runner, name);
      if (!existsSync(destination) || digest(await fs.readFile(destination)) !== digest(await fs.readFile(path))) await fs.copyFile(path, destination);
    }
    // Only broker discovery metadata is copied; terminal account databases and startup EAs are not.
    const dataDirectory = this.mt5.native.dataDirectory ?? this.mt5.native.directory;
    for (const name of ['servers.dat']) if (existsSync(join(dataDirectory, 'Config', name))) await fs.copyFile(join(dataDirectory, 'Config', name), join(runner, 'Config', name));
    const account = structuredClone(this.mt5.official.config.account);
    const files = testerFiles(pass, account, this.mt5.official.config.startup_ini);
    // Warm the native M1 cache, then copy only this broker's symbol/history data.
    // The test still runs inside MT5 and may synchronize additional ticks itself.
    const client = this.mt5.official.client('terminal');
    await waitForTradingConnection(client, account, { signal, progress: diagnostics => {
      this.storage.put('mt5_pass', { ...this.storage.get('mt5_pass', pass.id), diagnostics });
    } });
    const history = await client.call('get_chart_history', { symbol: pass.config.symbol, period: 'M1', datetime_from: `${Number(pass.config.from_date.slice(0, 4)) - 1}-01-01T00:00:00`, datetime_to: `${pass.config.to_date}T00:00:00`, limit: 1 }, signal);
    requireValue(!history.isError, '原生历史数据预热失败');
    await fs.writeFile(join(archive, 'history-preflight.json'), JSON.stringify(history));
    const bases = ['Bases', 'bases'].map(name => join(dataDirectory, name)).find(existsSync);
    if (bases && (await fs.readdir(bases)).includes(account.server)) {
      for (const relative of ['symbols', `history/${pass.config.symbol}`]) {
        const source = join(bases, account.server, relative);
        if (existsSync(source)) await fs.cp(source, join(runner, 'bases', account.server, relative), { recursive: true });
      }
    }
    const source = join(this.storage.directory, 'mt5/builds', pass.build_id, 'Experts/Strategy.ex5');
    const bytes = await boundedFile(source);
    requireValue(digest(bytes) === pass.artifact_digest, '冻结 EX5 已发生变化，拒绝回测');
    const expert = join(runner, 'MQL5/Experts/MT5Agent', `${pass.build_id}.ex5`);
    const profiles = join(runner, 'MQL5/Profiles/Tester');
    await fs.mkdir(join(expert, '..'), { recursive: true }); await fs.mkdir(profiles, { recursive: true }); await fs.writeFile(expert, bytes);
    const ini = join(runner, `${pass.id}.ini`);
    await fs.writeFile(ini, Buffer.from('\uFEFF' + files.ini, 'utf16le'), { mode: 0o600 });
    await fs.writeFile(join(profiles, `${pass.id}.set`), Buffer.from('\uFEFF' + files.set, 'utf16le'));
    await fs.writeFile(join(archive, 'parameters.set'), files.set);
    await fs.writeFile(join(archive, 'manifest.json'), JSON.stringify({ ...pass, inputs: files.inputs, compiler_defaults: 'EX5-bound', terminal_sha256: digest(await fs.readFile(join(runner, 'terminal64.exe'))) }, null, 2));
    const prefix = winePrefix(this.mt5.native.directory);
    const workspace = client.workspace;
    const info = workspace.structuredContent ?? JSON.parse(workspace.content.find(p => p.type === 'text').text);
    const commonWindows = win32.normalize(info.workspace.common_folder);
    const common = process.platform === 'win32' ? commonWindows : join(prefix, 'drive_c', commonWindows.replace(/^[cC]:\\/, '').replaceAll('\\', '/'));
    requireValue(process.platform === 'win32' || /^[cC]:\\/.test(commonWindows), '当前 Wine Common 路径不受支持');
    const output = join(common, 'Files/MT5Agent', pass.id);
    if (pass.owner_run_id) {
      pass = { ...pass, temporary_paths: { common_output: output } };
      this.storage.put('mt5_pass', { ...this.storage.get('mt5_pass', pass.id), temporary_paths: pass.temporary_paths });
    }
    requireValue(!existsSync(output), 'Tester 输出目录已存在；拒绝复用或重放');
    const offsets = await this.logOffsets(runner);
    const started = Date.now(); let logs = '', cleanupConfirmed = false, poll, logRead, cancelWrite;
    const cancel = () => {
      cancelWrite = fs.mkdir(output, { recursive: true }).then(() => fs.writeFile(join(output, 'cancel'), '')).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
    try {
      // Keep progress factual: native logs and phases, no estimated percentage.
      poll = setInterval(() => { logRead = this.logs(runner, started, account, false, offsets).then(text => {
        this.storage.put('mt5_pass', { ...this.storage.get('mt5_pass', pass.id), diagnostics: text.slice(-16000) });
      }).catch(() => {}); }, 2000);
      try {
        const receipt = await runTesterProcess(this.mt5.native, { terminal: join(runner, 'terminal64.exe'), ini, directory: runner }, { signal, onStarted: (pid, controllerPid) => {
          this.storage.put('mt5_pass', { ...this.storage.get('mt5_pass', pass.id), status: 'running', process_id: pid, controller_pid: controllerPid });
          this.mt5.runObserver?.backtest(this.get(pass.backtest_id));
        } });
        logs = receipt.diagnostics; cleanupConfirmed = true;
        this.storage.put('mt5_pass', { ...this.storage.get('mt5_pass', pass.id), process_cleanup: receipt.cleanup });
      } catch (error) {
        cleanupConfirmed = error.code !== 'runtime_cleanup_failed';
        throw error;
      }
      this.storage.put('mt5_pass', { ...this.storage.get('mt5_pass', pass.id), status: 'collecting' });
      const raw = await Promise.all(['result.json', 'equity.ndjson', 'trace.ndjson'].map(name => boundedFile(join(output, name))));
      const parsed = parseTesterResult(pass, ...raw);
      const actualInputs = testerInputs(await this.logs(runner, started, account, true, offsets), pass);
      requireValue(digest(await boundedFile(expert)) === pass.artifact_digest, 'Tester 执行期间 EX5 被修改');
      for (let i = 0; i < raw.length; i++) await fs.writeFile(join(archive, ['result.json', 'equity.ndjson', 'trace.ndjson'][i]), raw[i]);
      const nativeReport = join(runner, `${pass.id}.htm`);
      if (existsSync(nativeReport)) await fs.copyFile(nativeReport, join(archive, 'native-report.htm'));
      await fs.writeFile(join(archive, 'actual-inputs.json'), JSON.stringify(actualInputs, null, 2));
      this.register(pass, parsed, actualInputs);
      this.mt5.runObserver?.result(pass, parsed);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('MT5 未生成本次回测的完成结果；请查看实际 Tester 日志、历史数据及 SDK 接入');
      throw error;
    } finally {
      clearInterval(poll); signal.removeEventListener('abort', cancel); await logRead; await cancelWrite;
      // Wine graphics diagnostics must not push the actual Tester failure/inputs
      // out of the bounded progress record.
      const diagnostics = `${this.mt5.official.redact(logs).slice(-4000)}\n${await this.logs(runner, started, account, false, offsets)}`.trim();
      this.storage.put('mt5_pass', { ...this.storage.get('mt5_pass', pass.id), diagnostics: diagnostics.slice(-24000) });
      await fs.writeFile(join(archive, 'tester.log'), diagnostics);
      if (cleanupConfirmed) {
        await fs.rm(ini, { force: true });
        await fs.rm(output, { recursive: true, force: true });
        await fs.rm(join(profiles, `${pass.id}.set`), { force: true });
        await fs.rm(join(runner, `${pass.id}.htm`), { force: true });
      }
    }
  }
  async logOffsets(runner) {
    const offsets = new Map();
    for (const directory of [join(runner, 'logs'), join(runner, 'Tester/logs')]) {
      for (const name of await fs.readdir(directory).catch(() => [])) if (name.endsWith('.log')) {
        const path = join(directory, name); offsets.set(path, (await fs.stat(path)).size);
      }
    }
    return offsets;
  }
  async logs(runner, started, account, full = false, offsets = new Map()) {
    const names = [join(runner, 'logs'), join(runner, 'Tester/logs')], parts = [];
    for (const directory of names) for (const name of await fs.readdir(directory).catch(() => [])) {
      if (!name.endsWith('.log')) continue;
      const path = join(directory, name), stat = await fs.stat(path);
      if (stat.mtimeMs < started || stat.size > 64 * 1024 * 1024) continue;
      const content = await terminalText(path, offsets.get(path) ?? 0); parts.push(full ? content : content.slice(-24000));
    }
    let text = parts.join('\n'); for (const secret of [account.login, account.password].filter(Boolean)) text = text.replaceAll(secret, '[redacted]');
    return this.mt5.official.redact(text);
  }
  register(pass, parsed, actualInputs = {}) {
    const { result, equity, trace } = parsed;
    const { deals, ...summary } = result;
    const sets = { summary: [summary], equity, deals, trace };
    const datasets = Object.entries(sets).map(([role, rows]) => {
      const key = id('data');
      return { ...(pass.owner_run_id ? { owner_run_id: pass.owner_run_id, owner_task_id: pass.owner_task_id, conversation_id: pass.conversation_id } : {}), id: key, backtest_id: pass.backtest_id, pass_id: pass.id, role, title: `${pass.label} · MT5 ${role}`, description: 'MT5 Strategy Tester 原生 EA SDK 导出；时间为券商服务器墙钟，未推断 UTC。', rows,
        provenance: { kind: 'observed', dataset_id: key, source_kind: 'external', provider: 'mt5/strategy-tester', as_of: now(), data_hash: digest(JSON.stringify(rows)), engine_version: `mt5-${result.terminal_build}/sdk-${result.sdk_version}`, time_range: null } };
    });
    this.storage.transaction(() => {
      datasets.forEach(data => this.mt5.host.datasets.register(data));
      this.storage.put('mt5_pass', { ...this.storage.get('mt5_pass', pass.id), status: 'succeeded', parameters: Object.keys(actualInputs).length ? Object.fromEntries(Object.entries(actualInputs).filter(([key]) => !key.startsWith('Product_'))) : pass.parameters, actual_inputs: actualInputs, metrics: result.metrics, dataset_ids: datasets.map(d => d.id),
        engine_version: `mt5-${result.terminal_build}/sdk-${result.sdk_version}`, trace_truncated: result.trace_truncated, equity_truncated: result.equity_truncated, completed_at: now() });
    });
  }
  async close() { this.closing = true; for (const job of this.pending.values()) job.controller.abort(); await Promise.allSettled([...this.pending.values()].map(j => j.promise)); }
}
