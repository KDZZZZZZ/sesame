import { records } from './records.js';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { AsyncResource, AsyncLocalStorage } from 'node:async_hooks';
import { datasetSnapshot } from './data.js';
import { check } from './shared.js';
import { bindExecution, executionCall, verifyComposition, declaredCalls, selectResearch, catalog } from './composition.js';
import { createTradingMemory } from './memory.js';
import { accountKey, cleanError, clone, makePlan, selectModel, TERMINAL, triggerIdentity, validateDecision } from './plans.js';
import { SYSTEM, ANALYSIS_SYSTEM, rolePrompt, TRADING_MEMORY, usesTradingMemory, stages, collaboration, taskTools, taskPlugins } from './team.js';
import { reportPath, writeDailyReport } from './reports.js';
const TASK_TERMINAL = new Set(['completed', 'canceled', 'cancelled', 'expired', 'unknown', 'superseded']);
const interruption = (error, signal) => ['RUN_INTERRUPTED', 'DEPENDENCY_UNAVAILABLE'].includes(error?.code) ? error
  : ['RUN_INTERRUPTED', 'DEPENDENCY_UNAVAILABLE'].includes(signal?.reason?.code) ? signal.reason : null;
const dependencyCodes = new Set(['DEPENDENCY_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'MODEL_CHANGED', 'PLUGIN_CHANGED', 'PREREQUISITE_REQUIRED', 'TOOL_NOT_DELEGATABLE', 'MT5_PYTHON_UNAVAILABLE', 'SOURCE_UNAVAILABLE', 'PROVIDER_UNAVAILABLE']);
const requirement = id => ({ id: 'trading-dependencies', capability: 'sesame/manual-trading#workflow_dependencies', input: { runId: id }, reason: 'The frozen trading plan requires its selected configuration and live execution context.' });
const dependencyError = (id, error) => Object.assign(new Error(error.message), { code: 'DEPENDENCY_UNAVAILABLE', details: { requirements: [requirement(id)], cause: cleanError(error), ...error.details } });
const publishesReport = plan => plan.purpose !== 'analysis' || plan.publishReport === true;
const schedulingKey = plan => plan.purpose === 'analysis' ? `analysis:${plan.id}` : accountKey(plan);
const analysisWriteEffect = /^(?:broker\.write|external-trading|external-strategy-operation|application-configuration|invoke:selected-execution|(?:write:plans|manage:|start:|cancel:workflow|control:workflow)|native-(?:connection|process-start)|may-(?:start|resume)-|process\.(?:exec|cancel)|plugin\.(?:install|update|remove|policy)|plugin\.state\.write-on-configure)/;

export class TradingRuntime {
  constructor(host, { now = Date.now, timer = true, mockModelResponses = false } = {}) {
    this.host = host; this.invocation = new AsyncLocalStorage(); this.now = now; this.timerEnabled = timer; this.running = new Map(); this.contextReads = new Map(); this.applying = new Map(); this.subscriptions = new Map(); this.closed = false;
    this.memories = new Map();
    this.mockModelResponses = mockModelResponses === true;
    this.archiving = new Map(); this.cancelling = new Set(); this.executions = new Map(); this.workHosts = new Map();
    this.analysisAdmissions = new Map();
    this.executionScope = new AsyncResource('sesame.manual-trading.scheduler', { requireManualDestroy: true });
  }
  currentAgent() { const call = this.invocation.getStore(); call?.signal?.throwIfAborted(); return call?.provenance?.agent; }
  notify(topic, payload) { try { Promise.resolve(this.host.events.emit({ topic: `workspace.manual-trading.${topic}`, payload })).catch(() => {}); } catch { /* Diagnostics do not change execution receipts. */ } }
  taskView(run) { return { id: run.id, status: run.status, conversationId: run.executionSessionId ?? run.output?.sessionId ?? run.progress?.sessionId ?? null,
    createdAt: run.createdAt, completedAt: run.completedAt, model: run.output?.model, result: run.output ?? null, error: run.error,
    ...(Array.isArray(run.output?.toolCalls) ? { toolCalls: run.output.toolCalls } : {}) }; }
  async waitTask(id, signal, observe = () => {}, host = this.host) {
    let run = (await host.runs.read({ id })).run;
    for (;;) {
      const view = this.taskView(run); observe(view);
      if (run.status === 'interrupted') throw Object.assign(new Error(run.interrupts?.find(item => !item.resolvedAt)?.reason ?? 'Child Agent is interrupted'), { code: 'RUN_INTERRUPTED', details: { childRunId: run.id, interrupts: run.interrupts } });
      if (TASK_TERMINAL.has(run.status)) return view;
      run = (await host.runs.wait({ id }, { until: 'changed', afterVersion: run.revision, timeoutMs: 60000, signal })).run;
    }
  }
  memoryFor(plan) { if (!this.memories.has(plan.ownerConversationId)) this.memories.set(plan.ownerConversationId, createTradingMemory(this.host, { now: this.now, ownerConversationId: plan.ownerConversationId })); return this.memories.get(plan.ownerConversationId); }
  plans() { return records(this.host).list('plans'); }
  plan(id) { const plan = records(this.host).get('plans', id, true); check(plan, 'NOT_FOUND', 'Trading plan not found'); return plan; }
  run(id) { const run = records(this.host).get('runs', id, true); check(run, 'NOT_FOUND', 'Trading run not found'); return run; }
  save(run, events = []) {
    run = JSON.parse(JSON.stringify(run));
    const previous = records(this.host).get('runs', run.id, true);
    if (canonical(previous ?? null) === canonical(run) && !events.length) return previous;
    const saved = records(this.host).put('runs', { ...run, events: [...(run.events ?? []), ...events].slice(-2000) });
    if (previous?.status !== saved.status) this.executions.get(run.id)?.progress({ phase: saved.status, summary: saved.status });
    return saved;
  }
  update(id, changes) { return this.save({ ...this.run(id), ...changes }); }
  async checkpoint(id) {
    const execution = this.executions.get(id), run = this.run(id);
    if (execution) await execution.checkpoint({ runId: id, stageIndex: run.stageIndex ?? 0 });
  }
  async dependencies(host, id, signal) {
    const run = this.run(id), plan = run.plan;
    try {
      check(this.plan(run.planId).enabled, 'PLAN_PAUSED', 'The frozen trading plan is paused; resume the plan before its workflow.');
      check(!run.executionStartedAt || run.execution, 'EXECUTION_OUTCOME_UNKNOWN', 'An execution was already sent without a saved receipt. Reconcile that original run; no action will be resent.');
      const manager = run.tasks.find(task => task.role === 'manager' && task.status === 'completed');
      if (manager && plan.purpose !== 'analysis') check(run.decision, 'NO_DECISION', 'The completed manager did not save its target. The main Agent can read manual_trading_context, verify the retained analysis and existing trading authorization, and use manual_trading_decide before resuming this workflow.');
      if (manager && plan.purpose === 'analysis') check(run.reports.find(report => report.taskId === manager.id && report.status === 'completed')?.text?.trim(), 'NO_ANALYSIS', 'The completed research manager returned no Markdown synthesis. Its Run and prior evidence are retained; no registered capability can submit that missing role output on its behalf.');
      if (run.tasks.some(task => task.role === 'executor' && task.status === 'completed')) check(run.execution, 'NOT_EXECUTED', 'The completed executor did not save an execution receipt. Reconcile the original operation IDs before resuming; the workflow cannot infer a trade from its text or repeat the completed Agent.');
      if (!run.execution) {
        await verifyComposition(host, plan.execution);
        const pending = stages(plan).slice(run.stageIndex ?? 0).flat();
        if (pending.length) await verifyComposition(host, plan.research);
        const roles = [...new Set([...pending, ...(plan.purpose === 'analysis' ? [] : ['executor'])])];
        for (const role of roles) selectModel(host, plan.agentModels[role] ?? plan.model);
        if (roles.some(role => usesTradingMemory(role, plan))) await selectResearch(host, { plugins: [TRADING_MEMORY.pluginId], tools: [] });
        await declaredCalls(host, [...new Set(roles.flatMap(role => taskTools(plan, role)))], ['sesame/manual-trading', ...new Set(roles.flatMap(role => taskPlugins(plan, role)))]);
        const snapshot = await executionCall(host, plan.execution, 'context', { action: 'snapshot', history_days: 30 }, signal);
        check(canonical(snapshot.account) === canonical(plan.account), 'ACCOUNT_CHANGED', 'Selected execution account differs from the frozen plan.');
        for (const key of ['positions', 'orders', 'fills', 'historicalOrders', 'deployments']) check(Array.isArray(snapshot[key]), 'SOURCE_DATA_INVALID', `Execution snapshot must include ${key}`);
      }
      return { available: true, details: { runId: id, stageIndex: run.stageIndex ?? 0, executionRetained: Boolean(run.execution) } };
    } catch (error) {
      signal?.throwIfAborted();
      return { available: false, reason: error.message, details: { runId: id, cause: cleanError(error), ...(error.details ? { causeDetails: clone(error.details) } : {}) } };
    }
  }
  activity(id, type, data) { return this.save(this.run(id), [{ type, at: this.now(), ...data }]); }
  executor(host, run, execution) {
    const proof = execution?.provenance?.workflow;
    check(host.context.kind === 'subagent' && proof?.runId === host.context.runId && proof.sessionId === host.context.sessionId && proof.ownerSessionId === run.plan.ownerConversationId && execution.provenance.caller.pluginId === 'sesame/manual-trading',
      'FORBIDDEN', 'Requires the trusted workflow execution for this plan owner');
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
  main(host) { check(host.context.kind === 'main', 'FORBIDDEN', 'Configure trading plans in the main conversation'); }
  ownedPlan(host, id) { this.main(host); const plan = this.plan(id); check(plan.ownerConversationId === host.context.sessionId, 'FORBIDDEN', 'Trading plan belongs to another conversation'); return plan; }
  authorize(host, runId, roles) {
    const run = this.run(runId);
    if (host.context.kind === 'main') { check(host.context.sessionId === run.plan.ownerConversationId, 'FORBIDDEN', 'Trading plan belongs to another conversation'); return run; }
    const current = this.currentAgent();
    check(current?.pluginId === 'sesame/manual-trading' && current.sessionId === host.context.sessionId && current.input?.runId === run.id &&
      current.input.tradingPlan?.id === run.planId && canonical(current.input.tradingPlan.account) === canonical(run.plan.account) &&
      run.tasks.some(task => task.id === current.runId && task.role === current.input.role) && (!roles || roles.includes(current.input.role)), 'FORBIDDEN', 'Tool requires its current registered trading-plan task');
    return run;
  }
  async recoverTask(runId, task) {
    try {
      let run = (await this.host.runs.read({ id: task.id })).run;
      if (!TASK_TERMINAL.has(run.status)) { await this.host.runs.cancel({ id: task.id }, { reason: 'Trading runtime restarted; do not replay execution' }); run = (await this.host.runs.wait({ id: task.id }, { until: 'settled', timeoutMs: 60000 })).run; }
      const receipt = this.taskView(run); this.observeTaskView(runId, task.id, receipt);
      const current = this.run(runId);
      if (TASK_TERMINAL.has(receipt.status) && typeof receipt.result?.text === 'string' && !current.reports.some(report => report.taskId === task.id)) this.update(runId, { reports: [...current.reports, { taskId: task.id, role: task.role, round: task.round, model: receipt.model ?? task.model, status: receipt.status, createdAt: receipt.completedAt ?? this.now(), text: receipt.result.text.slice(0, 16000) }] });
    } catch (error) {
      const current = this.run(runId), at = this.now();
      this.update(runId, { tasks: current.tasks.map(value => value.id === task.id ? { ...value, observationError: cleanError(error),
        ...(['not_found', 'NOT_FOUND'].includes(error.code) ? { status: 'interrupted', completedAt: at, recovery: { kind: 'host_run_missing', at } } : {}) } : value) });
    }
  }
  async start() {
    check(this.host.capabilities && this.host.runs, 'PREREQUISITE_REQUIRED', 'Manual trading requires declared Agent capabilities and Runs');
    for (const run of records(this.host).list('runs')) {
      if (run.workflow && !TERMINAL.has(run.status)) {
        // The host owns recovery of accepted Runs. Keep their identities and
        // receipts; never cancel/recreate them during plugin activation.
        this.update(run.id, { status: 'interrupted', reportPending: Boolean(run.reportPending), error: { code: 'RUN_INTERRUPTED', message: 'Saved workflow retained; resume its host Run after checking dependencies.' } });
        continue;
      }
      const unfinished = (run.tasks ?? []).filter(task => !TASK_TERMINAL.has(task.status));
      if (TERMINAL.has(run.status) && !unfinished.length) continue;
      // Recover observed child executions without replaying uncertain external effects.
      for (const task of unfinished) await this.recoverTask(run.id, task);
      const current = this.run(run.id), recovered = this.update(run.id, { reportPending: !current.report,
        ...(!TERMINAL.has(run.status) ? { status: 'interrupted', completedAt: this.now(), error: { code: 'RESTART_INTERRUPTED', message: 'App restarted; inspect durable receipts before a new decision. This run is not replayed.' } } : {}) });
      if ((recovered.tasks ?? []).every(task => TASK_TERMINAL.has(task.status))) {
        this.activity(run.id, 'run.finished', { status: recovered.status, message: '宿主重启，已核验或中断遗留任务；未重放执行。' });
      }
    }
    for (const plan of this.plans()) {
      if (!plan.execution) records(this.host).put('plans', { ...plan, enabled: false, migrationRequired: 'Select an independent execution capability before resuming this legacy plan' });
      else if (plan.enabled && plan.accountEvents) await this.subscribe(plan);
    }
    if (this.timerEnabled) { this.timer = setInterval(() => { this.tick().catch(error => this.notify('scheduler.failed', cleanError(error))); }, 1000); this.timer.unref?.(); }
    return this;
  }
  async configure(host, input, signal) {
    this.main(host);
    check(input && typeof input === 'object', 'INVALID_ARGUMENT', 'A workflow plan is required');
    const previous = input.id ? records(this.host).get('plans', input.id, true) : null;
    check(previous?.purpose !== 'analysis', 'READ_ONLY_WORKFLOW', 'A one-shot analysis is immutable; use a new analysis request or an explicitly authorized trading plan.');
    if (previous) this.ownedPlan(host, previous.id);
    check(!previous || !records(this.host).list('runs').some(run => run.planId === previous.id && !TERMINAL.has(run.status)), 'PLAN_BUSY', 'Stop the active run before changing its frozen plan');
    const execution = await bindExecution(host, input.execution, signal);
    const plan = await makePlan(host, input, execution, previous, this.now());
    for (const role of ['market', 'manager', 'executor']) {
      check(taskTools(plan, role).length <= 64, 'TOOL_BUDGET_EXCEEDED', 'Select a smaller research tool subset; each task supports 64 tools');
      check(taskPlugins(plan, role).length <= 32, 'PLUGIN_BUDGET_EXCEEDED', 'Select fewer plugins; each task supports 32 research and execution dependencies combined');
    }
    records(this.host).put('plans', plan);
    await this.unsubscribe(plan.id);
    if (plan.enabled && plan.accountEvents) await this.subscribe(plan);
    return this.plan(plan.id);
  }
  async analyze(host, input, signal) {
    this.main(host);
    check(typeof input.request_id === 'string' && input.request_id.length > 0 && input.request_id.length <= 200, 'INVALID_ARGUMENT', 'Use one stable request_id for this analysis.');
    const id = `analysis_${digest([host.context.sessionId, input.request_id]).slice(7, 39)}`, requestDigest = digest(input);
    const pending = this.analysisAdmissions.get(id);
    if (pending) {
      check(pending.requestDigest === requestDigest, 'IDEMPOTENCY_CONFLICT', 'This analysis request_id already has different input.');
      return pending.promise;
    }
    const promise = this.admitAnalysis(host, input, id, requestDigest, signal);
    this.analysisAdmissions.set(id, { requestDigest, promise });
    try { return await promise; } finally { this.analysisAdmissions.delete(id); }
  }
  async admitAnalysis(host, input, id, requestDigest, signal) {
    const previous = records(this.host).get('plans', id, true);
    if (previous) {
      check(previous.requestDigest === requestDigest, 'IDEMPOTENCY_CONFLICT', 'This analysis request_id already has different input.');
      if (previous.lastRunId) return this.run(previous.lastRunId);
    }
    let plan = previous;
    if (!plan) {
      const execution = await bindExecution(host, input.execution, signal);
      plan = { ...await makePlan(host, { ...input, id, mode: 'team', interval_minutes: null, event_keys: [], account_events: false, enabled: true }, execution, null, this.now()),
        purpose: 'analysis', publishReport: input.report === true, requestDigest };
      // Reads may cache/publish evidence. Exclude declared trading/configuration/control effects;
      // a dynamic read capability's operation-level boundary remains its producer's contract.
      const forbidden = new Set(['manual_trading_decide', 'manual_trading_apply', 'manual_trading_review', ...execution.tools.filter(name => !execution.readTools.includes(name)),
        ...(await catalog(host)).filter(cap => plan.research.plugins.includes(cap.pluginId) && cap.effects?.some(effect => analysisWriteEffect.test(effect))).map(cap => cap.localId)]);
      const blocked = plan.research.tools.filter(name => forbidden.has(name));
      check(!input.research?.tools || !blocked.length, 'READ_ONLY_WORKFLOW', `Analysis excludes declared trading, configuration and workflow controls: ${blocked.join(', ')}. Select the reading/research capabilities.`);
      plan.research.tools = plan.research.tools.filter(name => !forbidden.has(name));
      plan.research.allowedCalls = plan.research.allowedCalls.filter(call => !forbidden.has(call.capabilityId));
      for (const role of stages(plan).flat()) {
        check(taskTools(plan, role).length <= 64, 'TOOL_BUDGET_EXCEEDED', 'Select a smaller research tool subset; each role supports 64 tools.');
        check(taskPlugins(plan, role).length <= 32, 'PLUGIN_BUDGET_EXCEEDED', 'Select fewer research plugins; each role supports 32 plugins.');
      }
      signal?.throwIfAborted();
      records(this.host).put('plans', plan);
    }
    const run = this.trigger(plan.id, { kind: 'analysis', id: input.request_id }, host);
    const admission = this.running.get(schedulingKey(plan))?.admission;
    if (admission) await admission;
    return this.run(run.id);
  }
  async setEnabled(host, id, enabled) {
    const plan = this.ownedPlan(host, id);
    check(plan.purpose !== 'analysis', 'READ_ONLY_WORKFLOW', 'Analysis has no schedule; resume its retained host Run instead.');
    check(!enabled || plan.execution, 'EXECUTION_REQUIRED', 'Reconfigure the legacy plan with a selected execution capability');
    if (enabled) { await verifyComposition(host, plan.execution); await verifyComposition(host, plan.research); }
    records(this.host).put('plans', { ...plan, enabled, updatedAt: this.now(), nextDueAt: enabled && plan.intervalMinutes ? this.now() + plan.intervalMinutes * 60000 : plan.nextDueAt });
    if (!enabled) {
      await this.unsubscribe(id);
      for (const run of records(this.host).list('runs').filter(value => value.planId === id && !TERMINAL.has(value.status))) this.cancel(run.id, 'Trading plan paused');
    } else if (plan.accountEvents) await this.subscribe(this.plan(id));
    return this.plan(id);
  }
  trigger(planId, trigger, host) {
    check(!this.closed, 'RUNTIME_CLOSED', 'Trading runtime is stopped');
    const plan = this.plan(planId), id = triggerIdentity(plan, trigger), previous = records(this.host).get('runs', id, true);
    if (previous) { check(canonical(previous.trigger) === canonical(trigger), 'IDEMPOTENCY_CONFLICT', 'Event ID already has different input'); return previous; }
    check(plan.enabled, 'PLAN_PAUSED', 'Trading plan is paused');
    check(plan.purpose !== 'analysis' || trigger.kind === 'analysis' && !plan.lastRunId,
      'READ_ONLY_WORKFLOW', 'A one-shot analysis cannot be triggered as a trading cycle.');
    check(plan.execution, 'EXECUTION_REQUIRED', 'Select an execution capability before starting this workflow');
    check(Buffer.byteLength(JSON.stringify(trigger)) <= 12000, 'INVALID_ARGUMENT', 'Event payload exceeds 12 KB');
    for (const queued of records(this.host).list('runs').filter(run => run.planId === plan.id && run.status === 'queued')) {
      this.update(queued.id, { status: 'cancelled', completedAt: this.now(), supersededBy: id });
      this.activity(queued.id, 'run.finished', { status: 'cancelled', message: '尚未开始的运行已被新事件替换。' });
    }
    const run = this.save({ id, planId: plan.id, plan, trigger: clone(trigger), status: 'queued', createdAt: this.now(), tasks: [], reports: [], reportPending: publishesReport(plan), mockModelResponses: this.mockModelResponses });
    if (host) this.workHosts.set(id, host);
    records(this.host).put('plans', { ...plan, lastRunId: id }); this.pump(); return run;
  }
  event(key, eventId, data = {}, at, ownerConversationId, host) {
    if (at !== undefined) check(Number.isSafeInteger(at) && at <= this.now() && this.now() - at <= 86400000, 'STALE_EVENT', 'Event must be observed within the last day');
    check(typeof key === 'string' && typeof eventId === 'string' && eventId.length > 0, 'INVALID_ARGUMENT', 'Event key and stable ID are required');
    return this.plans().filter(plan => plan.enabled && (!ownerConversationId || plan.ownerConversationId === ownerConversationId) && plan.eventKeys.includes(key)).map(plan => this.trigger(plan.id, { kind: 'event', id: `${key}:${eventId}`, key, ...(at === undefined ? {} : { observedAt: at }), data }, host));
  }
  async tick() {
    if (this.closed || this.ticking) return;
    this.ticking = true;
    try {
      for (const plan of this.plans().filter(value => value.enabled && value.intervalMinutes && value.nextDueAt <= this.now())) {
        records(this.host).put('plans', { ...plan, nextDueAt: this.now() + plan.intervalMinutes * 60000 });
        this.trigger(plan.id, { kind: 'interval', id: String(plan.nextDueAt), observedAt: this.now() });
      }
      for (const plan of this.plans().filter(value => value.enabled && value.accountEvents && value.eventRetryAt && value.eventRetryAt <= this.now())) await this.subscribe(plan);
      this.pump();
    } finally { this.ticking = false; }
  }
  pump() {
    if (this.closed) return;
    for (const run of records(this.host).list('runs').filter(value => value.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)) {
      const key = schedulingKey(run.plan), plan = this.plan(run.planId);
      if (!plan.enabled || this.running.has(key) || records(this.host).list('runs').some(other => other.id !== run.id && schedulingKey(other.plan) === key && other.status !== 'queued' && !TERMINAL.has(other.status))) continue;
      const last = plan.lastEventAt ?? 0;
      if (run.trigger.kind === 'event' && this.now() - last < plan.eventCooldownMs) continue;
      if (run.trigger.kind === 'event') records(this.host).put('plans', { ...plan, lastEventAt: this.now() });
      const controller = new AbortController(), entry = { runId: run.id, controller };
      let admitted;
      entry.admission = new Promise(resolve => { admitted = resolve; });
      this.running.set(key, entry);
      const host = this.workHosts.get(run.id) ?? this.host;
      entry.promise = this.executionScope.runInAsyncScope(async () => {
        const accepted = await host.capabilities.invoke('sesame/manual-trading#workflow_execute', { runId: run.id }, { signal: controller.signal, operationId: 'workflow:' + run.id,
          task: { ...(host.context.kind === 'service' ? { sessionId: run.plan.ownerConversationId } : {}), title: run.plan.title, collaboration: collaboration(run.plan),
            output: publishesReport(run.plan) ? { type: 'report', space: 'research', path: reportPath(run) } : { type: 'none' } } });
        check(accepted.type === 'run', 'TASK_RECEIPT_INVALID', 'Workflow requires a real Run'); this.update(run.id, { workflow: accepted.run });
        admitted();
        let settled; do { settled = await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000 }); } while (settled.reason === 'timeout');
        if (settled.reason === 'interrupted' || settled.run.status === 'interrupted') this.update(run.id, { status: 'interrupted', error: this.run(run.id).error ?? cleanError(settled.run.error ?? { code: 'RUN_INTERRUPTED', message: settled.run.interrupts?.find(item => !item.resolvedAt)?.reason ?? 'Workflow dependency or input is unavailable' }) });
        else if (!TERMINAL.has(this.run(run.id).status) && settled.run.status === 'cancelled') this.update(run.id, { status: 'cancelled', completedAt: this.now(), error: cleanError(settled.run.error ?? new Error('Host workflow cancelled')) });
        else if (!TERMINAL.has(this.run(run.id).status) && settled.run.status === 'unknown') this.update(run.id, { status: 'interrupted', error: cleanError(settled.run.error ?? new Error('Host workflow outcome is unknown; inspect its retained Run.')) });
        return settled.run;
      }).catch(error => {
        admitted();
        if (interruption(error, controller.signal)) { this.update(run.id, { status: 'interrupted', error: this.run(run.id).error ?? cleanError(interruption(error, controller.signal)) }); return; }
        if (!TERMINAL.has(this.run(run.id).status)) this.update(run.id, { status: controller.signal.aborted ? 'cancelled' : 'interrupted', error: cleanError(error), ...(controller.signal.aborted ? { completedAt: this.now() } : {}) });
        this.notify('run.interrupted', { runId: run.id, ...cleanError(error) });
      }).finally(() => { this.running.delete(key); this.workHosts.delete(run.id); this.pump(); });
    }
  }
  async task(runId, role, round, signal) {
    signal?.throwIfAborted(); const run = this.run(runId), plan = run.plan, host = this.workHosts.get(runId);
    check(host, 'NO_ACTIVE_WORKFLOW', 'Agent dispatch requires its active workflow Run');
    const key = `${role}:${round}`, previous = run.tasks.find(task => task.role === role && task.round === round);
    const savedReport = previous && run.reports.find(report => report.taskId === previous.id && report.status === 'completed');
    if (previous?.status === 'completed' && savedReport) return { id: previous.id, status: 'completed', result: { text: savedReport.text }, conversationId: previous.conversationId };
    const model = plan.agentModels[role] ?? plan.model;
    const tools = taskTools(plan, role), plugins = taskPlugins(plan, role);
    check(tools.length <= 64, 'TOOL_BUDGET_EXCEEDED', 'Select a smaller research tool subset; each task supports 64 tools');
    check(plugins.length <= 32, 'PLUGIN_BUDGET_EXCEEDED', 'Select fewer plugins; each task supports 32 research and execution dependencies combined');
    let allowedCalls;
    try {
      await verifyComposition(host, plan.execution);
      if (role !== 'executor') await verifyComposition(host, plan.research);
      if (usesTradingMemory(role, plan)) await selectResearch(host, { plugins: [TRADING_MEMORY.pluginId], tools: [] });
      allowedCalls = await declaredCalls(host, tools, ['sesame/manual-trading', ...plugins]);
    } catch (error) { if (dependencyCodes.has(error.code)) throw dependencyError(runId, error); throw error; }
    const request = run.taskRequests?.[key] ?? {
      title: `${plan.title.slice(0, 50)} · ${role} ${round}`,
      instructions: `${plan.purpose === 'analysis' ? ANALYSIS_SYSTEM : SYSTEM}\n\n本角色：${rolePrompt(plan, role)}\n\n计划要求：${plan.instructions}`,
      objective: `以符合 ${role} 角色目标的实际证据或保存的执行回执形成可共享成果；必要依赖缺失则暂停并说明恢复条件，不能替换目标后宣告完成。`,
      input: { tradingPlan: { id: plan.id, account: plan.account, ownerConversationId: plan.ownerConversationId }, execution: plan.execution, runId, role, round, trigger: run.trigger, ...(plan.purpose === 'analysis' ? { purpose: 'analysis', report: plan.publishReport } : {}) },
      allowedCalls, model,
    };
    if (!run.taskRequests?.[key]) this.update(runId, { taskRequests: { ...this.run(runId).taskRequests, [key]: request } });
    let accepted;
    try { accepted = previous ? { type: 'run', run: { id: previous.id } } : await host.capabilities.invoke('host.agent.run', request,
      { signal, operationId: `${run.id}:${role}:${round}`, task: { title: `${plan.title.slice(0, 50)} · ${role}`, agentId: role, role, stage: role, iteration: round, output: { type: 'none' } } }); }
    catch (error) { if (dependencyCodes.has(error.code)) throw dependencyError(runId, error); throw error; }
    check(accepted.type === 'run', 'TASK_RECEIPT_INVALID', 'Agent execution must return a Run');
    const task = accepted.run;
    if (!previous) this.update(runId, { tasks: [...this.run(runId).tasks, { id: task.id, role, round, model, status: 'queued', createdAt: this.now() }] });
    await this.checkpoint(runId);
    const result = await this.waitTask(task.id, signal, view => this.observeTaskView(runId, task.id, view), host);
    const current = this.run(runId);
    const errorText = result.error?.message ?? result.error ?? '';
    this.update(runId, { tasks: current.tasks.map(value => value.id === task.id ? { ...value, status: result.status, conversationId: result.conversationId } : value),
      reports: [...current.reports.filter(report => report.taskId !== task.id), { taskId: task.id, role, round, model: result.model ?? model, status: result.status, createdAt: this.now(), text: String(result.result?.text ?? errorText).slice(0, 16000), ...(result.error ? { error: cleanError(result.error) } : {}) }] });
    if (result.status !== 'completed' && dependencyCodes.has(result.error?.code)) throw dependencyError(runId, result.error);
    check(result.status === 'completed', result.error?.code ?? 'AGENT_FAILED', `${role} task ${result.status}: ${String(errorText).slice(0, 300)}`);
    await this.checkpoint(runId);
    return result;
  }
  async execute(host, id, signal, execution) {
    this.executor(host, this.run(id), execution);
    this.workHosts.set(id, host); this.executions.set(id, execution);
    check(!execution.checkpointState || execution.checkpointState.runId === id, 'CHECKPOINT_MISMATCH', 'Checkpoint belongs to another trading run');
    const before = this.run(id), attempt = execution.attempt;
    this.update(id, { workflow: execution.run, status: 'researching', startedAt: before.startedAt ?? this.now(), executionAttempt: attempt,
      ...(before.executionAttempt !== attempt ? { contextError: null } : {}), error: null });
    let failure, interrupted = false, stageTasks = [];
    try {
      const steps = stages(this.run(id).plan);
      for (let round = this.run(id).stageIndex ?? 0; round < steps.length && !this.run(id).execution; round++) {
        await this.checkpoint(id);
        stageTasks = steps[round].map(role => this.task(id, role, round, signal));
        await Promise.all(stageTasks);
        this.update(id, { stageIndex: round + 1 }); await this.checkpoint(id);
      }
      signal.throwIfAborted();
      if (this.run(id).plan.purpose === 'analysis') {
        const summary = this.run(id).reports.findLast(report => report.role === 'manager' && report.status === 'completed')?.text;
        check(summary?.trim(), 'NO_ANALYSIS', 'Research manager did not return its Markdown synthesis.');
        this.update(id, { status: 'completed', completedAt: this.now(), summary });
      } else {
        check(this.run(id).decision, 'NO_DECISION', 'Manager did not save a valid target portfolio');
        if (!this.run(id).execution) await this.task(id, 'executor', steps.length, signal);
        check(this.run(id).execution, 'NOT_EXECUTED', 'Executor did not return a durable execution result');
        this.recordMemory(this.update(id, { status: 'completed', completedAt: this.now() }));
      }
    } catch (error) {
      const control = interruption(error, signal);
      if (control || !signal.aborted) {
        interrupted = true; this.update(id, { status: 'interrupted', reportPending: false, error: cleanError(control ?? error) });
        if (!control || control.code === 'DEPENDENCY_UNAVAILABLE') await execution.interrupt({ reason: (control ?? error).message, requirements: control?.details?.requirements, state: { runId: id, stageIndex: this.run(id).stageIndex ?? 0 } });
        throw control ?? error;
      }
      await Promise.allSettled(stageTasks);
      failure = error;
      const run = this.update(id, { status: 'cancelled', completedAt: this.now(), error: cleanError(error) });
      if (run.decision) this.recordMemory(run);
    } finally {
      if (!interrupted && publishesReport(this.run(id).plan) && !this.run(id).report && !this.closed && !signal.aborted) {
        try { await this.archive(host, id); }
        catch (error) { failure = interruption(error, signal) ?? failure ?? error; this.update(id, { reportPending: true, reportError: cleanError(error) }); }
      }
      const control = interruption(failure, signal);
      if (control || failure && !signal.aborted) {
        interrupted = true; failure = control ?? failure;
        this.update(id, { status: 'interrupted', completedAt: null, reportPending: false, error: this.run(id).error ?? cleanError(failure) });
      }
      if (!interrupted) this.notify('run.finished', { runId: id, planId: this.run(id).planId, status: this.run(id).status, reportPending: this.run(id).reportPending });
      this.executions.delete(id);
      this.workHosts.delete(id);
    }
    if (interruption(failure, signal)) throw interruption(failure, signal);
    signal.throwIfAborted();
    if (interrupted && failure) await execution.interrupt({ reason: failure.message, state: { runId: id, stageIndex: this.run(id).stageIndex ?? 0 } });
    if (failure) throw Object.assign(new Error(failure.message), { code: failure.code ?? 'WORKFLOW_FAILED', details: { runId: id, report: this.run(id).report ?? null } });
    return { runId: id, status: this.run(id).status, report: this.run(id).report ?? null, ...(this.run(id).summary ? { summary: this.run(id).summary } : {}) };
  }
  recordMemory(run) {
    try { this.memoryFor(run.plan).record({ id: run.id, planId: run.planId, accountId: accountKey(run.plan),
      executionAccountId: run.plan.account.accountId, executionSources: run.plan.execution?.fillSources ?? [],
      symbols: [...new Set([...run.plan.symbols, ...(run.snapshot?.positions ?? []).map(row => row.symbol ?? row.stock_code).filter(Boolean)])],
      snapshot: { account: run.snapshot.account, capturedAt: run.snapshot.capturedAt, summary: run.snapshot.summary, positions: run.snapshot.positions.slice(0, 100), positionCount: run.snapshot.positions.length, fullSnapshotRunId: run.id }, decision: run.decision,
      reports: run.reports.map(report => ({ ...report, text: report.text.slice(0, 4000), fullReportRunId: run.id, excerpt: report.text.length > 4000 })),
      execution: run.execution ? { status: run.execution.status, targetReached: run.execution.targetReached, operationIds: run.execution.orders.map(order => order.operationId), fullReceiptRunId: run.id } : null, decisionAt: run.decidedAt, createdAt: this.now() }); }
    catch (error) { this.update(run.id, { memoryError: cleanError(error) }); }
  }
  async context(host, id, section = 'all', offset = 0, limit = 50, signal) {
    this.authorize(host, id);
    signal?.throwIfAborted();
    if (section !== 'team' && !this.run(id).snapshot) {
      const blocked = this.run(id).contextError;
      if (blocked) {
        const error = Object.assign(new Error(blocked.message), { code: blocked.code, details: clone(blocked.details) });
        throw dependencyCodes.has(error.code) ? dependencyError(id, error) : error;
      }
      if (!this.contextReads.has(id)) this.contextReads.set(id, (async () => {
        const run = this.run(id), snapshot = await executionCall(host, run.plan.execution, 'context', { action: 'snapshot', history_days: 30 }, signal);
        check(canonical(snapshot.account) === canonical(run.plan.account), 'ACCOUNT_CHANGED', 'Configured account changed after this plan was saved');
        for (const key of ['positions', 'orders', 'fills', 'historicalOrders', 'deployments']) check(Array.isArray(snapshot[key]), 'SOURCE_DATA_INVALID', `Execution snapshot must include ${key}`);
        check(Array.isArray(snapshot.positions) && Buffer.byteLength(JSON.stringify(snapshot)) <= 1024 * 1024, 'SOURCE_DATA_INVALID', 'Account snapshot missing or exceeds 1 MiB');
        const memoryContext = this.memoryFor(run.plan).context({ planId: run.planId, accountId: accountKey(run.plan), symbols: [...new Set([...run.plan.symbols, ...snapshot.positions.map(row => row.symbol ?? row.stock_code).filter(Boolean)])], asOf: this.now(), limit: 8 });
        this.update(id, { snapshot, memoryContext });
      })().catch(error => {
        if (error.details?.retryable === false) this.update(id, { contextError: { ...cleanError(error), details: clone(error.details) } });
        if (dependencyCodes.has(error.code)) throw dependencyError(id, error);
        throw error;
      }).finally(() => this.contextReads.delete(id)));
      await this.contextReads.get(id);
    }
    const run = this.run(id), snapshot = run.snapshot;
    const page = rows => ({ items: (rows ?? []).slice(offset, offset + limit), total: (rows ?? []).length, nextOffset: offset + limit < (rows ?? []).length ? offset + limit : null });
    const result = { runId: id, plan: run.plan, ...(snapshot ? { capturedAt: snapshot.capturedAt } : {}),
      ...(['all', 'account'].includes(section) ? { account: snapshot.account, summary: snapshot.summary, positions: page(snapshot.positions), deployments: page(snapshot.deployments), coverage: snapshot.historyCoverage } : {}),
      ...(['all', 'history'].includes(section) ? { orders: page(snapshot.orders), fills: page(snapshot.fills), historicalOrders: page(snapshot.historicalOrders) } : {}),
      ...(['all', 'team'].includes(section) ? { reports: page(run.reports) } : {}),
      ...(['all', 'memory'].includes(section) ? { memory: run.memoryContext } : {}) };
    if (host.context.kind === 'subagent' && result.reports) {
      this.authorize(host, id);
      const current = this.currentAgent();
      const consumed = new Set(this.run(id).consumedOutputs ?? []);
      for (const report of result.reports.items) {
        const key = `${report.taskId}:${current.runId}`;
        if (report.taskId === current.runId || consumed.has(key) || !run.tasks.some(task => task.id === report.taskId)) continue;
        this.executions.get(id)?.emit('handoff', { fromRunId: report.taskId, toRunId: current.runId });
        consumed.add(key);
      }
      this.update(id, { consumedOutputs: [...consumed] });
    }
    return result;
  }
  async decide(host, id, decision, signal) {
    const run = this.authorize(host, id, ['manager']);
    check(run.plan.purpose !== 'analysis', 'READ_ONLY_WORKFLOW', 'Analysis returns advice, not an executable target.');
    check(this.plan(run.planId).enabled && !TERMINAL.has(run.status) && run.snapshot, 'RUN_NOT_READY', 'Read this active run account context before deciding');
    const value = validateDecision(run.plan, run.snapshot, decision);
    if (run.decision) { check(canonical(run.decision) === canonical(value), 'DECISION_FROZEN', 'This run already has a different frozen target'); return run.decision; }
    const references = [...value.evidence_dataset_ids, ...value.evidence_sources, ...value.evidence_artifacts];
    const snapshots = await datasetSnapshot(host, references, signal);
    const evidence = [...new Set(references.map(ref => typeof ref === 'string' ? ref : ref.datasetId ?? ref.id))].map(datasetId => {
      const dataset = snapshots.get(datasetId);
      check(Buffer.byteLength(JSON.stringify(dataset)) <= 256000, 'EVIDENCE_TOO_LARGE', 'Select bounded research datasets');
      return { datasetId, capturedAt: this.now(), digest: digest(dataset), ...(dataset.artifact ? { artifact: dataset.artifact } : {}), dataset };
    });
    check(Buffer.byteLength(JSON.stringify(evidence)) <= 512000, 'EVIDENCE_TOO_LARGE', 'Combined decision evidence exceeds 512 KB; select bounded datasets');
    signal?.throwIfAborted();
    const current=this.authorize(host,id,['manager']);
    check(this.plan(current.planId).enabled&&!TERMINAL.has(current.status),'RUN_NOT_READY','Run stopped while reading decision evidence');
    if(current.decision){check(canonical(current.decision)===canonical(value),'DECISION_FROZEN','This run already has a different frozen target');return current.decision;}
    check(canonical(current.snapshot)===canonical(run.snapshot),'SNAPSHOT_CHANGED','Account snapshot changed while reading evidence');
    this.update(id, { decision: value, decidedAt: this.now(), evidence, status: 'decided' }); return value;
  }
  async apply(host, id, signal) {
    const run = this.authorize(host, id, ['executor']);
    check(run.plan.purpose !== 'analysis', 'READ_ONLY_WORKFLOW', 'This analysis has no execution authorization.');
    if (run.execution) return run.execution;
    check(this.plan(run.planId).enabled && run.decision && !TERMINAL.has(run.status), 'RUN_NOT_READY', 'Run is not active with a saved decision');
    if (!this.applying.has(id)) this.applying.set(id, (async () => {
      if (run.executionStartedAt) throw dependencyError(id, Object.assign(new Error('An execution was already sent without a saved receipt; reconcile the original run and operation IDs. No action is resent.'), { code: 'EXECUTION_OUTCOME_UNKNOWN' }));
      const assertActive = () => { this.authorize(host, id, ['executor']); check(this.plan(run.planId).enabled && !TERMINAL.has(this.run(id).status), 'PLAN_PAUSED', 'Trading plan stopped'); signal?.throwIfAborted(); };
      assertActive(); await verifyComposition(this.host, run.plan.execution); assertActive();
      const { unchanged, targets, pause_strategies, rationale } = run.decision;
      this.update(id, { status: 'executing', executionStartedAt: this.now() });
      const execution = await executionCall(host, run.plan.execution, 'apply', { run: { id, plan: { id: run.planId,
        account: run.plan.account, ownerConversationId: run.plan.ownerConversationId, slippageBps: run.plan.slippageBps }, decision: { unchanged, targets, pause_strategies, rationale }, decidedAt: run.decidedAt } }, signal);
      check(execution && typeof execution.status === 'string' && Array.isArray(execution.orders) && Array.isArray(execution.pauses), 'SOURCE_DATA_INVALID', 'Execution capability must return a durable structured receipt');
      this.update(id, { execution, reportPending: true }); return execution;
    })().finally(() => this.applying.delete(id)));
    return this.applying.get(id);
  }
  async archive(host, id) {
    const run = this.run(id);
    if (host.context.kind === 'main') { this.authorize(host, id); check(run.report, 'REPORT_UNAVAILABLE', 'This execution has no published report; inspect its retained receipts'); return run.report; }
    this.executor(host, run, this.executions.get(id));
    check(TERMINAL.has(run.status) && run.tasks.every(task => TASK_TERMINAL.has(task.status)), 'RUN_NOT_FINISHED', 'Publish after all actual Agent runs settle');
    if (!this.archiving.has(id)) this.archiving.set(id, Promise.resolve().then(async () => {
      const report = await writeDailyReport(host, this.run(id), { onSnapshot: reportSnapshot => this.update(id, { reportSnapshot, reportPending: true }) });
      this.executions.get(id).emit('artifact', { ref: report.ref, label: run.plan.title });
      this.update(id, { report, reportPending: false, reportError: null }); return report;
    }).catch(error => { this.update(id, { reportPending: true, reportError: cleanError(error) }); throw error; }).finally(() => this.archiving.delete(id)));
    return this.archiving.get(id);
  }
  async review(host, args, signal) {
    const current = this.authorize(host, args.current_run_id), reviewed = this.run(args.run_id);
    check(accountKey(current.plan) === accountKey(reviewed.plan) && current.plan.ownerConversationId === reviewed.plan.ownerConversationId, 'FORBIDDEN', 'Review belongs to another account');
    const datasets = await datasetSnapshot(host, args.evidence, signal);
    return this.memoryFor(current.plan).review({ runId: reviewed.id, asOf: this.now(), evidence: args.evidence, reflection: args.reflection }, datasets);
  }
  cancel(id, reason) {
    const run = this.run(id); if (TERMINAL.has(run.status)) return run;
    this.update(id, { status: 'cancelled', completedAt: this.now(), error: { code: 'CANCELLED', message: reason } });
    if (run.workflow) {
      const work = Promise.resolve().then(() => this.host.runs.cancel(run.workflow, { reason }))
        .catch(error => this.notify('cancel.failed', { runId: id, workflowId: run.workflow.id, ...cleanError(error) })).finally(() => this.cancelling.delete(work));
      this.cancelling.add(work);
    }
    for (const task of run.tasks) {
      const work = Promise.resolve().then(() => this.host.runs.cancel({ id: task.id }, { reason }))
        .then(({ run: receipt }) => this.observeTaskView(id, task.id, this.taskView(receipt)))
        .catch(error => this.notify('cancel.failed', { runId: id, taskId: task.id, ...cleanError(error) })).finally(() => this.cancelling.delete(work));
      this.cancelling.add(work);
    }
    const active = this.running.get(schedulingKey(run.plan));
    if (active?.runId === id) active.controller.abort(new Error(reason));
    else this.activity(id, 'run.finished', { status: 'cancelled', message: '本轮已取消。' });
    return this.run(id);
  }
  async subscribe(plan) {
    await this.unsubscribe(plan.id);
    try {
      check(plan.execution?.accountProvider, 'UNSUPPORTED_CAPABILITY', 'Selected execution capability does not declare account events');
      const selected = plan.execution.accountProvider, providerId = `${selected.pluginId}#${selected.providerId}`;
      const source = (await this.host.data.sources({ providerId })).items.find(item => item.available !== false);
      check(source && source.operations.watch, 'UNSUPPORTED_CAPABILITY', 'Selected account source has no declared watch operation');
      const identity = await executionCall(this.host, plan.execution, 'context', { action: 'identity' });
      check(canonical(identity.account) === canonical(plan.account), 'ACCOUNT_CHANGED', 'Event source account differs from the frozen plan');
      const controller = new AbortController();
      const stream = await this.host.data.watch({ source: source.ref, operation: 'watch', input: { account: plan.account, topics: ['positions', 'orders'] } }, { signal: controller.signal });
      const subscription = { controller, stream }; this.subscriptions.set(plan.id, subscription);
      check(!this.closed && this.plan(plan.id).enabled && this.plan(plan.id).revision === plan.revision, 'PLAN_CHANGED', 'Plan stopped or changed while subscribing');
      const previous = new Map();
      subscription.promise = (async () => {
        for await (const event of stream.events) {
          if (this.closed || !this.plan(plan.id).enabled) break;
          if (event.type === 'stream.gap') throw Object.assign(new Error(event.reason ?? 'Account stream gap'), { code: 'STREAM_GAP' });
          if (!['positions.upsert', 'orders.upsert'].includes(event.type)) continue;
          const key = digest(event.payload);
          if (previous.get(event.type) === key) continue; previous.set(event.type, key);
          this.trigger(plan.id, { kind: 'event', id: `account:${digest([providerId, event.eventId ?? null, event.epoch ?? null, event.seq ?? null, key]).slice(7)}`, observedAt: event.observedAt, data: { type: event.type, message: 'Account state changed; read a fresh snapshot' } });
        }
      })().catch(error => { if (!controller.signal.aborted && !this.closed) { records(this.host).put('plans', { ...this.plan(plan.id), eventStatus: 'unavailable', eventError: cleanError(error), eventRetryAt: this.now() + 60000 }); this.notify('event.failed', cleanError(error)); } });
      records(this.host).put('plans', { ...this.plan(plan.id), eventStatus: 'subscribed', eventError: null, eventRetryAt: null });
    } catch (error) {
      await this.unsubscribe(plan.id);
      records(this.host).put('plans', { ...this.plan(plan.id), eventStatus: 'unavailable', eventError: cleanError(error), eventRetryAt: error.code === 'UNSUPPORTED_CAPABILITY' ? null : this.now() + 60000 });
    }
  }
  async unsubscribe(id) { const sub = this.subscriptions.get(id); this.subscriptions.delete(id); if (sub) { sub.controller.abort(); try { await sub.stream.close(); } finally { await sub.promise; } } }
  async dispose(host = this.host) {
    this.host = host; this.closed = true; clearInterval(this.timer);
    for (const value of this.running.values()) {
      this.update(value.runId, { status: 'interrupted', error: { code: 'RUN_INTERRUPTED', message: 'Plugin stopped; resume the retained host Run.' } });
      value.controller.abort(Object.assign(new Error('Trading plugin stopped; retain accepted Run identities'), { code: 'RUN_INTERRUPTED' }));
    }
    await Promise.allSettled([...this.subscriptions.keys()].map(id => this.unsubscribe(id)));
    await Promise.allSettled([...this.running.values()].map(value => value.promise));
    await Promise.allSettled(this.cancelling);
    await Promise.allSettled(this.archiving.values());
    if (!this.executionScopeDestroyed) { this.executionScope.emitDestroy(); this.executionScopeDestroyed = true; }
  }
}
