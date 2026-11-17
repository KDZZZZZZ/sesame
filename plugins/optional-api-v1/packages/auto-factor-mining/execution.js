import { canonical, ensure, error, failure, validateBudget } from './contracts.js';

const ACTIVE = new Set(['queued', 'running', 'interrupting', 'cancelling']);
const STOPPED = new Set(['interrupted', 'completed', 'cancelled', 'unknown']);
const refsIn = value => {
  const refs = new Map(), visit = item => { if (item && typeof item === 'object') {
    if (typeof item.id === 'string' && typeof item.revision === 'string' && typeof item.digest === 'string') refs.set(canonical(item), item);
    else Object.values(item).forEach(visit);
  } }; visit(value); return [...refs.values()];
};

/** One explicit operation. It never starts another capability or research step. */
export function createExecution({ journal, artifacts, runs }) {
  async function history(runId) {
    let cursor, observed, attempt = 1, start = null; const intervals = [];
    do {
      const result = await runs.read({ id: runId }, { include: ['events'], limit: 200, ...(cursor ? { cursor } : {}) });
      observed = result.run;
      for (const event of result.history?.items ?? []) {
        const at = Date.parse(event.at); ensure(Number.isFinite(at), 'Native Run history has an invalid time', 'EVIDENCE_MISMATCH');
        if (event.type === 'resumed') attempt = event.data.attempt;
        if (event.type === 'status' && event.data.status === 'running') start ??= at;
        if (event.type === 'status' && STOPPED.has(event.data.status) && start !== null) {
          intervals.push({ attempt, start, end: at }); start = null;
        }
      }
      const next = result.history?.nextCursor; ensure(!next || next !== cursor, 'Native history cursor did not advance', 'EVIDENCE_MISMATCH'); cursor = next;
    } while (cursor);
    if (start !== null) intervals.push({ attempt, start, end: null });
    return { run: observed, intervals };
  }
  async function timings(job, native) {
    const records = await journal.all(job.id, 'execution-run'), ids = new Set([...records.map(record => record.runId), job.runId, native.run.id].filter(Boolean));
    let activeMs = job.budgetBaseline?.activeMs ?? 0, startedAt = Date.now();
    for (const id of ids) {
      const observed = await history(id);
      for (const interval of observed.intervals) {
        if (id === native.run.id && interval.attempt === (native.attempt ?? native.run.attempt ?? 1) && interval.end === null) startedAt = interval.start;
        else {
          ensure(interval.end !== null, 'A previous native operation is still active', 'OPERATION_ACTIVE');
          activeMs += Math.max(0, interval.end - interval.start);
        }
      }
      if (!observed.intervals.length && id !== native.run.id && job.runId === id && job.startedAt) {
        const end = Date.parse(observed.run.completedAt ?? observed.run.updatedAt);
        ensure(STOPPED.has(observed.run.status) && Number.isFinite(end), 'Previous native execution timing is unavailable', 'RECONCILIATION_REQUIRED');
        activeMs += Math.max(0, end - job.startedAt);
      }
    }
    return { activeMs, startedAt };
  }
  return { async execute(kind, input, signal, native, work) {
    ensure(native?.run?.id && typeof native.checkpoint === 'function', 'A native single-operation Run is required', 'EXECUTION_CONTEXT_REQUIRED');
    validateBudget(input.budget); ensure(input.budget.maxWorkers === 1, 'One operation owns one worker');
    const boundSignal = AbortSignal.any([signal, native.signal].filter(Boolean)); boundSignal.throwIfAborted();
    let job = await journal.create(kind, input, boundSignal);
    if (job.status === 'completed') return artifacts.readJSON(job.outputRef, { signal: boundSignal });
    const hostAttempt = native.attempt ?? native.run.attempt ?? 1;
    if (job.runId) {
      const previous = (await runs.read({ id: job.runId })).run;
      const resumedSame = previous.id === native.run.id && hostAttempt > job.hostAttempt;
      ensure(resumedSame || !ACTIVE.has(previous.status), 'This request is already running; observe its native Run', 'OPERATION_ACTIVE');
      if (resumedSame) {
        for (const process of await journal.all(job.id, 'process')) if (process.runId) {
          const child = (await runs.read({ id: process.runId })).run;
          ensure(child.status === 'completed', 'A stopped process requires an explicit same-request call in a new native Run', 'EXPLICIT_RETRY_REQUIRED');
        }
      }
    }
    const timing = await timings(job, native), priorAttempt = job.nativeAttempt;
    job = await journal.update(job.id, current => {
      ensure(current.nativeAttempt === priorAttempt && current.status !== 'completed', 'This request was claimed by another Run', 'OPERATION_ACTIVE');
      return { ...current, ...timing, status: 'running', runId: native.run.id, hostAttempt, nativeAttempt: priorAttempt + 1, epoch: current.epoch + Number(priorAttempt > 0), error: null };
    }, boundSignal);
    const remaining = Math.max(1, Math.ceil(job.budget.maxSeconds * 1000 - timing.activeMs - (Date.now() - timing.startedAt)));
    const ctx = { jobId: job.id, epoch: job.epoch, attemptId: `operation:${job.nativeAttempt}`, nativeAttempt: job.nativeAttempt, signal: AbortSignal.any([boundSignal, AbortSignal.timeout(remaining)]) };
    const update = transform => journal.update(job.id, current => {
      ensure(current.epoch === ctx.epoch && current.status === 'running', 'Operation attempt is no longer active', 'CANCELLED'); return transform(current);
    }, boundSignal);
    try {
      await journal.entry(job.id, 'execution-run', native.run.id, prior => prior ?? { runId: native.run.id }, boundSignal);
      await journal.assertActive(ctx);
      await native.checkpoint({ operationId: job.id, epoch: ctx.epoch, nativeAttempt: ctx.nativeAttempt });
      const result = await work(ctx); await journal.assertActive(ctx);
      const outputRef = await artifacts.publishJSON(result, { schema: 'factor-evidence/1', dependencies: refsIn(result), operationId: `${job.id}:result` }, ctx);
      ctx.signal.throwIfAborted();
      await update(current => ({ ...current, outputRef, status: 'completed', activeMs: current.activeMs + Date.now() - current.startedAt, startedAt: null }));
      await native.checkpoint({ operationId: job.id, outputRef });
      return result;
    } catch (cause) {
      // Native interrupt/cancel revokes this Host; a new explicit invocation
      // reads its history and reconciles the retained operation and child files.
      if (boundSignal.aborted) throw cause;
      const problem = ctx.signal.aborted ? error('BUDGET_EXHAUSTED', 'Operation time budget exhausted') : cause;
      const current = await journal.get(job.id);
      if (current.epoch === ctx.epoch && current.status === 'running') await update(value => ({ ...value, status: 'interrupted', error: failure(problem), activeMs: value.activeMs + Date.now() - value.startedAt, startedAt: null }));
      throw problem;
    }
  } };
}
