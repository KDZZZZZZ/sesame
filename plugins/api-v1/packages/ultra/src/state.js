import { createHash, randomUUID } from 'node:crypto';

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

export async function locked(host, owner, action) {
  const key = `${host.context.storageRoot}:${owner}`, previous = locks.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(action); locks.set(key, pending);
  try { return await pending; } finally { if (locks.get(key) === pending) locks.delete(key); }
}

export async function read(host, collection, key) {
  try { return await host.state.read({ collection, key }); } catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; }
}
export async function put(host, collection, key, value, version = 0) {
  check(Buffer.byteLength(JSON.stringify(value)) <= 240 * 1024, 'STATE_TOO_LARGE', 'Keep each Ultra branch input and result bounded; use published resource references for large data.');
  await host.state.commit([{ op: 'put', key: { collection, key }, expectedVersion: version, value }]);
  return { value, version: version + 1 };
}
export async function patch(host, collection, key, updater) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const record = await read(host, collection, key); check(record, 'NOT_FOUND', 'Ultra state was not found.');
    const value = updater(structuredClone(record.value));
    if (JSON.stringify(value) === JSON.stringify(record.value)) return value;
    try { return (await put(host, collection, key, value, record.version)).value; }
    catch (error) { if (!['VERSION_CONFLICT', 'CONFLICT'].includes(error.code) || attempt === 3) throw error; }
  }
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
  return record.value;
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
    next: FINAL.has(state.status) ? 'ended' : continuation === 'draining' ? 'collect-existing-results' : state.status === 'waiting-input' ? 'resolve-and-resume' : 'read-status-and-continue',
  };
}
