import { check as assert, memberId } from './workflow-mechanics.js';
const check = (ok, message) => assert(ok, 'INVALID_WORKFLOW', message);
export function tradingPlan(input = {}) {
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['reviews', 'execute'].includes(key)), 'workflow accepts reviews and execute.');
  const execute = input.execute === undefined ? true : input.execute;
  check(typeof execute === 'boolean', 'workflow.execute must be boolean.');
  const configuredReviews = input.reviews === undefined ? [] : input.reviews;
  check(Array.isArray(configuredReviews) && configuredReviews.length <= 12, 'Use at most 12 reviews.');
  const seen = new Set(['manager', 'executor']);
  const reviews = configuredReviews.map(member => {
    check(member && typeof member === 'object' && Object.keys(member).every(key => ['id','title','instructions'].includes(key)), 'Review requires id, optional title and instructions.');
    check(memberId(member.id) && !seen.has(member.id), 'Review ids must be unique and cannot use reserved manager/executor identities or inherited dictionary names.');
    seen.add(member.id);
    const title = member.title ?? member.id, instructions = member.instructions ?? '';
    check(typeof title === 'string' && title.trim() && title.length <= 120, 'Review title requires 1..120 characters.');
    check(typeof instructions === 'string' && instructions.length <= 6000, 'Review instructions exceed 6000 characters.');
    return { id: member.id, title, instructions };
  });
  return { reviews, execute };
}
