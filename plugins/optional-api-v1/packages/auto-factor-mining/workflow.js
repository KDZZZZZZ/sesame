import { check as assert, memberId } from './workflow-mechanics.js';
const defaults = { plan: 'supervisor', hypothesis: 'researcher', code: 'coder', review: 'reviewer', reflection: 'reflector', selection: 'supervisor' };
const optional = new Set(['plan', 'review', 'reflection']);
const check = (ok, message) => assert(ok, 'INVALID_WORKFLOW', message);
export function factorPlan(input = {}) {
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => Object.hasOwn(defaults, key)), 'workflow accepts plan, hypothesis, code, review, reflection and selection.');
  return Object.fromEntries(Object.entries(defaults).map(([step, role]) => {
    const member = input[step] === undefined ? { id: role } : input[step];
    if (member === null) { check(optional.has(step), `${step} cannot be omitted.`); return [step, null]; }
    check(member && typeof member === 'object' && Object.keys(member).every(key => ['id', 'title', 'instructions'].includes(key)), `${step} requires a member.`);
    check(memberId(member.id), `${step} needs a safe member id, excluding inherited dictionary names.`);
    const title = member.title ?? member.id, instructions = member.instructions ?? '';
    check(typeof title === 'string' && title.trim() && title.length <= 120, 'Member title requires 1..120 characters.');
    check(typeof instructions === 'string' && instructions.length <= 6000, 'Member instructions exceed 6000 characters.');
    return [step, { id: member.id, title, instructions }];
  }));
}
export function factorCollaboration(plan) {
  const members = [...new Map(Object.values(plan).filter(Boolean).map(member => [member.id, member])).values()];
  if (members.length < 2) return null;
  const links = [['plan','hypothesis'],['hypothesis','code'],['code','review'],['review','reflection'],['reflection','plan'],['code','selection'],['review','selection']];
  const relationships = new Map();
  for (const [a, b] of links) {
    if (!plan[a] || !plan[b] || plan[a].id === plan[b].id) continue;
    const from = plan[a].id, to = plan[b].id, key = `${from}:${to}`, label = `${a} → ${b}`;
    const previous = relationships.get(key);
    relationships.set(key, { from, to, label: previous ? `${previous.label}; ${label}` : label });
  }
  return { agents: members.map(member => ({ id: member.id, title: member.title })), relationships: [...relationships.values()] };
}
