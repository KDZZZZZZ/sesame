import test from 'node:test';
import assert from 'node:assert/strict';
import { validateKnowledgeBasis, renderKnowledgeBasis } from '../packages/reports/report-knowledge.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const en = { escape, tr: (_, english) => english };
const zh = { escape, tr: chinese => chinese };
const basis = (agreement = 'insufficient') => ({
  mechanism: 'A supplied research hypothesis; geometric location does not establish direction.',
  expected_observation: 'Compare the supplied touching and non-touching outcomes over the same horizon.',
  agreement,
  interpretation: 'No comparable historical outcome has been supplied.',
});

test('knowledge is optional and never requires invented theory references', () => {
  assert.doesNotThrow(() => validateKnowledgeBasis(undefined));
  assert.equal(renderKnowledgeBasis(undefined, en), '');
  assert.doesNotThrow(() => validateKnowledgeBasis(basis()));
  assert.doesNotThrow(() => validateKnowledgeBasis({ ...basis(), theory_refs: [], assumptions: [] }));
  const html = renderKnowledgeBasis(basis(), en);
  assert.match(html, /Insufficient historical evidence for comparison/);
  assert.doesNotMatch(html, /Knowledge sources|<dt>Assumptions/);
});

test('provided knowledge needs a meaningful expectation, mechanism and interpretation', () => {
  for (const invalid of [null, false, 'theory', [], {}, { agreement: 'supporting' }]) {
    assert.throws(() => validateKnowledgeBasis(invalid, 'M02/claim-1'), /M02\/claim-1: knowledge_basis/);
  }
  for (const key of ['mechanism', 'expected_observation', 'interpretation']) {
    for (const invalid of [undefined, '', ' \n ', 0, {}, 'a'.repeat(20001)]) {
      assert.throws(() => validateKnowledgeBasis({ ...basis(), [key]: invalid }), new RegExp(`knowledge_basis\\.${key}`));
    }
  }
  assert.throws(() => validateKnowledgeBasis({ ...basis(), agreement: 'confirmed' }), /knowledge_basis.agreement/);
  assert.throws(() => validateKnowledgeBasis({ ...basis(), confidence: 0.9 }), /declared fields/);
});

test('optional knowledge sources and assumptions preserve supplied lists without coercion', () => {
  const value = { ...basis(), theory_refs: ['Author supplied chapter and version', 'method/hypothesis@2'], assumptions: ['Closed bars only', 'One observation horizon'] };
  assert.doesNotThrow(() => validateKnowledgeBasis(value));
  const html = renderKnowledgeBasis(value, en);
  for (const text of [...value.theory_refs, ...value.assumptions]) assert.ok(html.includes(text));
  for (const key of ['theory_refs', 'assumptions']) {
    for (const invalid of [null, 'citation', {}, [''], ['  '], [1], [{ id: 'source' }], Array(33).fill('item')]) {
      assert.throws(() => validateKnowledgeBasis({ ...basis(), [key]: invalid }), new RegExp(`knowledge_basis\\.${key}`));
    }
    assert.doesNotThrow(() => validateKnowledgeBasis({ ...basis(), [key]: Array(32).fill('supplied text') }));
  }
});

test('all comparison states are rendered as supplied with no confidence calculation', () => {
  const labels = {
    supporting: 'Historical results support the expectation',
    conflicting: 'Historical results conflict with the expectation',
    mixed: 'Historical results show both support and conflict',
    insufficient: 'Insufficient historical evidence for comparison',
  };
  for (const [agreement, label] of Object.entries(labels)) {
    const value = Object.freeze({ ...basis(agreement), theory_refs: Object.freeze(['supplied/source@1']), assumptions: Object.freeze(['Supplied assumption']) });
    const before = structuredClone(value);
    assert.doesNotThrow(() => validateKnowledgeBasis(value));
    const html = renderKnowledgeBasis(value, en);
    assert.ok(html.includes(label));
    assert.ok(html.includes(value.interpretation), 'The renderer must not resolve contradictory supplied prose itself');
    assert.deepEqual(value, before);
    assert.doesNotMatch(html, /confidence|[0-9]%|probability|validated|fetch\(/i);
  }
  assert.match(renderKnowledgeBasis(basis('mixed'), zh), /历史统计支持与冲突并存/);
  assert.match(renderKnowledgeBasis(basis('conflicting'), zh), /历史统计与预期冲突/);
});

test('knowledge prose, citations and translated labels cannot inject active markup', () => {
  const attack = '</p><script>alert(1)</script><img src=x onerror=alert(1)>\"\'&';
  const value = { mechanism: attack, expected_observation: attack, interpretation: attack, theory_refs: [attack, 'javascript:alert(1)'], assumptions: [attack], agreement: 'supporting' };
  const html = renderKnowledgeBasis(value, en);
  assert.doesNotMatch(html, /<script|<img|href=/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;&#39;&amp;/);
  assert.ok(html.includes('javascript:alert(1)'), 'Citation text must remain text, not become a link');
  assert.doesNotMatch(renderKnowledgeBasis(basis(), { escape, tr: () => attack }), /<script|<img/);
});
