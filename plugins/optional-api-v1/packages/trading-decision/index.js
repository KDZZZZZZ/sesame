import { createAgentCapabilities } from './agent-tools.js';
import { TradingRuntime } from './runtime.js';
import { instance, setInstance } from './state.js';
import { closeRecords } from './records.js';

export function createCapabilities(host) {
  return [
    ...createAgentCapabilities(host),
    { name: 'activate', execute: async () => {
      const runtime = new TradingRuntime(host);
      try { setInstance(host, { runtime }); await runtime.start(); return { ready: true }; }
      catch (error) { await runtime.dispose(); closeRecords(host); setInstance(host, null); throw error; }
    } },
    { name: 'dispose', execute: async () => { await instance(host).runtime.dispose(host); closeRecords(host); setInstance(host, null); return {}; } },
    { name: 'trading_decision_workflow_execute', execute: ({ runId }, signal, context) => instance(host).runtime.execute(host, runId, signal, context) },
    { name: 'trading_decision_workflow_dependencies', execute: ({ runId }, signal) => instance(host).runtime.dependencies(host, runId, signal) },
  ];
}
