import { configuration, configuredModel, check, digest, canonical, text, errorInfo, ID, terminal } from './shared.js';
import { waitForSettledRun } from './workflow-mechanics.js';
import { SYSTEM, OUTPUTS, PURPOSES, collaboration } from './team.js';
import { verifyResearch, verifyEvaluator, taskPlugins, knowledgeCalls, hasResearchDataAccess } from './composition.js';
import { callEvaluator } from './evaluation.js';
import { archiveReport, finalSnapshot } from './archive.js';
import { Checkpoints } from './checkpoints.js';
import { factorPlan } from './workflow.js';

const FINAL = new Set(['completed', 'cancelled']);
const interruption = (error, signal) => ['RUN_INTERRUPTED', 'DEPENDENCY_UNAVAILABLE'].includes(error?.code) ? error
  : ['RUN_INTERRUPTED', 'DEPENDENCY_UNAVAILABLE'].includes(signal?.reason?.code) ? signal.reason : null;
const dependencyCodes = new Set(['DEPENDENCY_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'MODEL_CHANGED', 'RESEARCH_PLUGIN_UNAVAILABLE', 'RESEARCH_PLUGIN_CHANGED', 'EVALUATOR_UNAVAILABLE', 'EVALUATOR_CHANGED', 'SOURCE_UNAVAILABLE', 'PROVIDER_UNAVAILABLE']);
const requirement = id => ({ id: 'factor-dependencies', capability: ID + '#auto_factor_dependencies', input: { run_id: id }, reason: 'The frozen factor workflow requires its selected model, evaluator and development evidence.' });
const dependencyError = (id, error) => Object.assign(new Error(error.message), { code: 'DEPENDENCY_UNAVAILABLE', details: { ...error.details, cause: errorInfo(error), requirements: [requirement(id)] } });

// Like trading-decision, the service schedules real host Agents and keeps durable
// checkpoints. This workflow has no account, order, or strategy-control ports.
export class MiningRuntime {
  constructor(host, { now = Date.now } = {}) {
    this.host = host; this.now = now; this.checkpoints = new Checkpoints(host); this.workHosts = new Map(); this.running = new Map(); this.closed = false;
    this.reporting = new Map(); this.executions = new Map();
  }
  get(id) { const run = this.checkpoints.get(id); check(run, 'NOT_FOUND', 'Mining run not found'); return run; }
  save(run, events = []) {
    const previous = this.checkpoints.get(run.id);
    if (canonical(previous) === canonical(run) && !events.length) return previous;
    const saved = this.checkpoints.save({ ...run, events: [...(run.events ?? []), ...events].slice(-2000), updatedAt: this.now() });
    if (previous?.phase !== saved.phase || previous?.status !== saved.status) this.executions.get(run.id)?.progress({ phase: saved.phase, summary: saved.status });
    return saved;
  }
  update(id, changes) { return this.save({ ...this.get(id), ...changes }); }
  async checkpoint(id) {
    await this.checkpoints.flush();
    const execution = this.executions.get(id), run = this.get(id);
    if (execution) await execution.checkpoint({ runId: id, generation: run.generation, phase: run.phase, round: run.round });
  }
  dependencies(host, id) {
    // requires probes may inspect only the already-loaded frozen data and
    // declarations. Evaluator preparation/candidate/finalization can perform
    // network/process work and remains in explicit workflow operations.
    const run = this.get(id);
    try {
      this.dataset(id);
      if (run.workflowDigest) check(run.workflowDigest === digest(run.config.workflow), 'FROZEN_WORKFLOW_CHANGED', 'Restore the frozen workflow plan or start a new factor run.');
      const missingOutput = run.tasks.find(task => task.finishedAt && !task.output && task.status !== 'cancelled');
      check(!missingOutput, 'MISSING_OUTPUT', `Completed ${missingOutput?.role}/${missingOutput?.mode} Agent ${missingOutput?.runRef?.id ?? missingOutput?.id} did not save its structured output. Its text and prior evidence are retained. auto_factor_submit requires that registered running role; the main Agent cannot submit on its behalf or repeat a completed Agent.`);
      if (!run.finalEvaluation) {
        verifyEvaluator(host, run.config.evaluator);
        if (!run.selection) {
          verifyResearch(host, run.config.research);
          knowledgeCalls(host, run.config.research);
          for (const model of [run.config.model, ...Object.values(run.config.agentModels)]) configuredModel(host, model);
        }
      }
      return { available: true, details: { runId: id, frozenDataVerified: true, evaluatorSession: run.evaluation.sessionId,
        evaluatorSessionProbe: 'No independent read-only session probe is declared; the evaluator validates its saved session at the next requested operation.' } };
    } catch (error) { return { available: false, reason: error.message, details: { runId: id, cause: errorInfo(error) } }; }
  }
  event(id, type, message, extra = {}) {
    return this.save(this.get(id), [{ at: this.now(), type, message, ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)) }]);
  }
  executor(host, run, execution) {
    const proof = execution?.provenance?.workflow;
    check(host.context.kind === 'subagent' && proof?.runId === host.context.runId && proof.sessionId === host.context.sessionId && proof.ownerSessionId === run.ownerConversationId && execution.provenance.caller.pluginId === ID,
      'FORBIDDEN', 'Requires the trusted workflow execution for this owner');
  }
  main(host, run) {
    check(host.context.kind === 'main', 'FORBIDDEN', 'Use this operation in the main conversation');
    if (run) check(host.context.sessionId === run.ownerConversationId, 'FORBIDDEN', 'Run belongs to another conversation');
  }
  authorize(host, id, mode, execution) {
    const run = this.get(id);
    if (host.context.kind === 'main' && !mode) { this.main(host, run); return { run }; }
    const current = execution?.provenance?.agent, assignment = current?.input;
    const task = run.tasks.find(t => t.id === assignment?.assignmentId);
    check(host.context.kind === 'subagent' && current?.pluginId === ID && current.sessionId === host.context.sessionId &&
      assignment?.runId === id && assignment.generation === run.generation && task && task.generation === run.generation && !task.finishedAt &&
      task.role === assignment.role && task.mode === assignment.mode && (!mode || task.mode === mode),
      'FORBIDDEN', 'Requires the registered running Agent for this run and role');
    return { run, task };
  }
  async start() {
    await this.checkpoints.load();
    for (const run of this.checkpoints.all()) {
      if (run.workflow && !FINAL.has(run.status)) {
        this.update(run.id, { status: 'interrupted', reportPending: false, error: { code: 'RUN_INTERRUPTED', message: 'Resume the retained host Run; saved Agent identities and outputs are unchanged.' } });
        continue;
      }
      const active = ['running', 'queued'].includes(run.status), unsettled = run.tasks.filter(task => !task.finishedAt);
      if (!active && !unsettled.length) continue;
      for (const task of unsettled) if (task.runRef) await this.cancelTask(task.runRef, 'Host restart: reconcile before explicit resume');
      this.update(run.id, { status: active ? 'interrupted' : run.status, reportPending: FINAL.has(run.status) && !run.report,
        tasks: run.tasks.map(task => task.finishedAt ? task : { ...task, status: 'interrupted', finishedAt: this.now(), error: { code: 'HOST_RESTART', message: 'Host restarted' } }),
        ...(active ? { error: { code: 'HOST_RESTART', message: 'Saved experiments retained; explicitly resume unfinished stages.' } } : {}) });
      this.event(run.id, 'interrupted', active ? '宿主重启；保留断点，等待显式恢复' : '宿主重启；遗留角色已中断，最终结果保留');
    }
    await this.checkpoints.flush(); return this;
  }
  async create(host, input, signal) {
    this.main(host); check(!this.closed, 'CLOSED', 'Plugin is stopping');
    text(input.request_id, 'request_id', 150); const title = text(input.title, 'title', 100), goal = text(input.goal, 'goal', 4000);
    const config = configuration(host, input.config);
    const id = `fm_${digest([host.context.sessionId, input.request_id]).slice(7, 39)}`;
    // Loading and calling happen inside auto_factor_start's live invocation.
    await host.plugins.setEnabled(config.evaluator.plugin_id, true, { scope: 'session' });
    const openResearchData = hasResearchDataAccess(config.research);
    const prepared = await callEvaluator(host, config.evaluator, { action: 'prepare', run_id: id,
      ...(input.dataset_id ? { dataset_id: text(input.dataset_id, 'dataset_id', 200) } : {}), options: config.evaluator.arguments,
      access: openResearchData ? 'development-only' : 'restricted' }, signal);
    check(prepared.development && Array.isArray(prepared.development.rows) && prepared.data?.digest && prepared.contract && typeof prepared.contract.instructions === 'string' && prepared.contract.instructions.length <= 6000,
      'EVALUATOR_PROTOCOL', 'Evaluator must return bounded development evidence and candidate instructions');
    check(!openResearchData || prepared.data.holdoutMode === 'none', 'HOLDOUT_ACCESS', 'Research capabilities without compatible input-only access require an evaluator session without holdout data');
    const { development: dataset, ...evaluation } = prepared, dataDigest = prepared.data.digest;
    const fingerprint = digest({ title, goal, config, dataDigest });
    const prior = this.checkpoints.get(id);
    if (prior) { check(prior.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', 'request_id already has different frozen inputs'); return prior; }
    const memory = this.checkpoints.all().filter(r => r.ownerConversationId === host.context.sessionId && r.data.digest === dataDigest && r.status === 'completed')
      .slice(-5).map(r => ({ runId: r.id, dataDigest, reflections: r.reflections, trials: r.trials.map(t => ({ id: t.id, hypothesis: t.hypothesis ?? null, candidate: t.candidate ?? null, metrics: t.metrics ?? null, review: t.review ?? null, error: t.error ?? null })) }));
    const run = { id, title, goal, fingerprint, ownerConversationId: host.context.sessionId, config, status: 'queued', phase: 'plan',
      createdAt: this.now(), updatedAt: this.now(), round: 0, generation: 0, tasks: [], trials: [], events: [], reflections: [], memory,
      data: prepared.data, evaluation, reportPending: false, ...(config.workflow ? { workflowDigest: digest(config.workflow) } : {}) };
    await this.checkpoints.setDataset(id, { id, dataset, digest: digest(dataset) }); this.save(run);
    this.event(id, 'created', '固定输入、时间分割、模型和研究范围，开始因子研究');
    await this.checkpoints.flush(); await this.pump(host, id); return this.get(id);
  }
  dataset(id) {
    const frozen = this.checkpoints.dataset(id);
    check(frozen.dataset.evaluatorVersion === this.get(id).data.evaluatorVersion, 'EVALUATOR_CHANGED', 'Evaluator version changed');
    check(digest(frozen.dataset) === frozen.digest, 'FROZEN_DATA_CHANGED', 'Frozen dataset identity changed; restore the original evidence or start a new run');
    return frozen.dataset;
  }
  async observed(host, id) {
    let run = this.get(id), interrupts = []; this.main(host, run);
    if (run.workflow && !FINAL.has(run.status)) {
      const actual = (await host.runs.read(run.workflow)).run;
      interrupts = (actual.interrupts ?? []).filter(item => !item.resolvedAt);
      if (actual.status === 'interrupted' && run.status !== 'interrupted') run = this.update(id, { status: 'interrupted', error: { code: 'RUN_INTERRUPTED', message: actual.interrupts?.find(item => !item.resolvedAt)?.reason ?? 'Workflow requires dependency or input resolution' } });
      else if (['cancelled', 'unknown'].includes(actual.status)) run = this.update(id, { status: actual.status === 'cancelled' ? 'cancelled' : 'interrupted', error: errorInfo(actual.error ?? new Error(`Host workflow ${actual.status}`)) });
      await this.checkpoints.flush();
    }
    return { ...run, interrupts };
  }
  async list(host) {
    this.main(host);
    return Promise.all(this.checkpoints.all().filter(r => r.ownerConversationId === host.context.sessionId).map(async saved => {
      const r = await this.observed(host, saved.id);
      return { id: r.id, title: r.title, status: r.status, phase: r.phase, trials: r.trials.length, tasks: r.tasks.length, updatedAt: r.updatedAt, report: r.report ?? null };
    }));
  }
  async cancelTask(ref, reason) { try { await this.host.runs.cancel(ref, { reason }); } catch (error) { if (!['NOT_FOUND', 'run_not_active'].includes(error.code)) throw error; } }
  async control(host, id, action, options = {}) {
    const run = await this.observed(host, id);
    if (action === 'resume') {
      check(['paused', 'interrupted'].includes(run.status), 'NOT_RESUMABLE', 'Only interrupted work can resume its original host Run');
      check(!this.running.has(id), 'STILL_STOPPING', 'Previous tasks are still stopping; inspect and retry resume');
      check(run.workflow, 'NOT_STARTED', 'There is no accepted host Run to resume');
      await host.runs.resume(run.workflow, { interruptIds: options.interrupt_ids, response: options.response ?? null });
      this.event(id, 'resume_requested', '已请求恢复原 Run；依赖由宿主重查，已保存的角色与评估结果沿用');
    } else {
      check(['pause', 'cancel'].includes(action), 'INVALID_ARGUMENT', 'Choose pause, resume or cancel');
      check(action === 'cancel' ? !FINAL.has(run.status) : !terminal.has(run.status), 'RUN_FINISHED', 'Run already ended');
      if (action === 'pause') {
        check(run.workflow, 'NOT_STARTED', 'There is no accepted host Run to interrupt');
        const receipt = await host.runs.interrupt(run.workflow, { reason: 'Factor research paused by the main Agent' });
        this.update(id, { ...(receipt.run?.status === 'interrupted' ? { status: 'interrupted' } : {}), pauseRequestedAt: this.now(), reportPending: false });
        await this.checkpoints.flush(); return this.get(id);
      }
      this.update(id, { status: 'cancelled', reportPending: false, completedAt: this.now() });
      this.event(id, action, action === 'pause' ? '暂停研究，保留所有断点' : '取消研究，保留已产生的证据');
      if (run.workflow) await host.runs.cancel(run.workflow, { reason: `Mining run ${action}` });
      this.running.get(id)?.controller.abort(new Error(action));
      for (const task of this.get(id).tasks) if (!task.finishedAt && task.runRef) await this.cancelTask(task.runRef, `Mining run ${action}`);
      await this.running.get(id)?.promise.catch(() => {});
    }
    await this.checkpoints.flush(); return this.get(id);
  }
  async pump(host, id) {
    if (this.closed || this.running.has(id)) return;
    const run = this.get(id);
    if (run.workflow) return run.workflow;
    const result = await host.capabilities.invoke(ID + '#auto_factor_workflow', { run_id: id }, { operationId: id + ':workflow',
      task: { title: run.title, ...(collaboration(run.config) ? { collaboration: collaboration(run.config) } : {}), output: { type: 'report', space: 'strategy', path: `${run.config.reportFolder}/${id}-attempt-${run.generation + 1}.html` } } });
    check(result.type === 'run', 'INVALID_HOST_RESULT', 'Workflow requires a tracked Run'); this.update(id, { workflow: result.run }); await this.checkpoints.flush();
  }
  async workflow(host, id, signal, execution) {
    this.executor(host, this.get(id), execution); check(!this.running.has(id), 'RUN_ACTIVE', 'Workflow is already active');
    const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal].filter(Boolean)), entry = { controller };
    this.running.set(id, entry); this.workHosts.set(id, host); this.executions.set(id, execution);
    check(!execution.checkpointState || execution.checkpointState.runId === id, 'CHECKPOINT_MISMATCH', 'Checkpoint belongs to another factor run');
    this.update(id, { workflow: execution.run, status: 'queued', error: null, executionAttempt: execution.attempt });
    const reused = this.get(id).tasks.filter(task => task.output && task.finishedAt);
    if (reused.length) execution.progress({ phase: 'resume', summary: `复用 ${reused.length} 项已保存成果：${reused.slice(0, 10).map(task => `${task.role}/${task.mode} (${task.runRef?.id ?? task.id})`).join('、')}`,
      metrics: { reusedOutputs: reused.length } });
    entry.promise = new Promise(resolve => setImmediate(resolve)).then(() => this.execute(id, combined));
    try { await entry.promise; await this.checkpoints.flush(); return { runId: id, status: this.get(id).status, report: this.get(id).report ?? null }; }
    finally { this.running.delete(id); this.workHosts.delete(id); this.executions.delete(id); }
  }
  async task(id, role, mode, key, details, signal) {
    signal.throwIfAborted(); let run = this.get(id); const host = this.workHosts.get(id);
    const member = factorPlan(run.config.workflow)[mode], originalRole = role;
    check(member, 'INVALID_WORKFLOW', `The ${mode} stage is omitted by this plan.`);
    role = member.id;
    check(host, 'NO_ACTIVE_WORKFLOW', 'Agent dispatch requires its active workflow Run');
    const prior = run.tasks.filter(t => t.key === key).at(-1);
    if (prior?.output && prior.finishedAt && prior.status === 'completed') return prior.output;
    if (prior?.finishedAt) throw Object.assign(new Error(prior.error?.message ?? 'Task ended without a reusable output; no new Agent is created'), { code: prior.error?.code ?? 'AGENT_FAILED' });
    const model = run.config.agentModels[role] ?? run.config.agentModels[originalRole] ?? run.config.model; configuredModel(host, model);
    verifyEvaluator(host, run.config.evaluator); verifyResearch(host, run.config.research); taskPlugins(run.config.evaluator, run.config.research);
    const readingCalls = knowledgeCalls(host, run.config.research);
    const allowedCalls = [{ pluginId: ID, capabilityId: 'auto_factor_context' }, { pluginId: ID, capabilityId: 'auto_factor_submit' }, ...run.config.research.tools.map(value => { const index = value.lastIndexOf('#'); return { pluginId: value.slice(0, index), capabilityId: value.slice(index + 1) }; })];
    for (const call of readingCalls) if (!allowedCalls.some(item => item.pluginId === call.pluginId && item.capabilityId === call.capabilityId)) allowedCalls.push(call);
    const assignmentId = 'assignment_' + digest([id, key, run.generation]).slice(7, 39);
    const request = prior?.request ?? { title: run.title.slice(0, 60) + ' · ' + member.title, instructions: SYSTEM + '\n' + run.evaluation.contract.instructions + (member.instructions ? '\n本任务具体职责：' + member.instructions : ''), objective: PURPOSES[mode],
      input: { runId: id, assignmentId, generation: run.generation, role, mode, ...details, ...(prior?.pendingOutput ? { retryOutput: prior.pendingOutput } : {}) },
      plugins: [...new Set([...run.config.research.plugins, ...readingCalls.map(call => call.pluginId)])], allowedCalls, model };
    if (!prior) this.update(id, { tasks: [...run.tasks, { id: assignmentId, key, role, mode, ...details, generation: run.generation, model, status: 'queued', createdAt: this.now(), request, requestDigest: digest(request) }] });
    await this.checkpoint(id); let ref = prior?.runRef;
    try {
      const result = ref ? { type: 'run', run: ref } : await host.capabilities.invoke('host.agent.run', request, { operationId: assignmentId, signal,
        task: { title: request.title, ...(collaboration(run.config) ? { agentId: role } : {}), role, stage: mode, iteration: details.round ?? 0, output: { type: 'none' } } });
      check(result.type === 'run', 'INVALID_HOST_RESULT', 'Agent capability must return a Run'); ref = result.run;
      this.update(id, { tasks: this.get(id).tasks.map(t => t.id === assignmentId ? { ...t, runRef: ref } : t) }); await this.checkpoint(id);
      const resultRun = await waitForSettledRun(host, ref, signal);
      run = this.get(id); const saved = run.tasks.find(t => t.id === assignmentId);
      this.update(id, { tasks: run.tasks.map(t => t.id === assignmentId ? { ...t, status: resultRun.status, finishedAt: this.now(), conversationId: resultRun.output?.sessionId ?? t.conversationId ?? null,
        text: String(resultRun.output?.text ?? ''), ...(resultRun.error ? { error: errorInfo(resultRun.error) } : {}) } : t) });
      check(resultRun.status === 'completed', 'AGENT_FAILED', role + ': ' + resultRun.status + (resultRun.error?.message ? ': ' + resultRun.error.message : ''));
      check(saved.output, 'MISSING_OUTPUT', role + ' did not save structured output');
      this.event(id, 'task_finished', role + ' 已保存 ' + mode, { role, taskId: assignmentId, trialId: details.trialId }); await this.checkpoints.flush(); return saved.output;
    } catch (error) {
      const control = interruption(error, signal);
      if (control || dependencyCodes.has(error.code)) {
        this.update(id, { tasks: this.get(id).tasks.map(t => t.id === assignmentId ? { ...t, status: 'interrupted', error: errorInfo(control ?? error) } : t) });
        await this.checkpoints.flush(); throw control ?? dependencyError(id, error);
      }
      this.update(id, { tasks: this.get(id).tasks.map(t => t.id === assignmentId ? { ...t, status: signal.aborted ? 'cancelled' : 'interrupted', ...(signal.aborted ? { finishedAt: this.now() } : {}), error: errorInfo(error) } : t) });
      await this.checkpoints.flush(); throw error;
    }
  }
  context(host, id, section = 'team', offset = 0, limit = 20, execution) {
    const { run, task } = this.authorize(host, id, undefined, execution);
    const page = rows => ({ items: rows.slice(offset, offset + limit), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null });
    let config = run.config, data = run.data;
    if (task && run.data.holdoutMode !== 'none') {
      // A full input Ref resolves the held-out rows too. Keep it in the owner
      // record and final archive, outside the research roles' development view.
      const { arguments: _arguments, ...evaluator } = run.config.evaluator;
      const { sourceId: _sourceId, inputRefs: _inputRefs, provenance: _provenance, dependencies: _dependencies, ...developmentData } = run.data;
      config = { ...run.config, evaluator };
      data = developmentData;
    }
    const base = { runId: id, title: run.title, goal: run.goal, status: run.status, config, data,
      assignment: task ? { role: task.role, mode: task.mode, direction: task.direction ?? null, round: task.round ?? null, trialId: task.trialId ?? null,
        expectedOutput: task.mode === 'code' ? { candidate: run.evaluation?.contract?.candidateExample ?? {}, explanation: '实现与假设之间的关系' } : OUTPUTS[task.mode] ?? null } : null,
      evaluator: run.evaluation?.contract ?? null, holdoutMode: run.data.holdoutMode ?? 'legacy' };
    if (section === 'data') {
      const frozen = this.checkpoints.dataset(id);
      return { ...base, rows: page((frozen.development ?? this.dataset(id)).rows), access: 'development-only; no held-out observations are provided by this workflow' };
    }
    if (section === 'memory') return { ...base, memory: page(run.memory), reflections: run.reflections };
    const team = page(run.tasks.filter(t => t.output).map(t => ({ taskId: t.id, role: t.role, round: t.round ?? null, trialId: t.trialId ?? null, output: t.output })));
    if (task) {
      // A child can read its assignment before start() returns its Run to the
      // parent. Use only host provenance already matched to this assignment.
      const toRunId = task.runRef?.id ?? execution.provenance.agent.runId;
      if (!task.runRef) {
        const workflow = execution.provenance.workflow;
        check(typeof toRunId === 'string' && toRunId === host.context.runId &&
          workflow?.runId === run.workflow?.id && workflow.ownerSessionId === run.ownerConversationId,
          'FORBIDDEN', 'Early handoff requires the assigned child and its trusted parent workflow');
      }
      const seen = new Set(run.consumedOutputs ?? []);
      for (const value of team.items.filter(value => value.taskId !== task.id)) {
        const source = run.tasks.find(item => item.id === value.taskId), key = `${value.taskId}:${task.id}`;
        if (seen.has(key) || !source?.runRef || source.generation !== task.generation) continue;
        this.executions.get(id)?.emit('handoff', { fromRunId: source.runRef.id, toRunId }); seen.add(key);
      }
      if (seen.size !== (run.consumedOutputs?.length ?? 0)) this.update(id, { consumedOutputs: [...seen] });
    }
    return { ...base, trial: task?.trialId ? run.trials.find(t => t.id === task.trialId) : null, trials: page(run.trials), team, reflections: run.reflections };
  }
  async submit(host, id, output, signal, execution) {
    const { run, task } = this.authorize(host, id, execution?.provenance?.agent?.input?.mode, execution);
    check(task && ['running', 'queued'].includes(run.status) && !run.selection, 'RUN_NOT_ACTIVE', 'Research submissions require an active unfrozen run');
    check(output && !Array.isArray(output) && typeof output === 'object' && Buffer.byteLength(JSON.stringify(output)) <= 16000, 'INVALID_OUTPUT', 'Output must be an object <=16KB');
    let value = this.validateOutput(run, task, output);
    const pending = run.tasks.find(t => t.key === task.key && t.pendingOutput)?.pendingOutput;
    if (pending) check(canonical(pending) === canonical(value), 'OUTPUT_FROZEN', 'This task already has a different output');
    if (task.output) { await this.checkpoints.flush(); return task.output; }
    this.update(id, { tasks: this.get(id).tasks.map(t => t.id === task.id ? { ...t, pendingOutput: value } : t) });
    await this.checkpoints.flush();
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
        if (dependencyCodes.has(error.code)) throw dependencyError(id, error);
        throw error;
      }
      check(task.mode !== 'code' || measured.trialId === task.trialId && measured.candidate && typeof measured.eligible === 'boolean' && measured.metrics && Array.isArray(measured.redundancy), 'EVALUATOR_PROTOCOL', 'Evaluator must return candidate identity, measured metrics, eligibility and redundancy');
      check(task.mode !== 'selection' || canonical(measured.trialIds) === canonical(value.trialIds) && measured.selectionDigest, 'EVALUATOR_PROTOCOL', 'Evaluator selected different candidates');
      value = { ...value, evaluation: measured };
    }
    this.authorize(host, id, task.mode, execution);
    check(['running', 'queued'].includes(this.get(id).status), 'RUN_NOT_ACTIVE', 'Run stopped while evaluator was working; frozen receipts remain recoverable');
    this.update(id, { tasks: this.get(id).tasks.map(t => t.id === task.id ? { ...t, output: value, submittedAt: this.now() } : t) });
    this.event(id, 'submitted', `${task.role} 提交了结构化 ${task.mode}`, { role: task.role, trialId: task.trialId }); await this.checkpoints.flush(); return value;
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
      case 'reflection': {
        check(!Object.hasOwn(o, 'stop') || typeof o.stop === 'boolean', 'INVALID_OUTPUT', 'Reflection stop must be a boolean when provided; omit it to continue');
        check(Array.isArray(o.lessons), 'INVALID_OUTPUT', 'Reflection lessons must be an array of strings');
        return { summary: text(o.summary, 'summary'), lessons: o.lessons.map(s => text(s, 'lesson', 1000)), stop: o.stop ?? false };
      }
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
      const eligible = measured.eligible;
      const review = factorPlan(this.get(id).config.workflow).review
        ? await this.task(id, 'reviewer', 'review', `${key}:review`, { round, direction, trialId }, signal)
        : { verdict: eligible ? 'accept' : 'reject', reason: 'Human-language review omitted by the frozen workflow; acceptance uses the actual evaluator eligibility gate.', source: 'evaluator' };
      this.trial(id, trialId, { review, eligible, status: review.verdict === 'accept' && eligible ? 'accepted' : 'rejected',
        gate: measured.gate ?? '' });
    } catch (error) {
      if (dependencyCodes.has(error.code)) throw dependencyError(id, error);
      throw error;
    }
  }
  async execute(id, signal) {
    if (signal.aborted || this.get(id).status !== 'queued') return;
    let reportInterruption;
    this.update(id, { status: 'running' });
    try {
      for (let round = 0; !this.get(id).selection && round < this.get(id).config.rounds; round++) {
        signal.throwIfAborted();
        await this.checkpoint(id);
        if (round && this.get(id).reflections.find(r => r.round === round - 1)?.stop) break;
        if (this.get(id).reflections.some(r => r.round === round) || this.get(id).completedRounds?.includes(round)) continue;
        if (this.get(id).trials.length >= this.get(id).config.maxTrials && !this.get(id).trials.some(t => t.round === round && !['accepted', 'rejected', 'failed'].includes(t.status))) break;
        this.update(id, { round, phase: 'plan' });
        const workflow = factorPlan(this.get(id).config.workflow);
        const plan = workflow.plan ? await this.task(id, 'supervisor', 'plan', `r${round}:plan`, { round }, signal)
          : { directions: this.get(id).config.directions, stop: false };
        if (plan.stop) break;
        this.update(id, { phase: 'experiments' });
        for (let start = 0; start < plan.directions.length; start += this.get(id).config.parallelism) {
          await Promise.all(plan.directions.slice(start, start + this.get(id).config.parallelism).map(d => this.branch(id, round, d, signal)));
        }
        this.update(id, { phase: 'reflection' });
        if (workflow.reflection) {
          const reflection = await this.task(id, 'reflector', 'reflection', `r${round}:reflection`, { round }, signal);
          this.update(id, { reflections: [...this.get(id).reflections.filter(r => r.round !== round), { round, ...reflection }] });
        } else this.update(id, { completedRounds: [...new Set([...(this.get(id).completedRounds ?? []), round])] });
        await this.checkpoint(id);
      }
      signal.throwIfAborted(); let selection = this.get(id).selection;
      if (!selection) {
        this.update(id, { phase: 'selection' });
        const selected = await this.task(id, 'supervisor', 'selection', 'selection', { round: this.get(id).round }, signal);
        selection = { ...selected, frozenAt: this.now(), digest: selected.evaluation.selectionDigest };
        this.update(id, { selection }); this.event(id, 'selection_frozen', `冻结 ${selected.trialIds.length} 个候选，交由所选评估能力完成最终评价`);
      }
      this.update(id, { phase: 'final-evaluation' });
      await this.checkpoint(id);
      await this.finalize(this.workHosts.get(id), id, signal);
      this.update(id, { status: 'completed', phase: 'complete', completedAt: this.now(), reportPending: true }); this.event(id, 'completed', '研究完成；候选与评估回执可复核');
    } catch (error) {
      const control = interruption(error, signal) ?? (dependencyCodes.has(error.code) ? dependencyError(id, error) : null);
      if (control || !signal.aborted) {
        this.update(id, { status: 'interrupted', reportPending: false, error: errorInfo(control ?? error) }); await this.checkpoints.flush();
        if (!control || control.code === 'DEPENDENCY_UNAVAILABLE') await this.executions.get(id).interrupt({ reason: (control ?? error).message, requirements: control?.details?.requirements, state: { runId: id, generation: this.get(id).generation, phase: this.get(id).phase, round: this.get(id).round } });
        throw control ?? error;
      }
    } finally {
      if (!this.closed && !signal.aborted && FINAL.has(this.get(id).status) && !this.get(id).report) {
        try { await this.report(this.workHosts.get(id), id, signal); }
        catch (error) { reportInterruption = interruption(error, signal) ?? error; this.update(id, { reportPending: true, reportError: errorInfo(error) }); }
      }
      reportInterruption ??= interruption(null, signal);
      if (reportInterruption) this.update(id, { status: 'interrupted', completedAt: null, reportPending: false, error: this.get(id).error ?? errorInfo(reportInterruption) });
      if (FINAL.has(this.get(id).status)) this.event(id, 'run.finished', '本次因子研究已结束');
    }
    if (reportInterruption) {
      if (!interruption(reportInterruption, signal)) await this.executions.get(id).interrupt({ reason: reportInterruption.message, state: { runId: id, generation: this.get(id).generation, phase: this.get(id).phase, round: this.get(id).round } });
      throw reportInterruption;
    }
    if (signal.aborted) {
      if (['running', 'queued'].includes(this.get(id).status)) this.update(id, { status: 'cancelled', completedAt: this.now() });
      signal.throwIfAborted();
    }
    const outcome = this.get(id);
    if (outcome.error || outcome.reportError) throw Object.assign(new Error(outcome.error?.message ?? outcome.reportError.message), { code: outcome.error?.code ?? outcome.reportError.code, details: { runId: id, report: outcome.report ?? null } });
  }
  async finalize(host, id, signal) {
    const run = this.get(id); this.executor(host, run, this.executions.get(id));
    check(run.selection && ['running', 'queued'].includes(run.status), 'RUN_NOT_ACTIVE', 'Final evaluation requires active work with a frozen selection');
    if (run.finalEvaluation) return run.finalEvaluation;
    const result = await callEvaluator(host, run.config.evaluator, { action: 'finalize', run_id: id, session_id: run.evaluation.sessionId, selection_digest: run.selection.digest }, signal);
    check(result.selectionDigest === run.selection.digest && result.archive && Array.isArray(result.archive.rows) && result.holdout && ['evaluated', 'not-requested'].includes(result.holdoutStatus), 'EVALUATOR_PROTOCOL', 'Final evaluator receipt must match the frozen selection and include reproducible evidence');
    check(run.data.holdoutMode !== 'none' || result.holdoutStatus === 'not-requested' && Object.keys(result.holdout).length === 0, 'HOLDOUT_ACCESS', 'Development-only sessions cannot claim a holdout evaluation');
    check(['running', 'queued'].includes(this.get(id).status), 'RUN_NOT_ACTIVE', 'Run stopped during final evaluation');
    const stored = this.checkpoints.dataset(id), { archive, ...finalEvaluation } = result;
    await this.checkpoints.setDataset(id, { id, dataset: archive, development: stored.development ?? stored.dataset, digest: digest(archive) });
    this.update(id, { holdout: result.holdout, finalEvaluation }); await this.checkpoints.flush(); return finalEvaluation;
  }
  async report(host, id, signal) {
    const run = this.get(id);
    if (host.context.kind === 'main') { this.main(host, run); check(run.report, 'REPORT_UNAVAILABLE', 'This execution has no published report; inspect its retained checkpoint or resume unfinished work'); return run.report; }
    this.executor(host, run, this.executions.get(id));
    check(FINAL.has(run.status) && run.tasks.every(value => value.finishedAt),
      'RUN_NOT_FINISHED', 'Only completed or cancelled work with all research tasks settled can publish its final summary');
    if (!this.reporting.has(id)) {
      const pending = Promise.resolve().then(async () => {
        if (!this.get(id).reportSnapshot && !this.get(id).report) this.update(id, { reportSnapshot: finalSnapshot(this.get(id)), reportPending: true });
        const report = await archiveReport(host, this.get(id), this.get(id).report ? null : this.dataset(id), { signal,
          onPublication: async reportPublication => { this.update(id, { reportPublication, reportPending: true }); await this.checkpoints.flush(); } });
        this.executions.get(id).emit('artifact', { ref: report.ref, label: this.get(id).title });
        this.update(id, { report, reportPending: false, reportError: null }); return report;
      }).catch(error => { this.update(id, { reportPending: true, reportError: errorInfo(error) }); throw error; })
        .finally(() => this.reporting.delete(id));
      this.reporting.set(id, pending);
    }
    const report = await this.reporting.get(id);
    await this.checkpoints.flush();
    return report;
  }
  async dispose() {
    this.closed = true;
    for (const [id, entry] of this.running) {
      if (['queued', 'running'].includes(this.get(id).status)) this.update(id, { status: 'interrupted', reportPending: false });
      entry.controller.abort(Object.assign(new Error('Plugin stopped; retain accepted Run identities for recovery'), { code: 'RUN_INTERRUPTED' }));
    }
    await Promise.allSettled([...this.running.values()].map(entry => entry.promise));
    await Promise.allSettled(this.reporting.values());
    await this.checkpoints.flush();
  }
}
