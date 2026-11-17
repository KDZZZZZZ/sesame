import { createArtifacts } from '../artifacts.js';
import { createJournal } from '../journal.js';
import { createExecution } from '../execution.js';
import { clone } from '../contracts.js';
import { storageFixture } from './storage-fixture.js';

export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export const budget = { maxCandidates: 8, batchSize: 2, maxWorkers: 1, maxSeconds: 60, maxInputBytes: 1048576, maxOutputBytes: 1048576, seed: 7 };
export async function executionFixture(t) {
  const f = await storageFixture(t), artifacts = createArtifacts({ host: f.host });
  const journal = createJournal({ state: f.state, artifacts, ownerSessionId: 'direct-agent' });
  const nativeRuns = new Map(), history = new Map(), checkpoints = [];
  const runs = { async read(ref, options = {}) {
    const run = nativeRuns.get(ref.id ?? ref); if (!run) throw Object.assign(Error('Missing Run'), { code: 'NOT_FOUND' });
    const offset = Number(options.cursor?.split(':')[1] ?? 0), entries = (history.get(run.id) ?? []).filter(item => item.sequence > offset), page = entries.slice(0, options.limit ?? 200);
    return { run: clone(run), ...(options.include ? { history: { items: clone(page), ...(page.length < entries.length ? { nextCursor: `sequence:${page.at(-1).sequence}` } : {}) } } : {}) };
  } };
  const addEvent = (id, status, at = Date.now(), type = 'status', extras = {}) => {
    const items = history.get(id) ?? [], sequence = items.length + 1;
    items.push({ id: `${id}:${sequence}`, runId: id, sequence, at: new Date(at).toISOString(), type, data: { status, ...extras } }); history.set(id, items);
    Object.assign(nativeRuns.get(id), { status, updatedAt: new Date(at).toISOString() });
  };
  const native = (id = 'native-1', attempt = 1, started = Date.now()) => {
    if (!nativeRuns.has(id)) nativeRuns.set(id, { id, attempt, status: 'queued', startedAt: new Date(started).toISOString(), interrupts: [] });
    else { nativeRuns.get(id).attempt = attempt; addEvent(id, 'queued', started, 'resumed', { attempt }); }
    addEvent(id, 'running', started);
    const controller = new AbortController();
    return { run: { id }, attempt, signal: controller.signal, controller,
      checkpoint: async state => { controller.signal.throwIfAborted(); checkpoints.push(clone(state)); },
      interrupt: ({ reason }) => { const cause = Object.assign(Error(reason), { code: 'RUN_INTERRUPTED' }); addEvent(id, 'interrupted'); controller.abort(cause); throw cause; },
    };
  };
  const ports = { journal, artifacts, runs };
  return { ...f, artifacts, journal, runs, nativeRuns, history, checkpoints, addEvent, native, ports, execution: createExecution(ports) };
}
