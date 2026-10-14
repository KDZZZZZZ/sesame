import { JudgmentService } from './service.js';
import { setInstance } from './state.js';
export { createTools } from './tools.js';
export { createJudgmentTools, definitions } from './tools.js';
export { JudgmentService, JUDGMENT_PLUGIN, JUDGMENT_POLICY } from './service.js';

export async function activate(host, options = {}) {
  const service = new JudgmentService(host, options).init(); setInstance(host, service);
  return { service, afterTurn: event => service.auditTurn(event), dispose: async () => { await service.close(); setInstance(host, null); } };
}
export const activateJudgment = activate;
