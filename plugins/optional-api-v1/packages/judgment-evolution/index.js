import { JudgmentService } from './service.js';
import { setInstance } from './state.js';
export { createTools } from './tools.js';

export async function activate(host) {
  const service = new JudgmentService(host).init(); setInstance(host, service);
  return { afterTurn: event => service.auditTurn(event), dispose: () => { service.close(); setInstance(host, null); } };
}
