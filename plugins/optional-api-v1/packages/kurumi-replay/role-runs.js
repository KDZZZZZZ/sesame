const terminal = new Set(['completed', 'failed', 'cancelled', 'unknown']);

// The replay ledger stores its request separately. Public Run identity and
// output come only from the host execution ledger.
export function roleTask(host, runId) {
  const { run } = host.runs.read({ id: runId });
  return { ...run, runId: run.id, requestId: run.operationId, conversationId: run.output?.sessionId ?? run.progress?.sessionId ?? null,
    model: run.output?.model ?? run.input?.arguments?.model ?? null, result: run.output, turns: run.output?.turns ?? null, toolCalls: run.output?.toolCalls ?? [] };
}
export async function submitRole(host, request, signal) {
  signal?.throwIfAborted();
  const result = await host.capabilities.invoke('host.agent.run', {
    title: request.title, instructions: request.instructions, objective: request.objective ?? '完成给定的已冻结回放任务，并遵守指令中的输入范围与预算。',
    input: request.input, model: request.model,
    allowedCalls: request.tools.map(capabilityId => ({ pluginId: host.context.pluginId, capabilityId })),
    budget: { maxTurns: request.maxTurns, maxToolCalls: request.maxToolCalls, timeoutMs: request.timeoutMs ?? 900000 },
  }, { operationId: request.requestId, signal });
  if (result.type !== 'run') throw Object.assign(new Error('Agent capability did not return a Run'), { code: 'AGENT_SUBMIT_FAILED' });
  return result.run;
}
export async function waitRole(host, runId, signal) {
  for (;;) {
    const result = await host.runs.wait({ id: runId }, { until: 'settled', timeoutMs: 60000, signal });
    if (terminal.has(result.run.status)) return roleTask(host, runId);
  }
}
