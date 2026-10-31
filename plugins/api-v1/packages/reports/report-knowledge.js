// Supplied explanations only. Knowledge selection, historical comparison and
// confidence estimation belong to the research method, never to this renderer.
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 20000;
const agreements = new Set(['supporting', 'conflicting', 'mixed', 'insufficient']);
const keys = new Set(['theory_refs', 'mechanism', 'assumptions', 'expected_observation', 'agreement', 'interpretation']);

/** An omitted explanation is valid; a supplied one must state a testable expectation. */
export function validateKnowledgeBasis(value, name = 'Knowledge basis') {
  if (value === undefined) return;
  assert(object(value) && Object.keys(value).every(key => keys.has(key)), `${name}: knowledge_basis must be an object with declared fields`);
  for (const key of ['mechanism', 'expected_observation', 'interpretation']) {
    assert(text(value[key]), `${name}: knowledge_basis.${key} must be nonempty text`);
  }
  assert(agreements.has(value.agreement), `${name}: knowledge_basis.agreement must be supporting, conflicting, mixed or insufficient`);
  for (const key of ['theory_refs', 'assumptions']) {
    assert(value[key] === undefined || Array.isArray(value[key]) && value[key].length <= 32 && value[key].every(text), `${name}: knowledge_basis.${key} must contain at most 32 nonempty texts`);
  }
}

/** Project the supplied comparison verbatim; do not infer agreement or confidence. */
export function renderKnowledgeBasis(value, { escape, tr }) {
  if (value === undefined) return '';
  validateKnowledgeBasis(value);
  const label = (zh, en) => escape(tr(zh, en));
  const agreementLabels = {
    supporting: ['历史统计支持预期', 'Historical results support the expectation'],
    conflicting: ['历史统计与预期冲突', 'Historical results conflict with the expectation'],
    mixed: ['历史统计支持与冲突并存', 'Historical results show both support and conflict'],
    insufficient: ['历史依据不足以对照', 'Insufficient historical evidence for comparison'],
  };
  const item = (zh, en, content) => `<dt>${label(zh, en)}</dt><dd>${content}</dd>`;
  const list = values => `<ul class="module-list">${values.map(entry => `<li>${escape(entry)}</li>`).join('')}</ul>`;
  const details = [
    item('作用机制', 'Mechanism', escape(value.mechanism)),
    ...(value.assumptions?.length ? [item('成立条件', 'Assumptions', list(value.assumptions))] : []),
    item('预期观察', 'Expected observation', escape(value.expected_observation)),
    ...(value.theory_refs?.length ? [item('知识来源', 'Knowledge sources', list(value.theory_refs))] : []),
  ].join('');
  return `<aside class="module-history module-knowledge"><p><strong>${label('知识依据与历史对照', 'Knowledge and historical comparison')}</strong> · ${label(...agreementLabels[value.agreement])}</p><p>${escape(value.interpretation)}</p><details><summary>${label('机制、条件与预期', 'Mechanism, assumptions and expectation')}</summary><dl class="module-values">${details}</dl></details></aside>`;
}
