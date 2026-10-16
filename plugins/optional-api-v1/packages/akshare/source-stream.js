
export function subscription(stream, signal) {
  const queue = [{ type: 'snapshot', snapshot: stream.snapshot, position: stream.position, consistency: stream.consistency, recovery: stream.recovery }];
  let wake, ended = false, failure, pending;
  const close = () => pending ??= (async () => { ended = true; signal?.removeEventListener('abort', abort); wake?.(); await stream.close(); })();
  const abort = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', abort, {once:true});
  stream.ready(event => { if (ended) return; if (queue.length >= 256) { failure = Object.assign(new Error('Source consumer fell behind; request a new snapshot'), {code:'SUBSCRIPTION_OVERFLOW'}); abort(); return; } queue.push(event); wake?.(); });
  if (signal?.aborted) abort();
  return { id: stream.position.streamId, close, events: { async *[Symbol.asyncIterator]() { try { for (;;) { if (failure) throw failure; if (queue.length) yield queue.shift(); else if (ended) return; else await new Promise(resolve => { wake = resolve; }); } } finally { await close(); } } } };
}
