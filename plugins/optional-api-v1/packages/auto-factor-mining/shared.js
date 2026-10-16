import { createHash } from 'node:crypto';
import { resolveResearch, resolveEvaluator, taskPlugins } from './composition.js';

export const ID = 'sesame/auto-factor-mining';
export const ROLES = ['supervisor', 'researcher', 'coder', 'reviewer', 'reflector'];
export const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'exhausted']);
export const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  return value;
}
export const digest = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
export function check(ok, code, message) { if (!ok) throw Object.assign(new Error(message), { code }); }
export const errorInfo = error => ({ code: error?.code ?? 'MINING_FAILED', message: String(error?.message ?? error).slice(0, 1000) });
export function text(value, name, max = 4000) {
  check(typeof value === 'string' && value.trim() && value.length <= max, 'INVALID_ARGUMENT', `${name} requires 1..${max} characters`);
  return value.trim();
}
export function integer(value, min, max, name) {
  check(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_ARGUMENT', `${name} requires ${min}..${max}`); return value;
}
export function configuredModel(host, choice) {
  check(choice?.provider && choice?.id, 'MODEL_REQUIRED', 'Choose a configured provider/id using auto_factor_models');
  const found = host.context.models.find(m => m.provider === choice.provider && m.id === choice.id);
  check(found, 'MODEL_UNAVAILABLE', `Model unavailable: ${choice.provider}/${choice.id}`);
  check(!choice.configurationDigest || choice.configurationDigest === found.configurationDigest, 'MODEL_CHANGED', 'Model configuration changed; select the current descriptor');
  return structuredClone(found);
}
export function configuration(host, input) {
  check(input && typeof input === 'object', 'INVALID_ARGUMENT', 'config is required');
  const model = configuredModel(host, input.model), agentModels = {};
  for (const [role, value] of Object.entries(input.agentModels ?? {})) {
    check(ROLES.includes(role), 'INVALID_ARGUMENT', `Unknown role: ${role}`); agentModels[role] = configuredModel(host, value);
  }
  const directions = input.directions ?? ['动量与反转', '波动与风险', '量价与流动性'];
  check(Array.isArray(directions) && directions.length >= 1 && directions.length <= 6 && new Set(directions).size === directions.length, 'INVALID_ARGUMENT', 'Use 1..6 distinct research directions');
  directions.forEach(d => text(d, 'direction', 100));
  const research = resolveResearch(host, input.research), evaluator = resolveEvaluator(host, input.evaluator);
  taskPlugins(evaluator, research);
  return {
    model, agentModels, directions, research, evaluator,
    rounds: integer(input.rounds ?? 3, 1, 10, 'rounds'), maxTrials: integer(input.maxTrials ?? 12, 1, 40, 'maxTrials'),
    parallelism: integer(input.parallelism ?? 3, 1, 3, 'parallelism'), maxTasks: integer(input.maxTasks ?? 80, 4, 200, 'maxTasks'),
    taskTimeoutMs: integer(input.taskTimeoutMs ?? 600000, 30000, 1800000, 'taskTimeoutMs'),
    reportFolder: '自动因子挖掘',
  };
}
