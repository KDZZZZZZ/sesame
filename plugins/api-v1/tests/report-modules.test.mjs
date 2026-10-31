import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveStructure, bindResults } from '../packages/reports/report-structure.js';
import { reportCompositionCapabilities, renderComposedReport, assertCompositionBindings } from '../packages/reports/report-compose.js';

const example = JSON.parse(readFileSync(new URL('../packages/reports/examples/module-report-input.json', import.meta.url), 'utf8'));
const ref = (id = 'results', kind = 'data') => ({ id, kind, revision: 'r1', digest: `sha256:${'a'.repeat(64)}`, schemaVersion: '1.0.0' });
const custom = () => structuredClone(example.custom_structure);
const fixture = (rows = example.rows, provenance = 'demo', evidenceProvenance = 'derived') => {
  const writes = [], reads = [];
  const host = {
    resources: { read: async (value, options) => {
      reads.push({ ref: value, options });
      if (options.part === 'manifest') return { content: { format: 'json-rows', path: 'rows.json', provenance: { kind: value.id === 'results' ? provenance : evidenceProvenance } } };
      const bytes = Buffer.from(JSON.stringify(rows));
      const chunk = bytes.subarray(options.offset, options.offset + options.length);
      return { content: chunk.toString('base64'), total: bytes.length, ...(options.offset + chunk.length < bytes.length ? { nextOffset: options.offset + chunk.length } : {}) };
    } },
    capabilities: { invoke: async (id, args) => { assert.equal(id, 'sesame/workspace#write', 'No research or model capability may run'); writes.push(args); return { type: 'result', value: { path: args.path } }; } },
  };
  return { writes, reads, host, compose: reportCompositionCapabilities(host).find(cap => cap.name === 'report_compose').execute };
};
const composeInput = structure => ({ title: '字段演示', output_path: 'report.html', structure, results_ref: ref() });

test('catalog resolves all 19 modules and 11 compositions without mandatory business fields or methods', () => {
  const catalog = resolveStructure();
  assert.equal(catalog.modules.length, 19); assert.equal(catalog.compositions.length, 11);
  for (const item of [...catalog.modules, ...catalog.compositions]) {
    const resolved = resolveStructure({ template_id: item.id });
    for (const section of resolved.sections) {
      assert.deepEqual(section.method_refs, []);
      assert.ok(section.fields.every(field => !field.required && field.meaning && field.label));
    }
  }
  assert.equal(resolveStructure({ template_id: 'M02', locale: 'en' }).sections[0].title, 'Technical events and scenarios');
});

test('user section and field arrays replace defaults, preserve order, and leave the catalog unchanged', () => {
  const before = resolveStructure({ template_id: 'R02' });
  const resolved = resolveStructure(custom());
  assert.deepEqual(resolved.sections.map(section => section.id), ['M02']);
  assert.deepEqual(resolved.sections[0].fields.map(field => field.key), ['scenarios', 'key_levels', 'counterevidence']);
  const bound = bindResults(resolved, example.rows);
  assert.equal(bound.completeness.status, 'complete'); assert.equal(bound.completeness.provided, 3);
  assert.deepEqual(bound.completeness.missing, []);
  assert.equal(bound.completeness.ignored, example.rows.length - 3);
  assert.deepEqual(resolveStructure({ template_id: 'R02' }), before);
  assert.deepEqual(resolveStructure({ template_id: 'R02', sections: [] }).sections, []);
});

test('fully custom and repeated modules can carry different methods and targets', () => {
  const result = resolveStructure({ sections: [
    { id: 'week', module_id: 'M02', fields: [], context: { horizon: 'next week' } },
    { id: 'month', module_id: 'M02', fields: ['summary'], method_refs: ['user/method@3'] },
    { id: 'custom', title: '自定义', fields: [{ key: 'observation', label: '观察', type: 'text', meaning: '用户指定字段' }] },
  ] });
  assert.deepEqual(result.sections.map(section => section.id), ['week', 'month', 'custom']);
  assert.deepEqual(result.sections[0].fields, []);
});

test('invalid structures reject ambiguous IDs and undeclared fields instead of restoring defaults', () => {
  for (const value of [
    { template_id: 'unknown' },
    { template_id: 'M02', sections: [{ module_id: 'M02', fields: ['made_up'] }] },
    { sections: [{ id: '__proto__', title: 'bad', fields: [] }] },
    { sections: [{ module_id: 'M02' }, { module_id: 'M02' }] },
    { sections: [{ module_id: 'M02', fields: ['summary', 'summary'] }] },
    { sections: [{ id: 'custom', title: 'bad', fields: [{ key: 'missing_meaning', type: 'text', label: 'Bad' }] }] },
    { template_id: 'M02', silently_select_method: 'default' },
  ]) assert.throws(() => resolveStructure(value));
});

test('required gaps produce partial completeness; deleted defaults and qualitative-only results do not', () => {
  const structure = resolveStructure({ sections: [{ module_id: 'M02', fields: ['summary', { key: 'key_levels', required: true }] }] });
  const rows = [{ section_id: 'M02', field: 'summary', value: '仅提供定性判断' }];
  const result = bindResults(structure, rows);
  assert.equal(result.completeness.status, 'partial');
  assert.deepEqual(result.completeness.missing.map(item => item.field), ['key_levels']);
  assert.equal(result.researchValidation, 'not_evaluated');
  const qualitative = resolveStructure({ sections: [{ module_id: 'M02', fields: ['summary'] }] });
  assert.equal(bindResults(qualitative, rows).completeness.status, 'complete');
  assert.equal(bindResults(qualitative, []).completeness.status, 'empty');
});

test('selected methods, target contexts, duplicates and incompatible values fail before writing', async () => {
  const structure = custom();
  structure.sections[0].context = { subject: 'DEMO', horizon: 'next week' };
  for (const rows of [
    [{ section_id: 'M02', field: 'scenarios', value: [], method_ref: 'wrong/method' }],
    [{ section_id: 'M02', field: 'scenarios', value: [], method_ref: 'demo/price-action@1', context: { subject: 'DEMO', horizon: 'next month' } }],
    [{ section_id: 'M02', field: 'scenarios', value: 'not an array', method_ref: 'demo/price-action@1' }],
  ]) {
    const { compose, writes } = fixture(rows);
    await assert.rejects(compose(composeInput(structure))); assert.equal(writes.length, 0);
  }
  const duplicate = [example.rows.find(row => row.field === 'key_levels'), example.rows.find(row => row.field === 'key_levels')];
  assert.throws(() => bindResults(resolveStructure(custom()), duplicate), /Duplicate result/);
});

test('typed probabilities cannot manufacture verification or use an incomplete distribution as a complete one', () => {
  const structure = resolveStructure({ sections: [{ module_id: 'M14', fields: ['probabilities'] }] });
  const row = structuredClone(example.rows.find(row => row.field === 'probabilities'));
  for (const value of [-0.1, 1.1]) {
    const invalid = structuredClone(row); invalid.value.items[0].probability = value;
    assert.throws(() => bindResults(structure, [invalid]), /distribution/);
  }
  const incomplete = structuredClone(row); incomplete.value.items.pop();
  assert.throws(() => bindResults(structure, [incomplete]), /distribution/);
  incomplete.value.exhaustive = false;
  assert.equal(bindResults(structure, [incomplete]).completeness.status, 'complete');
  const unsupported = structuredClone(row); unsupported.validation.status = 'out_of_sample';
  assert.throws(() => bindResults(structure, [unsupported]), /historical result references/);
  delete unsupported.validation;
  assert.throws(() => bindResults(structure, [unsupported]), /explicit validation state/);
  const verified = structuredClone(row); verified.validation = { status: 'out_of_sample', history_refs: [ref('history')] };
  const before = structuredClone(verified), result = bindResults(structure, [verified]);
  assert.deepEqual(verified, before, 'Binding must not mutate source evidence');
  assert.equal(result.researchValidation, 'not_evaluated');
  assert.deepEqual(result.evidence_refs, [ref('history')]);
});

test('declared interval and probability semantics are checked without selecting an estimator', () => {
  const structure = resolveStructure({ sections: [{ id: 'custom', title: 'Custom', fields: [
    { key: 'range', label: 'Range', type: 'interval', meaning: 'Supplied interval' },
    { key: 'p', label: 'Probability', type: 'probability', meaning: 'Supplied event probability' },
  ] }] });
  assert.throws(() => bindResults(structure, [{ section_id: 'custom', field: 'range', value: { lower: 9, upper: 1, meaning: 'forecast range' } }]), /interval/);
  assert.throws(() => bindResults(structure, [{ section_id: 'custom', field: 'p', value: 50 }]), /probability/);
});

test('unavailable results retain reasons and never substitute 50% or neutral values', () => {
  const structure = resolveStructure({ sections: [{ module_id: 'M14', fields: [{ key: 'probabilities', required: true }] }] });
  const row = { section_id: 'M14', field: 'probabilities', status: 'unavailable', reason: '方法没有提供数值预测' };
  assert.equal(bindResults(structure, [row]).completeness.missing[0].reason, row.reason);
  assert.throws(() => bindResults(structure, [{ ...row, value: 0.5 }]), /cannot carry a value/);
  assert.throws(() => bindResults(structure, [{ ...row, reason: '' }]), /require a reason/);
});

test('reading path omits internal validation badges while preserving evidence and useful notes', () => {
  const structure = resolveStructure({ sections: [{ module_id: 'M13', fields: ['summary'] }] });
  const row = { section_id: 'M13', field: 'summary', value: '20次相似情况里有11次上涨。', validation: { status: 'historical_exploration', history_refs: [ref('history')] } };
  const render = value => renderComposedReport({ title: '历史比较', structure, bound: bindResults(structure, [value]), data: [], references: [ref('history')], demo: false });
  const html = render(row), mainReading = html.split('<details class="kit-appendix module-sources">')[0];
  assert.match(mainReading, /20次相似情况里有11次上涨/);
  assert.doesNotMatch(mainReading, /<p class="module-validation">/);
  assert.match(html, /&quot;status&quot;: &quot;historical_exploration&quot;/);
  assert.match(html, /&quot;history_refs&quot;/);
  const withNote = render({ ...row, validation: { ...row.validation, note: '这里只比较已有记录，不能当成今天的概率。' } });
  assert.match(withNote, /<p class="module-validation">这里只比较已有记录，不能当成今天的概率。<\/p>/);
  assert.doesNotMatch(withNote.split('<details class="kit-appendix module-sources">')[0], /历史样本统计/);
  assert.deepEqual(row.validation, { status: 'historical_exploration', history_refs: [ref('history')] }, 'Presentation must not alter supplied evidence');
});

test('composition reads fixed outputs, preserves precision and user structure, and returns publish bindings', async () => {
  const { compose, writes, reads } = fixture();
  const result = await compose(composeInput(custom()));
  const html = writes[0].content;
  assert.equal(result.completeness.provided, 3);
  assert.equal(result.renderStatus, 'not_checked'); assert.equal(result.researchValidation, 'not_evaluated');
  assert.match(html, /100\.00–101\.00/); assert.match(html, /data-sesame-report-template="report\/1"/);
  assert.match(html, /演示样本/); assert.doesNotMatch(html, /<h2>新闻|<h3>结果概率/);
  assert.ok(html.indexOf('<h3>条件情景') < html.indexOf('<h3>关键位置'));
  assert.deepEqual(result.publish.data[0].ref, ref()); assert.equal(result.publish.provenance_kind, 'demo');
  assert.ok(reads.every(read => read.ref.id === 'results'));
  assertCompositionBindings(html, result.publish.data, result.publish.references, 'demo');
  assert.throws(() => assertCompositionBindings(html, [], [], 'demo'), /original fixed data/);
  assert.throws(() => assertCompositionBindings(html, [{ ...result.publish.data[0], ref: ref('other') }], [], 'demo'), /original fixed data/);
  assert.throws(() => assertCompositionBindings(html, result.publish.data, [], 'derived'), /demo provenance/);
});

test('history references are verified, bound for publication and retain demo provenance', async () => {
  const row = structuredClone(example.rows.find(row => row.field === 'probabilities'));
  row.validation = { status: 'out_of_sample', history_refs: [ref('history')] };
  const f = fixture([row], 'derived', 'demo');
  const result = await f.compose(composeInput({ template_id: 'M14', sections: [{ module_id: 'M14', fields: ['probabilities'] }] }));
  assert.ok(f.reads.some(read => read.ref.id === 'history'));
  assert.deepEqual(result.publish.references, [ref('history')]); assert.equal(result.publish.provenance_kind, 'demo');
  assert.throws(() => assertCompositionBindings(f.writes[0].content, result.publish.data, [], 'demo'), /missing a fixed evidence/);
  const unavailable = fixture([row]);
  const read = unavailable.host.resources.read;
  unavailable.host.resources.read = async (ref, options) => ref.id === 'history' && options.part === 'manifest' ? { content: { provenance: { available_for_analysis: false } } } : read(ref, options);
  await assert.rejects(unavailable.compose(composeInput({ sections: [{ module_id: 'M14', fields: ['probabilities'] }] })), /not available for analysis/);
  assert.equal(unavailable.writes.length, 0);
});

test('source paging, missing resources and cancellation cannot produce a false completed report', async () => {
  const rows = [{ section_id: 'M02', field: 'summary', value: '长'.repeat(100000) }];
  const f = fixture(rows);
  await f.compose(composeInput({ template_id: 'M02', sections: [{ module_id: 'M02', fields: ['summary'] }] }));
  assert.ok(f.reads.filter(read => read.options.part === 'content').length > 1);
  const cancelled = fixture();
  await assert.rejects(cancelled.compose(composeInput(custom()), AbortSignal.abort(new Error('cancelled'))), /cancelled/);
  assert.equal(cancelled.writes.length, 0); assert.equal(cancelled.reads.length, 0);
  const broken = fixture(); broken.host.resources.read = async () => { throw new Error('missing source'); };
  await assert.rejects(broken.compose(composeInput(custom())), /missing source/); assert.equal(broken.writes.length, 0);
});

test('prose, labels, objects and embedded bindings cannot inject executable markup', () => {
  const attack = '</script><img src=x onerror=alert(1)>{{BODY}}';
  const structure = resolveStructure({ sections: [{ id: 'safe', title: attack, fields: [{ key: 'value', label: attack, meaning: 'User field', type: 'object' }] }] });
  const bound = bindResults(structure, [{ section_id: 'safe', field: 'value', value: { note: attack } }]);
  const html = renderComposedReport({ title: attack, summary: attack, structure, bound, data: [{ id: 'research-results', ref: ref() }], references: [], demo: false });
  assert.doesNotMatch(html, /<img src=x/); assert.match(html, /&lt;img/); assert.match(html, /\\u003c\/script>/);
  assert.equal((html.match(/id="sesame-composition-bindings"/g) ?? []).length, 1);
  assert.match(html, /\{\{BODY\}\}/, 'Authored template-like text is not recursively expanded');
});

test('hidden fields retain source state and removed fields never get validated or re-added', () => {
  const row = structuredClone(example.rows.find(row => row.field === 'probabilities'));
  const structure = resolveStructure({ sections: [{ module_id: 'M14', fields: [{ key: 'probabilities', display: 'hidden' }] }] });
  const bound = bindResults(structure, [row]);
  const html = renderComposedReport({ title: '演示', structure, bound, data: [], references: [], demo: true });
  assert.doesNotMatch(html, /<th>概率/); assert.match(html, /unvalidated/);
  const removed = resolveStructure({ sections: [{ module_id: 'M14', fields: [] }] });
  const result = bindResults(removed, [{ ...row, value: 'ignored incompatible result' }]);
  assert.equal(result.completeness.ignored, 1); assert.deepEqual(result.completeness.missing, []);
});
