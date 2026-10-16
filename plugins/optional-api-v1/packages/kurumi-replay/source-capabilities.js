import { randomUUID } from 'node:crypto';
import { ReplayMarketProvider, ReplayAccountProvider } from './providers.js';
import { getService } from './service.js';

export const sourceOperations = Object.freeze({
  market: ['bind', 'unbind', 'searchInstruments', 'describeInstrument', 'queryBars', 'subscribeBars'],
  account: ['bind', 'unbind', 'listAccounts', 'snapshot', 'queryPositions', 'queryOrders', 'queryFills', 'queryHistory', 'subscribeAccount'],
});
export function initializeSources(host, service) {
  service.sources = { market: new ReplayMarketProvider(host, service), account: new ReplayAccountProvider(host, service) };
}
export function disposeSources(service) { for (const provider of Object.values(service.sources ?? {})) provider.dispose(); }

function subscription(handle, signal) {
  const queue = [{ type: 'snapshot', snapshot: handle.snapshot, position: handle.position, consistency: handle.consistency }];
  let pending, done = false, problem, closing;
  const close = () => {
    if (!closing) { done = true; signal?.removeEventListener('abort', abort); pending?.({ done: true }); pending = null; closing = Promise.resolve(handle.close()); }
    return closing;
  };
  const abort = () => { void close(); };
  handle.ready(event => {
    if (done) return;
    if (pending) { const resolve = pending; pending = null; resolve({ done: false, value: event }); }
    else if (queue.length < 256) queue.push(event);
    else { problem = Object.assign(new Error('Replay stream overflow; request a new snapshot'), { code: 'RESYNC_REQUIRED' }); void close(); }
  });
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  return { id: handle.position.streamId, close, events: { async *[Symbol.asyncIterator]() {
    try { for (;;) { if (problem) throw problem; if (done) return; if (queue.length) yield queue.shift(); else { const event = await new Promise(resolve => { pending = resolve; }); if (event.done) return; yield event.value; } } }
    finally { await close(); }
  } } };
}
export function createSourceCapabilities(host) {
  return Object.entries(sourceOperations).flatMap(([source, operations]) => operations.map(operation => ({
    name: `${source}_${operation}`,
    async execute(input, signal) {
      signal?.throwIfAborted();
      const provider = getService(host).sources[source];
      if (operation === 'bind') {
        const bindingId = randomUUID(), bound = provider.bind(input.binding, { bindingId, signal });
        return { bindingId, ...bound };
      }
      if (operation === 'unbind') { provider.unbind(input.binding); return { released: true }; }
      const context = { bindingId: input.binding.bindingId, connection: input.binding.connection, signal };
      const streaming = operation.startsWith('subscribe');
      const paged = !streaming && !['describeInstrument', 'snapshot'].includes(operation);
      const value = await provider[operation]({ ...input.query, ...(paged ? { page: input.page } : {}) }, context);
      if (streaming) return subscription(value, signal);
      const page = value.data.page ?? (Array.isArray(value.data.items) ? value.data : null);
      const { page: _page, items: _items, ...details } = value.data;
      return { items: page ? page.items : [value.data], ...(page?.nextCursor ? { nextCursor: page.nextCursor } : {}),
        metadata: { ...(page ? details : {}), ...(page ? { snapshotId: page.snapshotId, consistency: page.consistency } : {}), meta: value.meta, connection: input.binding.connection } };
    },
  })));
}
