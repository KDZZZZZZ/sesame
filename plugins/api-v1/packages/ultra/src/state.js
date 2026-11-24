import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const ID = 'sesame/ultra';
export const FINAL = new Set(['completed', 'stopped', 'closed']);
export const SETTLED = new Set(['completed', 'failed', 'cancelled', 'canceled', 'unknown', 'interrupted']);
export const ACTIVE = new Set(['queued', 'running', 'interrupting', 'cancelling']);
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const uniqueId = () => `ultra_${randomUUID()}`;
export function check(value, code, message) { if (!value) throw Object.assign(new Error(message), { code }); }
export function main(host) { check(host.context.kind === 'main' && host.context.sessionId, 'FORBIDDEN', 'Use Ultra controls from the owning main conversation.'); return host.context.sessionId; }
export const errorInfo = error => ({ code: String(error?.code ?? 'FAILED').slice(0, 100), message: String(error?.message ?? error).slice(0, 2000) });
const locks = new Map();

export async function locked(host, owner, action, lane = 'operation') {
  const key = JSON.stringify([host.context.storageRoot, owner, lane]), previous = locks.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(action); locks.set(key, pending);
  try { return await pending; } finally { if (locks.get(key) === pending) locks.delete(key); }
}

export const stateWrite = (host, action) => locked(host, host.context.ownerSessionId ?? host.context.sessionId, action, 'state');
export async function retryConflicts(action) {
  for (let attempt = 1; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (!['VERSION_CONFLICT', 'CONFLICT'].includes(error.code) || attempt === 6) throw error;
      await delay(50 * attempt);
    }
  }
}
const textLimit = 4000;
const truncationNote = '\n[已截断，请只保留结论与固定引用 ID。]';
export function conciseText(value = '') {
  if (value.length <= textLimit) return value;
  return value.slice(0, textLimit - truncationNote.length).replace(/[\uD800-\uDBFF]$/u, '') + truncationNote;
}

export async function read(host, collection, key) {
  try { return await host.state.read({ collection, key }); } catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; }
}
export function stateChange(collection, key, value, version = 0) {
  if (collection === 'sessions') value = { ...value, context: conciseText(value.context), summary: conciseText(value.summary) };
  check(Buffer.byteLength(JSON.stringify(value)) <= 240 * 1024, 'STATE_TOO_LARGE', 'Keep each Ultra branch input and result bounded; use published resource references for large data.');
  return { op: 'put', key: { collection, key }, expectedVersion: version, value };
}
export async function patch(host, collection, key, updater) {
  return stateWrite(host, () => retryConflicts(async () => {
    const record = await read(host, collection, key); check(record, 'NOT_FOUND', 'Ultra state was not found.');
    const change = stateChange(collection, key, updater(structuredClone(record.value)), record.version);
    if (JSON.stringify(change.value) !== JSON.stringify(record.value)) await host.state.commit([change]);
    return change.value;
  }));
}
export async function query(host, collection, filter) {
  const items = []; let cursor;
  do { const page = await host.state.query({ collection, filter, limit: 200, ...(cursor ? { cursor } : {}) }); items.push(...page.items.map(row => row.value)); cursor = page.nextCursor; } while (cursor);
  return items;
}
export async function session(host, id, owner = main(host)) {
  const pointer = await read(host, 'owners', owner);
  const record = await read(host, 'sessions', id ?? pointer?.value.id ?? 'missing');
  check(record && record.value.owner === owner, 'NOT_FOUND', 'No Ultra task belongs to this conversation.');
  // A close can arrive before goal admission, or while an older resume waits.
  // The owner's durable generation fences those delayed state writes without
  // aborting any already accepted research Run.
  if ((record.value.controlGeneration ?? 0) < (pointer?.value.closeGeneration ?? 0)
    && !FINAL.has(record.value.status) && record.value.status !== 'stopping' && record.value.continuation !== 'draining') {
    return patch(host, 'sessions', record.value.id, value => (value.controlGeneration ?? 0) < pointer.value.closeGeneration
      && !FINAL.has(value.status) && value.status !== 'stopping' ? {
        ...value, status: 'closing', continuation: 'draining', wake: null,
        closeAuthority: pointer.value.closeAuthority ?? 0, closeRequestedAt: pointer.value.closeRequestedAt, updatedAt: Date.now(),
      } : value);
  }
  return { ...record.value, context: conciseText(record.value.context), summary: conciseText(record.value.summary) };
}
export const branches = (host, id) => query(host, 'branches', { session: id });
export const branchKey = (id, key) => `${id}:${key}`;
export const saveSession = (host, id, change) => patch(host, 'sessions', id, value => ({ ...value, ...change, updatedAt: Date.now() }));
export const saveBranch = (host, branch, change) => patch(host, 'branches', branchKey(branch.session, branch.key), value => ({ ...value, ...change, updatedAt: Date.now() }));

export const continuationState = state => FINAL.has(state.status) || state.status === 'off' || state.status === 'stopping' ? 'closed' : state.continuation ?? 'active';

export function publicState(state, jobs = [], detailed = false) {
  const historical = job => ['completed', 'failed', 'cancelled', 'canceled'].includes(job.status);
  const settled = jobs.filter(historical);
  const recent = new Set(settled.slice(-20).map(job => job.key));
  const visible = detailed ? jobs : jobs.filter(job => !historical(job) || recent.has(job.key));
  const preview = value => { const text = JSON.stringify(value); return !detailed && text.length > 8000 ? { preview: text.slice(0, 6000), truncated: true, detail: 'Read ultra_status with this branch_key or read its original Run output.' } : value; };
  const continuation = continuationState(state);
  return { id: state.id, objective: state.objective, mode: state.mode, status: state.status, max_parallel: state.maxParallel,
    enabled: continuation === 'active', continuation,
    active_work: jobs.filter(job => ['starting', 'running'].includes(job.status)).length,
    accepted_work: jobs.filter(job => job.startedAt).length, queued_work: jobs.filter(job => job.status === 'queued').length,
    success_criteria: state.successCriteria, cycle: state.cycle ?? null, wake: state.wake ?? null, summary: state.summary ?? '',
    total_branches: jobs.length, omitted_branches: jobs.length - visible.length,
    branches: visible.map(job => ({ key: job.key, title: job.title, status: job.status, exclusive: job.exclusive,
      run_refs: job.refs ?? [], ...(job.error ? { error: job.error } : {}), ...(job.result !== undefined ? { result: preview(job.result) } : {}),
      ...(job.stopRefs?.length ? { stop_refs: job.stopRefs, stop_pending: !job.stopDone } : {}), ...(job.stopError ? { stop_error: job.stopError } : {}) })),
    ...(state.error ? { error: state.error } : {}), ...(state.result ? { result: state.result } : {}),
    next: FINAL.has(state.status) ? 'ended' : continuation === 'draining' ? 'collect-existing-results' : state.status === 'waiting-input' ? 'resolve-and-resume' : 'continue-from-current-results',
  };
}
