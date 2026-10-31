// Investment-research's domain contract, copied for independently installed consumers.
import { check, memberId as identifier } from './workflow-mechanics.js';
import { canonical } from '@sesame/plugin-sdk/protocol';
import { artifactRef, checkedArtifact, dataRef, readRows, uniqueRefs, verifyRefs } from './research-artifacts.js';

export const ANALYSTS = ['market', 'fundamentals', 'news', 'sentiment'];
export const REVIEWERS = ['bull', 'bear', 'risk', 'manager'];
export const ROLES = [...ANALYSTS, ...REVIEWERS];
export const TITLES = { market: '市场研究员', fundamentals: '基本面研究员', news: '新闻研究员', sentiment: '情绪研究员', bull: '多头研究员', bear: '空头研究员', risk: '风险审查员', manager: '研究经理' };
export const STAGES = [ANALYSTS, ['bull'], ['bear'], ['risk'], ['manager']];

export function researchPlan(input) {
  const custom = input !== undefined;
  const source = input === undefined ? { stages: STAGES.map(stage => stage.map(id => ({ id, role: id }))), synthesis: 'manager' } : input;
  check(source && typeof source === 'object' && !Array.isArray(source) && Object.keys(source).every(key => ['stages', 'synthesis'].includes(key)), 'INVALID_WORKFLOW', 'workflow accepts stages and synthesis only.');
  check(Array.isArray(source.stages) && source.stages.length > 0 && source.stages.length <= 32, 'INVALID_WORKFLOW', 'Use 1..32 nonempty workflow stages.');
  const members = {}, stages = source.stages.map(stage => {
    check(Array.isArray(stage) && stage.length > 0, 'INVALID_WORKFLOW', 'Every stage must contain members.');
    return stage.map(member => {
      check(member && typeof member === 'object' && Object.keys(member).every(key => ['id', 'role', 'title', 'instructions'].includes(key)), 'INVALID_WORKFLOW', 'A member accepts id, role, title and instructions.');
      check(identifier(member.id) && !Object.hasOwn(members, member.id), 'INVALID_WORKFLOW', 'Member IDs must be safe and unique.');
      const role = member.role ?? member.id;
      check(ROLES.includes(role) || role === 'custom', 'INVALID_WORKFLOW', 'Use a built-in role or custom with instructions.');
      check(member.instructions === undefined || typeof member.instructions === 'string' && member.instructions.length <= 6000, 'INVALID_WORKFLOW', 'Member instructions must be a string of at most 6000 characters.');
      check(role !== 'custom' || member.instructions?.trim(), 'INVALID_WORKFLOW', 'A custom role requires instructions.');
      const title = member.title ?? TITLES[role] ?? member.id;
      check(typeof title === 'string' && title.trim() && title.length <= 120, 'INVALID_WORKFLOW', 'Member title must contain 1..120 characters.');
      members[member.id] = { id: member.id, role, title, instructions: member.instructions ?? '' };
      return member.id;
    });
  });
  check(Object.keys(members).length <= 32, 'INVALID_WORKFLOW', 'Use at most 32 members.');
  check(identifier(source.synthesis) && stages.at(-1).length === 1 && stages.at(-1)[0] === source.synthesis, 'INVALID_WORKFLOW', 'The final stage must contain only the synthesis member.');
  return { custom, stages, members, synthesis: source.synthesis };
}
export const publicPlan = plan => ({ stages: plan.stages.map(stage => stage.map(id => plan.members[id])), synthesis: plan.synthesis });

export const PACKET_TYPE = 'sesame.investment-research.result';
export function validatePacket(packet, manifest) {
  const validText = value => typeof value === 'string' && value.trim().length > 0;
  const refs = value => Array.isArray(value) && value.every(dataRef) && uniqueRefs(value).length === value.length;
  const runRef = value => value && typeof value.id === 'string' && value.id.length > 0;
  check(packet?.type === PACKET_TYPE && packet.schemaVersion === '1.0.0' && packet.status === 'complete'
    && validText(packet.title) && validText(packet.question) && validText(packet.as_of)
    && Array.isArray(packet.subjects) && packet.subjects.length > 0 && packet.subjects.every(validText)
    && validText(packet.summary) && refs(packet.source_refs), 'INVALID_RESEARCH_RESULT', 'Expected a complete sesame.investment-research.result with question, as_of, subjects, summary and fixed source_refs.');
  let plan;
  try { plan = researchPlan(packet.workflow); }
  catch (error) { check(false, 'INVALID_RESEARCH_RESULT', `Invalid research plan: ${error.message}`); }
  const ids = plan.stages.flat();
  check(Array.isArray(packet.members) && packet.members.length === ids.length && packet.members.every((member, index) => member?.role === ids[index]
    && validText(member.markdown) && runRef(member.run_ref) && refs(member.source_refs))
    && new Set(packet.members.map(member => member.run_ref.id)).size === ids.length,
  'INVALID_RESEARCH_RESULT', 'A complete research result must contain every planned member exactly once, in plan order, with original Markdown, RunRef and fixed source_refs.');
  check(packet.summary === packet.members.find(member => member.role === plan.synthesis).markdown, 'INVALID_RESEARCH_RESULT', 'Research summary must equal the designated synthesis member output.');
  const stage = id => plan.stages.findIndex(members => members.includes(id));
  const qa = packet.qa ?? [];
  check(Array.isArray(qa) && qa.every(answer => stage(answer.from) > stage(answer.to) && stage(answer.to) >= 0 && validText(answer.markdown)
    && runRef(answer.run_ref) && runRef(answer.qa_run_ref) && refs(answer.source_refs)), 'INVALID_RESEARCH_RESULT', 'Research QA must retain real preceding-member identities and fixed evidence.');
  const sourceKeys = new Set(packet.source_refs.map(canonical));
  const evidence = packet.evidence_refs ?? [];
  check(refs(evidence) && [...evidence, ...packet.members.flatMap(member => member.source_refs), ...qa.flatMap(answer => answer.source_refs)].every(ref => sourceKeys.has(canonical(ref))),
    'INVALID_RESEARCH_RESULT', 'All original member, question and input evidence must appear in the result source_refs.');
  if (manifest) {
    const dependencies = new Set((manifest.dependencies ?? []).map(canonical));
    check(packet.source_refs.every(ref => dependencies.has(canonical(ref))), 'INVALID_RESEARCH_RESULT', 'Research source_refs must match the exact published artifact dependencies.');
  }
  return packet;
}

export async function readPacket(host, ref, { signal } = {}) {
  const { manifest, metadata } = await checkedArtifact(host, ref);
  check(metadata.producer.id === 'sesame/investment-research', 'INVALID_RESEARCH_RESULT', 'An investment-research result must retain its actual investment-research producer.');
  const rows = await readRows(host, ref, { signal, manifest });
  check(rows.length === 1, 'INVALID_RESEARCH_RESULT', 'Expected exactly one investment-research result row.');
  const packet = validatePacket(rows[0], manifest);
  await verifyRefs(host, packet.source_refs);
  if (packet.report_ref !== undefined) {
    check(artifactRef(packet.report_ref, 'report') && manifest.dependencies.some(value => canonical(value) === canonical(packet.report_ref)), 'INVALID_RESEARCH_RESULT', 'Research report_ref must be an exact pinned dependency.');
    // Data remains reusable independently of its presentation. Delivery uses
    // checkedReport/checkedReportReceipt; reading research does not rerender it.
    await checkedArtifact(host, packet.report_ref, 'report');
  }
  return packet;
}
