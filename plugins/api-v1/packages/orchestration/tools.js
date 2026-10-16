export function createCapabilities(host) {
  return [
    { name: 'agent_list', execute: input => host.runs.list(input) },
    { name: 'agent_delegate', execute: ({ operationId, task, ...input }, signal) => host.capabilities.invoke('host.agent.run', input, { operationId, task, signal }) },
    { name: 'agent_inspect', execute: async ({ runId, wait, timeoutMs, includeHistory, cursor, limit }, signal) => {
      const waited = wait ? await host.runs.wait(runId, { until: wait, timeoutMs, signal }) : null;
      const result = await host.runs.read(runId, { ...(includeHistory ? { include: ['messages', 'calls', 'events', 'outputs', 'resources'] } : {}), cursor, limit });
      return { ...result, ...(waited ? { waitReason: waited.reason } : {}) };
    } },
    { name: 'agent_stop', execute: ({ runId, reason }) => host.runs.cancel(runId, { reason }) },
  ];
}
