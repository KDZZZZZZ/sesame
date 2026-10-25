// Deterministic source; checked-in copies keep each workflow archive independent.
import { createHash } from 'node:crypto';
import { normalizeEffect } from '@sesame/plugin-sdk/protocol';
export { canonical, digest } from '@sesame/plugin-sdk/protocol';

export const check = (ok, code, message) => { if (!ok) throw Object.assign(new Error(message), { code }); };
export const memberId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !Object.hasOwn(Object.prototype, value);
// Research may acquire and freeze data; this is deliberately not the host's
// side-effect-free readiness policy. Unknown/empty effects never imply safety.
const researchEffects = new Set(['read', 'artifact.read', 'state.read', 'resources.read', 'data.read', 'network', 'artifact.write', 'resources.write']);
export const researchSafeCapability = cap => cap.kind === 'function' && Array.isArray(cap.effects) && cap.effects.length > 0 && cap.effects.every(effect => researchEffects.has(normalizeEffect(effect)));
export const workflowError = (error, code) => ({ code: error?.code ?? code, message: String(error?.message ?? error).slice(0, 1000),
  ...(typeof error?.retryable === 'boolean' ? { retryable: error.retryable } : {}), ...(typeof error?.retry === 'string' ? { retry: error.retry } : {}) });

// Factor checkpoints historically hash JSON strings (including their quotes),
// unlike protocol.digest(string), which hashes raw UTF-8. Do not change saved IDs.
const normalizeJSON = value => Array.isArray(value) ? value.map(normalizeJSON) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalizeJSON(value[key])])) : value;
export const canonicalJSON = value => JSON.stringify(normalizeJSON(value));
export const digestJSON = value => `sha256:${createHash('sha256').update(canonicalJSON(value)).digest('hex')}`;

export function configuredModel(host, selection, { required = 'MODEL_REQUIRED', unavailable = 'MODEL_UNAVAILABLE', changed = 'MODEL_CHANGED' } = {}) {
  check(typeof selection?.provider === 'string' && selection.provider && typeof selection.id === 'string' && selection.id, required, 'Select a configured model provider/id.');
  const model = host.context.models.find(value => value.provider === selection.provider && value.id === selection.id);
  check(model, unavailable, `Configured model unavailable: ${selection.provider}/${selection.id}`);
  check(selection.configurationDigest === undefined || selection.configurationDigest === model.configurationDigest, changed, 'The selected model configuration has changed; restore its frozen configuration or select it for a new run.');
  return structuredClone(model);
}
export function roleModels(host, model, overrides, roles, options) {
  check(overrides === undefined || overrides && typeof overrides === 'object' && !Array.isArray(overrides), 'INVALID_ARGUMENT', 'Role model overrides must be an object.');
  const selected = configuredModel(host, model, options), result = {};
  for (const [role, value] of Object.entries(overrides ?? {})) {
    check(roles.includes(role), 'INVALID_ARGUMENT', `Unknown team role: ${role}`);
    result[role] = configuredModel(host, value, options);
  }
  return { model: selected, agentModels: result };
}
export const uniqueCalls = calls => [...new Map(calls.map(call => [`${call.pluginId}#${call.capabilityId}`, structuredClone(call)])).values()];
export async function verifyRevisions(revisions, read, { code = 'PLUGIN_CHANGED', message = id => `Selected plugin changed; restore its frozen revision before resuming: ${id}` } = {}) {
  for (const frozen of revisions ?? []) {
    const current = await read(frozen.id);
    check(typeof frozen.digest === 'string' && frozen.digest && current.digest === frozen.digest, code, message(frozen.id));
  }
}

export const SETTLED_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled', 'unknown', 'expired', 'superseded']);
export function assertRunNotInterrupted(run, reason) {
  if (reason === 'interrupted' || run.status === 'interrupted') throw Object.assign(new Error(run.interrupts?.find(item => !item.resolvedAt)?.reason ?? 'Child Agent is interrupted; resume its original Run.'), {
    code: 'RUN_INTERRUPTED', details: { childRunId: run.id, interrupts: run.interrupts },
  });
}
// Only workflows waiting for an end state share this loop. TD intentionally
// observes until:'changed' with afterVersion to retain its private live ledger.
export async function waitForSettledRun(host, ref, signal) {
  for (;;) {
    signal?.throwIfAborted();
    const { reason, run } = await host.runs.wait(ref, { until: 'settled', timeoutMs: 30000, signal });
    assertRunNotInterrupted(run, reason);
    if (SETTLED_RUN_STATUSES.has(run.status)) return run;
  }
}
