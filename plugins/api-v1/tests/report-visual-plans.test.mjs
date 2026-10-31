import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveStructure, bindResults } from '../packages/reports/report-structure.js';

const root = new URL('../packages/reports/', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const catalog = JSON.parse(read('templates/module-catalog.json'));
const plans = JSON.parse(read('templates/module-visual-plans.json'));
const fields = new Map(catalog.modules.flatMap(module => module.fields.map(field => [`${module.id}.${field.key}`, field])));
const ids = entries => entries.map(entry => entry.id).sort();
const chartChoices = plan => [...plan.primary_charts, ...plan.supporting_charts, ...(plan.excluded_by_default_charts ?? [])];
const referenced = plan => [...chartChoices(plan).map(item => item.field), ...plan.key_cards.flatMap(card => card.fields), ...plan.details];

test('every catalog module and composition has a distinct, complete and bounded visual plan', () => {
  assert.deepEqual(ids(plans.modules), ids(catalog.modules));
  assert.deepEqual(ids(plans.compositions), ids(catalog.compositions));
  assert.equal(plans.modules.length, 19);
  assert.equal(plans.compositions.length, 11);
  const all = [...plans.modules, ...plans.compositions];
  assert.equal(new Set(all.map(plan => plan.reading_question)).size, all.length);
  for (const plan of all) {
    for (const key of ['reading_question', 'layout']) assert.ok(plan[key]?.trim(), `${plan.id}.${key}`);
    for (const key of ['primary_charts', 'supporting_charts', 'key_cards', 'details', 'interactions', 'no_chart']) assert.ok(Array.isArray(plan[key]), `${plan.id}.${key}`);
    for (const key of ['primary_charts', 'key_cards', 'details', 'interactions', 'no_chart']) assert.ok(plan[key].length, `${plan.id}.${key} needs an actual recommendation`);
    for (const card of plan.key_cards) assert.ok(card.fields.length && card.kind && card.rule, `${plan.id}: card needs existing fields and a meaning`);
  }
  for (const path of ['templates/module-visual-plans.json', 'skills/report-design/module-layouts.md']) assert.ok(Buffer.byteLength(read(path)) <= 128 * 1024, path);
  assert.ok(readFileSync(new URL(import.meta.url)).byteLength <= 128 * 1024);
});

test('visual recommendations only reference actual catalog fields of the selected modules', () => {
  for (const plan of [...plans.modules, ...plans.compositions]) {
    const composition = catalog.compositions.find(item => item.id === plan.id);
    const owners = new Set(composition ? [...composition.modules, ...composition.optional_modules] : [plan.id]);
    for (const ref of referenced(plan)) {
      assert.ok(fields.has(ref), `${plan.id}: unknown field ${ref}`);
      assert.ok(owners.has(ref.split('.')[0]), `${plan.id}: ${ref} is outside the composition`);
    }
    for (const choice of chartChoices(plan)) {
      assert.equal(fields.get(choice.field).type, 'chart', `${plan.id}: ${choice.field} must be a chart`);
      assert.ok(choice.role || choice.reason, `${choice.field}: chart must answer a question or explain its default exclusion`);
    }
  }
});

test('every built-in chart candidate has an explicit role or default exclusion', () => {
  for (const module of catalog.modules) {
    const actual = module.fields.filter(field => field.type === 'chart').map(field => `${module.id}.${field.key}`).sort();
    const choices = chartChoices(plans.modules.find(plan => plan.id === module.id)).map(choice => choice.field).sort();
    assert.deepEqual(choices, actual, `${module.id}: no forgotten or duplicated chart candidates`);
  }
  const technical = plans.modules.find(plan => plan.id === 'M02');
  assert.equal(fields.get('M02.method_comparison_chart').chart.kind, 'lifecycle');
  for (const key of ['method_scan', 'feature_signals']) assert.ok(referenced(technical).includes(`M02.${key}`));
});

test('R02 and R03 keep one final scenario tree and concentrate detailed evidence in M13', () => {
  const summary = plans.modules.find(plan => plan.id === 'M14');
  assert.deepEqual(summary.primary_charts.map(choice => choice.field), ['M14.outlook_chart']);
  assert.deepEqual(summary.supporting_charts, []);
  assert.ok(summary.excluded_by_default_charts.some(choice => choice.field === 'M14.evidence_chart'));
  for (const id of ['R02', 'R03']) {
    const plan = plans.compositions.find(item => item.id === id);
    assert.equal(plan.history_owner, 'M13');
    assert.equal(plan.summary_module, 'M14');
    assert.equal(plan.default_scenario_tree, 'M15.action_chart');
    assert.deepEqual(chartChoices(plan).filter(choice => fields.get(choice.field).chart.kind === 'decision-tree').map(choice => choice.field), ['M15.action_chart']);
    const structure = resolveStructure({ template_id: id });
    assert.equal(structure.sections.at(-1).module_id, 'M15');
    const trees = structure.sections.flatMap(section => section.fields.filter(field => field.chart?.kind === 'decision-tree').map(field => `${section.module_id}.${field.key}`));
    assert.deepEqual(trees, ['M15.action_chart']);
    assert.ok(structure.sections.find(section => section.module_id === 'M13').fields.some(field => field.key === 'inference_evidence'));
    assert.ok(!structure.sections.find(section => section.module_id === 'M14').fields.some(field => ['inference_evidence', 'evidence_chart'].includes(field.key)));
  }
});

test('all visual defaults remain fully replaceable and methods are selected independently', () => {
  assert.equal(plans.policy.status, 'suggestions_only');
  for (const template of [...catalog.modules, ...catalog.compositions]) {
    const structure = resolveStructure({ template_id: template.id, sections: [{ id: 'author', title: 'User-selected result', method_refs: ['user/method@7'], fields: [{ key: 'finding', label: 'Finding', type: 'text', meaning: 'A field authored for this task' }] }] });
    assert.equal(structure.sections.length, 1);
    assert.deepEqual(structure.sections[0].fields.map(field => field.key), ['finding']);
    assert.deepEqual(structure.suggested_charts, []);
    const bound = bindResults(structure, [{ section_id: 'author', field: 'finding', value: 'Method result', method_ref: 'user/method@7' }]);
    assert.equal(bound.completeness.status, 'complete');
    assert.equal(bound.researchValidation, 'not_evaluated');
    assert.deepEqual(resolveStructure({ template_id: template.id, sections: [] }).sections, []);
  }
  const multipleTrees = resolveStructure({ template_id: 'R02', sections: [{ module_id: 'M02', fields: ['scenario_chart'] }, { module_id: 'M15', fields: ['action_chart'] }] });
  assert.deepEqual(multipleTrees.sections.map(section => section.fields[0].key), ['scenario_chart', 'action_chart']);
});

test('M18 plans retain all eight chart candidates and the full native strategy inspection contract', () => {
  const strategy = plans.modules.find(plan => plan.id === 'M18');
  assert.deepEqual(chartChoices(strategy).map(choice => choice.field.split('.')[1]).sort(), ['equity_chart', 'drawdown_chart', 'market_matrix_chart', 'parameter_heatmap', 'parameter_sensitivity_chart', 'validation_chart', 'funnel_chart', 'pnl_chart'].sort());
  for (const key of ['logic_graph', 'parameter_trials', 'selection_rule']) assert.ok(referenced(strategy).includes(`M18.${key}`));
  const contract = strategy.native_preservation;
  assert.equal(contract.renderer, 'backtest-template.js + assets/backtest-explorer.js');
  for (const capability of ['真实逻辑节点与函数展开', '品种×周期矩阵', '显示指标切换不重选优', '点格后全部参数试验分页', '参数敏感性', '跨分页固定色阶']) assert.ok(contract.required_behaviors.includes(capability));
  assert.match(contract.synthetic_preview, /虚构样本不是实际策略收益/);
});
