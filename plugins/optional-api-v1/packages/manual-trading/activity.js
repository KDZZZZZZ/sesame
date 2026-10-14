import { canonical } from '@sesame/plugin-sdk/protocol';
import { stages } from './team.js';

export const ACTIVITY_LIMIT = 2000;
export const TASK_TERMINAL = new Set(['completed', 'failed', 'canceled', 'cancelled', 'expired', 'interrupted', 'superseded']);
const copy = value => value === undefined ? undefined : structuredClone(value);
const changed = (left, right) => canonical(left ?? null) !== canonical(right ?? null);
const taskEvent = status => status === 'queued' || status === 'running' || status === 'completed' ? `task.${status}`
  : ['canceled', 'cancelled', 'superseded'].includes(status) ? 'task.cancelled' : TASK_TERMINAL.has(status) ? 'task.failed' : null;
const finite = value => Number.isSafeInteger(value) && value >= 0;

export function taskStageIndex(plan, role, round) {
  const count = stages(plan).length;
  return role === 'executor' ? count : role === 'reporter' ? count + 1 : round;
}

/** Derive events only from persisted changes or explicit native call timestamps. */
export function activityChanges(previous, run, at) {
  const events = [], before = previous ?? {};
  if (!previous && run.status === 'queued') events.push({ type: 'run.queued', at: run.createdAt, message: '本轮已进入真实任务队列。' });
  if (run.startedAt !== undefined && before.startedAt === undefined) events.push({ type: 'run.started', at: run.startedAt, message: '开始执行本轮计划。' });
  const oldTasks = new Map((before.tasks ?? []).map(task => [task.id, task]));
  for (const task of run.tasks ?? []) {
    const old = oldTasks.get(task.id), common = { taskId: task.id, role: task.role, round: task.round, stageIndex: task.stageIndex ?? taskStageIndex(run.plan, task.role, task.round) };
    if (task.status !== old?.status) {
      const type = taskEvent(task.status);
      if (type) events.push({ ...common, type, at: task.status === 'queued' ? task.createdAt : task.status === 'running' ? task.startedAt : task.completedAt,
        status: task.status, message: `${task.role} 任务状态：${task.status}。` });
    }
    const oldCalls = new Map((old?.toolCalls ?? []).map(call => [call.id, call]));
    for (const call of task.toolCalls ?? []) {
      const prior = oldCalls.get(call.id), fields = { ...common, toolCallId: call.id, toolName: call.name };
      if (!prior && finite(call.startedAt)) events.push({ ...fields, type: 'tool.started', at: call.startedAt, status: 'started', message: `${task.role} 调用 ${call.name}。` });
      if (call.status !== 'started' && call.status !== prior?.status) events.push({ ...fields, type: 'tool.finished', at: call.completedAt ?? at, status: call.status, message: `${call.name} 返回：${call.status}。` });
    }
  }
  const oldReports = new Set((before.reports ?? []).map(report => report.taskId));
  for (const report of run.reports ?? []) if (!oldReports.has(report.taskId) && report.status === 'completed') {
    events.push({ type: 'report.ready', taskId: report.taskId, role: report.role, round: report.round, at: report.createdAt, message: `${report.role} 的公开报告已保存。` });
  }
  if (run.decision && !before.decision) events.push({ type: 'decision.saved', at: run.decidedAt, message: run.decision.unchanged ? '已保存目标仓位不变。' : '已保存本轮目标仓位。' });
  const progress = run.execution ?? run.executionProgress, oldProgress = before.execution ?? before.executionProgress;
  if (progress && changed(oldProgress, progress)) events.push({ type: 'execution.progress', status: progress.status, at, message: `执行核对：${progress.status}。`,
    detail: `已记录 ${progress.orders?.length ?? 0} 条订单回执、${progress.pauses?.length ?? 0} 条挂载操作回执。` });
  if (run.report && changed(before.report, run.report)) events.push({ type: 'report.archived', at, message: '本轮日报已归档。' });
  return events;
}

/** Sequence numbers never restart when old events are dropped. Reads are deduped independently of retention. */
export function appendActivity(run, items, { at, limit = ACTIVITY_LIMIT } = {}) {
  const old = run.activity ?? {}, events = [...(old.events ?? [])], added = [], readKeys = new Set(old.readKeys ?? []);
  let seq = old.seq ?? 0, finished = old.finished ?? false;
  for (const item of items) {
    if (item.type === 'report.read') {
      const key = canonical([item.fromTaskId, item.toTaskId]);
      if (readKeys.has(key)) continue;
      readKeys.add(key);
    }
    if (item.type === 'run.finished') { if (finished) continue; finished = true; }
    const event = { ...copy(item), at: finite(item.at) ? item.at : at, id: `${run.id}:activity:${++seq}`, seq };
    events.push(event); added.push(event);
  }
  const droppedNow = Math.max(0, events.length - limit), retained = events.slice(droppedNow);
  return { run: { ...run, activity: { seq, events: retained, truncated: Boolean(old.truncated || droppedNow), dropped: (old.dropped ?? 0) + droppedNow,
    readKeys: [...readKeys], finished, updatedAt: at } }, events: added };
}

/** Display only the host's public projection; never copy SDK thinking, arguments or results. */
export function publicOutput(message, maxText = 16000) {
  if (!message || message.role !== 'assistant') return null;
  let remaining = maxText, truncated = false;
  const take = value => { const text = String(value ?? ''), part = text.slice(0, Math.max(remaining, 0)); remaining -= part.length; if (part.length < text.length) truncated = true; return part; };
  const segments = [];
  for (const segment of (message.segments ?? []).slice(0, 256)) {
    if (segment.type === 'text' || segment.type === 'status') segments.push({ id: String(segment.id), type: segment.type, text: take(segment.text) });
    else if (segment.type === 'tool') segments.push({ id: String(segment.id), type: 'tool', tool_name: String(segment.tool_name ?? '').slice(0, 200), status: String(segment.status ?? '').slice(0, 40) });
  }
  truncated ||= (message.segments?.length ?? 0) > 256;
  const text = segments.some(segment => segment.type === 'text') ? segments.filter(segment => segment.type === 'text').map(segment => segment.text).join('')
    : take((message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'));
  return { messageId: message.id, text, segments, finalSegmentId: message.final_segment_id ?? null, status: message.status, truncated };
}

/** A pure, serializable projection shared by the live viewer and immutable archive. */
export function activitySnapshot(run, { mode = 'live', feedUrl } = {}) {
  if (!['live', 'archive'].includes(mode)) throw new Error('Activity mode must be live or archive');
  const plan = run.plan, activity = run.activity, mockModelResponses = run.mockModelResponses === true;
  return copy({ schemaVersion: 1, mode, ...(feedUrl === undefined ? {} : { feedUrl }),
    generatedAt: activity?.updatedAt ?? run.completedAt ?? run.startedAt ?? run.createdAt ?? null,
    mockModelResponses, recorded: Boolean(activity), truncated: activity?.truncated ?? false, droppedEvents: activity?.dropped ?? 0,
    firstSeq: activity?.events?.[0]?.seq ?? null, lastSeq: activity?.seq ?? 0,
    run: { id: run.id, planId: run.planId, title: plan.title, mode: plan.mode, executionPluginId: plan.execution?.pluginId ?? null, status: run.status,
      trigger: run.trigger ? { kind: run.trigger.kind, ...(run.trigger.key === undefined ? {} : { key: run.trigger.key }) } : null,
      createdAt: run.createdAt, startedAt: run.startedAt ?? null, completedAt: run.completedAt ?? null, mockModelResponses,
      decision: run.decision ?? null, execution: run.execution ?? null, executionProgress: run.executionProgress ?? null,
      report: run.report ?? null, reportPending: run.reportPending, error: run.error ?? null },
    workflow: { mode: plan.mode, stages: [...stages(plan), ['executor'], ['reporter']].map((roles, index) => ({ index, roles: [...roles] })) },
    tasks: (run.tasks ?? []).map(task => ({ id: task.id, role: task.role, round: task.round, stageIndex: task.stageIndex ?? taskStageIndex(plan, task.role, task.round),
      provider: task.model?.provider ?? null, model: task.model?.id ?? null, status: task.status, conversationId: task.conversationId ?? null,
      createdAt: task.createdAt ?? null, startedAt: task.startedAt ?? null, completedAt: task.completedAt ?? null, stage: task.stage ?? null,
      publicOutput: task.publicOutput ?? null, observationError: task.observationError ?? null })),
    reports: (run.reports ?? []).map(report => ({ taskId: report.taskId, role: report.role, round: report.round, status: report.status,
      provider: report.model?.provider ?? null, model: report.model?.id ?? null, createdAt: report.createdAt, text: report.text })),
    events: activity?.events ?? [] });
}
