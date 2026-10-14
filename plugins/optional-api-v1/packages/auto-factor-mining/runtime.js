import { configuration, configuredModel, check, digest, canonical, text, errorInfo, ID, terminal } from './shared.js';
import { SYSTEM, OUTPUTS, PURPOSES } from './team.js';
import { verifyResearch, verifyEvaluator, taskPlugins } from './composition.js';
import { callEvaluator } from './evaluation.js';
import { archiveReport, finalSnapshot } from './archive.js';
import { AsyncResource } from 'node:async_hooks';
import { ACTIVITY_LIMIT, TASK_TERMINAL, appendActivity, publicOutput } from './activity.js';

const FINAL = new Set(['completed', 'cancelled', 'exhausted']);

// Like manual-trading, the service schedules real host Agents and keeps durable
// checkpoints. This workflow has no account, order, or strategy-control ports.
export class MiningRuntime {
  constructor(host, { now = Date.now, activityPollMs = 500, activityLimit = ACTIVITY_LIMIT } = {}) {
    this.host = host; this.now = now; this.running = new Map(); this.closed = false;
    check(Number.isInteger(activityPollMs) && activityPollMs >= 10 && activityPollMs <= 60000, 'INVALID_ARGUMENT', 'Activity polling must be 10..60000 ms');
    check(Number.isInteger(activityLimit) && activityLimit >= 1 && activityLimit <= 10000, 'INVALID_ARGUMENT', 'Activity retention must be 1..10000 events');
    this.activityPollMs = activityPollMs; this.activityLimit = activityLimit; this.listeners = new Set(); this.taskPolls = new Map(); this.reporting = new Map();
    this.observationScope = new AsyncResource('sesame.auto-factor-mining.activity', { requireManualDestroy: true });
  }
  get(id) { const run = this.host.storage.get('runs', id, true); check(run, 'NOT_FOUND', 'Mining run not found'); return run; }
  save(run, events = []) {
    const previous = this.host.storage.get('runs', run.id, true);
    if (canonical(previous) === canonical(run) && !events.length) return previous;
    const update = appendActivity(previous, run, events, this.now(), this.activityLimit);
    if (canonical(previous) === canonical(update.run)) return previous;
    const saved = this.host.storage.put('runs', { ...update.run, updatedAt: this.now() });
    for (const listener of this.listeners) {
      try { listener({ runId: run.id, events: update.added })?.catch?.(() => {}); } catch { /* Viewing cannot interrupt research. */ }
    }
    return saved;
  }
  update(id, changes) { return this.save({ ...this.get(id), ...changes }); }
  event(id, type, message, extra = {}) {
    return this.save(this.get(id), [{ at: this.now(), type, message, ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)) }]);
  }
  onActivity(listener) { check(!this.closed && typeof listener === 'function', 'CLOSED', 'Activity listener requires an active runtime'); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async observeTask(id, taskId, generation, isActive = () => !this.closed) {
    return this.observationScope.runInAsyncScope(async () => {
      const current = () => {
        if (!isActive()) return null;
        const run = this.get(id), task = run.tasks.find(value => value.id === taskId);
        return run.generation === generation && task && !task.finishedAt ? task : null;
      };
      if (!current() || typeof this.host.agents.inspect !== 'function') return;
      try {
        const observed = await this.host.agents.inspect(taskId);
        let task = current(); if (!task || observed?.id !== taskId) return;
        const changed = { ...task, status: TASK_TERMINAL.has(task.status) && !TASK_TERMINAL.has(observed.status) ? task.status : observed.status,
          conversationId: observed.conversationId ?? task.conversationId ?? null };
        if (observed.status === 'running' && !task.startedAt) changed.startedAt = this.now();
        if (Array.isArray(observed.toolCalls)) changed.toolCalls = observed.toolCalls.slice(0, 256).map(call => ({ id: call.id, name: call.name, status: call.status,
          ...(call.startedAt == null ? {} : { startedAt: call.startedAt }), ...(call.completedAt == null ? {} : { completedAt: call.completedAt }) }));
        this.update(id, { tasks: this.get(id).tasks.map(value => value.id === taskId ? changed : value) });
        if (!observed.conversationId || typeof this.host.tasks?.read !== 'function' || typeof this.host.messages?.read !== 'function') return;
        const conversation = await this.host.tasks.read(observed.conversationId);
        task = current(); if (!task) return;
        const messageId = conversation.active_response_message_id ?? task.publicOutput?.messageId;
        if (!messageId) return;
        const output = publicOutput(await this.host.messages.read(messageId, true));
        task = current(); if (!task || !output) return;
        const updated = { ...task, publicOutput: output }; delete updated.observationError;
        this.update(id, { tasks: this.get(id).tasks.map(value => value.id === taskId ? updated : value) });
      } catch (error) {
        const task = current(); if (!task) return;
        this.update(id, { tasks: this.get(id).tasks.map(value => value.id === taskId ? { ...value, observationError: errorInfo(error) } : value) });
      }
    });
  }
  watchTask(id, taskId, generation) {
    if (typeof this.host.agents.inspect !== 'function') return () => {};
    const poll = { active: true, busy: false };
    const sample = async () => {
      if (!poll.active || poll.busy || this.closed) return;
      poll.busy = true;
      try { await this.observeTask(id, taskId, generation, () => poll.active && !this.closed); }
      finally { poll.busy = false; }
    };
    poll.stop = () => { poll.active = false; clearInterval(poll.timer); this.taskPolls.delete(taskId); };
    poll.timer = setInterval(() => { void sample(); }, this.activityPollMs); poll.timer.unref?.();
    this.taskPolls.set(taskId, poll); void sample(); return poll.stop;
  }
  main(host, run) {
    check(host.scope.kind === 'main', 'FORBIDDEN', 'Use this operation in the main conversation');
    if (run) check(host.scope.conversationId === run.ownerConversationId, 'FORBIDDEN', 'Run belongs to another conversation');
  }
  authorize(host, id, mode) {
    const run = this.get(id);
    if (host.scope.kind === 'main' && !mode) { this.main(host, run); return { run }; }
    const current = host.agents.current();
    const task = run.tasks.find(t => t.id === current?.id);
    check(current?.pluginId === ID && current.status === 'running' && current.conversationId === host.scope.conversationId &&
      current.input?.runId === id && task && task.generation === run.generation && !task.finishedAt && task.role === current.input.role && task.mode === current.input.mode &&
      (!mode || task.mode === mode), 'FORBIDDEN', 'Requires the registered running Agent for this run and role');
    return { run, task };
  }
  start() {
    check(this.host.agents && this.host.inference, 'PREREQUISITE_REQUIRED', 'Sesame >=0.2.3-dev.8 Agent/model ports required');
    for (const run of this.host.storage.list('runs')) {
      const active = ['running', 'queued'].includes(run.status), unsettled = run.tasks.filter(task => !task.finishedAt);
      if (!active && !unsettled.length) continue;
      for (const task of unsettled) this.cancelTask(task.id, 'Host restart: reconcile before explicit resume');
      this.update(run.id, { status: active ? 'interrupted' : run.status, reportPending: FINAL.has(run.status) && !run.report,
        tasks: run.tasks.map(task => task.finishedAt ? task : { ...task, status: 'interrupted', finishedAt: this.now(), error: { code: 'HOST_RESTART', message: 'Host restarted' } }),
        ...(active ? { error: { code: 'HOST_RESTART', message: 'Saved experiments retained; explicitly resume unfinished stages.' } } : {}) });
      this.event(run.id, 'interrupted', active ? '宿主重启；保留断点，等待显式恢复' : '宿主重启；遗留角色已中断，最终结果保留');
    }
    return this;
  }
  async create(host, input, signal) {
    this.main(host); check(!this.closed, 'CLOSED', 'Plugin is stopping');
    text(input.request_id, 'request_id', 150); const title = text(input.title, 'title', 100), goal = text(input.goal, 'goal', 4000);
    const config = configuration(host, input.config);
    const id = `fm_${digest([host.scope.conversationId, input.request_id]).slice(7, 39)}`;
    // Loading and calling happen inside auto_factor_start's live invocation.
    await host.plugins.load?.(config.evaluator.plugin_id);
    const prepared = await callEvaluator(host, config.evaluator, { action: 'prepare', run_id: id,
      ...(input.dataset_id ? { dataset_id: text(input.dataset_id, 'dataset_id', 200) } : {}), options: config.evaluator.arguments,
      access: config.research.plugins.length ? 'development-only' : 'restricted' }, signal);
    check(prepared.development && Array.isArray(prepared.development.rows) && prepared.data?.digest && prepared.contract && typeof prepared.contract.instructions === 'string' && prepared.contract.instructions.length <= 6000,
      'EVALUATOR_PROTOCOL', 'Evaluator must return bounded development evidence and candidate instructions');
    check(!config.research.plugins.length || prepared.data.holdoutMode === 'none', 'HOLDOUT_ACCESS', 'General research capabilities require an evaluator session without holdout data');
    const { development: dataset, ...evaluation } = prepared, dataDigest = prepared.data.digest;
    const fingerprint = digest({ title, goal, config, dataDigest });
    const prior = this.host.storage.get('runs', id, true);
    if (prior) { check(prior.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', 'request_id already has different frozen inputs'); return prior; }
    const memory = this.host.storage.list('runs').filter(r => r.ownerConversationId === host.scope.conversationId && r.data.digest === dataDigest && r.status === 'completed')
      .slice(-5).map(r => ({ runId: r.id, dataDigest, reflections: r.reflections, trials: r.trials.map(t => ({ id: t.id, hypothesis: t.hypothesis ?? null, candidate: t.candidate ?? null, metrics: t.metrics ?? null, review: t.review ?? null, error: t.error ?? null })) }));
    const run = { id, title, goal, fingerprint, ownerConversationId: host.scope.conversationId, config, status: 'queued', phase: 'plan',
      createdAt: this.now(), updatedAt: this.now(), round: 0, generation: 0, tasks: [], trials: [], events: [], reflections: [], memory,
      data: prepared.data, evaluation, reportPending: false };
    this.host.storage.transaction(() => { this.host.storage.put('datasets', { id, dataset, digest: digest(dataset) }); this.save(run); });
    this.event(id, 'created', '固定输入、时间分割、模型和预算，开始因子研究');
    this.pump(id); return this.get(id);
  }
  dataset(id) {
    const frozen = this.host.storage.get('datasets', id);
    check(frozen.dataset.evaluatorVersion === this.get(id).data.evaluatorVersion, 'EVALUATOR_CHANGED', 'Evaluator version changed');
    check(digest(frozen.dataset) === frozen.digest, 'FROZEN_DATA_CHANGED', 'Frozen dataset identity changed; restore the original evidence or start a new run');
    return frozen.dataset;
  }
  list(host) { this.main(host); return this.host.storage.list('runs').filter(r => r.ownerConversationId === host.scope.conversationId).map(r => ({ id: r.id, title: r.title, status: r.status, phase: r.phase, trials: r.trials.length, tasks: r.tasks.length, updatedAt: r.updatedAt, report: r.report ?? null })); }
  cancelTask(id, reason) { try { this.host.agents.cancel(id, reason); } catch (error) { this.host.events?.emit('task.cancel.failed', { taskId: id, ...errorInfo(error) }); } }
  async control(host, id, action) {
    const run = this.get(id); this.main(host, run);
    if (action === 'resume') {
      check(['paused', 'interrupted', 'failed'].includes(run.status), 'NOT_RESUMABLE', 'Only paused, interrupted or failed runs can resume');
      check(!this.running.has(id), 'STILL_STOPPING', 'Previous tasks are still stopping; inspect and retry resume');
      verifyResearch(host, run.config.research); verifyEvaluator(host, run.config.evaluator);
      this.dataset(id);
      for (const model of [run.config.model, ...Object.values(run.config.agentModels)]) configuredModel(host, model);
      this.update(id, { status: 'queued', generation: run.generation + 1, error: null, report: null, reportPending: false, reportError: null,
        reportSnapshot: null, reportFiles: [], previousReports: [...(run.previousReports ?? []), ...(run.report ? [run.report] : [])] }); this.event(id, 'resumed', '显式恢复未完成阶段；已经保存的产物沿用'); this.pump(id);
    } else {
      check(['pause', 'cancel'].includes(action), 'INVALID_ARGUMENT', 'Choose pause, resume or cancel');
      check(action === 'cancel' ? !FINAL.has(run.status) : !terminal.has(run.status), 'RUN_FINISHED', 'Run already ended');
      this.update(id, { status: action === 'pause' ? 'paused' : 'cancelled', reportPending: false, ...(action === 'cancel' ? { completedAt: this.now() } : {}) });
      this.event(id, action, action === 'pause' ? '暂停研究，保留所有断点' : '取消研究，保留已产生的证据');
      this.running.get(id)?.controller.abort(new Error(action));
      for (const task of this.get(id).tasks) if (!task.finishedAt) this.cancelTask(task.id, `Mining run ${action}`);
      await this.running.get(id)?.promise;
      if (action === 'cancel' && !this.closed) {
        try { await this.report(host, id); }
        catch (error) { this.update(id, { reportPending: true, reportError: errorInfo(error) }); }
      }
    }
    return this.get(id);
  }
  pump(id) {
    if (this.closed || this.running.has(id)) return;
    const controller = new AbortController(), entry = { controller };
    this.running.set(id, entry);
    // A background run must not inherit the completed start/resume invocation.
    entry.promise = this.observationScope.runInAsyncScope(() => new Promise(resolve => setImmediate(resolve)).then(() => this.execute(id, controller.signal))).catch(error => {
      this.update(id, { status: 'failed', reportPending: false, error: errorInfo(error) });
    }).finally(() => this.running.delete(id));
  }
  async task(id, role, mode, key, details, signal) {
    signal.throwIfAborted(); let run = this.get(id);
    const prior = run.tasks.filter(t => t.key === key).at(-1);
    // A validated submission is a durable checkpoint even if the process died
    // after the tool returned but before the Agent's final text was recorded.
    if (prior?.output) return prior.output;
    if (prior?.finalizeReceipt) return prior.finalizeReceipt;
    if (prior && prior.generation === run.generation) throw Object.assign(new Error(prior.error?.message ?? 'Task failed without structured output'), { code: 'AGENT_FAILED' });
    const reporter = mode === 'report', finalizer = mode === 'finalize';
    check(reporter || finalizer || run.tasks.filter(task => !['report', 'finalize'].includes(task.mode)).length < run.config.maxTasks, 'BUDGET_EXHAUSTED', 'Maximum Agent task budget reached');
    const model = run.config.agentModels[role] ?? run.config.model;
    configuredModel(this.host, model);
    if (!reporter) verifyEvaluator(this.host, run.config.evaluator); if (!reporter && !finalizer) verifyResearch(this.host, run.config.research);
    const tools = reporter ? ['auto_factor_report'] : finalizer ? ['auto_factor_finalize', run.config.evaluator.tool] : [...new Set(['auto_factor_context', 'auto_factor_submit', run.config.evaluator.tool, ...(run.config.research?.tools ?? [])])];
    const plugins = taskPlugins(run.config.evaluator, run.config.research, { reporter, finalizer });
    check(tools.length <= 64, 'RESEARCH_TOOL_LIMIT', 'Selected tools plus workflow/evaluator tools exceed the host limit of 64');
    const request = { requestId: `${id}:${key}:${run.generation}`, title: `${run.title.slice(0, 60)} · ${role}`, kind: 'research', output: { type: 'none' },
      instructions: reporter ? '只调用 auto_factor_report 归档指定 run_id 的已保存研究。不要修改研究或交易。' : finalizer ? '只调用 auto_factor_finalize 完成指定 run_id 已冻结选择的评估。不得重新研究或改动候选。' : `${SYSTEM}\n${PURPOSES[mode]}\n选中评估器约定：${run.evaluation.contract.instructions}`,
      input: { runId: id, role, mode, ...details, ...(prior?.pendingOutput ? { retryOutput: prior.pendingOutput } : {}) }, tools,
      plugins,
      model, lane: `${id}:${details.direction ?? role}`, queue: 'fifo', timeoutMs: run.config.taskTimeoutMs, maxTurns: reporter || finalizer ? 3 : 12, maxToolCalls: reporter || finalizer ? 3 : 24 };
    const receipt = this.host.agents.submit(request);
    let stopWatching = () => {};
    try {
      this.update(id, { tasks: [...this.get(id).tasks, { id: receipt.id, key, role, mode, ...details, generation: run.generation, model, status: receipt.status, createdAt: this.now(),
        ...(receipt.status === 'running' ? { startedAt: this.now() } : {}), requestDigest: digest(request) }] });
      stopWatching = this.watchTask(id, receipt.id, run.generation);
      const result = await this.host.agents.wait(receipt.id, signal);
      await this.observeTask(id, receipt.id, run.generation, () => !signal.aborted && !this.closed);
      stopWatching();
      run = this.get(id); const saved = run.tasks.find(t => t.id === receipt.id);
      this.update(id, { tasks: run.tasks.map(t => t.id === receipt.id ? { ...t, status: result.status, finishedAt: this.now(), conversationId: result.conversationId ?? null,
        text: String(result.result?.text ?? ''), ...(result.error ? { error: errorInfo(result.error) } : {}) } : t) });
      check(result.status === 'completed' || saved.output || saved.finalizeReceipt, 'AGENT_FAILED', `${role}: ${result.status} ${String(result.error ?? '').slice(0, 300)}`);
      check(reporter ? saved.reportReceipt : finalizer ? saved.finalizeReceipt : saved.output, 'MISSING_OUTPUT', `${role} did not call the structured output tool`);
      this.event(id, 'task_finished', `${role} 已保存 ${mode}`, { role, taskId: receipt.id, trialId: details.trialId });
      return reporter ? this.get(id).report : finalizer ? saved.finalizeReceipt : saved.output;
    } catch (error) {
      this.cancelTask(receipt.id, 'Mining task stopped');
      this.update(id, { tasks: this.get(id).tasks.map(t => t.id === receipt.id ? { ...t, status: signal.aborted ? 'cancelled' : 'failed', finishedAt: this.now(), error: errorInfo(error) } : t) });
      throw error;
    } finally { stopWatching(); }
  }
  context(host, id, section = 'team', offset = 0, limit = 20) {
    const { run, task } = this.authorize(host, id);
    const page = rows => ({ items: rows.slice(offset, offset + limit), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null });
    const base = { runId: id, title: run.title, goal: run.goal, status: run.status, config: run.config, data: run.data,
      assignment: task ? { role: task.role, mode: task.mode, direction: task.direction ?? null, round: task.round ?? null, trialId: task.trialId ?? null,
        expectedOutput: task.mode === 'code' ? { candidate: run.evaluation?.contract?.candidateExample ?? {}, explanation: '实现与假设之间的关系' } : OUTPUTS[task.mode] ?? null } : null,
      evaluator: run.evaluation?.contract ?? null, holdoutMode: run.data.holdoutMode ?? 'legacy' };
    if (section === 'data') {
      const frozen = this.host.storage.get('datasets', id);
      return { ...base, rows: page((frozen.development ?? this.dataset(id)).rows), access: 'development-only; no held-out observations are provided by this workflow' };
    }
    if (section === 'memory') return { ...base, memory: page(run.memory), reflections: run.reflections };
    const team = page(run.tasks.filter(t => t.output).map(t => ({ taskId: t.id, role: t.role, round: t.round ?? null, trialId: t.trialId ?? null, output: t.output })));
    if (task) this.save(this.get(id), team.items.filter(value => value.taskId !== task.id).map(value => ({
      type: 'report.read', fromTaskId: value.taskId, toTaskId: task.id, taskId: task.id, role: task.role,
      message: `${task.role} 读取 ${value.role} 的共享结论`, generation: run.generation,
    })));
    return { ...base, trial: task?.trialId ? run.trials.find(t => t.id === task.trialId) : null, trials: page(run.trials), team, reflections: run.reflections };
  }
  async submit(host, id, output, signal) {
    const { run, task } = this.authorize(host, id, host.agents.current()?.input?.mode);
    check(task && ['running', 'queued'].includes(run.status) && !run.selection, 'RUN_NOT_ACTIVE', 'Research submissions require an active unfrozen run');
    check(output && !Array.isArray(output) && typeof output === 'object' && Buffer.byteLength(JSON.stringify(output)) <= 16000, 'INVALID_OUTPUT', 'Output must be an object <=16KB');
    let value = this.validateOutput(run, task, output);
    const pending = run.tasks.find(t => t.key === task.key && t.pendingOutput)?.pendingOutput;
    if (pending) check(canonical(pending) === canonical(value), 'OUTPUT_FROZEN', 'This task already has a different output');
    if (task.output) return task.output;
    this.update(id, { tasks: this.get(id).tasks.map(t => t.id === task.id ? { ...t, pendingOutput: value } : t) });
    if (task.mode === 'code' || task.mode === 'selection') {
      const request = task.mode === 'code' ? { action: 'candidate', trial_id: task.trialId, candidate: value.candidate, accepted_ids: run.trials.filter(t => t.status === 'accepted').map(t => t.id) }
        : { action: 'select', trial_ids: value.trialIds };
      let measured;
      try { measured = await callEvaluator(host, run.config.evaluator, { ...request, run_id: id, session_id: run.evaluation.sessionId }, signal); }
      catch (error) {
        // An explicit semantic rejection is safe to correct. An interrupted or
        // unknown outcome keeps the original input for an idempotent retry.
        if (error.code === 'EVALUATION_REJECTED') this.update(id, { tasks: this.get(id).tasks.map(t => {
          if (t.key !== task.key || t.generation > task.generation || t.output) return t;
          const { pendingOutput: _pending, ...rest } = t; return rest;
        }) });
        throw error;
      }
      check(task.mode !== 'code' || measured.trialId === task.trialId && measured.candidate && typeof measured.eligible === 'boolean' && measured.metrics && Array.isArray(measured.redundancy), 'EVALUATOR_PROTOCOL', 'Evaluator must return candidate identity, measured metrics, eligibility and redundancy');
      check(task.mode !== 'selection' || canonical(measured.trialIds) === canonical(value.trialIds) && measured.selectionDigest, 'EVALUATOR_PROTOCOL', 'Evaluator selected different candidates');
      value = { ...value, evaluation: measured };
    }
    this.authorize(host, id, task.mode);
    check(['running', 'queued'].includes(this.get(id).status), 'RUN_NOT_ACTIVE', 'Run stopped while evaluator was working; frozen receipts remain recoverable');
    this.update(id, { tasks: this.get(id).tasks.map(t => t.id === task.id ? { ...t, output: value, submittedAt: this.now() } : t) });
    this.event(id, 'submitted', `${task.role} 提交了结构化 ${task.mode}`, { role: task.role, trialId: task.trialId }); return value;
  }
  validateOutput(run, task, o) {
    switch (task.mode) {
      case 'plan': {
        check(typeof o.stop === 'boolean' && Array.isArray(o.directions) && o.directions.length <= 6 && new Set(o.directions).size === o.directions.length && o.directions.every(d => run.config.directions.includes(d)) && (o.stop || o.directions.length), 'INVALID_OUTPUT', 'Plan must choose configured directions or stop');
        return { directions: o.directions, stop: o.stop, reason: text(o.reason, 'reason') };
      }
      case 'hypothesis': {
        if (o.skip === true) return { skip: true, reason: text(o.reason, 'reason') };
        if (o.parentId) check(run.trials.some(t => t.id === o.parentId && t.round < task.round), 'INVALID_PARENT', 'Parent must be an earlier-round trial');
        return { hypothesis: text(o.hypothesis, 'hypothesis'), rationale: text(o.rationale, 'rationale'), ...(o.parentId ? { parentId: o.parentId } : {}) };
      }
      case 'code': check(o.candidate && typeof o.candidate === 'object' && !Array.isArray(o.candidate), 'INVALID_OUTPUT', 'Submit an opaque candidate object accepted by the selected evaluator'); return { candidate: structuredClone(o.candidate), explanation: text(o.explanation, 'explanation') };
      case 'review': check(['accept', 'reject'].includes(o.verdict), 'INVALID_OUTPUT', 'verdict must be accept/reject'); return { verdict: o.verdict, reason: text(o.reason, 'reason') };
      case 'reflection': check(typeof o.stop === 'boolean' && Array.isArray(o.lessons) && o.lessons.length <= 8, 'INVALID_OUTPUT', 'Reflection requires lessons and stop'); return { summary: text(o.summary, 'summary'), lessons: o.lessons.map(s => text(s, 'lesson', 1000)), stop: o.stop };
      case 'selection': {
        check(Array.isArray(o.trialIds) && o.trialIds.length <= 20 && new Set(o.trialIds).size === o.trialIds.length && o.trialIds.every(id => run.trials.some(t => t.id === id && t.status === 'accepted')), 'INVALID_OUTPUT', 'Select only unique accepted trials');
        return { trialIds: o.trialIds, reason: text(o.reason, 'reason') };
      }
      default: throw new Error('No structured output for this role');
    }
  }
  trial(id, trialId, changes) { return this.update(id, { trials: this.get(id).trials.map(t => t.id === trialId ? { ...t, ...changes } : t) }); }
  async branch(id, round, direction, signal) {
    const key = `r${round}:${digest(direction).slice(7, 19)}`, trialId = `trial_${key.replace(':', '_')}`;
    let trial = this.get(id).trials.find(t => t.id === trialId);
    if (trial && ['accepted', 'rejected', 'failed'].includes(trial.status)) return;
    if (!trial && this.get(id).trials.length >= this.get(id).config.maxTrials) return;
    if (!trial) {
      this.update(id, { trials: [...this.get(id).trials, { id: trialId, round, direction, status: 'proposing', createdAt: this.now() }] });
      trial = this.get(id).trials.find(t => t.id === trialId);
    }
    try {
      const proposal = await this.task(id, 'researcher', 'hypothesis', `${key}:hypothesis`, { round, direction, trialId }, signal);
      if (proposal.skip) { this.trial(id, trialId, { status: 'rejected', hypothesis: '未提出假设', review: { verdict: 'reject', reason: proposal.reason } }); return; }
      this.trial(id, trialId, { ...proposal, status: 'implementing' });
      const code = await this.task(id, 'coder', 'code', `${key}:code`, { round, direction, trialId }, signal);
      const measured = code.evaluation;
      this.trial(id, trialId, { candidate: measured.candidate, candidateDigest: measured.candidateDigest, explanation: code.explanation,
        metrics: measured.metrics, redundancy: measured.redundancy, evaluationReceipt: measured, status: 'reviewing' });
      this.event(id, 'evaluated', '选中的评估能力已返回计算回执', { trialId });
      const review = await this.task(id, 'reviewer', 'review', `${key}:review`, { round, direction, trialId }, signal);
      const eligible = measured.eligible;
      this.trial(id, trialId, { review, eligible, status: review.verdict === 'accept' && eligible ? 'accepted' : 'rejected',
        gate: measured.gate ?? '' });
    } catch (error) {
      if (signal.aborted || error.code === 'BUDGET_EXHAUSTED') throw error;
      this.trial(id, trialId, { status: 'failed', error: errorInfo(error) });
      this.event(id, 'trial_failed', errorInfo(error).message, { trialId });
    }
  }
  async execute(id, signal) {
    if (signal.aborted || this.get(id).status !== 'queued') return;
    this.update(id, { status: 'running' });
    try {
      for (let round = 0; !this.get(id).selection && round < this.get(id).config.rounds; round++) {
        signal.throwIfAborted();
        if (round && this.get(id).reflections.find(r => r.round === round - 1)?.stop) break;
        if (this.get(id).reflections.some(r => r.round === round)) continue;
        if (this.get(id).trials.length >= this.get(id).config.maxTrials && !this.get(id).trials.some(t => t.round === round && !['accepted', 'rejected', 'failed'].includes(t.status))) break;
        this.update(id, { round, phase: 'plan' });
        const plan = await this.task(id, 'supervisor', 'plan', `r${round}:plan`, { round }, signal);
        if (plan.stop) break;
        this.update(id, { phase: 'experiments' });
        for (let start = 0; start < plan.directions.length; start += this.get(id).config.parallelism) {
          const results = await Promise.allSettled(plan.directions.slice(start, start + this.get(id).config.parallelism).map(d => this.branch(id, round, d, signal)));
          const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
        }
        this.update(id, { phase: 'reflection' });
        const reflection = await this.task(id, 'reflector', 'reflection', `r${round}:reflection`, { round }, signal);
        this.update(id, { reflections: [...this.get(id).reflections.filter(r => r.round !== round), { round, ...reflection }] });
      }
      signal.throwIfAborted(); let selection = this.get(id).selection;
      if (!selection) {
        this.update(id, { phase: 'selection' });
        const selected = await this.task(id, 'supervisor', 'selection', 'selection', { round: this.get(id).round }, signal);
        selection = { ...selected, frozenAt: this.now(), digest: selected.evaluation.selectionDigest };
        this.update(id, { selection }); this.event(id, 'selection_frozen', `冻结 ${selected.trialIds.length} 个候选，交由所选评估能力完成最终评价`);
      }
      this.update(id, { phase: 'final-evaluation' });
      await this.task(id, 'supervisor', 'finalize', 'evaluation:finalize', {}, signal);
      this.update(id, { status: 'completed', phase: 'complete', completedAt: this.now(), reportPending: true }); this.event(id, 'completed', '研究完成；候选与评估回执可复核');
    } catch (error) {
      if (!signal.aborted) { const exhausted = error.code === 'BUDGET_EXHAUSTED'; this.update(id, { status: exhausted ? 'exhausted' : 'failed', reportPending: exhausted,
        ...(exhausted ? { completedAt: this.now() } : {}), error: errorInfo(error) }); this.event(id, 'stopped', errorInfo(error).message); }
    } finally {
      if (!this.closed && !signal.aborted && FINAL.has(this.get(id).status) && !this.get(id).report) {
        try { await this.task(id, 'reporter', 'report', `report:${this.get(id).generation}`, {}, signal); }
        catch (error) { this.update(id, { reportPending: true, reportError: errorInfo(error) }); }
      }
      if (FINAL.has(this.get(id).status)) this.event(id, 'run.finished', '本次因子研究已结束');
    }
  }
  async finalize(host, id, signal) {
    const { run, task } = this.authorize(host, id, 'finalize');
    check(run.selection && ['running', 'queued'].includes(run.status), 'RUN_NOT_ACTIVE', 'Final evaluation requires active work with a frozen selection');
    if (task.finalizeReceipt) return task.finalizeReceipt;
    const result = await callEvaluator(host, run.config.evaluator, { action: 'finalize', run_id: id, session_id: run.evaluation.sessionId, selection_digest: run.selection.digest }, signal);
    check(result.selectionDigest === run.selection.digest && result.archive && Array.isArray(result.archive.rows) && result.holdout && ['evaluated', 'not-requested'].includes(result.holdoutStatus), 'EVALUATOR_PROTOCOL', 'Final evaluator receipt must match the frozen selection and include reproducible evidence');
    check(run.data.holdoutMode !== 'none' || result.holdoutStatus === 'not-requested' && Object.keys(result.holdout).length === 0, 'HOLDOUT_ACCESS', 'Development-only sessions cannot claim a holdout evaluation');
    this.authorize(host, id, 'finalize');
    check(['running', 'queued'].includes(this.get(id).status), 'RUN_NOT_ACTIVE', 'Run stopped during final evaluation');
    const stored = this.host.storage.get('datasets', id), { archive, ...finalEvaluation } = result;
    const receipt = { completed: true, holdoutStatus: result.holdoutStatus, receiptDigest: result.receiptDigest };
    this.host.storage.transaction(() => {
      this.host.storage.put('datasets', { id, dataset: archive, development: stored.development ?? stored.dataset, digest: digest(archive) });
      this.update(id, { holdout: result.holdout, finalEvaluation, tasks: this.get(id).tasks.map(t => t.id === task.id ? { ...t, finalizeReceipt: receipt } : t) });
    });
    return receipt;
  }
  async report(host, id) {
    const { run, task } = this.authorize(host, id, host.scope.kind === 'main' ? undefined : 'report');
    check(FINAL.has(run.status) && run.tasks.filter(value => value.role !== 'reporter').every(value => value.finishedAt),
      'RUN_NOT_FINISHED', 'Only completed, cancelled or exhausted work with all research tasks settled can publish its final summary');
    if (!this.reporting.has(id)) {
      const pending = Promise.resolve().then(async () => {
        check(this.get(id).config.evaluator || this.get(id).report?.fileId, 'EVALUATOR_REQUIRED', 'This legacy run has no evaluator receipt; preserve its ledger and use an explicit evaluator for new work');
        if (!this.get(id).reportSnapshot && !this.get(id).report) this.update(id, { reportSnapshot: finalSnapshot(this.get(id)), reportPending: true });
        const report = await archiveReport(host, this.get(id), this.get(id).report?.fileId ? null : this.dataset(id), {
          onFile: receipt => {
            const current = this.get(id);
            this.update(id, { reportFiles: [...(current.reportFiles ?? []).filter(file => file.suffix !== receipt.suffix), receipt] });
          },
        });
        this.update(id, { report, reportPending: false, reportError: null }); return report;
      }).catch(error => { this.update(id, { reportPending: true, reportError: errorInfo(error) }); throw error; })
        .finally(() => this.reporting.delete(id));
      this.reporting.set(id, pending);
    }
    const report = await this.reporting.get(id);
    if (task) this.update(id, { tasks: this.get(id).tasks.map(value => value.id === task.id ? { ...value, reportReceipt: report } : value) });
    return report;
  }
  async dispose() {
    this.closed = true;
    for (const poll of this.taskPolls.values()) poll.stop();
    for (const [id, entry] of this.running) {
      if (['queued', 'running'].includes(this.get(id).status)) this.update(id, { status: 'interrupted', reportPending: false });
      entry.controller.abort(new Error('Plugin stopped'));
      for (const task of this.get(id).tasks) if (!task.finishedAt) this.cancelTask(task.id, 'Plugin stopped');
    }
    await Promise.allSettled([...this.running.values()].map(entry => entry.promise));
    await Promise.allSettled(this.reporting.values());
    this.listeners.clear(); this.observationScope.emitDestroy();
  }
}
