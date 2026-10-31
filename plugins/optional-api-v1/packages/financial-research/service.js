import { createConfiguration } from './configuration.js';
import { createTransport } from './transport.js';
import { createEvidence } from './evidence.js';

// Preserve the public facade and host identity; collaborators share the original
// records repository and have no independent storage or capability entry points.
export function createService(host, { now = Date.now, fetch: fetcher = globalThis.fetch, env = process.env, timeoutMs = 15000 } = {}) {
  const configuration = createConfiguration(host, { now, env });
  const transport = createTransport({ now, fetch: fetcher, timeoutMs, credential: configuration.credential });
  const evidence = createEvidence(host, { now, transport });
  const service = {
    status() { return evidence.status(configuration.status()); },
    async configure(input, signal) {
      await configuration.configure(input, signal);
      return service.status();
    },
    read: evidence.read,
    queryEvidence: evidence.queryEvidence,
    query: evidence.query,
  };
  return service;
}
