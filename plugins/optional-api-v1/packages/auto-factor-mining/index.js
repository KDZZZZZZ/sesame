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
import { createExecution } from './execution.js';
import { createSearchSessions } from './search-session.js';
import { createOperations } from './operations.js';
import { COLLECTIONS, digest, ensure, identifier, keys } from './contracts.js';

const configurationWrites = new Map();
function writeConfiguration(root, update) {
  const pending = (configurationWrites.get(root) ?? Promise.resolve()).catch(() => {}).then(update);
  configurationWrites.set(root, pending);
  return pending.finally(() => { if (configurationWrites.get(root) === pending) configurationWrites.delete(root); });
}

export function createCapabilities(host) {
  let handlers;
  return ['factor_environment', 'factor_prepare', 'factor_search', 'factor_compute', 'factor_evaluate', 'factor_library', 'factor_pool', 'factor_configuration_read', 'factor_configuration_update'].map(name => capability(name, (...args) => {
    handlers ??= createHandlers(host);
    return handlers[name](...args);
  }));
}

function createHandlers(host) {
  const artifacts = createArtifacts({ host }), environment = createEnvironment({ host });
  const journal = createJournal({ state: host.state, artifacts, ownerSessionId: host.context.ownerSessionId ?? host.context.sessionId });
  const python = createPython({ host, artifacts, journal, environment }), library = createLibrary({ state: host.state, artifacts });
  const execution = createExecution({ journal, artifacts, runs: host.runs });
  const search = createSearchSessions({ search: createSearch({ python }), library, journal, artifacts, runs: host.runs, execution });
  const operations = createOperations({ compute: createCompute({ python }), evaluator: createEvaluator({ python }), library, artifacts, execution });
  const handlers = {
    factor_environment: (input, signal) => environment[input.action](input.pythonPath ? { pythonPath: input.pythonPath } : {}, signal),
    factor_prepare: (input, signal, nativeExecution) => operations.prepare(input, signal, nativeExecution),
    factor_search: (input, signal, nativeExecution) => search.handle(input, signal, nativeExecution),
    factor_compute: (input, signal, nativeExecution) => operations.compute(input, signal, nativeExecution),
    factor_evaluate: (input, signal, nativeExecution) => operations.evaluate(input, signal, nativeExecution),
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
