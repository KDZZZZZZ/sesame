import { promises as fs } from 'node:fs';
import { join, win32 } from 'node:path';
import { winePrefix } from './platform.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { digest, id, now, requireValue } from './support.js';
import { nativeData, TIME_BASIS } from './market.js';
import { correlatedTrace } from './strategy.js';
import { prepareTerminal } from './terminal.js';
import { SDK_VERSION } from './contracts.js';

// Platform-owned Tester-only entry guards: the template's, and the compact form the visual engine emits.
const legacyGuards = [
  'if(!MQLInfoInteger(MQL_TESTER)) { Print("This managed SDK currently supports Tester only."); return INIT_FAILED; }',
  'if(!MQLInfoInteger(MQL_TESTER)) return INIT_FAILED;',
];
const liveGuard = 'if(!ProductExecutionAllowed()) { Print("Managed account authorization required."); return INIT_FAILED; }';
// This is a platform-owned lifecycle upgrade, frozen in the build manifest.
// Strategy modules and their checked IR are unchanged. Old EX5 files stay Tester-only.
export function prepareLiveEntry(source) {
  const guard = legacyGuards.find(text => source.includes(text));
  return { source: guard ? source.replace(guard, liveGuard) : source, live: Boolean(guard) };
}
function hostPath(path, native) {
  if (process.platform === 'win32') return path;
  requireValue(/^[cC]:\\/.test(path) && !path.split(/[\\/]/).includes('..'), '终端目录不在受支持的 Wine C 盘内');
  return join(winePrefix(native?.directory), 'drive_c', path.slice(3).replaceAll('\\', '/'));
}
const active = d => ['preparing', 'attaching', 'running', 'unknown'].includes(d.status);
const preparable = new Set(['需要自动更新构建并重新回测', '需要自动配置终端算法交易', '终端尚未识别冻结构建，需要自动准备']);
// Template EAs record lifecycle "initialized" at the end of OnInit. Visual-engine EAs record a platform.visual
// event as each handler starts; the terminal dispatches OnTimer/OnTick only after OnInit succeeded, so a
// later handler event after "init" is the evidence. An init event alone (e.g. OnInit then failing) is not.
export function initialized(events) {
  if (!events.some(e => e.node_id === 'platform.permissions' && e.value?.trade_allowed === true && e.value?.dll_allowed === false)) return false;
  if (events.some(e => e.kind === 'lifecycle' && e.value === 'initialized')) return true;
  const visual = events.filter(e => e.kind === 'event' && e.node_id === 'platform.visual');
  const start = visual.find(e => e.value?.kind === 'init');
  return Boolean(start) && visual.some(e => e.seq > start.seq && e.value?.kind !== 'init');
}

export class Deployments {
  constructor(mt5) {
    this.mt5 = mt5; this.storage = mt5.storage; this.jobs = new Set(); this.busy = false;
    this.mountRequests = new Map(); this.preparationJobs = new Map();
    for (const d of this.list()) if (['preparing', 'attaching'].includes(d.status)) this.save({ ...d, status: 'unknown', reason: '应用重启，请核对终端挂载状态；未自动重放。' });
    for (const p of this.preparations()) if (['queued', 'running'].includes(p.status)) this.storage.put('mt5_preparation', { ...p, status: 'interrupted', reason: '应用重启，准备任务已暂停；可重新发起准备，不会自动挂载。', updated_at: now() });
  }
  preparations() { return this.storage.list('mt5_preparation'); }
  list() { return this.storage.list('mt5_deployment'); }
  save(value) { const saved = this.storage.put('mt5_deployment', { ...value, updated_at: now() }); this.mt5.runObserver?.deployment(saved); return saved; }
  candidates() {
    return this.storage.list('mt5_pass').filter(p => p.status === 'succeeded').map(pass => {
      const build = this.storage.get('mt5_build', pass.build_id), project = this.storage.get('mt5_project', build.project_id);
      return { pass_id: pass.id, build_id: build.id, project_id: project.id, title: project.title, revision: build.revision, symbol: pass.config.symbol, period: pass.config.period, parameters: pass.parameters, risk_limits: pass.risk_limits, metrics: pass.metrics, live_capable: build.live_capable === true, artifact_digest: build.ex5_sha256 };
    }).reverse();
  }
  // The terminal indexes MQL5/Experts when it starts; under Wine a file copied while it runs never reaches its
  // program list. Each frozen build is therefore staged once at a stable path, recognised, and mounted from there.
  staged(build) {
    const workspace = nativeData(this.mt5.official.client('terminal').workspace).workspace;
    const expert = win32.join(workspace.mql5_folder, 'Experts', 'MT5Agent', `${build.id}.ex5`);
    return { expert, dest: hostPath(expert, this.mt5.native) };
  }
  async stage(build) {
    const { expert, dest } = this.staged(build);
    const bytes = await fs.readFile(join(this.storage.directory, 'mt5/builds', build.id, 'Experts/Strategy.ex5'));
    requireValue(digest(bytes) === build.ex5_sha256, '冻结产物校验失败');
    const existing = await fs.readFile(dest).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing) requireValue(digest(existing) === build.ex5_sha256, '终端目录中的冻结 EX5 已被改动', 409);
    else { await fs.mkdir(join(dest, '..'), { recursive: true }); await fs.writeFile(dest, bytes, { flag: 'wx' }); }
    return expert;
  }
  async recognitionReason(build) {
    const { expert, dest } = this.staged(build);
    const existing = await fs.readFile(dest).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing && digest(existing) !== build.ex5_sha256) return '终端目录中的冻结 EX5 已被改动';
    const missing = '终端尚未识别冻结构建，需要自动准备';
    if (!existing) return missing;
    const { programs = [] } = await this.mt5.market.read('list_available_mql5_programs');
    return programs.some(p => p.type === 'Expert' && String(p.path).toLowerCase() === expert.toLowerCase()) ? null : missing;
  }
  /** Restarts the idle terminal under the same rules as configuration so it re-reads its program list. */
  refreshPrograms(progress) { return prepareTerminal(this.mt5, progress, { restart: true }); }
  async check(passId) {
    const pass = this.storage.get('mt5_pass', passId), build = this.storage.get('mt5_build', pass.build_id), reasons = [];
    if (pass.status !== 'succeeded' || build.status !== 'succeeded') reasons.push('需要已完成回测的冻结构建');
    if (build.translation && build.translation_mode !== 'live') reasons.push('该 SVL 翻译仅面向回测；实盘需针对 live 目标登记并验证新的翻译');
    if (!build.live_capable || build.sdk_version !== SDK_VERSION) reasons.push('需要自动更新构建并重新回测');
    if (pass.artifact_digest !== build.ex5_sha256) reasons.push('回测产物与挂载产物不一致');
    const blocked = this.mt5.official.deploymentAccess().blocked_reason;
    if (blocked) reasons.push(blocked);
    const { scope, info } = await this.mt5.market.connected();
    if (info.terminal.experts_trade_allowed !== true) reasons.push('需要自动配置终端算法交易');
    if (info.terminal.mcp_trade_allowed !== true) reasons.push('MT5 原生接口尚未允许交易');
    if (this.list().some(d => active(d) && d.server === scope.server && d.login === scope.login)) reasons.push('此账户已有挂载或待核对任务，请先停止或核对');
    // Native input strings cannot safely encode separators or whitespace.
    if (!/^[^,=\s]+$/.test(scope.server)) reasons.push('此券商名称无法通过原生 EA 参数接口安全传入');
    const artifact = join(this.storage.directory, 'mt5/builds', build.id, 'Experts/Strategy.ex5');
    if (build.status === 'succeeded' && digest(await fs.readFile(artifact)) !== build.ex5_sha256) reasons.push('冻结 EX5 的校验值已变化');
    if (!reasons.length) { const reason = await this.recognitionReason(build); if (reason) reasons.push(reason); }
    return { ready: reasons.length === 0, reasons, checked_at: now(), pass_id: pass.id, server: scope.server, login: scope.login, account_type: info.account.type ?? null, symbol: pass.config.symbol, period: pass.config.period, parameters: pass.parameters, risk_limits: pass.risk_limits, artifact_digest: build.ex5_sha256 };
  }
  async track(fn) { const promise = fn(); this.jobs.add(promise); try { return await promise; } finally { this.jobs.delete(promise); } }
  prepare(input, requestKey, configuration, owner = null) {
    const previous = this.preparations().find(p => p.request_key === requestKey);
    if (previous) {
      requireValue(previous.source_pass_id === input.pass_id && previous.server === input.server && previous.login === input.login && previous.source_artifact_digest === input.artifact_digest, '幂等键已用于不同准备', 409);
      return previous;
    }
    requireValue(input.authorize_trading === true, '需要明确的准备或挂载请求', 403);
    const blocked = this.mt5.official.deploymentAccess().blocked_reason; requireValue(!blocked, blocked, 403);
    requireValue(!this.busy && !this.preparations().some(p => ['queued', 'running'].includes(p.status)), '已有准备或挂载正在进行', 409);
    configuration.assertIdle();
    const pass = this.storage.get('mt5_pass', input.pass_id), build = this.storage.get('mt5_build', pass.build_id), account = this.mt5.official.config.account;
    requireValue(pass.status === 'succeeded' && build.status === 'succeeded' && input.artifact_digest === pass.artifact_digest && input.artifact_digest === build.ex5_sha256, '请选择已成功回测且产物一致的版本', 409);
    requireValue(input.login === String(account.login) && input.server === account.server, '账户已变化，请重新检查准备', 409);
    let p = { id: id('prep'), request_key: requestKey, source_pass_id: pass.id, source_artifact_digest: input.artifact_digest, pass_id: pass.id, build_id: build.id, backtest_id: null, login: input.login, server: input.server, status: 'queued', stage: 'authorizing', reason: null, created_at: now(), updated_at: now() };
    const update = changes => { p = this.storage.put('mt5_preparation', { ...p, ...changes, updated_at: now() }, 'mt5.preparation.updated'); return p; };
    update({}); this.busy = true;
    // One explicit preparation owns configuration until verification finishes.
    const task = configuration.exclusive(async () => {
      try {
        update({ status: 'running' });
        update({ stage: 'terminal' });
        const terminal = await prepareTerminal(this.mt5, stage => update({ stage }));
        update({ terminal });
        if (!build.live_capable || build.sdk_version !== SDK_VERSION) {
          update({ stage: 'compiling' });
          const queued = this.mt5.queueBuild(build.project_id, build.revision); update({ build_id: queued.id });
          const compiled = await this.mt5.startBuild(queued.id);
          requireValue(compiled.status === 'succeeded' && compiled.live_capable, compiled.diagnostics || '构建更新尚未完成', 409);
          update({ stage: 'backtesting' });
          const job = this.mt5.tester.queue(compiled.id, { ...pass.config, parameters: pass.parameters }, {}, owner, pass.risk_limits); update({ backtest_id: job.id });
          const finished = await this.mt5.tester.start(job.id);
          requireValue(finished.status === 'succeeded' && finished.passes.length === 1, finished.error || '更新后的回测尚未完成', 409);
          update({ pass_id: finished.passes[0].id });
        }
        update({ stage: 'staging' });
        const final = this.storage.get('mt5_build', this.storage.get('mt5_pass', p.pass_id).build_id);
        await this.stage(final);
        if (await this.recognitionReason(final)) {
          update({ terminal: await this.refreshPrograms(stage => update({ stage })) });
          requireValue(!(await this.recognitionReason(final)), '终端重启后仍未识别冻结构建', 409);
        }
        update({ stage: 'verifying' });
        const check = await this.check(p.pass_id); requireValue(check.ready, check.reasons.join('；'), 409);
        return update({ status: 'ready', stage: 'ready', check });
      } catch (error) { return update({ status: 'failed', reason: this.mt5.official.redact(error.message) }); }
      finally { this.busy = false; }
    }, owner);
    this.preparationJobs.set(p.id, task);
    void task.finally(() => this.preparationJobs.delete(p.id)).catch(() => {});
    this.jobs.add(task); void task.finally(() => this.jobs.delete(task)).catch(() => {});
    return p;
  }
  /** One explicit user action owns preparation and mount; no background auto-mount. */
  async requestMount(passId, requestKey, expected, configuration, owner = null) {
    requireValue(typeof requestKey === 'string' && requestKey.length >= 16 && requestKey.length <= 128, '挂载需要稳定的请求 ID');
    const identity = JSON.stringify([passId, expected.login, expected.server, expected.artifact_digest]);
    const pending = this.mountRequests.get(requestKey);
    if (pending) { requireValue(pending.identity === identity, '幂等键已用于不同挂载', 409, 'idempotency_conflict'); return pending.task; }
    const task = this.track(async () => {
      const previous = this.list().find(d => d.request_key === requestKey);
      if (previous) {
        requireValue((previous.source_pass_id ?? previous.pass_id) === passId && previous.login === expected.login && previous.server === expected.server
          && (previous.source_artifact_digest ?? previous.artifact_digest) === expected.artifact_digest, '幂等键已用于不同挂载', 409, 'idempotency_conflict');
        return previous;
      }
      let check = await this.check(passId);
      requireValue(expected.login === check.login && expected.server === check.server && expected.artifact_digest === check.artifact_digest, '账户或构建已变化，请重新检查挂载', 409);
      requireValue(check.reasons.every(reason => preparable.has(reason)), check.reasons.join('；'), 409, 'deployment_not_ready');
      // An interrupted/failed preparation with this key remains interrupted;
      // reconnecting the UI must not silently revive an earlier mount intent.
      const priorPreparation = this.preparations().find(p => p.request_key === requestKey);
      if (!check.ready || priorPreparation) {
        const p = this.prepare({ ...expected, pass_id: passId, authorize_trading: true }, requestKey, configuration, owner);
        await this.preparationJobs.get(p.id);
        const prepared = this.storage.get('mt5_preparation', p.id);
        requireValue(prepared.status === 'ready', prepared.reason || '挂载准备尚未完成', 409);
        check = await this.check(prepared.pass_id);
        requireValue(check.login === expected.login && check.server === expected.server, '准备期间账户已改变', 409);
      }
      return configuration.exclusive(() => this.mount(check.pass_id, requestKey, { ...check, source_pass_id: passId, source_artifact_digest: expected.artifact_digest, conversation_id: owner }), owner);
    });
    this.mountRequests.set(requestKey, { identity, task });
    try { return await task; } finally { this.mountRequests.delete(requestKey); }
  }
  async mount(passId, requestKey, expected) {
    requireValue(typeof requestKey === 'string' && requestKey.length >= 16 && requestKey.length <= 128, '挂载需要稳定的请求 ID');
    return this.track(async () => {
      const previous = this.list().find(d => d.request_key === requestKey);
      if (previous) { requireValue(previous.pass_id === passId && previous.login === expected.login && previous.server === expected.server && previous.artifact_digest === expected.artifact_digest, '幂等键已用于不同挂载', 409, 'idempotency_conflict'); return previous; }
      requireValue(!this.busy, '正在处理挂载操作', 409); this.busy = true;
      let d;
      try {
        const check = await this.check(passId); requireValue(check.ready, check.reasons.join('；'), 409, 'deployment_not_ready');
        requireValue(expected.login === check.login && expected.server === check.server && expected.artifact_digest === check.artifact_digest, '账户或构建已变化，请重新检查挂载', 409);
        const pass = this.storage.get('mt5_pass', passId), build = this.storage.get('mt5_build', pass.build_id), client = this.mt5.official.client('terminal');
        const workspace = nativeData(client.workspace).workspace;
        d = this.save({ id: id('deploy'), request_key: requestKey, status: 'preparing', pass_id: pass.id,
          source_pass_id: expected.source_pass_id ?? pass.id, source_artifact_digest: expected.source_artifact_digest ?? check.artifact_digest,
          build_id: build.id, project_id: build.project_id, revision: build.revision, server: check.server, login: check.login, symbol: check.symbol, period: check.period, artifact_digest: check.artifact_digest, parameters: pass.parameters, risk_limits: pass.risk_limits, conversation_id: expected.conversation_id ?? null, chart_id: null, created_at: now(), reason: null });
        const expert = await this.stage(build);
        requireValue(!(await this.recognitionReason(build)), '终端尚未识别冻结构建，请先运行自动准备', 409, 'deployment_not_ready');
        d = this.save({ ...d, expert_path: expert, output_path: join(hostPath(workspace.common_folder, this.mt5.native), 'Files/MT5Agent', d.id) });
        const r = pass.risk_limits;
        const inputs = { ...pass.parameters, Product_RunId: d.id, Product_EnableLive: true, Product_AccountLogin: d.login, Product_AccountServer: d.server, Product_MaxRiskPct: r.max_risk_per_trade_pct, Product_MaxDailyLossPct: r.max_daily_loss_pct, Product_MaxPositions: r.max_open_positions, Product_MaxLots: r.max_lots };
        for (const [key, value] of Object.entries(inputs)) requireValue(/^[A-Za-z][\w]*$/.test(key) && /^[^,=\s]+$/.test(String(value)), 'EA 输入不能包含逗号、等号或空白');
        const parameters = await this.mt5.market.read('get_expert_advisor_parameters', { expert_path: expert });
        const names = new Set(parameters.parameters?.map(p => p.name));
        requireValue(Object.keys(inputs).every(key => names.has(key)), '编译产物缺少指定 EA 输入，拒绝静默使用默认参数');
        // Persist intent before the native start; an interrupted attempt remains
        // unknown and is never replayed. The official startup opens its own chart.
        d = this.save({ ...d, native_start_requested: true });
        const opened = await this.attach(d, inputs);
        d = this.save({ ...d, chart_id: opened.chart_id, status: 'attaching' });
        let events = [];
        // The 1 s timer gives a visual-engine EA its first post-init event; allow a few of them.
        for (let attempt = 0; attempt < 40; attempt++) {
          events = await this.readTrace(d); if (initialized(events)) break;
          await sleep(250);
        }
        requireValue(initialized(events), '终端尚未确认 EA 初始化，请核对原生图表', 409);
        return this.save({ ...d, status: 'running', native_evidence: { verified: true, sequence: events.at(-1)?.seq ?? 0, observedAt: Date.now(), trace: events.slice(-32) } });
      } catch (error) {
        if (!d) throw error;
        if (d.output_path && d.native_start_requested) {
          // An uncertain startup may have attached the EA. Stop new managed
          // requests without replaying startup or closing any existing position.
          await fs.mkdir(d.output_path, { recursive: true });
          await fs.writeFile(join(d.output_path, 'stop'), 'stop', { mode: 0o600 });
        }
        // Once chart creation/attachment may have happened, never retry it automatically.
        return this.save({ ...d, status: d.native_start_requested || d.chart_id || this.storage.get('mt5_command', `${d.id}_open`, true) ? 'unknown' : 'failed', reason: this.mt5.official.redact(error.message) });
      } finally { this.busy = false; }
    });
  }
  attach(d, inputs) { return prepareTerminal(this.mt5, () => {}, { restart: true, deployment: d, inputs }); }
  async action(d, suffix, tool, args) {
    const command = await this.mt5.official.callDeployment(d.id, suffix, tool, args);
    requireValue(command.status === 'returned', command.error ?? '终端未确认操作结果，请核对图表', 409, 'deployment_unknown');
    return nativeData(command.result);
  }
  async stop(key) {
    return this.track(async () => {
      let d = this.storage.get('mt5_deployment', key); if (d.status === 'stopped') return d;
      requireValue(d.chart_id, '原生图表 ID 未确认，请先核对 MT5 图表', 409);
      const { scope } = await this.mt5.market.connected(); requireValue(scope.login === d.login && scope.server === d.server, '请连接此挂载所属账户', 409);
      try {
        // Persistent stop marker blocks new managed requests even if detach loses its response.
        if (d.output_path) { await fs.mkdir(d.output_path, { recursive: true }); await fs.writeFile(join(d.output_path, 'stop'), 'stop', { mode: 0o600 }); }
        await this.action(d, 'stop', 'chart_remove_expert', { chart_id: d.chart_id });
        d = this.save({ ...d, status: 'stopped', reason: null });
      } catch (error) { d = this.save({ ...d, status: 'unknown', reason: this.mt5.official.redact(error.message) }); }
      return d;
    });
  }
  async readTrace(d) {
    if (!d.output_path) return [];
    const archive = join(this.storage.directory, 'mt5/deployments', d.id);
    let path = join(d.output_path, 'trace.ndjson');
    const exists = path => fs.lstat(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    let stat = await exists(path);
    if (!stat) { path = join(archive, 'trace.ndjson'); stat = await exists(path); }
    if (!stat) return [];
    requireValue(stat.isFile() && stat.size <= 32 * 1024 * 1024, '原生轨迹文件超出读取限制');
    const text = await fs.readFile(path, 'utf8'), last = text.lastIndexOf('\n');
    const events = text.slice(0, last + 1).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    requireValue(events.length <= 200000 && events.every((e, i) => e.build_id === d.build_id && e.seq === i + 1), '轨迹构建或序列不一致');
    if (path !== join(archive, 'trace.ndjson')) {
      await fs.mkdir(archive, { recursive: true }); await fs.writeFile(join(archive, 'trace.ndjson'), text.slice(0, last + 1), { mode: 0o600 });
    }
    return events;
  }
  async tradeDetail(key) {
    const trade = this.mt5.market.trade(key), scope = this.mt5.market.scope();
    for (const d of this.list().filter(d => d.server === scope.server && d.login === scope.login && d.symbol === trade.symbol)) {
      const trace = correlatedTrace(trade, await this.readTrace(d)); if (!trace.length) continue;
      const revision = this.storage.get('mt5_revision', `${d.project_id}:${d.revision}`);
      return { origin: { mode: 'live', deployment_id: d.id }, trade, fills: [trade.raw], engine: revision.engine ?? null, rule_graph: { ...revision.rules, revision: d.revision, artifact_digest: d.artifact_digest, parameters: d.parameters, risk_limits: d.risk_limits }, trace_status: 'partial', trace_reason: '仅展示与真实订单或成交票据关联的原生记录。', trace: { items: trace, snapshot_sequence: trace.at(-1)?.seq ?? 0, truncated: false, time_basis: TIME_BASIS } };
    }
    return { origin: { mode: 'live', deployment_id: null }, trade, fills: [trade.raw], engine: null, rule_graph: null, trace_status: 'unavailable', trace_reason: '此成交没有关联的策略运行记录；手动交易、外部 EA 或券商自动成交不推断信号。', trace: { items: [], snapshot_sequence: 0, truncated: false, time_basis: TIME_BASIS } };
  }
  async close() { await Promise.allSettled([...this.jobs]); }
}
