import { join } from 'node:path';
import { AgentDecisionService } from './agent-decisions.js';
import { DecisionRecords } from './decision-records.js';
import { readBytes } from '../artifact-io.js';

const instances = new Map();
const check = (value, message) => { if (!value) throw new Error(message); };

export async function loadDecisionInputs(host, request) {
  const inputs = []; let size = 0;
  for (const input of request.inputs) {
    const manifest = await host.resources.read(input.ref, { part: 'manifest' });
    const payload = { ref: input.ref, availableAt: input.availableAt, content: manifest.content, provenance: manifest.provenance ?? null };
    if (input.paths?.length) {
      payload.files = [];
      for (const path of input.paths) {
        const blob = manifest.blobs.find(blob => blob.path === path);
        check(blob && blob.size <= 1048576 && /^(application\/json|text\/)/.test(blob.mediaType), 'Frozen input must be bounded text or JSON');
        const bytes = await readBytes(host, input.ref, path);
        check(bytes.length <= 1048576, 'Input blob exceeds 1 MiB');
        payload.files.push({ path, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), digest: blob.digest });
      }
    }
    size += Buffer.byteLength(JSON.stringify(payload)); check(size <= 1048576, 'Combined decision inputs exceed 1 MiB'); inputs.push(payload);
  }
  return inputs;
}

export function activateDecisions(host) {
  const key = host.context.storageRoot;
  if (instances.has(key)) return { ready: true };
  const records = new DecisionRecords(join(key, 'decisions'));
  const services = { records,
    models: async () => (await host.data.query({ source: { providerId: 'host#models', revision: 'host:2' }, input: {}, limit: 200 })).items,
    readInputs: request => loadDecisionInputs(host, request),
    verifyRefs: async refs => { for (const ref of refs) await host.resources.read(ref, { part: 'manifest' }); },
    complete: async (request, signal) => {
      const { requestId, ...value } = request;
      const input = Object.fromEntries(Object.entries(value).filter(([, value]) => value !== undefined));
      const result = await host.capabilities.invoke('host.model.complete', input, { signal, operationId: `strategy-model:${requestId}` });
      check(result.type === 'result', 'Decision model must return an immediate result'); return result.value;
    },
    emit: payload => host.events.emit({ topic: 'workspace.strategy.decision', payload }),
  };
  try { instances.set(key, new AgentDecisionService(services)); }
  catch (error) { records.close(); throw error; }
  return { ready: true, storage: 'plugin-private-sqlite' };
}

export function decisionService(host) {
  const value = instances.get(host.context.storageRoot);
  check(value && !value.closed, 'Strategy decision service is not active'); return value;
}

export async function disposeDecisions(host) {
  const key = host.context.storageRoot, value = instances.get(key);
  if (!value) return { closed: true };
  if (value.bridgePromise) await value.bridgePromise.catch(() => {});
  await value.bridge?.close(); await value.close(); value.records.close(); instances.delete(key); return { closed: true };
}
