import { withEvidenceAppendix } from './report-appendix.js';
import { resolveReportStyle, applyReportStyle } from './report-styles.js';
import { readFileSync } from 'node:fs';
import { readBytes, writeWorkspace } from './artifact-io.js';
import { resolveStructure, bindResults, check, isFixedRef } from './report-structure.js';
import { kitKinds, compositionKinds } from './report-chart-fields.js';
import { presentValue } from './report-presentation.js';
import { renderReasoning, renderInference } from './report-reasoning.js';
import { renderKnowledgeBasis } from './report-knowledge.js';

const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const refKey = ref => JSON.stringify([ref.id, ref.revision, ref.digest, ref.kind, ref.schemaVersion]);
const unique = refs => [...new Map(refs.map(ref => [refKey(ref), ref])).values()];
const nonempty = value => typeof value === 'string' && value.trim() && value.length <= 20000;

export function renderComposedReport({ title, summary, structure, bound, data, references, demo }) {
  check(nonempty(title), 'A report title is required');
  check(summary === undefined || typeof summary === 'string', 'summary must be text');
  const zh = /^zh/i.test(structure.locale), tr = (zhText, enText) => zh ? zhText : enText;
  const validationLabels = {
    unvalidated: tr('未验证', 'Unvalidated'), historical_exploration: tr('历史样本统计', 'Historical sample statistics'),
    out_of_sample: tr('样本外验证记录', 'Out-of-sample record'), prospective: tr('前瞻验证记录', 'Prospective record'),
    not_applicable: tr('不适用', 'Not applicable'),
  };
  const names = zh ? { label: '名称', value: '结果', condition: '条件', outcome: '结果', reason: '依据', unit: '单位', status: '状态', count: '数量', lower: '下限', upper: '上限', meaning: '含义', note: '说明' } : {};
  const displayName = key => names[key] ?? key.replaceAll('_', ' ');
  const percent = value => new Intl.NumberFormat(structure.locale, { style: 'percent', maximumFractionDigits: 6 }).format(value);
  const charts = [];
  const basisKey = basis => basis ? json([basis.scenario, basis.matching_method_ref, basis.target, basis.horizon, basis.window, basis.refs]) : null;
  function historyHTML(basis, validation, display = 'full') {
    if (!basis) return '';
    if (display === 'hidden') return '';
    const sample = basis.sample;
    if (display === 'summary') {
      const detail = bound.sections.find(section => section.module_id === 'M13' && section.fields.some(field => field.display !== 'hidden' && (field.history_display === undefined || field.history_display === 'full') && field.result.status === 'provided' && [field.result.historical_basis,...(field.type === 'inferences' ? field.result.value.map(step=>step.historical_basis) : [])].some(item=>basisKey(item) === basisKey(basis))));
      return `<p class="module-validation">${tr('依据', 'Basis')}：${sample.resolved} ${tr('个同类历史样本', 'comparable historical cases')}${detail ? ` · <a href="#section-${escape(detail.id)}">${tr('查看历史验证', 'View historical evidence')}</a>` : ''}</p>`;
    }
    const selection = basis.sampling;
    const scope = selection.selected_scope === 'same_instrument_recent' ? tr('同品种近期', 'Recent same-instrument cases') : selection.selected_scope === 'cross_instrument' ? tr('跨品种补充', 'Cross-instrument fallback') : tr('用户指定范围', 'User-selected scope');
    const selectionDetail = `<dt>${tr('样本来源', 'Sample selection')}</dt><dd>${escape(scope)} · ${escape(selection.instruments.join(', '))}${selection.comparability ? `<br>${escape(selection.comparability)}` : ''}${selection.override_reason ? `<br>${escape(selection.override_reason)}` : ''}${selection.primary_search ? `<br>${tr('当前品种近期符合样本', 'Eligible recent cases for the current instrument')}：${selection.primary_search.eligible_count === null ? tr('未能完成检索', 'Search unavailable') : selection.primary_search.eligible_count}` : ''}</dd>`;
    const validationDetail = validation ? `<dt>${tr('验证状态', 'Validation status')}</dt><dd>${escape(validationLabels[validation.status])}${validation.note ? ` · ${escape(validation.note)}` : ''}</dd>` : '';
    return `<aside class="module-history"><p class="module-history-count"><strong>${sample.resolved}</strong> ${tr('个已结算同类情景', 'resolved comparable cases')}${sample.effective === undefined ? '' : ` · ${tr('有效样本量', 'Effective sample')} ${sample.effective}`}</p><p>${escape(basis.scenario)} · ${escape(basis.horizon)}</p><p>${basis.outcomes.map(row => `${escape(row.label)} ${row.count}`).join(' · ')}</p><details><summary>${tr('历史口径与不确定性', 'Historical scope and uncertainty')}</summary><dl class="module-values">${selectionDetail}${validationDetail}<dt>${tr('观察窗口', 'Observed window')}</dt><dd>${escape(basis.window.start)} → ${escape(basis.window.end)} · ${tr('截点', 'As of')} ${escape(basis.window.as_of)}</dd><dt>${tr('样本处理', 'Sample handling')}</dt><dd>${tr('匹配', 'Matched')} ${sample.matched} · ${tr('待结算', 'Pending')} ${sample.pending} · ${tr('排除', 'Excluded')} ${sample.excluded}</dd><dt>${tr('匹配方法', 'Matching method')}</dt><dd>${escape(basis.matching_method_ref)}</dd><dt>${tr('基准', 'Baseline')}</dt><dd>${escape(basis.baseline.description)}</dd><dt>${tr('样本依赖', 'Sample dependence')}</dt><dd>${escape(basis.dependence)}</dd><dt>${tr('不确定性', 'Uncertainty')}</dt><dd>${escape(basis.uncertainty)}</dd></dl><ul>${basis.limitations.map(limit => `<li>${escape(limit)}</li>`).join('')}</ul></details></aside>`;
  }
  const confidenceHTML = value => `<p class="module-confidence"><strong>${value.estimate === undefined ? escape(value.assessment) : escape(percent(value.estimate))}</strong> · ${escape(value.definition)}</p>${value.estimate !== undefined && value.assessment ? `<p>${escape(value.assessment)}</p>` : ''}${value.interval ? `<p>${escape(percent(value.interval.level))} ${tr('估计区间', 'estimation interval')} ${escape(percent(value.interval.lower))}–${escape(percent(value.interval.upper))}</p>` : ''}`;
  function chartHTML(field) {
    const value = field.result.value, id = `module-chart-${charts.length + 1}`;
    const owner = bound.sections.find(section => section.fields.includes(field));
    const repeated = owner?.fields.some(item => item.key === 'summary' && item.display === 'visible' && item.result.status === 'provided' && item.result.value === value.takeaway);
    const caption = repeated ? '' : value.takeaway;
    const options = { ...field.chart.options, ...value.options };
    const columns = [...new Set([...field.chart.columns, ...(field.chart.kind === 'candlestick' ? (options.overlays ?? []).map(overlay => overlay.field) : [])])];
    charts.push({ id, kind: field.chart.kind, title: field.label, caption:value.takeaway, columns, options, rows: value.rows, ...(value.nodes ? { nodes: value.nodes } : {}) });
    return `<figure class="module-chart${repeated ? ' module-chart-caption-repeated' : ''}">${kitKinds.has(field.chart.kind) || !caption ? '' : `<p>${escape(caption)}</p>`}<div id="${id}" class="module-chart-plot" aria-label="${escape(field.label)}"></div><details id="${id}-details" class="module-chart-inspect"><summary>${tr('数据与来源', 'Data and sources')} · ${value.rows.length}${options.unit ? ` · ${escape(options.unit)}` : ''}</summary><p class="report-source">${escape(value.source_note)}</p><div class="module-chart-table"></div></details></figure>`;
  }
  function valueHTML(value, depth = 0) {
    if (value === null) return '<span>—</span>';
    if (typeof value === 'boolean') return escape(value ? tr('是', 'Yes') : tr('否', 'No'));
    if (typeof value !== 'object') return escape(value);
    if (depth >= 8) return `<pre class="module-raw">${escape(JSON.stringify(value, null, 2))}</pre>`;
    if (Array.isArray(value)) {
      // Flat, aligned business records (event schedules, weights, ratings) read
      // as a table. Nested or heterogeneous results retain their full lists.
      const columns = value[0] && typeof value[0] === 'object' && !Array.isArray(value[0]) ? Object.keys(value[0]) : [];
      if (value.length > 0 && value.length <= 64 && columns.length >= 2 && columns.length <= 8 && value.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).length === columns.length && columns.every(key => Object.hasOwn(entry, key) && (entry[key] === null || typeof entry[key] !== 'object')))) {
        return `<div class="module-record-table" role="region" aria-label="${tr('研究结果表', 'Research result table')}" tabindex="0"><table><thead><tr>${columns.map(key => `<th scope="col">${escape(displayName(key))}</th>`).join('')}</tr></thead><tbody>${value.map(entry => `<tr>${columns.map(key => `<td>${valueHTML(entry[key], depth + 1)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
      const item = entry => `<li>${valueHTML(entry, depth + 1)}</li>`;
      const main = `<ul class="module-list">${value.slice(0, 8).map(item).join('')}</ul>`;
      return value.length <= 8 ? main : `${main}<details class="module-more"><summary>${tr('其余', 'Remaining')} ${value.length - 8}</summary><ul class="module-list">${value.slice(8).map(item).join('')}</ul></details>`;
    }
    return `<dl class="module-facts">${Object.entries(value).map(([key, entry]) => `<div class="module-fact${entry !== null && typeof entry === 'object' || typeof entry === 'string' && entry.length > 48 ? ' module-fact-wide' : ''}"><dt>${escape(displayName(key))}</dt><dd>${valueHTML(entry, depth + 1)}</dd></div>`).join('')}</dl>`;
  }
  function fieldHTML(field) {
    const row = field.result;
    if (field.display === 'hidden' || !field.supplied && !field.required) return '';
    let body;
    const presentation = row.status === 'provided' ? presentValue(field, row.value, { escape, valueHTML, locale: structure.locale, tr }) : null;
    if (row.status !== 'provided') body = `<p class="module-unavailable">${escape(row.reason)}</p>`;
    else if (presentation) body = presentation.html;
    else if (field.type === 'chart') body = chartHTML(field);
    else if (field.type === 'confidence') body = confidenceHTML(row.value);
    else if (field.type === 'inferences') body = row.value.map(step => renderInference(step, {escape,tr,historyHTML,confidenceHTML,historyDisplay:field.history_display})).join('');
    else if (field.type === 'distribution') body = `<p class="report-source">${escape(row.value.target)}</p><div class="report-table"><table><thead><tr><th>${tr('结果', 'Outcome')}</th><th>${tr('概率', 'Probability')}</th></tr></thead><tbody>${row.value.items.map(item => `<tr><td>${escape(item.label)}</td><td>${escape(percent(item.probability))}</td></tr>`).join('')}</tbody></table></div>`;
    else if (field.type === 'probability') body = `<p>${escape(percent(row.value))}</p>`;
    else if (field.type === 'interval') body = `<p>${escape(row.value.lower)} – ${escape(row.value.upper)}${field.unit ? ` ${escape(field.unit)}` : ''}</p><p class="report-source">${escape(row.value.meaning)}${row.value.level === undefined ? '' : ` · ${escape(percent(row.value.level))}`}</p>`;
    else body = `<div class="module-value">${valueHTML(row.value)}${field.unit && !['object', 'array'].includes(field.type) ? ` <span>${escape(field.unit)}</span>` : ''}</div>`;
    // The internal evidence status remains in the end appendix. In the reading
    // path, show a useful explanation rather than repeating a status badge for
    // every result. Actual sample counts and historical comparisons stay visible.
    const state = row.validation?.note?.trim() && !row.historical_basis
      ? `<p class="module-validation">${escape(row.validation.note)}</p>` : '';
    const explanation = field.type !== 'inferences' || row.status !== 'provided' ? renderReasoning({...row,confidence:field.type === 'confidence' && row.status === 'provided' ? row.value : undefined}, {escape,tr,historyHTML,confidenceHTML,historyDisplay:field.history_display}) : '';
    const repeatedValue = explanation && (field.type === 'text' && row.value === row.reasoning.conclusion || field.type === 'confidence');
    const content = explanation ? `${repeatedValue ? '' : body}${explanation}` : `${body}${state}${field.type === 'inferences' ? '' : historyHTML(row.historical_basis, row.validation, field.history_display) + renderKnowledgeBasis(row.knowledge_basis,{escape,tr})}`;
    return field.display === 'folded'
      ? `<details class="module-field"><summary>${escape(field.label)}</summary>${content}</details>`
      : `<div class="module-field${presentation ? ` module-visual-card module-presentation-${presentation.kind}` : ''}${field.key === 'summary' ? ' module-reading' : ''}" data-field="${escape(field.key)}">${field.type === 'chart' && row.status === 'provided' && kitKinds.has(field.chart.kind) ? '' : `<h3>${escape(field.label)}</h3>`}${content}</div>`;
  }
  const sections = bound.sections.map(section => {
    const body = section.fields.map(fieldHTML).join('');
    return body ? `<section class="kit-section module-section" id="section-${escape(section.id)}">${bound.sections.length === 1 && section.title === title ? '' : `<h2>${escape(section.title)}</h2>`}${body}</section>` : '';
  }).join('');
  const readerEvidence = (row, display) => {
    const allowed = ['id','claim','status','reason','method_ref','theory_refs','evidence_refs','confidence','knowledge_basis','reasoning','validation',...(display === undefined || display === 'full' ? ['historical_basis'] : [])];
    const result = Object.fromEntries(allowed.filter(key=>row[key] !== undefined).map(key=>[key,structuredClone(row[key])]));
    if (display === 'hidden' || display === 'summary') {
      if (result.validation) delete result.validation.history_refs;
      if (display === 'hidden' && result.reasoning) delete result.reasoning.history;
    }
    return result;
  };
  const methodRows = bound.sections.flatMap(section => section.fields.filter(field => field.result.status === 'provided').map(field => ({
    section: section.title, field: field.label, method: field.result.method_ref ?? null, theories: field.result.theory_refs ?? [],
    context: field.result.context ?? null, ...readerEvidence(field.result,field.display === 'hidden' ? 'hidden' : field.history_display),
    ...(field.type === 'inferences' ? { inferences: field.result.value.map(step=>readerEvidence(step,field.display === 'hidden' ? 'hidden' : field.history_display)) } : {}),
    ...(field.type === 'confidence' ? { confidence: field.result.value } : {}),
  })));
  const source = `<details class="kit-appendix module-sources"><summary>${tr('研究依据与来源', 'Research methods and sources')}</summary><div class="kit-appendix-body"><pre class="module-raw">${escape(JSON.stringify({ inputs: data, references, methods: methodRows }, null, 2))}</pre></div></details>`;
  const badge = demo ? `<p class="module-demo">${tr('演示样本 · 不代表真实行情或已验证预测', 'DEMO SAMPLE · Not market observations or validated forecasts')}</p>` : '';
  const empty = bound.completeness.status === 'empty' ? `<p>${tr('尚未提供所选字段的研究结果。', 'No research results have been supplied for the selected fields.')}</p>` : '';
  // The contract binds the static projection to the exact immutable inputs at publication.
  // Agent writing guidance is not part of the visual projection. Keep the
  // actual field meanings, mappings and user choices, without duplicating a
  // large knowledge guide into every offline document.
  const { guidance, visual_plan, ...projectionStructure } = structure;
  projectionStructure.sections = structure.sections.map(section => ({...section,fields:section.fields.map(({agent_guidance,...field}) => field)}));
  const contract = `<script id="sesame-composition-bindings" type="application/json">${json({ schemaVersion: '1.0.0', data, references, structure:projectionStructure, demo })}</script>`;
  const chartKinds = new Set(charts.map(chart => chart.kind)), assets = [];
  if (charts.length) {
    assets.push('report-kit.js', 'editorial-charts.js');
    if (charts.some(chart => ['waterfall', 'dumbbell', 'strip', 'histogram', 'boxplot', 'ridgeline', 'violin'].includes(chart.kind))) assets.push('charts-statistics.js');
    if (charts.some(chart => ['calendar', 'parallel', 'bump', 'lifecycle'].includes(chart.kind))) assets.push('charts-temporal.js');
    if (charts.some(chart => ['treemap', 'threads', 'flow', 'network-circular', 'network-force'].includes(chart.kind))) assets.push('charts-structure.js');
    if (charts.some(chart => compositionKinds.has(chart.kind))) assets.push('charts-composition.js');
    if (chartKinds.has('decision-tree')) assets.push('charts-decision.js');
    if (chartKinds.has('candlestick')) assets.push('vendor/lightweight-charts.js', 'charts-market.js');
  }
  // Library assets are bundled once. Chart values are a projection of the fixed
  // result source, so offline viewing and the report host show identical rows.
  const chartScripts = charts.length ? `<script id="sesame-module-charts" type="application/json">${json(charts)}</script>${assets.map(path => `<script>${asset(`assets/${path}`)}</script>`).join('')}<script>${asset('assets/module-charts.js')}</script>` : '';
  const body = `${badge}${summary ? `<p class="report-subtitle">${escape(summary)}</p>` : ''}${empty}${sections}${source}${contract}${chartScripts}`;
  const tokens = { LOCALE: escape(structure.locale), TITLE: escape(title), STYLES: asset('assets/editorial.css') + '\n' + asset('assets/module-report.css') + '\n' + asset('assets/report-reasoning.css'), BODY: body };
  const html = withEvidenceAppendix(asset('templates/document.html').replace(/\{\{([A-Z_]+)\}\}/g, (token, key) => Object.hasOwn(tokens, key) ? tokens[key] : token));
  check(Buffer.byteLength(html) <= 1024 * 1024, 'Composed report exceeds 1 MiB; use a smaller selected result set or a custom document with bound evidence');
  return html;
}

export function assertCompositionBindings(html, data, references, provenanceKind) {
  const blocks = [...html.matchAll(/<script\s+id="sesame-composition-bindings"\s+type="application\/json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) return;
  check(blocks.length === 1, 'Report contains duplicate composition bindings');
  const contract = JSON.parse(blocks[0][1]);
  check(contract.schemaVersion === '1.0.0' && Array.isArray(contract.data) && Array.isArray(contract.references), 'Invalid composition bindings');
  for (const binding of contract.data) check(data.some(item => item.id === binding.id && refKey(item.ref) === refKey(binding.ref)), 'Composed report requires its original fixed data binding; recompose after changing inputs');
  for (const ref of contract.references) check([...data.map(item => item.ref), ...references].some(item => refKey(item) === refKey(ref)), 'Composed report is missing a fixed evidence reference');
  check(!contract.demo || provenanceKind === 'demo', 'Composed demo reports must retain demo provenance');
}

export async function composeSourceReport(host, args, signal) {
      const structure = resolveStructure(args.structure);
      check(structure.kind === 'structure', 'Choose a template or explicit sections before composing');
      check(isFixedRef(args.results_ref) && args.results_ref.kind === 'data', 'results_ref must be a fixed DataRef');
      check(nonempty(args.title), 'title is required');
      signal?.throwIfAborted();
      const manifest = await host.resources.read(args.results_ref, { part: 'manifest' });
      check(manifest.content?.format === 'json-rows' && typeof manifest.content.path === 'string', 'Research results must use the json-rows data format');
      check(manifest.content.available_for_analysis !== false && manifest.content.provenance?.available_for_analysis !== false, 'Research results are not available for analysis');
      const bytes = await readBytes(host, args.results_ref, manifest.content.path, signal);
      check(bytes.length <= 4 * 1024 * 1024, 'Selected research results exceed 4 MiB');
      const rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const bound = bindResults(structure, rows);
      const references = unique(bound.evidence_refs);
      let demo = manifest.content.provenance?.kind === 'demo';
      for (const ref of references) {
        signal?.throwIfAborted();
        const source = await host.resources.read(ref, { part: 'manifest' });
        check(source.content?.available_for_analysis !== false && source.content?.provenance?.available_for_analysis !== false, 'Evidence is not available for analysis');
        demo ||= source.content?.provenance?.kind === 'demo';
      }
      const data = [{ id: 'research-results', ref: structuredClone(args.results_ref), usage: 'Fixed method outputs used by this report' }];
      const html = renderComposedReport({ ...args, structure, bound, data, references, demo });
      signal?.throwIfAborted();
      return { html, structure, bound, data, references, demo };
}

export function reportCompositionCapabilities(host) {
  return [
    { name: 'report_structure', execute: input => resolveStructure(input) },
    { name: 'report_compose', execute: async (args, signal) => {
      check(nonempty(args.output_path), 'output_path is required');
      const composed = await composeSourceReport(host,args,signal);
      const { structure,bound,data,references,demo } = composed;
      const html = applyReportStyle(composed.html,await resolveReportStyle(host,args.style));
      const written = await writeWorkspace(host, args.output_path, html, signal);
      return {
        path: written.path, bytes: Buffer.byteLength(html), structure, completeness: bound.completeness, lineageAudit:bound.lineageAudit,
        researchValidation: 'not_evaluated', renderStatus: 'not_checked', editable: false,
        publish: { content: { kind: 'modules', structure: args.structure, results_ref: args.results_ref }, style: args.style??{}, title: args.title, summary: args.summary || args.title, locale: structure.locale, provenance_kind: demo ? 'demo' : 'derived', data, references, features: ['interactive'] },
      };
    } },
  ];
}
