import assert from 'node:assert/strict';

// Controlled process output for environment selection unit tests. Native worker
// process reuse/cancellation is exercised separately by ccxt-worker.test.mjs.
export function processHost(context, execute) {
  const runs = new Map();
  return {
    context: { workspaceRoot: context.storageRoot, pythonPath: null, ...context },
    capabilities: {
      async invoke(id, input, options = {}) {
        assert.equal(id, 'host.process.exec');
        const ref = { id: `fixture-process-${runs.size + 1}`, kind: 'process', capabilityId: id }, controller = new AbortController();
        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
        const settled = Promise.resolve().then(() => execute(input, { ...options, signal })).then(output => {
          if (signal.aborted) return { ...ref, status: 'cancelled', error: { code: 'ABORTED', message: 'Fixture process cancelled' } };
          if (output.exitCode !== 0) return { ...ref, status: 'failed', error: { code: 'PROCESS_EXIT', message: 'Fixture process failed', details: output } };
          return { ...ref, status: 'completed', output };
        }, error => ({ ...ref, status: signal.aborted ? 'cancelled' : 'failed', error: { code: error.code ?? 'PROCESS_FAILED', message: error.message, details: error.details } }));
        runs.set(ref.id, { settled, controller });
        return { type: 'run', run: ref, receipt: { operationId: ref.id } };
      },
    },
    runs: {
      async wait(ref) { const entry = runs.get(ref.id); assert.ok(entry); return { reason: 'settled', run: await entry.settled }; },
      async cancel(ref) { const entry = runs.get(ref.id); assert.ok(entry); entry.controller.abort(); return { ...ref, status: 'cancelling' }; },
    },
  };
}
