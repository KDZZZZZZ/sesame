import { ANALYSTS, COLLABORATION } from './team.js';
export { researchPlan, publicPlan } from './investment-research-contract.js';

export function workflowCollaboration(plan) {
  if (!plan.custom) return COLLABORATION;
  const agents = plan.stages.flat().map(id => ({ id, title: plan.members[id].title, role: plan.members[id].role }));
  if (agents.length < 2) return null;
  const relationships = plan.stages.slice(1).flatMap((stage, index) => plan.stages[index].flatMap(from => stage.map(to => ({ from, to, label: '固定研究成果交接' }))));
  return { agents, relationships };
}
export function questionMembers(plan, id) {
  if (!plan.custom) return ANALYSTS;
  const index = plan.stages.findIndex(stage => stage.includes(id));
  return plan.stages.slice(0, index).flat();
}
