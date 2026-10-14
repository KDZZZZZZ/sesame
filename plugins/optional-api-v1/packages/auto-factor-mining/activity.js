import { canonical } from './shared.js';

export const ACTIVITY_LIMIT = 2000;
export const TASK_TERMINAL = new Set(['completed', 'failed', 'cancelled', 'canceled', 'expired', 'interrupted', 'superseded']);
const names = { supervisor: '研究主管', researcher: '假设研究员', coder: '因子实现员', reviewer: '证据评审员', reflector: '复盘研究员', reporter: '总结归档' };
const stages = { plan: 0, hypothesis: 1, code: 2, review: 3, reflection: 4 };
const changed = (a, b) => canonical(a ?? null) !== canonical(b ?? null);

export function displayRole(run, task) {
  return ['researcher', 'coder', 'reviewer'].includes(task.role) && task.direction
    ? `${task.role}:${run.config.directions.indexOf(task.direction)}` : task.role;
}
export function taskStage(run, task) {
  if (task.mode === 'selection') return run.config.rounds * 5;
  if (task.mode === 'finalize') return run.config.rounds * 5 + 1;
  if (task.mode === 'report') return run.config.rounds * 5 + 2;
  return (task.round ?? 0) * 5 + (stages[task.mode] ?? 0);
}

/** Events are persisted observations. Timers only sample public host state. */
export function appendActivity(previous, run, additions, now, limit = ACTIVITY_LIMIT) {
  const events = [...(run.events ?? [])], reads = new Set(run.activityReadKeys ?? []);
  let sequence = Math.max(run.activitySequence ?? 0, ...events.map(event => event.seq ?? 0));
  for (let i = 0; i < events.length; i++) if (!events[i].seq) events[i] = { ...events[i], seq: ++sequence, id: `${run.id}:activity:${sequence}` };
  const derived = [];
  for (const task of run.tasks ?? []) {
    const prior = previous?.tasks?.find(value => value.id === task.id);
    const common = { taskId: task.id, role: task.role, ...(task.direction ? { direction: task.direction } : {}), generation: task.generation };
    if (task.status !== prior?.status) derived.push({ ...common, type: `task.${task.status}`, message: `${names[task.role] ?? task.role}：${task.status}` });
    const oldCalls = new Map((prior?.toolCalls ?? []).map(call => [call.id, call]));
    for (const call of task.toolCalls ?? []) {
      const old = oldCalls.get(call.id), fields = { ...common, toolCallId: call.id, toolName: call.name };
      if (!old && call.startedAt != null) derived.push({ ...fields, type: 'tool.started', at: call.startedAt, message: `调用 ${call.name}` });
      if (call.status !== 'started' && call.status !== old?.status) derived.push({ ...fields, type: 'tool.finished', at: call.completedAt ?? now, message: `${call.name}：${call.status}` });
    }
    if (task.output && !prior?.output) derived.push({ ...common, type: 'report.ready', message: `${names[task.role] ?? task.role} 已共享结论` });
  }
  if (run.report && changed(previous?.report, run.report)) derived.push({ type: 'report.archived', message: '本次任务总结已归档' });
  const added = [];
  for (const item of [...derived, ...additions]) {
    if (item.type === 'report.read') {
      const key = canonical([item.fromTaskId, item.toTaskId]);
      if (reads.has(key)) continue;
      reads.add(key);
    }
    const event = { ...item, at: item.at ?? now, seq: ++sequence, id: `${run.id}:activity:${sequence}` };
    events.push(event); added.push(event);
  }
  const dropped = Math.max(0, events.length - limit);
  return { run: { ...run, events: events.slice(dropped), activitySequence: sequence, activityReadKeys: [...reads],
    activityDropped: (run.activityDropped ?? 0) + dropped }, added };
}

export function publicOutput(message, maxText = 16000) {
  if (!message || message.role !== 'assistant') return null;
  let remaining = maxText, truncated = false;
  const take = value => { const text = String(value ?? ''), part = text.slice(0, Math.max(remaining, 0)); remaining -= part.length; truncated ||= part.length < text.length; return part; };
  const segments = [];
  for (const segment of (message.segments ?? []).slice(0, 256)) {
    if (segment.type === 'text' || segment.type === 'status') segments.push({ id: String(segment.id), type: segment.type, text: take(segment.text) });
    else if (segment.type === 'tool') segments.push({ id: String(segment.id), type: 'tool', tool_name: String(segment.tool_name ?? '').slice(0, 200), status: String(segment.status ?? '').slice(0, 40) });
  }
  const text = segments.some(segment => segment.type === 'text') ? segments.filter(segment => segment.type === 'text').map(segment => segment.text).join('')
    : take((message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'));
  return { messageId: message.id, text, segments, status: message.status, truncated: truncated || (message.segments?.length ?? 0) > 256 };
}

export function activitySnapshot(run, { feedUrl } = {}) {
  const role = task => displayRole(run, task);
  const roles = [{ id: 'supervisor', name: names.supervisor }, ...run.config.directions.flatMap((direction, index) => ['researcher', 'coder', 'reviewer'].map(id => ({ id: `${id}:${index}`, name: `${names[id]} · ${direction}` }))),
    { id: 'reflector', name: names.reflector }, { id: 'reporter', name: names.reporter }];
  const workflow = [];
  for (let round = 0; round < run.config.rounds; round++) {
    const values = [['supervisor'], ...['researcher', 'coder', 'reviewer'].map(id => run.config.directions.map((_, index) => `${id}:${index}`)), ['reflector']];
    for (let phase = 0; phase < values.length; phase++) workflow.push({ index: round * 5 + phase, name: `第 ${round + 1} 轮 · ${['规划', '假设', '实现', '评审', '复盘'][phase]}`, roles: values[phase] });
  }
  workflow.push({ index: run.config.rounds * 5, name: '冻结候选', roles: ['supervisor'] }, { index: run.config.rounds * 5 + 1, name: '最终评估', roles: ['supervisor'] }, { index: run.config.rounds * 5 + 2, name: '总结', roles: ['reporter'] });
  return {
    schemaVersion: 1, mode: 'live', ...(feedUrl ? { feedUrl } : {}), generatedAt: run.updatedAt,
    recorded: true, truncated: Boolean(run.activityDropped), droppedEvents: run.activityDropped ?? 0,
    firstSeq: run.events[0]?.seq ?? null, lastSeq: run.activitySequence ?? 0,
    run: { id: run.id, title: run.title, mode: 'team', status: run.status, phase: run.phase, createdAt: run.createdAt,
      completedAt: run.completedAt ?? null, report: run.report ?? null, reportPending: run.reportPending, error: run.error ?? null },
    workflow: { mode: 'team', roles, stages: workflow },
    tasks: run.tasks.map(task => ({ id: task.id, role: role(task), stageIndex: taskStage(run, task), round: task.round ?? 0,
      provider: task.model?.provider ?? null, model: task.model?.id ?? null, status: task.status, createdAt: task.createdAt ?? null,
      startedAt: task.startedAt ?? null, completedAt: task.finishedAt ?? null, publicOutput: task.publicOutput ?? null })),
    reports: run.tasks.filter(task => task.text || task.output).map(task => ({ taskId: task.id, role: role(task), round: task.round ?? 0,
      text: task.text || JSON.stringify(task.output, null, 2), createdAt: task.finishedAt ?? task.submittedAt,
      provider: task.model?.provider ?? null, model: task.model?.id ?? null, status: task.status })),
    events: run.events.map(event => { const task = run.tasks.find(value => value.id === event.taskId); return { ...event, ...(task ? { role: role(task) } : {}) }; }),
  };
}
