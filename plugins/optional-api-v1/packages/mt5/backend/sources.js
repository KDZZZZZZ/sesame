import { randomUUID } from 'node:crypto';
import { requireValue } from './support.js';
import { strategyQuery } from './strategy.js';

export const providerOperations = Object.freeze({
  market: ['bind', 'unbind', 'searchInstruments', 'describeInstrument', 'queryBars', 'subscribeBars'],
  account: ['bind', 'unbind', 'listAccounts', 'snapshot', 'queryPositions', 'queryOrders', 'queryFills', 'queryHistory', 'subscribeAccount'],
});

function subscription(signal, start) {
  const queue = []; let waiter, ended = false, failure, dispose = () => {};
  const close = async () => { if (ended) return; ended = true; signal?.removeEventListener('abort', abort); queue.length = 0; waiter?.resolve({ done: true }); waiter = null; await dispose(); };
  const abort = () => { void close(); };
  const emit = event => {
    if (ended) return;
    if (waiter) { const current = waiter; waiter = null; current.resolve({ value: event, done: false }); return; }
    if (queue.length >= 256) { failure = Object.assign(new Error('MT5 source requires a new snapshot after overflow'), { code: 'RESYNC_REQUIRED' }); void close(); return; }
    queue.push(event);
  };
  signal?.addEventListener('abort', abort, { once: true });
  const events = { [Symbol.asyncIterator]() { return this; }, next() { if (failure) return Promise.reject(failure); if (queue.length) return Promise.resolve({ value: queue.shift(), done: false }); if (ended) return Promise.resolve({ done: true }); return new Promise((resolve, reject) => { waiter = { resolve, reject }; }); }, async return() { await close(); return { done: true }; } };
  dispose = start(emit) ?? dispose;
  if (signal?.aborted) void close();
  return { id: randomUUID(), events, close };
}

export async function providerCall(service, domain, operation, { binding = {}, query = {}, page = {} }, signal) {
  const provider = service.providers[domain];
  if (operation === 'bind') { const bindingId = randomUUID(); return { bindingId, ...await provider.bind(binding, { bindingId, signal }) }; }
  requireValue(typeof binding.bindingId === 'string', 'MT5 source requires its explicit binding', 422, 'INVALID_BINDING');
  const context = { bindingId: binding.bindingId, signal };
  if (operation === 'unbind') { provider.unbind(context); return { closed: true }; }
  if (operation.startsWith('subscribe')) {
    const stream = await provider[operation](query, context);
    return subscription(signal, emit => {
      emit({ type: 'snapshot', snapshot: stream.snapshot, position: stream.position, consistency: stream.consistency, recovery: stream.recovery });
      stream.ready(event => emit(event)); return () => stream.close();
    });
  }
  const result = await provider[operation]({ ...query, page }, context), data = result.data;
  const paged = data.page ?? (Array.isArray(data.items) ? data : null);
  const { page: nestedPage, items: outerItems, nextCursor: outerCursor, ...metadata } = data;
  return { items: paged?.items ?? [data], ...(paged?.nextCursor ? { nextCursor: paged.nextCursor } : {}), metadata: { ...metadata, ...(paged ? { snapshotId: paged.snapshotId, consistency: paged.consistency } : {}), meta: result.meta } };
}
export function paginate(items, page, extra = {}) {
  const limit = page.limit ?? 100, offset = page.cursor ? Number(page.cursor) : 0;
  requireValue(Number.isInteger(limit) && limit > 0 && limit <= 1000 && Number.isSafeInteger(offset) && offset >= 0 && offset <= items.length, 'Invalid MT5 source pagination');
  return { items: items.slice(offset, offset + limit), ...(offset + limit < items.length ? { nextCursor: String(offset + limit) } : {}), ...extra };
}
export function datasetQuery(host, service, { query = {}, page = {} }) {
  const storage = service.mt5.storage, row = query.datasetId ? storage.get('dataset', query.datasetId) : null;
  requireValue(!query.datasetId || row, 'MT5 dataset does not exist; use an ID returned by mt5_report_data or the dataset directory', 404, 'NOT_FOUND');
  const items = row ? row.strategy_role && query.parameters ? strategyQuery(row, query.parameters) : row.rows : storage.list('dataset').map(({ rows, ...metadata }) => ({ ...metadata, rowCount: rows.length }));
  const { rows, ...metadata } = row ?? {};
  return paginate(items, page, row ? { metadata } : {});
}
export function runQuery(service, { query = {}, page = {} }) {
  return paginate(service.mt5.storage.list('native_run_record').filter(row => (!query.id || row.id === query.id) && (!query.status || row.body.status === query.status)), page);
}
export function runWatch(service, input, signal) {
  return subscription(signal, emit => {
    let prior;
    const read = () => { const value = runQuery(service, { ...input, page: { limit: 1000 } }); const serialized = JSON.stringify(value); if (serialized !== prior) { emit({ type: 'snapshot', ...value }); prior = serialized; } };
    read(); const timer = setInterval(read, 1000); timer.unref?.(); return () => clearInterval(timer);
  });
}
