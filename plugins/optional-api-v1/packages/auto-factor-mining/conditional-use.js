import { check } from './workflow-mechanics.js';

const keys = ['valid_when', 'invalid_when', 'evidence', 'limitations', 'monitor', 'stop_when', 'counterexamples'];
export function applicability(value, required = false) {
  if (value === undefined) { check(!required, 'INVALID_OUTPUT', 'Conditional acceptance requires explicit applicability and limitations'); return undefined; }
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.keys(value).every(key => keys.includes(key)), 'INVALID_OUTPUT', 'applicability accepts valid_when, invalid_when, evidence, limitations, monitor, stop_when, counterexamples');
  for (const list of Object.values(value)) check(Array.isArray(list) && list.length <= 12 && list.every(item => typeof item === 'string' && item.trim() && item.length <= 1500), 'INVALID_OUTPUT', 'Applicability values are bounded lists of concrete statements or evidence identifiers');
  check(!required || ['valid_when', 'invalid_when', 'evidence', 'limitations', 'monitor', 'stop_when'].every(key => value[key]?.length), 'INVALID_OUTPUT', 'Conditional use needs supported valid/invalid scenarios, limits, monitoring and stop conditions; retain actual counterexamples when available');
  return structuredClone(value);
}
