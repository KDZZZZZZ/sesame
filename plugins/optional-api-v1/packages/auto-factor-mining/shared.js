import { check, configuredModel, roleModels, workflowError } from './workflow-mechanics.js';
export { canonicalJSON as canonical, digestJSON as digest, check, configuredModel } from './workflow-mechanics.js';
import { factorPlan, singleFactorPlan } from './workflow.js';
import { resolveResearch, resolveEvaluator, taskPlugins } from './composition.js';
import { nativePlan } from './native-plan.js';

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
  const executionMode = input.executionMode ?? 'multi';
  check(['single', 'multi'].includes(executionMode), 'INVALID_ARGUMENT', 'executionMode must be single or multi.');
  const workflow = executionMode === 'single' ? singleFactorPlan(input.workflow) : input.workflow === undefined ? undefined : factorPlan(input.workflow);
  const roles = new Set([...(executionMode === 'single' ? [] : ROLES), ...Object.values(workflow ?? {}).filter(Boolean).map(member => member.id)]);
  const { model, agentModels } = roleModels(host, input.model, input.agentModels, [...roles]);
  const directions = input.directions ?? ['动量与反转', '波动与风险', '量价与流动性'];
  check(Array.isArray(directions) && directions.length >= 1 && directions.length <= 6 && new Set(directions).size === directions.length, 'INVALID_ARGUMENT', 'Use 1..6 distinct research directions');
  directions.forEach(d => text(d, 'direction', 100));
  const research = resolveResearch(host, input.research), evaluator = resolveEvaluator(host, input.evaluator);
  taskPlugins(evaluator, research);
  check(executionMode !== 'single' || input.parallelism === undefined || input.parallelism === 1, 'INVALID_ARGUMENT', 'Single-Agent mode is sequential; parallelism must be 1.');
  let strategyValidation;
  if (input.strategyValidation !== undefined) {
    check(input.strategyValidation && typeof input.strategyValidation === 'object' && !Array.isArray(input.strategyValidation) && Object.keys(input.strategyValidation).every(key => ['intendedPlatform', 'requestedEngine', 'dataSource', 'contract', 'calendarSessions', 'spreadCommissionSwap', 'executionRules', 'granularity', 'notes'].includes(key)), 'INVALID_ARGUMENT', 'strategyValidation accepts explicit platform, engine, data/contract, calendar, cost, execution and granularity declarations.');
    strategyValidation = Object.fromEntries(Object.entries(input.strategyValidation).map(([key, value]) => [key, text(value, key, 2000)]));
    check(Buffer.byteLength(JSON.stringify(strategyValidation)) <= 12000, 'INVALID_ARGUMENT', 'strategyValidation must fit 12 KiB.');
  }
  return {
    model, agentModels, directions, research, evaluator, ...(workflow ? { workflow } : {}), ...(input.executionMode !== undefined || executionMode === 'single' ? { executionMode } : {}), ...(strategyValidation ? { strategyValidation } : {}),
    ...(input.nativeValidation !== undefined ? { nativeValidation: nativePlan(input.nativeValidation, strategyValidation) } : {}),
    rounds: integer(input.rounds ?? 3, 1, 10, 'rounds'), maxTrials: integer(input.maxTrials ?? 12, 1, 40, 'maxTrials'),
    parallelism: executionMode === 'single' ? 1 : integer(input.parallelism ?? 3, 1, 3, 'parallelism'),
    reportFolder: '自动因子挖掘',
  };
}
