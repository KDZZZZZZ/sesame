import { capability } from '@sesame/plugin-sdk/capabilities';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createArtifacts } from './artifacts.js';
import { createEnvironment } from './environment.js';
import { createJournal, readState } from './journal.js';
import { createPython } from './python-bridge.js';
import { createSearch } from './search.js';
import { createCompute } from './compute.js';
import { createEvaluator } from './evaluate.js';
import { createLibrary } from './library.js';
import { createReports } from './report.js';
import { createRuntime } from './runtime.js';
import { COLLECTIONS, canonical, digest, ensure, identifier, keys } from './contracts.js';

const configurationWrites = new Map();
function writeConfiguration(root, update) {
  const pending = (configurationWrites.get(root) ?? Promise.resolve()).catch(() => {}).then(update);
  configurationWrites.set(root, pending);
  return pending.finally(() => { if (configurationWrites.get(root) === pending) configurationWrites.delete(root); });
}

export function createCapabilities(host) {
  let handlers;
  return ['factor_environment', 'factor_research', 'factor_measure', 'factor_workflow', 'factor_job', 'factor_library', 'factor_pool', 'factor_configuration_read', 'factor_configuration_update'].map(name => capability(name, (...args) => {
    handlers ??= createHandlers(host);
    return handlers[name](...args);
  }));
}

function createHandlers(host) {
  const artifacts = createArtifacts({ host }), environment = createEnvironment({ host });
  const journal = createJournal({ state: host.state, artifacts, ownerSessionId: host.context.ownerSessionId ?? host.context.sessionId });
  const python = createPython({ host, artifacts, journal, environment }), library = createLibrary({ state: host.state, artifacts });
  const runtime = createRuntime({ search: createSearch({ python }), compute: createCompute({ python }), evaluator: createEvaluator({ python }), library, journal, runs: host.runs, reports: createReports({ host, artifacts, journal }), capabilities: host.capabilities, artifacts, environment: python.selection });
  const handlers = {
    factor_environment: (input, signal) => environment[input.action](input.pythonPath ? { pythonPath: input.pythonPath } : {}, signal),
    factor_research: ({ draft }) => runtime.research(draft),
    factor_measure: input => runtime.measure(input),
    factor_workflow: ({ jobId }, signal, execution) => runtime.execute(jobId, { ...execution, signal }),
    factor_job: async input => {
      const job = await runtime.control(input.jobId, input.action, input.interruptIds);
      if (input.action !== 'read') return job;
      const saved = await journal.get(input.jobId), trials = await journal.page(input.jobId, 'candidate', input.cursor, input.limit ?? 20);
      const evidence = [...new Map(trials.items.flatMap(t => [t.development?.valuesRef, t.holdout?.valuesRef].filter(Boolean)).map(ref => [canonical(ref), ref])).values()];
      const observed = saved.runId ? await host.runs.read(saved.runId) : null;
      return { ...job, trials: { items: trials.items.map(t => ({ candidateId: t.candidate?.id ?? t.candidateId ?? t.key, status: t.development?.status ?? t.holdout?.status ?? 'queued', factorId: t.development?.factorIds?.[0] ?? t.holdout?.factorIds?.[0] ?? null })), cursor: trials.cursor }, evidence: { items: evidence, cursor: trials.cursor }, interruptIds: (observed?.run.interrupts ?? []).filter(i => i.status !== 'resolved').map(i => i.id), ...(saved.reportStatus ? { reportStatus: saved.reportStatus } : {}), reportError: saved.reportError ?? null, ...(saved.valuesRef ? { valuesRef: saved.valuesRef } : {}) };
    },
    factor_library: async input => {
      if (input.action === 'query') return library.query(input.query);
      if (input.action === 'read') return { factor: await library.read(input.factorId), evaluations: await library.evaluations(input.factorId, { cursor: input.cursor, limit: input.limit ?? 20 }) };
      return library.annotate(input.factorId, input.note, input.operationId);
    },
    factor_pool: input => {
      if (input.action === 'read') return library.pool(input.poolId);
      if (input.action === 'decide') return library.decide(input.change);
      const { action: _action, ...feedback } = input; return library.feedback(feedback);
    },
    factor_configuration_read: async () => {
      try { const saved = JSON.parse(await readFile(join(host.context.storageRoot, 'environment.json'), 'utf8')); return { pythonPath: saved.pythonPath ?? null, ready: saved.ready === true }; }
      catch (e) { if (e.code !== 'ENOENT') throw e; return { pythonPath: null, ready: false }; }
    },
    factor_configuration_update: (input, signal) => writeConfiguration(host.context.storageRoot, async () => {
      keys(input, ['pythonPath', 'command_id', 'expected_version'], ['pythonPath', 'command_id']);
      const key = identifier('configuration', input.command_id), fingerprint = digest(input);
      const previous = await readState(host.state, COLLECTIONS.feedback, key);
      if (previous) { ensure(previous.value.fingerprint === fingerprint, 'Configuration command ID conflict', 'IDEMPOTENCY_CONFLICT'); return previous.value.result; }
      const selected = await environment.inspect({ pythonPath: input.pythonPath }, signal);
      ensure(selected.ready, selected.reason ?? 'Python environment is not ready', 'PREREQUISITE_REQUIRED');
      const result = { pythonPath: selected.pythonPath, ready: true };
      await host.state.commit([{ op: 'put', key: { collection: COLLECTIONS.feedback, key }, expectedVersion: 0, value: { fingerprint, result } }], { operationId: `${key}:${fingerprint}`, signal }); return result;
    }),
  };
  return handlers;
}
