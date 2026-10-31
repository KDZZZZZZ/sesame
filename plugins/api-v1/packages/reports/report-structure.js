import { readFileSync } from 'node:fs';
import { confidenceValue, historicalBasis, inferenceEvidence, fixedRef } from './report-evidence.js';
import { chartDefinition, chartValue } from './report-chart-fields.js';
import { presentationDefinition } from './report-presentation.js';
import { reportGuidance, fieldGuidance } from './report-guidance.js';
import { validateOrigin, validateReasoning, lineageAudit } from './report-lineage.js';
import { validateKnowledgeBasis } from './report-knowledge.js';

const catalog = JSON.parse(readFileSync(new URL('templates/module-catalog.json', import.meta.url), 'utf8'));
const visualPlans = JSON.parse(readFileSync(new URL('templates/module-visual-plans.json', import.meta.url), 'utf8'));
const analysisQuestions = JSON.parse(readFileSync(new URL('templates/analysis-questions.json', import.meta.url), 'utf8'));
const firstScreenPlans = JSON.parse(readFileSync(new URL('templates/first-screen-plans.json', import.meta.url), 'utf8'));
const types = new Set(['text', 'number', 'integer', 'boolean', 'array', 'object', 'probability', 'distribution', 'interval', 'confidence', 'inferences', 'chart']);
export const check = (condition, message) => { if (!condition) throw new Error(message); };
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 20000;
const label = (value, locale) => typeof value === 'string' ? value : value[/^zh/i.test(locale) ? 'zh-CN' : 'en'];
const keys = (value, allowed, name) => check(object(value) && Object.keys(value).every(key => allowed.includes(key)), `${name}: unknown field or expected an object`);

function selectedVisualPlan(templateId, sections, custom) {
  if (custom) return { mode:'user_defined', section_order:sections.map(section => section.id), guidance:visualPlans.policy.user_override };
  const source = [...visualPlans.modules, ...visualPlans.compositions].find(plan => plan.id === templateId);
  if (!source) return null;
  const plan = structuredClone(source), selected = new Set(sections.flatMap(section => section.fields.filter(field => field.display !== 'hidden').map(field => `${section.module_id}.${field.key}`)));
  for (const name of ['primary_charts','supporting_charts']) plan[name] = plan[name].filter(item => selected.has(item.field));
  plan.key_cards = plan.key_cards.map(card => ({...card,fields:card.fields.filter(field => selected.has(field))})).filter(card => card.fields.length);
  plan.details = plan.details.filter(field => selected.has(field));
  if (plan.default_scenario_tree && !selected.has(plan.default_scenario_tree)) delete plan.default_scenario_tree;
  return { mode:'suggestion', ...plan };
}

function fieldDefinition(input, defaults, locale) {
  const key = typeof input === 'string' ? input : input?.key;
  check(id(key), 'Field key must be a safe, nonempty identifier');
  const base = defaults.find(field => field.key === key);
  if (typeof input === 'string') check(base, `Unknown suggested field: ${key}; define a custom field with key, label, type and meaning`);
  else keys(input, ['key', 'label', 'type', 'meaning', 'unit', 'required', 'display', 'history_display', 'chart', 'presentation'], `Field ${key}`);
  const result = { ...(base ? structuredClone(base) : {}), ...(typeof input === 'string' ? {} : input) };
  const redefined = base && typeof input === 'object' && (input.type !== undefined && input.type !== base.type || input.meaning !== undefined && input.meaning !== base.meaning);
  if (redefined && input.presentation === undefined) delete result.presentation;
  result.label = label(result.label ?? '', locale);
  check(text(result.label) && text(result.meaning) && types.has(result.type), `Field ${key} requires a label, meaning and supported type`);
  check(result.unit === undefined || typeof result.unit === 'string' && result.unit.length <= 100, `Field ${key}: invalid unit`);
  check(result.required === undefined || typeof result.required === 'boolean', `Field ${key}: required must be boolean`);
  check(result.display === undefined || ['visible', 'folded', 'hidden'].includes(result.display), `Field ${key}: invalid display`);
  check(result.history_display === undefined || ['full', 'summary', 'hidden'].includes(result.history_display), `Field ${key}: invalid history_display`);
  if (result.type === 'chart') chartDefinition(result.chart);
  else delete result.chart;
  presentationDefinition(result.presentation, result.type);
  return { ...result, required: result.required ?? false, display: result.display ?? 'visible' };
}

/** No state, method invocation or inference: an explicit array replaces defaults. */
export function resolveStructure(input = {}) {
  keys(input, ['template_id', 'sections', 'locale'], 'Structure');
  const locale = input.locale ?? 'zh-CN';
  check(typeof locale === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(locale), 'Invalid locale');
  if (input.template_id === undefined && input.sections === undefined) {
    return {
      kind: 'catalog', schemaVersion: catalog.schemaVersion,
      // The host bounds large tool results by array length and nesting depth.
      // Keep every entry visible as a small keyed index before the full catalog.
      template_index: Object.fromEntries(catalog.compositions.map(({ id, title }) => [id, label(title, locale)])),
      module_index: Object.fromEntries(catalog.modules.map(({ id, title }) => [id, label(title, locale)])),
      first_screen_index: Object.fromEntries(Object.entries(firstScreenPlans.templates).map(([id, plan]) => [id, plan.fields.map(field => field.label).join(' · ')])),
      guidance_resources: ['skills/report-design/first-screen.md','templates/first-screen-plans.json','skills/report-writing/field-guide.md','skills/report-writing/technical-research.md','skills/report-design/module-layouts.md'],
      modules: catalog.modules.map(({ id, title, purpose, fields }) => ({ id, title: label(title, locale), purpose, chart_candidates: fields.filter(field => field.type === 'chart').map(field => ({ key: field.key, title: label(field.label, locale), kind: field.chart.kind })) })),
      compositions: catalog.compositions.map(({ id, title, purpose, modules, optional_modules, suggested_charts }) => ({ id, title: label(title, locale), purpose, modules: [...modules], optional_modules: [...optional_modules], suggested_charts: [...suggested_charts], judgment_questions: (analysisQuestions.templates[id]?.questions ?? []).map(({id,question}) => ({id,question})), reference_fields: structuredClone(analysisQuestions.templates[id]?.tc_alignment ?? null) })),
    };
  }
  const template = [...catalog.modules, ...catalog.compositions].find(item => item.id === input.template_id);
  check(input.template_id === undefined || template, `Unknown template: ${input.template_id}`);
  const suggestions = template ? (template.modules ?? [template.id]).map(module_id => {
    const defaults = structuredClone(template.section_defaults?.[module_id] ?? {});
    return { module_id, ...defaults, ...(defaults.title ? { title: label(defaults.title, locale) } : {}) };
  }) : [];
  const selected = input.sections ?? suggestions;
  check(Array.isArray(selected) && selected.length <= 64, 'sections must be an array of at most 64 entries');
  const sections = selected.map(section => {
    keys(section, ['id', 'module_id', 'title', 'fields', 'method_refs', 'context'], 'Section');
    const module = catalog.modules.find(item => item.id === section.module_id);
    check(section.module_id === undefined || module, `Unknown module: ${section.module_id}`);
    const sectionId = section.id ?? module?.id;
    check(id(sectionId), 'Custom sections require an id');
    const title = section.title ?? (module && label(module.title, locale));
    check(text(title), `Section ${sectionId} requires a title`);
    const requested = section.fields ?? module?.fields;
    check(Array.isArray(requested) && requested.length <= 64, `Section ${sectionId} requires at most 64 fields`);
    // Catalog field objects have localized labels; authored overrides have text labels.
    const fields = section.fields === undefined && module
      ? module.fields.map(field => fieldDefinition(field.key, module.fields, locale))
      : requested.map(field => fieldDefinition(field, module?.fields ?? [], locale));
    for (const field of fields) {
      const guidance = module && fieldGuidance(module.id, field);
      if (guidance) field.agent_guidance = guidance;
    }
    check(new Set(fields.map(field => field.key)).size === fields.length, `Section ${sectionId}: duplicate field`);
    const method_refs = section.method_refs ?? [];
    check(Array.isArray(method_refs) && method_refs.length <= 32 && method_refs.every(text) && new Set(method_refs).size === method_refs.length, `Section ${sectionId}: method_refs must be unique references`);
    const context = section.context ?? {};
    keys(context, ['subject', 'as_of', 'target', 'horizon'], `Section ${sectionId} context`);
    check(Object.values(context).every(text), `Section ${sectionId}: context values must be nonempty strings`);
    return { id: sectionId, module_id: module?.id ?? null, title, fields, method_refs: [...method_refs], context: { ...context } };
  });
  check(new Set(sections.map(section => section.id)).size === sections.length, 'Section IDs must be unique; use separate IDs for repeated modules');
  const questions = structuredClone(analysisQuestions.templates[template?.id] ?? null);
  const selectedFields = new Set(sections.flatMap(section => section.fields.map(field => `${section.module_id ?? section.id}.${field.key}`)));
  const referenceQuestions = (questions?.tc_alignment?.fields ?? []).filter(question => input.sections === undefined ||
    question.suggested_fields.some(field => selectedFields.has(field)));
  const selectedQuestions = new Set(referenceQuestions.map(question => question.tc_field ?? 'Sesame扩展'));
  const overviewPlan = structuredClone(firstScreenPlans.templates[template?.id] ?? null);
  if (overviewPlan && input.sections !== undefined) {
    overviewPlan.fields = overviewPlan.fields.filter(field => [...field.tc_fields, ...field.sesame_fields ?? []].some(name => selectedQuestions.has(name)))
      .map(field => ({ ...field, tc_fields: field.tc_fields.filter(name => selectedQuestions.has(name)),
        ...(field.sesame_fields ? { sesame_fields: field.sesame_fields.filter(name => selectedQuestions.has(name)) } : {}) }));
  }
  // Put the research questions before the larger field/visual dictionary so
  // bounded tool previews do not hide the selected template's responsibilities.
  return { kind: 'structure', schemaVersion: catalog.schemaVersion, template_id: template?.id ?? null, locale,
    first_screen_fields: Object.fromEntries((overviewPlan?.fields ?? []).map(field => [field.label, `${field.format} · ${field.guide}`])),
    first_screen_policy: '用 content.overview 在开头直接呈现以上全部适用结果：一行结论，短词/数字/一句话/短表/必要图。不要长摘要、重复结论、方法解释或免责段落。summary只供报告列表。合并重复对象与期限；用户删改优先，缺失如实短标。回撤、年化收益等金融名词保留；完整论据在后。分析方法独立。',
    // Plain values at a shallow level survive the real model-visible preview.
    // The full field dictionary below remains available for detailed reading.
    analysis_questions: Object.fromEntries(referenceQuestions.map((question, index) => [
      `${String(index + 1).padStart(2, '0')}. ${question.tc_field ?? 'Sesame扩展'}`,
      `${question.question}${question.scope_note ? ` ${question.scope_note}` : ''}`,
    ])),
    question_policy: '以上是本模板默认应回答的问题，不指定分析方法或结论。用户删改优先；显式选择字段时只保留相关问题。已取得的资料应回答适用问题，确实不适用或无法回答时说明具体原因，不编造数值。',
    judgment_brief: { template: questions ? { tc_alignment: questions.tc_alignment, ...questions } : null, policy: structuredClone(analysisQuestions.policy), explicit_selection: input.sections !== undefined, selected_fields: sections.flatMap(section => section.fields.map(field => `${section.module_id ?? section.id}.${field.key}`)) },
    first_screen_plan: overviewPlan,
    sections, guidance:structuredClone(reportGuidance), visual_plan:selectedVisualPlan(template?.id,sections,input.sections !==undefined), suggested_charts: [...template?.suggested_charts ?? []].filter(key => { const [module, field] = key.split('.'); return sections.some(section => section.module_id === module && section.fields.some(item => item.key === field)); }) };
}

export function isFixedRef(ref) {
  return fixedRef(ref);
}

function valueMatches(value, type) {
  const finite = number => typeof number === 'number' && Number.isFinite(number);
  const probability = number => finite(number) && number >= 0 && number <= 1;
  switch (type) {
    case 'text': return typeof value === 'string';
    case 'number': return finite(value);
    case 'integer': return Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return object(value);
    case 'confidence': return confidenceValue(value);
    case 'inferences': return Array.isArray(value);
    case 'chart': return object(value);
    case 'probability': return probability(value);
    case 'interval': return object(value) && finite(value.lower) && finite(value.upper) && value.lower <= value.upper && text(value.meaning) && (value.level === undefined || probability(value.level));
    case 'distribution': {
      if (!object(value) || !text(value.target) || typeof value.exhaustive !== 'boolean' || !Array.isArray(value.items) || !value.items.length || value.items.length > 64) return false;
      if (!value.items.every(item => object(item) && text(item.label) && probability(item.probability)) || new Set(value.items.map(item => item.label)).size !== value.items.length) return false;
      return !value.exhaustive || Math.abs(value.items.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-8;
    }
    default: return false;
  }
}

/** Validate only selected fields. These checks do not certify research quality. */
export function bindResults(structure, rows) {
  check(structure?.kind === 'structure', 'Resolve a structure before binding results');
  check(Array.isArray(rows) && rows.length <= 4096, 'Research results require at most 4096 JSON rows');
  const selected = new Map(structure.sections.flatMap(section => section.fields.map(field => [`${section.id}/${field.key}`, { section, field }])));
  const indexed = new Map(), evidence = new Map();
  let ignored = 0;
  for (const row of rows) {
    check(object(row) && id(row.section_id) && id(row.field), 'Result rows require section_id and field');
    const key = `${row.section_id}/${row.field}`, binding = selected.get(key);
    if (!binding) { ignored++; continue; }
    check(!indexed.has(key), `Duplicate result: ${key}`);
    const status = row.status ?? 'provided';
    check(['provided', 'unavailable', 'pending', 'not_applicable'].includes(status), `${key}: invalid result status`);
    if (status === 'provided') {
      check(valueMatches(row.value, binding.field.type), `${key}: value must match ${binding.field.type}`);
      if (binding.field.type === 'chart') chartValue(row.value, binding.field.chart);
      if (binding.section.method_refs.length) check(binding.section.method_refs.includes(row.method_ref), `${key}: result does not match the selected method`);
      for (const [name, expected] of Object.entries(binding.section.context)) check(row.context?.[name] === expected, `${key}: ${name} differs from the requested context`);
      if (binding.field.type === 'distribution' && binding.section.context.target) check(row.value.target === binding.section.context.target, `${key}: distribution target differs from the requested context`);
    } else {
      check(row.value === undefined || row.value === null, `${key}: unavailable results cannot carry a value`);
      check(text(row.reason), `${key}: unavailable results require a reason`);
    }
    check(row.method_ref === undefined || text(row.method_ref), `${key}: invalid method_ref`);
    check(row.theory_refs === undefined || Array.isArray(row.theory_refs) && row.theory_refs.length <= 32 && row.theory_refs.every(text), `${key}: invalid theory_refs`);
    check(row.evidence_refs === undefined || Array.isArray(row.evidence_refs) && row.evidence_refs.length <= 32 && row.evidence_refs.every(isFixedRef), `${key}: evidence_refs must be fixed artifact references`);
    const refs = [...row.evidence_refs ?? []];
    refs.push(...validateOrigin(row.origin, row, key));
    validateKnowledgeBasis(row.knowledge_basis, key);
    validateReasoning(row.reasoning, row, key, ['probability','distribution','confidence'].includes(binding.field.type) || binding.field.chart?.evidence_role === 'prediction');
    const validation = row.validation;
    if (validation !== undefined) {
      check(object(validation) && ['unvalidated', 'historical_exploration', 'out_of_sample', 'prospective', 'not_applicable'].includes(validation.status), `${key}: invalid validation status`);
      check(validation.note === undefined || text(validation.note), `${key}: invalid validation note`);
      const history = validation.history_refs ?? [];
      check(Array.isArray(history) && history.length <= 32 && history.every(isFixedRef), `${key}: history_refs must be fixed artifact references`);
      // This is evidence presence, not a pass threshold or a statistical test.
      if (['out_of_sample', 'prospective'].includes(validation.status)) check(history.length && text(row.method_ref), `${key}: validated claims require a method and historical result references`);
      refs.push(...history);
    }
    const historical = ['probability', 'distribution', 'confidence'].includes(binding.field.type) || binding.field.type === 'chart' && ['prediction', 'historical'].includes(binding.field.chart.evidence_role);
    if (status === 'provided' && historical) {
      check(validation && validation.status !== 'not_applicable' && text(row.method_ref), `${key}: predictions require a method and explicit validation state`);
      refs.push(...historicalBasis(row.historical_basis, { ...binding.section.context, ...(binding.field.type === 'distribution' ? { target: row.value.target } : {}) }, key));
    } else if (row.historical_basis !== undefined) refs.push(...historicalBasis(row.historical_basis, binding.section.context, key));
    if (status === 'provided' && binding.field.type === 'inferences') refs.push(...inferenceEvidence(row.value, binding.section.context, key));
    for (const ref of refs) evidence.set(JSON.stringify([ref.id, ref.revision, ref.digest, ref.kind, ref.schemaVersion]), ref);
    indexed.set(key, { ...structuredClone(row), status });
  }
  check(evidence.size <= 64, 'Selected results exceed 64 evidence references');
  const missing = [];
  let provided = 0;
  const sections = structure.sections.map(section => ({ ...section, fields: section.fields.map(field => {
    const supplied = indexed.has(`${section.id}/${field.key}`);
    const row = indexed.get(`${section.id}/${field.key}`) ?? { section_id: section.id, field: field.key, status: 'pending', reason: /^zh/i.test(structure.locale) ? '尚未提供研究结果' : 'Research result not supplied' };
    if (row.status === 'provided') provided++;
    else missing.push({ section_id: section.id, field: field.key, required: field.required, status: row.status, reason: row.reason });
    return { ...field, supplied, result: row, lineage_audit:lineageAudit(field,row) };
  }) }));
  return {
    sections, evidence_refs: [...evidence.values()].map(ref => structuredClone(ref)),
    completeness: { status: !provided ? 'empty' : missing.some(item => item.required) ? 'partial' : 'complete', provided, missing, ignored },
    researchValidation: 'not_evaluated',
    lineageAudit: sections.flatMap(section => section.fields.filter(field => field.supplied).map(field => ({section_id:section.id,field:field.key,...field.lineage_audit}))),
  };
}
