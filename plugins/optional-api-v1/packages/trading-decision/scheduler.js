import { records } from './records.js';
import { canonical, digest } from '@sesame/plugin-sdk/protocol';
import { check } from './shared.js';
import { executionCall } from './composition.js';
import { accountKey, cleanError, clone, TERMINAL, triggerIdentity } from './plans.js';
import { collaboration } from './team.js';
import { reportPath } from './reports.js';

const schedulingKey = accountKey;

// Admission and subscriptions use the facade's original state, host and Run scope.
// The runtime owns recovery, cancellation and final disposal of these resources.
export function trigger(runtime, planId, trigger, host) {
  check(!runtime.closed, 'RUNTIME_CLOSED', 'Trading runtime is stopped');
  const plan = runtime.plan(planId), id = triggerIdentity(plan, trigger), previous = records(runtime.host).get('runs', id, true);
  if (previous) { check(canonical(previous.trigger) === canonical(trigger), 'IDEMPOTENCY_CONFLICT', 'Event ID already has different input'); return previous; }
  check(plan.enabled, 'PLAN_PAUSED', 'Trading plan is paused');
  check(plan.execution, 'EXECUTION_REQUIRED', 'Select an execution capability before starting this workflow');
  check(Buffer.byteLength(JSON.stringify(trigger)) <= 12000, 'INVALID_ARGUMENT', 'Event payload exceeds 12 KB');
  for (const queued of records(runtime.host).list('runs').filter(run => run.planId === plan.id && run.status === 'queued')) {
    runtime.update(queued.id, { status: 'cancelled', completedAt: runtime.now(), supersededBy: id });
    runtime.activity(queued.id, 'run.finished', { status: 'cancelled', message: '尚未开始的运行已被新事件替换。' });
  }
  const run = runtime.save({ id, planId: plan.id, plan, trigger: clone(trigger), status: 'queued', createdAt: runtime.now(), tasks: [], reports: [], reportPending: true, mockModelResponses: runtime.mockModelResponses });
  if (host) runtime.workHosts.set(id, host);
  records(runtime.host).put('plans', { ...plan, lastRunId: id }); runtime.pump(); return run;
}
export function event(runtime, key, eventId, data = {}, at, ownerConversationId, host) {
  if (at !== undefined) check(Number.isSafeInteger(at) && at <= runtime.now() && runtime.now() - at <= 86400000, 'STALE_EVENT', 'Event must be observed within the last day');
  check(typeof key === 'string' && typeof eventId === 'string' && eventId.length > 0, 'INVALID_ARGUMENT', 'Event key and stable ID are required');
  return runtime.plans().filter(plan => plan.enabled && (!ownerConversationId || plan.ownerConversationId === ownerConversationId) && plan.eventKeys.includes(key)).map(plan => runtime.trigger(plan.id, { kind: 'event', id: `${key}:${eventId}`, key, ...(at === undefined ? {} : { observedAt: at }), data }, host));
}
export async function tick(runtime) {
  if (runtime.closed || runtime.ticking) return;
  runtime.ticking = true;
  try {
    for (const plan of runtime.plans().filter(value => value.enabled && value.intervalMinutes && value.nextDueAt <= runtime.now())) {
      records(runtime.host).put('plans', { ...plan, nextDueAt: runtime.now() + plan.intervalMinutes * 60000 });
      runtime.trigger(plan.id, { kind: 'interval', id: String(plan.nextDueAt), observedAt: runtime.now() });
    }
    for (const plan of runtime.plans().filter(value => value.enabled && value.accountEvents && value.eventRetryAt && value.eventRetryAt <= runtime.now())) await runtime.subscribe(plan);
    runtime.pump();
  } finally { runtime.ticking = false; }
}
export function pump(runtime, interruption) {
  if (runtime.closed) return;
  for (const run of records(runtime.host).list('runs').filter(value => value.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)) {
    const key = schedulingKey(run.plan), plan = runtime.plan(run.planId);
    if (!plan.enabled || runtime.running.has(key) || records(runtime.host).list('runs').some(other => other.id !== run.id && schedulingKey(other.plan) === key && other.status !== 'queued' && !TERMINAL.has(other.status))) continue;
    const last = plan.lastEventAt ?? 0;
    if (run.trigger.kind === 'event' && runtime.now() - last < plan.eventCooldownMs) continue;
    if (run.trigger.kind === 'event') records(runtime.host).put('plans', { ...plan, lastEventAt: runtime.now() });
    const controller = new AbortController(), entry = { runId: run.id, controller };
    let admitted;
    entry.admission = new Promise(resolve => { admitted = resolve; });
    runtime.running.set(key, entry);
    const host = runtime.workHosts.get(run.id) ?? runtime.host;
    entry.promise = runtime.executionScope.runInAsyncScope(async () => {
      const accepted = await host.capabilities.invoke('sesame/trading-decision#trading_decision_workflow_execute', { runId: run.id }, { signal: controller.signal, operationId: 'workflow:' + run.id,
        task: { ...(host.context.kind === 'service' ? { sessionId: run.plan.ownerConversationId } : {}), title: run.plan.title, ...(collaboration(run.plan) ? { collaboration: collaboration(run.plan) } : {}),
          output: { type: 'report', space: 'research', path: reportPath(run) } } });
      check(accepted.type === 'run', 'TASK_RECEIPT_INVALID', 'Workflow requires a real Run'); runtime.update(run.id, { workflow: accepted.run });
      admitted();
      let settled; do { settled = await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000 }); } while (settled.reason === 'timeout');
      if (settled.reason === 'interrupted' || settled.run.status === 'interrupted') runtime.update(run.id, { status: 'interrupted', error: runtime.run(run.id).error ?? cleanError(settled.run.error ?? { code: 'RUN_INTERRUPTED', message: settled.run.interrupts?.find(item => !item.resolvedAt)?.reason ?? 'Workflow dependency or input is unavailable' }) });
      else if (!TERMINAL.has(runtime.run(run.id).status) && settled.run.status === 'cancelled') runtime.update(run.id, { status: 'cancelled', completedAt: runtime.now(), error: cleanError(settled.run.error ?? new Error('Host workflow cancelled')) });
      else if (!TERMINAL.has(runtime.run(run.id).status) && settled.run.status === 'unknown') runtime.update(run.id, { status: 'interrupted', error: cleanError(settled.run.error ?? new Error('Host workflow outcome is unknown; inspect its retained Run.')) });
      return settled.run;
    }).catch(error => {
      admitted();
      if (interruption(error, controller.signal)) { runtime.update(run.id, { status: 'interrupted', error: runtime.run(run.id).error ?? cleanError(interruption(error, controller.signal)) }); return; }
      if (!TERMINAL.has(runtime.run(run.id).status)) runtime.update(run.id, { status: controller.signal.aborted ? 'cancelled' : 'interrupted', error: cleanError(error), ...(controller.signal.aborted ? { completedAt: runtime.now() } : {}) });
      runtime.notify('run.interrupted', { runId: run.id, ...cleanError(error) });
    }).finally(() => { runtime.running.delete(key); runtime.workHosts.delete(run.id); runtime.pump(); });
  }
}

export async function subscribe(runtime, plan) {
  await runtime.unsubscribe(plan.id);
  try {
    check(plan.execution?.accountProvider, 'UNSUPPORTED_CAPABILITY', 'Selected execution capability does not declare account events');
    const selected = plan.execution.accountProvider, providerId = `${selected.pluginId}#${selected.providerId}`;
    const source = (await runtime.host.data.sources({ providerId })).items.find(item => item.available !== false);
    check(source && source.operations.watch, 'UNSUPPORTED_CAPABILITY', 'Selected account source has no declared watch operation');
    const identity = await executionCall(runtime.host, plan.execution, 'context', { action: 'identity' });
    check(canonical(identity.account) === canonical(plan.account), 'ACCOUNT_CHANGED', 'Event source account differs from the frozen plan');
    const controller = new AbortController();
    const stream = await runtime.host.data.watch({ source: source.ref, operation: 'watch', input: { account: plan.account, topics: ['positions', 'orders'] } }, { signal: controller.signal });
    const subscription = { controller, stream }; runtime.subscriptions.set(plan.id, subscription);
    check(!runtime.closed && runtime.plan(plan.id).enabled && runtime.plan(plan.id).revision === plan.revision, 'PLAN_CHANGED', 'Plan stopped or changed while subscribing');
    const previous = new Map();
    subscription.promise = (async () => {
      for await (const event of stream.events) {
        if (runtime.closed || !runtime.plan(plan.id).enabled) break;
        if (event.type === 'stream.gap') throw Object.assign(new Error(event.reason ?? 'Account stream gap'), { code: 'STREAM_GAP' });
        if (!['positions.upsert', 'orders.upsert'].includes(event.type)) continue;
        const key = digest(event.payload);
        if (previous.get(event.type) === key) continue; previous.set(event.type, key);
        runtime.trigger(plan.id, { kind: 'event', id: `account:${digest([providerId, event.eventId ?? null, event.epoch ?? null, event.seq ?? null, key]).slice(7)}`, observedAt: event.observedAt, data: { type: event.type, message: 'Account state changed; read a fresh snapshot' } });
      }
    })().catch(error => { if (!controller.signal.aborted && !runtime.closed) { records(runtime.host).put('plans', { ...runtime.plan(plan.id), eventStatus: 'unavailable', eventError: cleanError(error), eventRetryAt: runtime.now() + 60000 }); runtime.notify('event.failed', cleanError(error)); } });
    records(runtime.host).put('plans', { ...runtime.plan(plan.id), eventStatus: 'subscribed', eventError: null, eventRetryAt: null });
  } catch (error) {
    await runtime.unsubscribe(plan.id);
    records(runtime.host).put('plans', { ...runtime.plan(plan.id), eventStatus: 'unavailable', eventError: cleanError(error), eventRetryAt: error.code === 'UNSUPPORTED_CAPABILITY' ? null : runtime.now() + 60000 });
  }
}
export async function unsubscribe(runtime, id) { const sub = runtime.subscriptions.get(id); runtime.subscriptions.delete(id); if (sub) { sub.controller.abort(); try { await sub.stream.close(); } finally { await sub.promise; } } }
