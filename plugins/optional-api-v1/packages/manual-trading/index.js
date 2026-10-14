import { createAgentTools } from './agent-tools.js';
import { TradingRuntime } from './runtime.js';
import { TradingActivityViewer } from './viewer.js';
import { JudgmentService, createJudgmentTools } from './judgment/index.js';
import { instance, setInstance } from './state.js';

export async function activate(host, options = {}) {
  const judgment = new JudgmentService(host).init();
  const runtime = new TradingRuntime(host, options);
  const viewer = new TradingActivityViewer(runtime);
  try { setInstance(host, { runtime, judgment, viewer }); await runtime.start(); }
  catch (error) { await viewer.dispose(); await runtime.dispose(); await judgment.close(); setInstance(host, null); throw error; }
  return { afterTurn: event => judgment.auditTurn(event), async dispose() { await viewer.dispose(); await runtime.dispose(); await judgment.close(); setInstance(host, null); } };
}

export function createTools(host) {
  const judgment = new Proxy({}, { get: (_target, method) => (...args) => instance(host).judgment[method](...args) });
  return [...createAgentTools(host), ...createJudgmentTools(host, { service: judgment })];
}
