import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reportGuidance, guidance, fieldGuidance } from '../packages/reports/report-guidance.js';
import { resolveStructure } from '../packages/reports/report-structure.js';

const root = new URL('../packages/reports/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('templates/module-catalog.json', root), 'utf8'));
const guide = (module, field) => fieldGuidance(module, field);
const words = (module, field) => JSON.stringify(guide(module, field));

test('every suggested field has substantive authored semantics and no type-only fallback', () => {
  const modules = new Set();
  let fieldCount = 0;
  for (const module of catalog.modules) {
    modules.add(module.id);
    for (const field of module.fields) {
      const value = guide(module.id, field);
      assert.ok(value, `${module.id}.${field.key} has guidance for its current meaning/type`);
      for (const key of ['definition', 'inputs', 'unit_time', 'interpretation', 'missing', 'judgment']) {
        assert.equal(typeof value[key], 'string', `${module.id}.${field.key}.${key}`);
        assert.ok(value[key].length >= 12, `${module.id}.${field.key}.${key} is not empty boilerplate`);
      }
      assert.ok(['definition', 'inputs', 'unit_time', 'interpretation', 'missing'].reduce((size, key) => size + value[key].length, 0) >= 120, `${module.id}.${field.key} expands the short catalog meaning`);
      assert.notEqual(value.definition, field.meaning);
      assert.ok(value.source.endsWith(`#${module.id}.${field.key}`));
      assert.ok(['acquired','derived','inferred','user_supplied','mixed'].includes(value.lineage.suggested_kind));
      assert.ok(['fact','statistic','interpretation','prediction','plan','metadata','mixed'].includes(value.lineage.nature));
      assert.ok(value.lineage.meaning_note.length > 12);
      assert.deepEqual(Object.keys(value.lineage).sort(),['meaning_note','nature','suggested_kind'],'Result semantics must not select plugin routes or algorithms');
      if (field.chart) assert.deepEqual(value.chart, { kind: field.chart.kind, columns: field.chart.columns, evidence_role: field.chart.evidence_role });
      fieldCount++;
    }
  }
  assert.equal(modules.size, 19);
  assert.ok(fieldCount >= 338);
  assert.equal(guide('M99', 'summary'), null);
  assert.equal(guide('M01', 'new_user_field'), null);
  assert.equal(guide('__proto__', 'summary'), null);
  assert.equal(guide('M01', 'constructor'), null);
});

test('generated knowledge stays under the per-file UTF-8 budget and matches the catalog exactly', () => {
  const paths = [...new Set(Object.values(reportGuidance.knowledge.by_module))];
  assert.equal(paths.length, 5);
  const seen = new Set();
  for (const path of paths) {
    const raw = readFileSync(new URL(path, root));
    assert.ok(raw.byteLength <= 128 * 1024, `${path}: ${raw.byteLength} bytes`);
    const data = JSON.parse(raw.toString('utf8'));
    for (const [moduleId, module] of Object.entries(data.modules)) {
      assert.ok(!seen.has(moduleId));
      seen.add(moduleId);
      const source = catalog.modules.find(value => value.id === moduleId);
      assert.deepEqual(Object.keys(module.fields), source.fields.map(value => value.key));
      for (const field of source.fields) {
        assert.equal(module.fields[field.key].type, field.type);
        assert.equal(module.fields[field.key].catalog_meaning, field.meaning);
      }
    }
  }
  assert.equal(seen.size, catalog.modules.length);
  const result = execFileSync(process.execPath, [fileURLToPath(new URL('scripts/build-field-guidance.mjs', root)), '--check'], { encoding: 'utf8' });
  assert.equal(result.trim().split('\n').length, paths.length);
});

test('users can redefine meaning or type without stale guidance and can keep display-only changes', () => {
  const original = catalog.modules.find(module => module.id === 'M04').fields.find(field => field.key === 'valuation');
  assert.equal(guide('M04', { ...original, meaning: '用户自己的价值比较定义' }), null);
  assert.equal(guide('M04', { ...original, type: 'text' }), null);
  assert.ok(guide('M04', { ...original, label: '我的价值研究', display: 'hidden' }));
  const originalChart = catalog.modules.find(module => module.id === 'M02').fields.find(field => field.key === 'scenario_chart');
  const selectedChart = { ...originalChart.chart, columns: ['id', 'parentId', 'label', 'condition', 'detail', 'scenario_id'], evidence_role: 'prediction' };
  const chartGuide = guide('M02', { ...originalChart, chart: selectedChart });
  assert.deepEqual(chartGuide.chart.columns, selectedChart.columns);
  assert.equal(chartGuide.chart.evidence_role, 'prediction');
  assert.ok(chartGuide.historical);
  const custom = resolveStructure({ template_id: 'M04', sections: [{ module_id: 'M04', fields: [
    { key: 'valuation', meaning: '用户自己的价值比较定义' },
    { key: 'own_field', label: '自定义', type: 'text', meaning: '本次约定' },
  ] }] });
  assert.deepEqual(custom.sections[0].fields.map(field => field.key), ['valuation', 'own_field']);
  assert.ok(custom.sections[0].fields.every(field => field.agent_guidance === undefined));
  assert.match(custom.guidance.customization, /用户可删改/);
  assert.match(custom.guidance.judgment, /用户需要回答的分析问题.*明确判断/);
  assert.deepEqual(resolveStructure({ template_id: 'M01', sections: [] }).sections, []);
});

test('all eleven compositions reuse selected field semantics while the catalog remains lightweight', () => {
  const listing = resolveStructure();
  assert.equal(listing.kind, 'catalog');
  assert.equal(listing.guidance, undefined);
  assert.ok(listing.modules.every(module => !module.fields));
  assert.equal(catalog.compositions.length, 11);
  for (const template of catalog.compositions) {
    const structure = resolveStructure({ template_id: template.id });
    assert.deepEqual(structure.guidance, reportGuidance);
    for (const section of structure.sections) {
      for (const field of section.fields) assert.deepEqual(field.agent_guidance, guide(section.module_id, field));
    }
  }
});

test('nearby finance concepts keep their distinct inputs, times and interpretation', () => {
  assert.match(words('M04', 'valuation'), /经济价值/);
  assert.match(words('M04', 'valuation'), /不等于未来交易价格/);
  assert.match(words('M04', 'model_target'), /预测起点.*期限/);
  assert.match(words('M05', 'target_prices'), /分析师意见汇总/);
  assert.match(words('M09', 'iv_rank'), /极值/);
  assert.match(words('M09', 'iv_rank'), /不能互换/);
  assert.match(words('M09', 'iv_percentile'), /相等值处理/);
  assert.match(words('M09', 'iv_percentile'), /不是极值距离/);
  assert.match(words('M08', 'evidence_volume'), /Confidence.*不是行情预测/);
  assert.match(words('M08', 'subjectivity'), /情绪正负.*证据量.*不同/);
  assert.match(words('M10', 'profit_probability'), /净损益严格大于零/);
  assert.match(words('M10', 'profit_probability'), /自身历史样本/);
  assert.match(words('M10', 'expected_profit'), /不是最大利润/);
  assert.match(words('M12', 'margin'), /不是最大损失/);
  assert.match(words('M17', 'economic_releases'), /actual 为 null/);
  assert.match(words('M19', 'performance_refs'), /原组合业绩不能改名/);
});

test('prediction guidance requires actual comparable outcomes and preserves search availability and baselines', () => {
  for (const module of catalog.modules) {
    for (const field of module.fields) {
      if (!['probability', 'distribution', 'confidence', 'inferences'].includes(field.type) && !['historical', 'prediction'].includes(field.chart?.evidence_role)) continue;
      const history = guide(module.id, field).historical;
      assert.ok(history, `${module.id}.${field.key}`);
      assert.match(history.rule, /实际后续结果/);
      assert.match(history.sampling, /当前品种.*近期/);
      assert.match(history.sampling, /eligible_count 为 0.*跨品种/);
      assert.match(history.sampling, /检索不可用.*不等于零匹配/);
      assert.match(history.comparison, /知识假说.*历史.*基准.*不确定性/);
      assert.match(history.status, /unavailable\/pending/);
    }
  }
  assert.match(words('M13', 'baseline'), /不是统一 50%/);
  assert.match(words('M13', 'sample'), /原始行数不等于独立样本数/);
  assert.match(words('M13', 'matching'), /用户|检索/);
  assert.match(words('M14', 'confidence'), /定性评价也须有其历史依据/);
  assert.match(words('M14', 'probabilities'), /综合历史结果/);
  assert.match(words('M01', 'data_times'), /首次公开可得/);
  assert.match(words('M06', 'previous_values'), /不倒填到历史时点/);
});

test('technical comparisons and backtest grids describe actual runs, not votes or retrospective winners', () => {
  assert.match(words('M02', 'method_scan'), /未运行.*不可用.*未检出/);
  assert.match(words('M02', 'feature_signals'), /理论含义与历史统计对照/);
  assert.equal(guide('M02', 'method_comparison_chart').chart.kind, 'lifecycle');
  assert.match(words('M02', 'method_comparison_chart'), /首次可得时间/);
  assert.match(words('M02', 'method_comparison_chart'), /多数表决概率/);
  assert.match(words('M18', 'market_matrix_chart'), /颜色指标.*选优指标/);
  assert.match(words('M18', 'parameter_sensitivity_chart'), /不能静默平均/);
  assert.match(words('M18', 'selection_rule'), /不使用留出结果挑参/);
  assert.match(words('M18', 'parameter_trials'), /失败、未运行和指标未定义/);
  assert.match(words('M18', 'logic_graph'), /只有本次实际使用 SVL/);
  assert.match(words('M18', 'funnel_chart'), /不是交易胜率/);
});

test('returned guides are detached and shared rules do not constrain user method or theory selection', () => {
  const before = guide('M01', 'trend');
  before.definition = 'mutated';
  assert.notEqual(guide('M01', 'trend').definition, before.definition);
  const prediction = guide('M14', 'probabilities');
  prediction.historical.sampling = 'mutated';
  assert.notEqual(guide('M14', 'probabilities').historical.sampling, 'mutated');
  assert.equal(guidance, reportGuidance);
  assert.ok(Object.isFrozen(reportGuidance.historical));
  assert.match(reportGuidance.method_and_knowledge, /自由组合/);
  assert.match(reportGuidance.judgment, /定性倾向不等于.*置信度/);
  assert.match(reportGuidance.judgment, /未严格证明因果不等于没有因果/);
  assert.match(guide('M01', 'data_times').judgment, /不为背景信息编造倾向/);
  assert.match(reportGuidance.customization, /不增加必填 schema/);
  assert.match(reportGuidance.knowledge.reading, /所选字段.*避免.*全部字段/);
});
