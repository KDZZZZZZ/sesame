import { ensure, error } from './contracts.js';

/** Existing API2 process capability; cancellation waits for the actual child. */
export async function runProcess(host, argv, { cwd, env, signal, timeoutMs = 540000, onRun, operationId } = {}) {
  signal?.throwIfAborted();
  ensure(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 540000, 'Invalid bounded process timeout');
  const accepted = await host.capabilities.invoke('host.process.exec', { argv, cwd, timeoutMs, ...(env ? { env } : {}) }, { signal, ...(operationId ? { operationId } : {}) });
  ensure(accepted.type === 'run', 'Process capability did not create a Run', 'INVALID_OUTPUT');
  await onRun?.(accepted.run);
  let cancelling;
  const cancel = () => { cancelling ??= Promise.resolve().then(() => host.runs.cancel(accepted.run, { reason: 'Factor operation cancelled' })).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) cancel();
    for (;;) {
      // A local control abort can still wait through this live port. If the
      // native workflow itself is interrupted, the SDK revokes its ports and
      // the host Run service owns descendant cleanup; a fresh control call
      // reconciles the persisted job with that native outcome.
      const result = await host.runs.wait(accepted.run, { until: 'settled', timeoutMs: 30000 });
      if (result.reason === 'timeout') continue;
      await cancelling;
      const run = result.run;
      signal?.throwIfAborted();
      if (run.status === 'completed') return { ...run.output, runId: run.id };
      if (run.error?.code === 'PROCESS_EXIT') return { ...run.error.details, runId: run.id };
      throw error(run.error?.code ?? 'PROCESS_FAILED', run.error?.message ?? `Process ${run.status}`);
    }
  } finally { signal?.removeEventListener('abort', cancel); }
}
