import { compileLocal } from './local-compiler.js';
import { requireValue, taskRunId } from './support.js';

/** Trusted native adapter entry; executeWorker is not a strategy sandbox. */
export async function execute(payload, { signal } = {}) {
  requireValue(payload.operation === 'compile', 'Unknown MT5 compiler worker operation');
  if (payload.runId) taskRunId(payload.runId);
  return compileLocal(payload.native, payload.directory, payload.manifestDigest, signal);
}
