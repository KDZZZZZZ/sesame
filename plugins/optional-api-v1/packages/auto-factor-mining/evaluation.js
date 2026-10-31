import { check, digest } from './shared.js';
import { invokeValue } from '@sesame/plugin-sdk/capabilities';
export const EVALUATION_PROTOCOL = 'sesame.factor-evaluator/v1';

/** Evaluation is invoked by an active native workflow or role capability. */
export async function callEvaluator(host, selected, request, signal) {
  const value = await invokeValue(host, `${selected.plugin_id}#${selected.tool}`, { protocol: EVALUATION_PROTOCOL, ...request }, { signal });
  check(value && typeof value === 'object' && value.protocol === EVALUATION_PROTOCOL && value.action === request.action && value.runId === request.run_id &&
    (!request.session_id || value.sessionId === request.session_id), 'EVALUATOR_PROTOCOL', 'Evaluator returned an incompatible or unrelated receipt');
  const { receiptDigest, ...body } = value;
  check(receiptDigest === digest(body), 'EVALUATOR_PROTOCOL', 'Evaluator receipt digest differs');
  const limit = ['prepare', 'finalize'].includes(request.action) ? 5 * 1024 * 1024 : request.action === 'select' ? 512 * 1024 : 64 * 1024;
  check(Buffer.byteLength(JSON.stringify(value)) <= limit, 'EVALUATOR_PROTOCOL', `Evaluator receipt exceeds ${limit} bytes`);
  return structuredClone(value);
}
