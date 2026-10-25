import { check, configuredModel, roleModels, workflowError } from './workflow-mechanics.js';
export { canonicalJSON as canonical, digestJSON as digest, check, configuredModel } from './workflow-mechanics.js';
import { factorPlan } from './workflow.js';
import { resolveResearch, resolveEvaluator, taskPlugins } from './composition.js';

export const ID = 'sesame/auto-factor-mining';
export const ROLES = ['supervisor', 'researcher', 'coder', 'reviewer', 'reflector'];
export const terminal = new Set(['completed', 'cancelled', 'interrupted']);
export const errorInfo = error => workflowError(error, 'MINING_FAILED');
export function text(value, name, max = 4000) {
  check(typeof value === 'string' && value.trim() && value.length <= max, 'INVALID_ARGUMENT', `${name} requires 1..${max} characters`);
  return value.trim();
}
export function integer(value, min, max, name) {
  check(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_ARGUMENT', `${name} requires ${min}..${max}`); return value;
}
export function configuration(host, input) {
  check(input && typeof input === 'object', 'INVALID_ARGUMENT', 'config is required');
  const workflow = input.workflow === undefined ? undefined : factorPlan(input.workflow);
  const roles = new Set([...ROLES, ...Object.values(workflow ?? {}).filter(Boolean).map(member => member.id)]);
  const { model, agentModels } = roleModels(host, input.model, input.agentModels, [...roles]);
  const directions = input.directions ?? ['动量与反转', '波动与风险', '量价与流动性'];
  check(Array.isArray(directions) && directions.length >= 1 && directions.length <= 6 && new Set(directions).size === directions.length, 'INVALID_ARGUMENT', 'Use 1..6 distinct research directions');
  directions.forEach(d => text(d, 'direction', 100));
  const research = resolveResearch(host, input.research), evaluator = resolveEvaluator(host, input.evaluator);
  taskPlugins(evaluator, research);
  return {
    model, agentModels, directions, research, evaluator, ...(workflow ? { workflow } : {}),
    rounds: integer(input.rounds ?? 3, 1, 10, 'rounds'), maxTrials: integer(input.maxTrials ?? 12, 1, 40, 'maxTrials'),
    parallelism: integer(input.parallelism ?? 3, 1, 3, 'parallelism'),
    reportFolder: '自动因子挖掘',
  };
}
