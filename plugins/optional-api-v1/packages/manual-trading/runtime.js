import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { AsyncResource } from 'node:async_hooks';
import { generateKeyPairSync, sign } from 'node:crypto';
import { check, payload } from './adapters.js';
import { createTradingMemory } from './memory.js';
import { accountKey, cleanError, clone, makePlan, TERMINAL, triggerIdentity, validateDecision } from './plans.js';
import { ROLE_PROMPTS, SYSTEM, stages, taskTools } from './team.js';
import { ensureReportFolder, writeDailyReport } from './reports.js';
import { applyPortfolio } from './portfolio.js';
import { ACTIVITY_LIMIT, TASK_TERMINAL, activityChanges, appendActivity, publicOutput, taskStageIndex } from './activity.js';

export class TradingRuntime {
  constructor(host, { now = Date.now, timer = true, activityPollMs = 500, activityLimit = ACTIVITY_LIMIT, mockModelResponses = false } = {}) {
    this.host = host; this.now = now; this.timerEnabled = timer; this.running = new Map(); this.contextReads = new Map(); this.applying = new Map(); this.subscriptions = new Map(); this.closed = false;
    this.memories = new Map();
    this.executionKeys = new Map();
    check(Number.isInteger(activityLimit) && activityLimit >= 1 && activityLimit <= 10000, 'INVALID_ARGUMENT', 'Activity retention must be 1..10000 events');
    check(Number.isInteger(activityPollMs) && activityPollMs >= 10 && activityPollMs <= 60000, 'INVALID_ARGUMENT', 'Activity polling must be 10..60000 ms');
    this.activityLimit = activityLimit; this.activityPollMs = activityPollMs; this.mockModelResponses = mockModelResponses === true;
    this.activityListeners = new Set(); this.taskPolls = new Map();
    // Keep public reads in the service's activation context, not the main tool caller's task context.
    this.observationScope = new AsyncResource('sesame.manual-trading.activity', { requireManualDestroy: true });
  }
  memoryFor(plan) { if (!this.memories.has(plan.ownerConversationId)) this.memories.set(plan.ownerConversationId, createTradingMemory(this.host, { now: this.now, ownerConversationId: plan.ownerConversationId })); return this.memories.get(plan.ownerConversationId); }
  plans() { return this.host.storage.list('plans'); }
  plan(id) { const plan = this.host.storage.get('plans', id, true); check(plan, 'NOT_FOUND', 'Trading plan not found'); return plan; }
  run(id) { const run = this.host.storage.get('runs', id, true); check(run, 'NOT_FOUND', 'Trading run not found'); return run; }
  save(run, events = []) {
    // Host records are JSON. Optional fields from older ports must not make change comparison fail.
    run = JSON.parse(JSON.stringify(run));
    const previous = this.host.storage.get('runs', run.id, true), changed = canonical(previous ?? null) !== canonical(run);
    if (!changed && !events.length) return previous;
    const at = this.now(), appended = appendActivity(run, [...activityChanges(previous, run, at), ...events], { at, limit: this.activityLimit });
    if (!changed && !appended.events.length) return previous;
    const saved = this.host.storage.put('runs', appended.run);
    for (const listener of this.activityListeners) {
      try { const result = listener({ runId: run.id, run: clone(saved), events: clone(appended.events) }); result?.catch?.(() => {}); }
      catch { /* Observers cannot interrupt trading or its durable receipts. */ }
    }
    return saved;
  }
  update(id, changes) { return this.save({ ...this.run(id), ...changes }); }
  activity(id, type, fields = {}) { return this.save(this.run(id), [{ ...fields, type }]); }
  onActivity(listener) {
    check(typeof listener === 'function' && !this.closed, 'RUNTIME_CLOSED', 'A live activity listener is required');
    this.activityListeners.add(listener); return () => this.activityListeners.delete(listener);
  }
  observeTaskView(runId, taskId, observed) {
    if (!observed || observed.id !== taskId) return;
    const run = this.run(runId), before = run.tasks.find(task => task.id === taskId);
    if (!before || TASK_TERMINAL.has(before.status) && !TASK_TERMINAL.has(observed.status)) return;
    const task = { ...before, status: observed.status, conversationId: observed.conversationId ?? before.conversationId ?? null };
    if (observed.model) task.model = clone(observed.model);
    if (observed.status === 'running' && task.startedAt === undefined) {
      // The public host port has no start timestamp; this is when running was first observed.
      task.startedAt = this.now(); task.startedAtSource = 'observed';
    }
    if (TASK_TERMINAL.has(observed.status) && task.completedAt === undefined) task.completedAt = observed.completedAt ?? this.now();
    if (Array.isArray(observed.toolCalls)) task.toolCalls = observed.toolCalls.slice(0, 256).map(call => ({ id: call.id, name: call.name, status: call.status,
      ...(call.startedAt === undefined ? {} : { startedAt: call.startedAt }), ...(call.completedAt === undefined ? {} : { completedAt: call.completedAt }) }));
    this.update(runId, { tasks: run.tasks.map(value => value.id === taskId ? task : value) });
  }
  async observeTask(runId, taskId, isActive = () => !this.closed) {
    return this.observationScope.runInAsyncScope(async () => {
      if (!isActive() || typeof this.host.agents.inspect !== 'function') return;
      try {
        const observed = await this.host.agents.inspect(taskId);
        if (!isActive()) return;
        this.observeTaskView(runId, taskId, observed);
        if (!observed.conversationId || typeof this.host.tasks?.read !== 'function' || typeof this.host.messages?.read !== 'function') return;
        const conversation = await this.host.tasks.read(observed.conversationId);
        if (!isActive()) return;
        const run = this.run(runId), task = run.tasks.find(value => value.id === taskId);
        if (!task) return;
        this.update(runId, { tasks: run.tasks.map(value => value.id === taskId ? { ...value, stage: conversation.stage ?? null } : value) });
        const messageId = conversation.active_response_message_id ?? task.publicOutput?.messageId;
        if (!messageId) return;
        const output = publicOutput(await this.host.messages.read(messageId, true));
        if (!isActive() || !output) return;
        const current = this.run(runId), value = current.tasks.find(item => item.id === taskId);
        if (!value) return;
        const next = { ...value, publicOutput: output }; delete next.observationError;
        this.update(runId, { tasks: current.tasks.map(item => item.id === taskId ? next : item) });
      } catch (error) {
        if (!isActive()) return;
        const run = this.run(runId);
        this.update(runId, { tasks: run.tasks.map(task => task.id === taskId ? { ...task, observationError: cleanError(error) } : task) });
      }
    });
  }
  watchTask(runId, taskId) {
    if (typeof this.host.agents.inspect !== 'function') return () => {};
    const poll = { active: true, busy: false };
    const sample = async () => {
      if (!poll.active || poll.busy || this.closed) return;
      poll.busy = true;
      try { await this.observeTask(runId, taskId, () => poll.active && !this.closed); }
      finally { poll.busy = false; }
    };
    poll.timer = setInterval(() => { void sample(); }, this.activityPollMs); poll.timer.unref?.();
    this.taskPolls.set(taskId, poll); void sample();
    return () => { poll.active = false; clearInterval(poll.timer); this.taskPolls.delete(taskId); };
  }
  main(host) { check(host.scope.kind === 'main', 'FORBIDDEN', 'Configure trading plans in the main conversation'); }
  authorize(host, runId, roles) {
    const run = this.run(runId);
    if (host.scope.kind === 'main') { check(host.scope.conversationId === run.plan.ownerConversationId, 'FORBIDDEN', 'Trading plan belongs to another conversation'); return run; }
    const current = host.agents.current();
    check(current?.pluginId === 'sesame/manual-trading' && current.status === 'running' && current.conversationId === host.scope.conversationId && current.input?.runId === run.id &&
      current.input.tradingPlan?.id === run.planId && canonical(current.input.tradingPlan.account) === canonical(run.plan.account) &&
      run.tasks.some(task => task.id === current.id && task.role === current.input.role) && (!roles || roles.includes(current.input.role)), 'FORBIDDEN', 'Tool requires its current registered trading-plan task');
    return run;
  }
  async recoverTask(runId, task) {
    const missing = error => ['not_found', 'NOT_FOUND'].includes(error?.code);
    const observe = receipt => {
      check(receipt?.id === task.id && typeof receipt.status === 'string', 'TASK_RECEIPT_INVALID', 'Host did not return the requested task receipt during restart recovery');
      this.observeTaskView(runId, task.id, receipt); return receipt;
    };
    try {
      let receipt;
      if (typeof this.host.agents.inspect === 'function') {
        try { receipt = observe(await this.host.agents.inspect(task.id)); }
        catch (error) { if (missing(error)) throw error; /* A cancellation receipt can still establish the real state. */ }
      }
      if (!receipt || !TASK_TERMINAL.has(receipt.status)) receipt = observe(await this.host.agents.cancel(task.id, 'Trading runtime restarted; do not replay execution'));
      const run = this.run(runId);
      if (TASK_TERMINAL.has(receipt.status) && typeof receipt.result?.text === 'string' && !run.reports.some(report => report.taskId === task.id)) {
        this.update(runId, { reports: [...run.reports, { taskId: task.id, role: task.role, round: task.round, model: receipt.model ?? task.model,
          status: receipt.status, createdAt: receipt.completedAt ?? this.now(), text: receipt.result.text.slice(0, 16000) }] });
      }
    } catch (error) {
      const run = this.run(runId), at = this.now();
      this.update(runId, { tasks: run.tasks.map(value => value.id === task.id ? { ...value, observationError: cleanError(error),
        ...(missing(error) ? { status: 'interrupted', completedAt: at, recovery: { kind: 'host_task_missing', at } } : {}) } : value) });
    }
  }
  async start() {
    check(this.host.agents && this.host.inference, 'PREREQUISITE_REQUIRED', 'Manual trading plans require Sesame 0.2.2 Agent/model ports');
    for (const run of this.host.storage.list('runs')) {
      const unfinished = (run.tasks ?? []).filter(task => !TASK_TERMINAL.has(task.status));
      if (TERMINAL.has(run.status) && !unfinished.length) continue;
      // Business completion precedes the reporter. Recover both lifetimes without replaying either.
      for (const task of unfinished) await this.recoverTask(run.id, task);
      const current = this.run(run.id), recovered = this.update(run.id, { reportPending: !current.report,
        ...(!TERMINAL.has(run.status) ? { status: 'interrupted', completedAt: this.now(), error: { code: 'RESTART_INTERRUPTED', message: 'App restarted; inspect durable receipts before a new decision. This run is not replayed.' } } : {}) });
      if ((recovered.tasks ?? []).every(task => TASK_TERMINAL.has(task.status))) {
        this.activity(run.id, 'run.finished', { status: recovered.status, message: '宿主重启，已核验或中断遗留任务；未重放执行。' });
      }
    }
    for (const plan of this.plans().filter(value => value.enabled && value.accountEvents)) await this.subscribe(plan);
    if (this.timerEnabled) { this.timer = setInterval(() => { this.tick().catch(error => this.host.events?.emit('scheduler.failed', cleanError(error))); }, 1000); this.timer.unref?.(); }
    return this;
  }
  async configure(host, input, signal) {
    this.main(host);
    check(input && ['mt5', 'qmt'].includes(input.backend), 'INVALID_ARGUMENT', 'Plan and backend are required');
    const previous = input.id ? this.host.storage.get('plans', input.id, true) : null;
    check(!previous || !this.host.storage.list('runs').some(run => run.planId === previous.id && !TERMINAL.has(run.status)), 'PLAN_BUSY', 'Stop the active run before changing its frozen plan');
    const identity = payload(await host.tools.call({ pluginId: `sesame/${input.backend}`, name: `${input.backend}_trading_context`, arguments: { action: 'identity' } }, signal));
    const plan = makePlan(host, input, identity.account, previous, this.now());
    await ensureReportFolder(host, plan.reportFolder);
    this.host.storage.put('plans', plan);
    await this.unsubscribe(plan.id);
    if (plan.enabled && plan.accountEvents) await this.subscribe(plan);
    return this.plan(plan.id);
  }
  async setEnabled(host, id, enabled) {
    this.main(host); const plan = this.plan(id);
    this.host.storage.put('plans', { ...plan, enabled, updatedAt: this.now(), nextDueAt: enabled && plan.intervalMinutes ? this.now() + plan.intervalMinutes * 60000 : plan.nextDueAt });
    if (!enabled) {
      await this.unsubscribe(id);
      for (const run of this.host.storage.list('runs').filter(value => value.planId === id && !TERMINAL.has(value.status))) this.cancel(run.id, 'Trading plan paused');
    } else if (plan.accountEvents) await this.subscribe(this.plan(id));
    return this.plan(id);
  }
  trigger(planId, trigger) {
    check(!this.closed, 'RUNTIME_CLOSED', 'Trading runtime is stopped');
    const plan = this.plan(planId), id = triggerIdentity(plan, trigger), previous = this.host.storage.get('runs', id, true);
    if (previous) { check(canonical(previous.trigger) === canonical(trigger), 'IDEMPOTENCY_CONFLICT', 'Event ID already has different input'); return previous; }
    check(plan.enabled, 'PLAN_PAUSED', 'Trading plan is paused');
    check(Buffer.byteLength(JSON.stringify(trigger)) <= 12000, 'INVALID_ARGUMENT', 'Event payload exceeds 12 KB');
    for (const queued of this.host.storage.list('runs').filter(run => run.planId === plan.id && run.status === 'queued')) {
      this.update(queued.id, { status: 'cancelled', completedAt: this.now(), supersededBy: id });
      this.activity(queued.id, 'run.finished', { status: 'cancelled', message: '尚未开始的运行已被新事件替换。' });
    }
    const run = this.save({ id, planId: plan.id, plan, trigger: clone(trigger), status: 'queued', createdAt: this.now(), tasks: [], reports: [], reportPending: true, mockModelResponses: this.mockModelResponses });
    this.host.storage.put('plans', { ...plan, lastRunId: id }); this.pump(); return run;
  }
  event(key, eventId, data = {}, at) {
    if (at !== undefined) check(Number.isSafeInteger(at) && at <= this.now() && this.now() - at <= 86400000, 'STALE_EVENT', 'Event must be observed within the last day');
    check(typeof key === 'string' && typeof eventId === 'string' && eventId.length > 0, 'INVALID_ARGUMENT', 'Event key and stable ID are required');
    return this.plans().filter(plan => plan.enabled && plan.eventKeys.includes(key)).map(plan => this.trigger(plan.id, { kind: 'event', id: `${key}:${eventId}`, key, ...(at === undefined ? {} : { observedAt: at }), data }));
  }
  async tick() {
    if (this.closed || this.ticking) return;
    this.ticking = true;
    try {
      for (const plan of this.plans().filter(value => value.enabled && value.intervalMinutes && value.nextDueAt <= this.now())) {
        this.host.storage.put('plans', { ...plan, nextDueAt: this.now() + plan.intervalMinutes * 60000 });
        this.trigger(plan.id, { kind: 'interval', id: String(plan.nextDueAt), observedAt: this.now() });
      }
      for (const plan of this.plans().filter(value => value.enabled && value.accountEvents && value.eventRetryAt && value.eventRetryAt <= this.now())) await this.subscribe(plan);
      this.pump();
    } finally { this.ticking = false; }
  }
  pump() {
    if (this.closed) return;
    for (const run of this.host.storage.list('runs').filter(value => value.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)) {
      const key = accountKey(run.plan), plan = this.plan(run.planId);
      if (!plan.enabled || this.running.has(key)) continue;
      const last = plan.lastEventAt ?? 0;
      if (run.trigger.kind === 'event' && this.now() - last < plan.eventCooldownMs) continue;
      if (run.trigger.kind === 'event') this.host.storage.put('plans', { ...plan, lastEventAt: this.now() });
      const controller = new AbortController(), entry = { runId: run.id, controller };
      this.running.set(key, entry);
      entry.promise = this.execute(run.id, controller.signal).catch(error => this.host.events?.emit('run.failed', { runId: run.id, ...cleanError(error) })).finally(() => { this.running.delete(key); this.pump(); });
    }
  }
  researchAvailable() { try { return this.host.plugins.inspect('sesame/financial-research').state !== 'disabled'; } catch { return false; } }
  async task(runId, role, round, signal) {
    signal?.throwIfAborted(); const run = this.run(runId), plan = run.plan;
    const model = plan.agentModels[role] ?? plan.model;
    if (role === 'executor' && !this.executionKeys.has(runId)) this.executionKeys.set(runId, generateKeyPairSync('ed25519'));
    const executionPublicKey = role === 'executor' ? this.executionKeys.get(runId).publicKey.export({ type: 'spki', format: 'pem' }) : undefined;
    const task = this.host.agents.submit({ requestId: `${run.id}:${role}:${round}`, title: `${plan.title.slice(0, 50)} · ${role} ${round}`, kind: 'research',
      instructions: role === 'reporter' ? '只调用 manual_trading_report，为指定运行归档已有真实记录，不作交易、不改决策。' : `${SYSTEM}\n\n本角色：${ROLE_PROMPTS[role]}\n\n计划要求：${plan.instructions}`,
      input: { tradingPlan: { id: plan.id, backend: plan.backend, account: plan.account, ownerConversationId: plan.ownerConversationId, researchPlugins: plan.researchPlugins ?? [] }, runId, role, round, trigger: run.trigger, ...(executionPublicKey ? { executionPublicKey } : {}) },
      tools: taskTools(plan, role, this.researchAvailable()), model, lane: `${digest(accountKey(plan)).slice(7, 39)}:${role}`, queue: 'fifo', timeoutMs: plan.taskTimeoutMs,
      maxTurns: role === 'executor' || role === 'reporter' ? 4 : 16, maxToolCalls: role === 'executor' ? 256 : 48 });
    this.update(runId, { tasks: [...this.run(runId).tasks, { id: task.id, role, round, stageIndex: taskStageIndex(plan, role, round), model, status: task.status, createdAt: task.createdAt ?? this.now() }] });
    let result, stopObserving = () => {};
    try {
      const waiting = this.host.agents.wait(task.id, signal); stopObserving = this.watchTask(runId, task.id);
      result = await waiting;
      this.observeTaskView(runId, task.id, result);
    } catch (error) {
      try { this.observeTaskView(runId, task.id, await this.host.agents.cancel(task.id, 'Trading task wait stopped')); }
      catch { /* Keep the original wait error; cancellation may already have completed. */ }
      throw error;
    } finally { stopObserving(); }
    const current = this.run(runId);
    this.update(runId, { tasks: current.tasks.map(value => value.id === task.id ? { ...value, status: result.status, conversationId: result.conversationId } : value),
      reports: [...current.reports, { taskId: task.id, role, round, model: result.model ?? model, status: result.status, createdAt: this.now(), text: String(result.result?.text ?? result.error ?? '').slice(0, 16000) }] });
    check(result.status === 'completed', 'AGENT_FAILED', `${role} task ${result.status}: ${String(result.error ?? '').slice(0, 300)}`);
    return result;
  }
  async execute(id, signal) {
    this.update(id, { status: 'researching', startedAt: this.now() });
    try {
      let round = 0;
      for (const stage of stages(this.run(id).plan)) {
        const results = await Promise.allSettled(stage.map(role => this.task(id, role, round, signal))); round++;
        const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
      }
      check(this.run(id).decision, 'NO_DECISION', 'Manager did not save a valid target portfolio'); signal.throwIfAborted();
      await this.task(id, 'executor', round, signal);
      check(this.run(id).execution, 'NOT_EXECUTED', 'Executor did not return a durable execution result');
      const run = this.update(id, { status: 'completed', completedAt: this.now() });
      this.recordMemory(run);
    } catch (error) {
      const run = this.update(id, { status: signal.aborted ? 'cancelled' : 'failed', completedAt: this.now(), error: cleanError(error) });
      if (run.decision) this.recordMemory(run);
    } finally {
      this.executionKeys.delete(id);
      const run = this.run(id);
      if (!run.report && !this.closed && !signal.aborted) {
        try { await this.task(id, 'reporter', 0, signal); }
        catch (error) { this.update(id, { reportPending: true, reportError: cleanError(error) }); }
      }
      this.activity(id, 'run.finished', { status: this.run(id).status, message: `本轮工作流结束：${this.run(id).status}。` });
      this.host.events?.emit('run.finished', { runId: id, planId: run.planId, status: this.run(id).status, reportPending: this.run(id).reportPending });
    }
  }
  recordMemory(run) {
    try { this.memoryFor(run.plan).record({ id: run.id, planId: run.planId, accountId: accountKey(run.plan),
      symbols: [...new Set([...run.plan.symbols, ...(run.snapshot?.positions ?? []).map(row => row.symbol ?? row.stock_code).filter(Boolean)])],
      snapshot: { account: run.snapshot.account, capturedAt: run.snapshot.capturedAt, summary: run.snapshot.summary, positions: run.snapshot.positions.slice(0, 100), positionCount: run.snapshot.positions.length, fullSnapshotRunId: run.id }, decision: run.decision,
      reports: run.reports.filter(report => report.role !== 'reporter').map(report => ({ ...report, text: report.text.slice(0, 4000), fullReportRunId: run.id, excerpt: report.text.length > 4000 })),
      execution: run.execution ? { status: run.execution.status, targetReached: run.execution.targetReached, operationIds: run.execution.orders.map(order => order.operationId), fullReceiptRunId: run.id } : null, decisionAt: run.decidedAt, createdAt: this.now() }); }
    catch (error) { this.update(run.id, { memoryError: cleanError(error) }); }
  }
  async context(host, id, section = 'all', offset = 0, limit = 50, signal) {
    this.authorize(host, id);
    if (!this.run(id).snapshot) {
      if (!this.contextReads.has(id)) this.contextReads.set(id, (async () => {
        const run = this.run(id), snapshot = payload(await host.tools.call({ pluginId: `sesame/${run.plan.backend}`, name: `${run.plan.backend}_trading_context`, arguments: { action: 'snapshot', history_days: 30 } }, signal));
        check(canonical(snapshot.account) === canonical(run.plan.account), 'ACCOUNT_CHANGED', 'Configured account changed after this plan was saved');
        check(Array.isArray(snapshot.positions) && Buffer.byteLength(JSON.stringify(snapshot)) <= 1024 * 1024, 'SOURCE_DATA_INVALID', 'Account snapshot missing or exceeds 1 MiB');
        const memoryContext = this.memoryFor(run.plan).context({ planId: run.planId, accountId: accountKey(run.plan), symbols: [...new Set([...run.plan.symbols, ...snapshot.positions.map(row => row.symbol ?? row.stock_code).filter(Boolean)])], asOf: this.now(), limit: 8 });
        this.update(id, { snapshot, memoryContext });
      })().finally(() => this.contextReads.delete(id)));
      await this.contextReads.get(id);
    }
    const run = this.run(id), snapshot = run.snapshot;
    const page = rows => ({ items: (rows ?? []).slice(offset, offset + limit), total: (rows ?? []).length, nextOffset: offset + limit < (rows ?? []).length ? offset + limit : null });
    const result = { runId: id, plan: run.plan, capturedAt: snapshot.capturedAt,
      ...(['all', 'account'].includes(section) ? { account: snapshot.account, summary: snapshot.summary, positions: page(snapshot.positions), deployments: page(snapshot.deployments), coverage: snapshot.historyCoverage } : {}),
      ...(['all', 'history'].includes(section) ? { orders: page(snapshot.orders), fills: page(snapshot.fills), historicalOrders: page(snapshot.historicalOrders) } : {}),
      ...(['all', 'team'].includes(section) ? { reports: page(run.reports) } : {}),
      ...(['all', 'memory'].includes(section) ? { memory: run.memoryContext } : {}) };
    if (host.scope.kind === 'subagent' && result.reports) {
      this.authorize(host, id);
      const current = host.agents.current();
      const reads = result.reports.items.filter(report => report.taskId !== current.id && run.tasks.some(task => task.id === report.taskId)).map(report => ({
        type: 'report.read', fromTaskId: report.taskId, toTaskId: current.id, taskId: current.id, role: current.input.role,
        message: `${current.input.role} 已读取 ${report.role} 的公开报告。` }));
      if (reads.length) this.save(this.run(id), reads);
    }
    return result;
  }
  decide(host, id, decision) {
    const run = this.authorize(host, id, ['manager']);
    check(this.plan(run.planId).enabled && !TERMINAL.has(run.status) && run.snapshot, 'RUN_NOT_READY', 'Read this active run account context before deciding');
    const value = validateDecision(run.plan, run.snapshot, decision);
    if (run.decision) { check(canonical(run.decision) === canonical(value), 'DECISION_FROZEN', 'This run already has a different frozen target'); return run.decision; }
    const evidence = value.evidence_dataset_ids.map(datasetId => {
      const dataset = host.datasets.read(datasetId);
      check(Buffer.byteLength(JSON.stringify(dataset)) <= 256000, 'EVIDENCE_TOO_LARGE', 'Select bounded research datasets');
      return { datasetId, capturedAt: this.now(), digest: digest(dataset), dataset };
    });
    check(Buffer.byteLength(JSON.stringify(evidence)) <= 512000, 'EVIDENCE_TOO_LARGE', 'Combined decision evidence exceeds 512 KB; select bounded datasets');
    this.update(id, { decision: value, decidedAt: this.now(), evidence, status: 'decided' }); return value;
  }
  async apply(host, id, signal) {
    const run = this.authorize(host, id, ['executor']);
    if (run.execution) return run.execution;
    check(this.plan(run.planId).enabled && run.decision && !TERMINAL.has(run.status), 'RUN_NOT_READY', 'Run is not active with a saved decision');
    if (!this.applying.has(id)) this.applying.set(id, (async () => {
      this.update(id, { status: 'executing', executionStartedAt: this.now() });
      const assertActive = () => { this.authorize(host, id, ['executor']); check(this.plan(run.planId).enabled && !TERMINAL.has(this.run(id).status), 'PLAN_PAUSED', 'Trading plan stopped'); signal?.throwIfAborted(); };
      const authorizeRequest = (action, args) => {
        assertActive();
        const task = host.agents.current(), key = this.executionKeys.get(id);
        check(task?.id && key, 'EXECUTION_KEY_UNAVAILABLE', 'This executor no longer has a live intent-signing key');
        const expiresAt = this.now() + 30000;
        const signature = sign(null, Buffer.from(canonical({ version: 1, taskId: task.id, runId: id, action, args, expiresAt })), key.privateKey).toString('base64');
        return { ...args, authorization: { expiresAt, signature } };
      };
      const execution = await applyPortfolio(host, this.run(id), { now: this.now, signal, assertActive, authorizeRequest, checkpoint: changes => this.update(id, changes) });
      this.update(id, { execution, reportPending: true }); return execution;
    })().finally(() => this.applying.delete(id)));
    return this.applying.get(id);
  }
  async archive(host, id) {
    const run = this.authorize(host, id, ['executor', 'reporter']);
    check(TERMINAL.has(run.status), 'RUN_NOT_FINISHED', 'Archive after the run has finished so all role reports and receipts are included');
    const report = await writeDailyReport(host, run); this.update(id, { report, reportPending: false }); return report;
  }
  review(host, args) {
    const current = this.authorize(host, args.current_run_id), reviewed = this.run(args.run_id);
    check(accountKey(current.plan) === accountKey(reviewed.plan) && current.plan.ownerConversationId === reviewed.plan.ownerConversationId, 'FORBIDDEN', 'Review belongs to another account');
    return this.memoryFor(current.plan).review({ runId: reviewed.id, asOf: this.now(), evidence: args.evidence, reflection: args.reflection });
  }
  cancel(id, reason) {
    const run = this.run(id); if (TERMINAL.has(run.status)) return run;
    this.update(id, { status: 'cancelled', completedAt: this.now(), error: { code: 'CANCELLED', message: reason } });
    for (const task of run.tasks) try { this.observeTaskView(id, task.id, this.host.agents.cancel(task.id, reason)); } catch { /* Already finished. */ }
    const active = this.running.get(accountKey(run.plan));
    if (active?.runId === id) active.controller.abort(new Error(reason));
    else this.activity(id, 'run.finished', { status: 'cancelled', message: '本轮已取消。' });
    return this.run(id);
  }
  async subscribe(plan) {
    await this.unsubscribe(plan.id);
    try {
      const binding = await this.host.providers.bind({ pluginId: `sesame/${plan.backend}`, providerId: 'account' });
      this.subscriptions.set(plan.id, { bindingId: binding.bindingId });
      check(!this.closed && this.plan(plan.id).enabled && this.plan(plan.id).revision === plan.revision, 'PLAN_CHANGED', 'Plan stopped or changed while binding account events');
      check(binding.connection?.revision === plan.account.revision, 'ACCOUNT_CHANGED', 'Event binding account revision differs from plan');
      const stream = await this.host.providers.subscribe(binding.bindingId, 'subscribeAccount', { account: binding.accounts[0], topics: ['positions', 'orders'] });
      this.subscriptions.set(plan.id, { bindingId: binding.bindingId, stream });
      check(!this.closed && this.plan(plan.id).enabled && this.plan(plan.id).revision === plan.revision, 'PLAN_CHANGED', 'Plan stopped or changed while subscribing account events');
      const previous = new Map();
      const content = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(content) : Object.fromEntries(Object.entries(value).filter(([key]) => !['observedAt', 'updatedAt', 'revision', 'snapshotId'].includes(key)).map(([key, item]) => [key, content(item)])) : value;
      stream.ready(event => {
        if (this.closed || !this.plan(plan.id).enabled) return;
        if (event.type === 'stream.gap') {
          this.host.storage.put('plans', { ...this.plan(plan.id), eventStatus: 'reconnecting', eventError: event.reason, eventRetryAt: this.now() + 10000 });
          this.unsubscribe(plan.id).catch(error => this.host.events?.emit('event.failed', cleanError(error)));
          try { this.trigger(plan.id, { kind: 'event', id: `gap:${binding.bindingId}`, data: { type: 'stream.gap', reason: event.reason } }); } catch (error) { this.host.events?.emit('event.failed', cleanError(error)); }
          return;
        }
        if (event.type === 'positions.upsert' || event.type === 'orders.upsert') {
          const key = digest(content(event.payload)); if (key === previous.get(event.type)) return; previous.set(event.type, key);
          try { this.trigger(plan.id, { kind: 'event', id: `account:${digest([binding.bindingId, event.eventId, event.epoch, event.seq]).slice(7)}`, observedAt: event.observedAt, data: { type: event.type, message: 'Account state changed; read a fresh full snapshot before deciding' } }); }
          catch (error) { this.host.events?.emit('event.failed', { planId: plan.id, ...cleanError(error) }); }
        }
      });
      this.host.storage.put('plans', { ...this.plan(plan.id), eventStatus: 'subscribed', eventError: null, eventRetryAt: null });
    } catch (error) {
      await this.unsubscribe(plan.id);
      this.host.storage.put('plans', { ...this.plan(plan.id), eventStatus: 'unavailable', eventError: cleanError(error), eventRetryAt: error.code === 'UNSUPPORTED_CAPABILITY' ? null : this.now() + 60000 });
    }
  }
  async unsubscribe(id) { const sub = this.subscriptions.get(id); this.subscriptions.delete(id); if (sub) { await sub.stream?.close(); await this.host.providers.unbind(sub.bindingId); } }
  async dispose() {
    this.closed = true; clearInterval(this.timer);
    for (const poll of this.taskPolls.values()) { poll.active = false; clearInterval(poll.timer); }
    this.taskPolls.clear();
    for (const value of this.running.values()) {
      this.cancel(value.runId, 'Trading plugin stopped');
      // A terminal business run can still have a reporter in flight.
      value.controller.abort(new Error('Trading plugin stopped'));
      for (const task of this.run(value.runId).tasks) try { this.host.agents.cancel(task.id, 'Trading plugin stopped'); } catch { /* Already finished. */ }
    }
    await Promise.allSettled([...this.subscriptions.keys()].map(id => this.unsubscribe(id)));
    await Promise.allSettled([...this.running.values()].map(value => value.promise));
    this.activityListeners.clear();
    if (!this.observationScopeDestroyed) { this.observationScope.emitDestroy(); this.observationScopeDestroyed = true; }
  }
}
