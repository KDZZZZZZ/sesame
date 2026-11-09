import { COLLECTIONS, canonical, digest, ensure, error, identifier, text } from './contracts.js';

export async function commitState(state, changes, options = {}) {
  ensure(Array.isArray(changes) && changes.length > 0 && changes.length <= 64, 'State transaction must contain 1–64 changes', 'RESOURCE_EXHAUSTED');
  for (const change of changes) ensure(Buffer.byteLength(canonical(change.value)) <= 240 * 1024, 'State record exceeds its byte budget', 'RESOURCE_EXHAUSTED');
  ensure(Buffer.byteLength(canonical(changes)) <= 512 * 1024, 'State transaction exceeds its byte budget', 'RESOURCE_EXHAUSTED');
  options.signal?.throwIfAborted();
  return state.commit(changes, options);
}

export async function readState(state, collection, key) {
  try { return await state.read({ collection, key }); }
  catch (e) { if (e.code === 'NOT_FOUND') return null; throw e; }
}
export async function updateState(state, collection, key, transform, signal) {
  for (let retry = 0; retry < 12; retry++) {
    signal?.throwIfAborted(); const current = await readState(state, collection, key);
    const value = await transform(current?.value ?? null, current?.version ?? 0);
    if (value === undefined) return current?.value ?? null;
    try { await commitState(state, [{ op: 'put', key: { collection, key }, value, expectedVersion: current?.version ?? 0 }], { signal }); return value; }
    catch (e) { if (e.code !== 'VERSION_CONFLICT' || retry === 11) throw e; }
  }
}
export function publicJob(job) {
  return Object.fromEntries(['id', 'runId', 'status', 'epoch', 'completed', 'proposed', 'report', 'error'].map(k => [k, job[k] ?? null]));
}
export function createJournal({ state, artifacts, ownerSessionId }) {
  const get = async id => { const row = await readState(state, COLLECTIONS.jobs, id); ensure(row, 'Research job not found', 'NOT_FOUND'); return row.value; };
  const update = (id, fn, signal) => updateState(state, COLLECTIONS.jobs, id, (value, version) => { ensure(value, 'Research job not found', 'NOT_FOUND'); return fn(value, version); }, signal);
  const entryKey = (jobId, kind, id) => identifier(kind, [jobId, id]);
  const readEntry = async (jobId, kind, id) => (await readState(state, COLLECTIONS.trials, entryKey(jobId, kind, id)))?.value ?? null;
  const entry = (jobId, kind, id, transform, signal) => updateState(state, COLLECTIONS.trials, entryKey(jobId, kind, id), async (value, version) => {
    const next = await transform(value, version); return next === undefined ? undefined : { ...next, jobId, kind, key: id };
  }, signal);
  const page = async (jobId, kind, cursor, limit = 100) => {
    ensure(Number.isSafeInteger(limit) && limit > 0 && limit <= 200, 'Invalid journal page limit');
    const result = await state.query({ collection: COLLECTIONS.trials, filter: { jobId, kind }, ...(cursor ? { cursor } : {}), limit });
    ensure(!result.nextCursor || result.nextCursor !== cursor, 'Journal cursor did not advance', 'EVIDENCE_MISMATCH');
    return { items: result.items.map(row => row.value), cursor: result.nextCursor ?? null };
  };
  const all = async (jobId, kind) => { const items = []; let cursor; do { const result = await page(jobId, kind, cursor); items.push(...result.items); cursor = result.cursor; } while (cursor); return items; };
  return {
    get, update, entry, readEntry, page, all,
    async create(type, input) {
      text(type, 128); text(input.requestId, 128);
      const id = identifier('factor-job', [ownerSessionId, input.requestId]), inputDigest = digest(input);
      const prior = await readState(state, COLLECTIONS.jobs, id);
      if (prior) { ensure(prior.value.inputDigest === inputDigest && prior.value.type === type, 'requestId was reused with different input', 'IDEMPOTENCY_CONFLICT'); return prior.value; }
      const ctx = { jobId: id, epoch: 1, attemptId: 'admit' };
      const inputRef = await artifacts.publishJSON(input, { schema: 'factor-evidence/1', dependencies: [], operationId: `${id}:input` }, ctx);
      const job = { id, type, inputDigest, inputRef, ownerSessionId, runId: null, status: 'queued', epoch: 1, completed: 0, proposed: 0, report: null, error: null, createdAt: Date.now(), activeMs: 0, budget: input.budget, snapshot: null, searchCheckpoint: null, searchExhausted: false, selection: null, phase: 'prepare' };
      try { await commitState(state, [{ op: 'put', key: { collection: COLLECTIONS.jobs, key: id }, value: job, expectedVersion: 0 }], { operationId: `${id}:admit:${inputDigest}` }); }
      catch (e) { if (!['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(e.code)) throw e; const existing = await get(id); ensure(existing.inputDigest === inputDigest && existing.type === type, 'requestId conflict', 'IDEMPOTENCY_CONFLICT'); return existing; }
      return job;
    },
    async assertActive(ctx, allowPausing = true) {
      ctx.signal?.throwIfAborted(); const job = await get(ctx.jobId);
      ensure(job.epoch === ctx.epoch && (job.status === 'running' || allowPausing && job.status === 'pausing'), 'Research attempt is no longer active', 'CANCELLED');
      if (job.activeMs + (job.startedAt ? Date.now() - job.startedAt : 0) >= job.budget.maxSeconds * 1000) throw error('BUDGET_EXHAUSTED', 'Research time budget exhausted');
      return job;
    },
  };
}
