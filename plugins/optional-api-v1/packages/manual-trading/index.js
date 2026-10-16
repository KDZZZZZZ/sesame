import { createAgentCapabilities } from './agent-tools.js';
import { TradingRuntime } from './runtime.js';
import { JudgmentService, createJudgmentCapabilities } from './judgment/index.js';
import { instance, setInstance } from './state.js';
import { closeRecords } from './records.js';

export function createCapabilities(host) {
  return [
    ...createAgentCapabilities(host), ...createJudgmentCapabilities(host, () => instance(host).judgment),
    { name: 'activate', execute: async () => {
      const judgment = new JudgmentService(host).init(), runtime = new TradingRuntime(host);
      try { setInstance(host, { runtime, judgment }); await runtime.start(); return { ready: true }; }
      catch (error) { await runtime.dispose(); await judgment.close(); closeRecords(host); setInstance(host, null); throw error; }
    } },
    { name: 'after_turn', execute: async (event, signal) => { await instance(host).judgment.invoke(host, 'auditTurn', [event], signal); return {}; } },
    { name: 'dispose', execute: async () => { const value = instance(host); await value.runtime.dispose(host); await value.judgment.close(); closeRecords(host); setInstance(host, null); return {}; } },
    { name: 'workflow_execute', execute: ({ runId }, signal, context) => instance(host).runtime.execute(host, runId, signal, context) },
    { name: 'workflow_dependencies', execute: ({ runId }, signal) => instance(host).runtime.dependencies(host, runId, signal) },
  ];
}
