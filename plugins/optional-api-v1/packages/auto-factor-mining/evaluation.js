import { check, digest } from './shared.js';
export const EVALUATION_PROTOCOL = 'sesame.factor-evaluator/v1';

/** Only call from the still-active main/role tool handler, never a service pump. */
export async function callEvaluator(host, selected, request, signal) {
  check(typeof host.tools?.call === 'function', 'HOST_UPGRADE_REQUIRED', 'Independent evaluation requires the current cross-plugin tool invocation API');
  const result = await host.tools.call({ pluginId: selected.plugin_id, name: selected.tool, arguments: { protocol: EVALUATION_PROTOCOL, ...request } }, signal);
  check(!result?.isError && !result?.details?.isError, 'EVALUATOR_FAILED', 'Selected evaluator returned a tool error');
  const value = result && Object.hasOwn(result, 'details') ? result.details : result;
  check(value && typeof value === 'object' && value.protocol === EVALUATION_PROTOCOL && value.action === request.action && value.runId === request.run_id &&
    (!request.session_id || value.sessionId === request.session_id), 'EVALUATOR_PROTOCOL', 'Evaluator returned an incompatible or unrelated receipt');
  const { receiptDigest, ...body } = value;
  check(receiptDigest === digest(body), 'EVALUATOR_PROTOCOL', 'Evaluator receipt digest differs');
  const limit = ['prepare', 'finalize'].includes(request.action) ? 5 * 1024 * 1024 : 64 * 1024;
  check(Buffer.byteLength(JSON.stringify(value)) <= limit, 'EVALUATOR_PROTOCOL', `Evaluator receipt exceeds ${limit} bytes`);
  return structuredClone(value);
}
