import { cycle } from '../src/runtime.js';
import { ID } from '../src/state.js';

export const fail = (code, message = code) => Object.assign(new Error(message), { code });
export async function until(check) { for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw Error('Fixture did not reach the expected state'); }

export function fixture({ stored, onInvoke } = {}) {
  const store = stored ?? { records: new Map(), runs: new Map(), operations: new Map(), calls: [], listeners: new Map(), sequence: 0, checkpoints: new Map(), events: [] };
  const descriptors = new Map([
    ['host.agent.run', { effects: ['model', 'declared-calls'], execution: 'run' }],
    ['host.capabilities.list', { effects: ['read'] }],
    ['host.sessions.query', { effects: ['read'] }],
    ['sesame/plugin-manager#plugin_discover', { effects: ['read'] }],
    ['sesame/plugin-manager#plugin_read', { effects: ['read'] }],
    ['sesame/research#analyze', { effects: ['start:agents'], execution: 'run' }],
    ['sesame/trading#submit', { effects: ['trade'], execution: 'run' }],
    ['sesame/trading#schedule', { effects: ['manage:scheduler', 'trade'] }],
    ['sesame/trading#pause', { effects: ['trade'] }],
    ['sesame/auto-factor-mining#auto_factor_start', { effects: ['write:research-checkpoints', 'start:workflow'] }],
  ].map(([id, descriptor]) => [id, { id, revision: 'fixture:1', consumers: ['agent', 'host'], kind: 'function', execution: 'immediate', ...descriptor }]));
  const lookup = reference => { const value = store.runs.get(typeof reference === 'string' ? reference : reference.id); if (!value) throw fail('NOT_FOUND'); return value; };
  const emit = job => { for (const listener of store.listeners.get(job.value.id) ?? []) listener(structuredClone(job.value)); };
  function update(job, changes) { job.value = { ...job.value, ...changes, revision: job.value.revision + 1 }; emit(job); return job.value; }
  function complete(id, output = { text: 'Evidence and next experiment.' }, status = 'completed') { const job = lookup(id); update(job, { status, output }); return job.value; }
  function newRun(capability, input, context, options) {
    const id = `run_${++store.sequence}`, job = { value: { id, kind: capability === `${ID}#ultra_cycle` ? 'workflow' : capability === 'host.agent.run' ? 'agent' : 'workflow', revision: 1,
      status: 'running', sessionId: context.sessionId, parentRunId: context.runId ?? null }, capability, input: structuredClone(input), context, options, controller: new AbortController() };
    store.runs.set(id, job);
    if (capability === `${ID}#ultra_cycle`) launchCycle(job);
    else if (capability === 'host.agent.run' && context.kind === 'subagent') queueMicrotask(() => complete(id, { text: 'Discover factor-research and dispatch two independent hypotheses.' }));
    return { id, kind: job.value.kind, revision: 1 };
  }
  function launchCycle(job) {
    job.controller = new AbortController(); update(job, { status: 'running' });
    const execution = { run: { id: job.value.id, kind: 'workflow', revision: job.value.revision }, checkpointState: store.checkpoints.get(job.value.id) ?? null,
      checkpoint: async value => { job.controller.signal.throwIfAborted(); store.checkpoints.set(job.value.id, structuredClone(value)); },
      progress: value => store.events.push(value), interrupt: value => { update(job, { status: 'interrupted', interrupts: [{ id: `interrupt_${job.value.id}`, reason: value.reason }], error: { code: 'RUN_INTERRUPTED', message: value.reason } }); throw fail('RUN_INTERRUPTED', value.reason); } };
    queueMicrotask(() => {
      job.running = cycle(makeHost({ kind: 'subagent', sessionId: `child_${job.value.id}`, ownerSessionId: job.context.sessionId, runId: job.value.id }), job.input, job.controller.signal, execution)
        .then(output => { if (!job.controller.signal.aborted) complete(job.value.id, output); })
        .catch(error => { if (error.code !== 'RUN_INTERRUPTED' && job.controller.signal.reason?.code !== 'RUN_INTERRUPTED') update(job, { status: job.controller.signal.aborted ? 'cancelled' : 'failed', error: { code: error.code ?? 'FAILED', message: error.message } }); });
    });
  }
  function makeHost(extra = {}) {
    const context = { kind: 'main', sessionId: 'conv_main', pluginId: ID, storageRoot: 'ultra-fixture', ...extra };
    return {
      context,
      state: {
        read: async key => { const value = store.records.get(`${key.collection}:${key.key}`); if (!value) throw fail('NOT_FOUND'); return structuredClone(value); },
        query: async ({ collection, filter = {} }) => ({ items: [...store.records.entries()].filter(([key, row]) => key.startsWith(`${collection}:`) && Object.entries(filter).every(([name, value]) => row.value[name] === value)).map(([, row]) => structuredClone(row)) }),
        commit: async changes => { for (const change of changes) { const key = `${change.key.collection}:${change.key.key}`, old = store.records.get(key); if ((old?.version ?? 0) !== change.expectedVersion) throw fail('VERSION_CONFLICT'); }
          for (const change of changes) store.records.set(`${change.key.collection}:${change.key.key}`, { key: change.key, value: structuredClone(change.value), version: change.expectedVersion + 1 }); return {}; },
      },
      plugins: { search: async () => ({ items: [{ id: 'sesame/factor-research', title: 'Factor research', description: 'Knowledge method', state: 'discoverable' }] }) },
      capabilities: {
        list: async ({ ids } = {}) => ({ items: [...descriptors.values()].filter(item => !ids || ids.includes(item.id)).map(value => structuredClone(value)) }),
        invoke: async (target, input, options = {}) => {
          options.signal?.throwIfAborted(); const capability = typeof target === 'string' ? target : target.id;
          if (capability === 'host.sessions.query') return { type: 'result', value: { items: [{ id: context.sessionId, kind: context.kind, ...(store.sessionStatus ?? { status: 'idle', activeResponseId: null }) }] } };
          const key = `${capability}:${options.operationId}`; if (store.operations.has(key)) return structuredClone(store.operations.get(key));
          store.calls.push({ capability, input: structuredClone(input), context: structuredClone(context), operationId: options.operationId });
          let result = await onInvoke?.({ capability, input, options, host: makeHost(extra), store, newRun: () => newRun(capability, input, context, options) });
          if (!result) {
            if (capability === `${ID}#ultra_cycle` || descriptors.get(capability)?.execution === 'run') result = { type: 'run', run: newRun(capability, input, context, options) };
            else if (capability === 'sesame/auto-factor-mining#auto_factor_start') result = { type: 'result', value: { id: 'fm_one', status: 'queued', workflow: newRun(capability, input, context, options) } };
            else result = { type: 'result', value: { ok: true } };
          }
          store.operations.set(key, result); return structuredClone(result);
        },
      },
      runs: {
        read: async reference => ({ run: structuredClone(lookup(reference).value) }),
        cancel: async reference => { const job = lookup(reference); job.controller.abort(fail('CANCELLED')); update(job, { status: 'cancelled' });
          for (const child of store.runs.values()) if (child.value.parentRunId === job.value.id) { child.controller.abort(fail('CANCELLED')); update(child, { status: 'cancelled' }); } return { run: structuredClone(job.value) }; },
        resume: async reference => { const job = lookup(reference); if (job.capability === `${ID}#ultra_cycle`) launchCycle(job); else update(job, { status: 'running', interrupts: [] }); return { run: structuredClone(job.value) }; },
        watch: (reference, { signal, afterVersion = 0 } = {}) => {
          const job = lookup(reference), queue = [], listeners = store.listeners.get(job.value.id) ?? new Set(); store.listeners.set(job.value.id, listeners);
          let pending, ended = false;
          const listener = value => { if (ended) return; if (pending) { pending.resolve({ value, done: false }); pending = null; } else queue.push(value); };
          const close = () => { ended = true; listeners.delete(listener); signal?.removeEventListener('abort', abort); pending?.resolve({ done: true }); pending = null; };
          const abort = () => { pending?.reject(signal.reason); pending = null; close(); };
          listeners.add(listener); if (job.value.revision > afterVersion) listener(structuredClone(job.value)); signal?.addEventListener('abort', abort, { once: true });
          return { close, events: { [Symbol.asyncIterator]() { return this; }, next() { if (signal?.aborted) return Promise.reject(signal.reason); if (queue.length) return Promise.resolve({ value: queue.shift(), done: false }); if (ended) return Promise.resolve({ done: true }); return new Promise((resolve, reject) => { pending = { resolve, reject }; }); } } };
        },
      },
      data: { watch: async () => ({ close: async () => {}, events: (async function* () { yield { type: 'snapshot', price: 1 }; yield { type: 'delta', price: 2 }; })() }) },
    };
  }
  return { host: makeHost(), hostFor: makeHost, store, descriptors, complete, update, newRun, async close() { for (const job of store.runs.values()) job.controller.abort(fail('CANCELLED')); await Promise.allSettled([...store.runs.values()].map(job => job.running)); } };
}
