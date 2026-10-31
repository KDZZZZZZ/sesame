// Evidence contracts and conservative projections. Matching, estimation and scientific validation belong
// to the selected research method, never to the report renderer.
import { validateKnowledgeBasis } from './report-knowledge.js';
import { validateOrigin, validateReasoning } from './report-lineage.js';
import { presentationDefinition, presentValue } from './report-presentation.js';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() && value.length <= 20000;
export const fixedRef = ref => object(ref) && ['id', 'revision', 'kind', 'schemaVersion'].every(key => text(ref[key])) && /^sha256:[a-f0-9]{64}$/.test(ref.digest);
const count = value => Number.isSafeInteger(value) && value >= 0;
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const defaultJudgmentPresentation = Object.freeze({ kind: 'judgments', label: '问题', value: '判断', subject: '对象', horizon: '期限', basis: '依据', condition: '改判条件', history: '历史参照' });

/** The same conservative projection for documents and native result adapters. */
export function renderJudgments(items, { presentation, locale = 'zh-CN' } = {}) {
  assert(Array.isArray(items) && items.length > 0 && items.length <= 200, 'Judgments need 1–200 supplied results in an array');
  const mapping = presentation === undefined ? defaultJudgmentPresentation : { kind: 'judgments', ...presentation };
  assert(presentation === undefined || object(presentation), 'Judgment presentation must contain property mappings');
  assert(mapping.kind === 'judgments', 'Judgment blocks only use a judgments presentation');
  presentationDefinition(mapping, 'array');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tr = (zh, en) => /^zh/i.test(locale) ? zh : en;
  const valueHTML = (value, depth = 0) => {
    if (value === null) return '<span>—</span>';
    if (typeof value === 'boolean') return escape(value ? tr('是', 'Yes') : tr('否', 'No'));
    if (typeof value !== 'object') return escape(value);
    if (depth >= 8) return `<pre class="module-raw">${escape(JSON.stringify(value, null, 2))}</pre>`;
    if (Array.isArray(value)) {
      const list = rows => `<ul class="module-list">${rows.map(row => `<li>${valueHTML(row, depth + 1)}</li>`).join('')}</ul>`;
      return `${list(value.slice(0, 8))}${value.length > 8 ? `<details class="module-more"><summary>${tr('其余', 'Remaining')} ${value.length - 8}</summary>${list(value.slice(8))}</details>` : ''}`;
    }
    return `<dl class="module-facts">${Object.entries(value).map(([key, entry]) => `<div class="module-fact${entry !== null && typeof entry === 'object' || typeof entry === 'string' && entry.length > 48 ? ' module-fact-wide' : ''}"><dt>${escape(key)}</dt><dd>${valueHTML(entry, depth + 1)}</dd></div>`).join('')}</dl>`;
  };
  const field = { type: 'array', label: tr('分项判断', 'Judgments'), meaning: tr('已提供的分项判断及完整原始记录；展示不产生新的判断。', 'Supplied judgments and complete original records; presentation adds no analysis.'), presentation: mapping };
  const projection = presentValue(field, items, { escape, valueHTML, locale, tr });
  return `<div class="module-field${projection ? ' module-visual-card module-presentation-judgments' : ''}" data-report-judgments>${projection ? projection.html : `<div class="module-value">${valueHTML(items)}</div>`}</div>`;
}

function samplingEvidence(sampling, basis, context, name) {
  assert(object(sampling) && text(sampling.subject), `${name}: sampling must identify the current instrument`);
  if (context.subject) assert(sampling.subject === context.subject, `${name}: sampling subject differs from the requested instrument`);
  assert(['same_instrument_recent_first', 'user_override'].includes(sampling.policy), `${name}: declare the historical sampling policy`);
  assert(['same_instrument_recent', 'cross_instrument', 'custom'].includes(sampling.selected_scope), `${name}: invalid selected sample scope`);
  assert(Array.isArray(sampling.instruments) && sampling.instruments.length > 0 && sampling.instruments.length <= 64 && sampling.instruments.every(text) && new Set(sampling.instruments).size === sampling.instruments.length, `${name}: selected instruments must be explicit and unique`);
  if (sampling.instruments.some(instrument => instrument !== sampling.subject)) assert(text(sampling.comparability), `${name}: cross-instrument samples require a comparability explanation`);
  if (sampling.policy === 'user_override') {
    assert(text(sampling.override_reason), `${name}: record the user's explicit sampling override`);
    if (sampling.primary_search?.ref !== undefined) assert(fixedRef(sampling.primary_search.ref), `${name}: invalid primary search reference`);
    return sampling.primary_search?.ref ? [sampling.primary_search.ref] : [];
  }
  const window = sampling.recent_window, search = sampling.primary_search;
  assert(object(window) && ['start', 'end'].every(key => text(window[key]) && Number.isFinite(Date.parse(window[key]))) && Date.parse(window.start) <= Date.parse(window.end) && Date.parse(window.end) <= Date.parse(basis.window.as_of), `${name}: declare a recent search window available by as_of`);
  assert(object(search) && ['matched', 'no_match', 'unavailable'].includes(search.status) && fixedRef(search.ref), `${name}: preserve the same-instrument recent search result`);
  assert(search.status === 'unavailable' ? search.eligible_count === null : count(search.eligible_count), `${name}: primary eligible count must match search availability`);
  if (search.status === 'matched') assert(search.eligible_count > 0, `${name}: matched search needs eligible samples`);
  if (search.status === 'no_match') assert(search.eligible_count === 0, `${name}: no_match requires zero eligible samples`);
  if (sampling.selected_scope === 'same_instrument_recent') {
    assert(sampling.instruments.length === 1 && sampling.instruments[0] === sampling.subject && search.status === 'matched' && search.eligible_count >= basis.sample.resolved, `${name}: use eligible recent cases from the current instrument first`);
    assert(Date.parse(basis.window.start) >= Date.parse(window.start) && Date.parse(basis.window.end) <= Date.parse(window.end), `${name}: selected cases fall outside the recent search window`);
  } else {
    assert(sampling.selected_scope === 'cross_instrument' && search.status === 'no_match' && search.eligible_count === 0 && !sampling.instruments.includes(sampling.subject), `${name}: cross-instrument fallback requires a completed recent same-instrument search with no eligible matches`);
  }
  return [search.ref];
}

export function confidenceValue(value) {
  return object(value) && text(value.definition) && (probability(value.estimate) || text(value.assessment))
    && (value.estimate === undefined || probability(value.estimate))
    && (value.interval === undefined || object(value.interval) && ['lower', 'upper', 'level'].every(key => probability(value.interval[key])) && value.interval.lower <= value.interval.upper && text(value.interval.method_ref));
}

export function historicalBasis(basis, context = {}, name = 'Historical basis') {
  assert(object(basis), `${name}: historical_basis is required; use unavailable when comparable history is missing`);
  for (const key of ['scenario', 'matching_method_ref', 'target', 'horizon', 'dependence', 'uncertainty']) assert(text(basis[key]), `${name}: ${key} is required`);
  for (const key of ['target', 'horizon']) if (context[key]) assert(basis[key] === context[key], `${name}: ${key} differs from the requested context`);
  const window = basis.window;
  assert(object(window) && ['start', 'end', 'as_of'].every(key => text(window[key]) && Number.isFinite(Date.parse(window[key]))), `${name}: historical window and as_of are required`);
  assert(Date.parse(window.start) <= Date.parse(window.end) && Date.parse(window.end) <= Date.parse(window.as_of), `${name}: historical outcomes must be observable by as_of`);
  if (context.as_of) assert(Number.isFinite(Date.parse(context.as_of)) && Date.parse(window.as_of) <= Date.parse(context.as_of), `${name}: historical cutoff exceeds the requested as_of`);
  const sample = basis.sample;
  assert(object(sample) && ['matched', 'resolved', 'pending', 'excluded'].every(key => count(sample[key])), `${name}: explicit matched/resolved/pending/excluded counts are required`);
  assert(sample.resolved > 0 && sample.matched === sample.resolved + sample.pending + sample.excluded, `${name}: resolved history must be positive and sample counts must reconcile`);
  assert(sample.effective === undefined || typeof sample.effective === 'number' && Number.isFinite(sample.effective) && sample.effective > 0 && sample.effective <= sample.resolved, `${name}: invalid effective sample size`);
  assert(Array.isArray(basis.outcomes) && basis.outcomes.length > 0 && basis.outcomes.length <= 64 && basis.outcomes.every(row => object(row) && text(row.label) && count(row.count)), `${name}: observed outcome counts are required`);
  assert(new Set(basis.outcomes.map(row => row.label)).size === basis.outcomes.length && basis.outcomes.reduce((n, row) => n + row.count, 0) === sample.resolved, `${name}: mutually exclusive outcome counts must reconcile to resolved cases`);
  assert(Array.isArray(basis.refs) && basis.refs.length > 0 && basis.refs.length <= 32 && basis.refs.every(fixedRef), `${name}: fixed historical case/result references are required`);
  const baseline = basis.baseline;
  assert(object(baseline) && ['provided', 'unavailable'].includes(baseline.status) && text(baseline.description), `${name}: describe the comparable baseline or why it is unavailable`);
  if (baseline.status === 'provided') assert(fixedRef(baseline.ref), `${name}: provided baseline needs a fixed reference`);
  assert(Array.isArray(basis.limitations) && basis.limitations.length > 0 && basis.limitations.length <= 32 && basis.limitations.every(text), `${name}: record applicability and limitations`);
  return [...basis.refs, ...(baseline.status === 'provided' ? [baseline.ref] : []), ...samplingEvidence(basis.sampling, basis, context, name)];
}

export function inferenceEvidence(steps, context, name) {
  assert(Array.isArray(steps) && steps.length > 0 && steps.length <= 64, `${name}: inference evidence requires 1–64 claims`);
  const refs = [], ids = new Set();
  for (const step of steps) {
    assert(object(step) && text(step.id) && !ids.has(step.id) && text(step.claim), `${name}: claims need unique IDs and a stated inference`);
    ids.add(step.id);
    const evidence = step.evidence_refs === undefined ? [] : step.evidence_refs;
    assert(Array.isArray(evidence) && evidence.length <= 32 && evidence.every(fixedRef), `${name}: inference evidence_refs must be fixed references`);
    refs.push(...evidence);
    validateKnowledgeBasis(step.knowledge_basis, `${name}/${step.id}`);
    refs.push(...validateOrigin(step.origin, step, `${name}/${step.id}`));
    validateReasoning(step.reasoning, step, `${name}/${step.id}`, true);
    const unsupported = step.status === 'unavailable' || step.status === 'pending';
    if (unsupported) {
      assert(text(step.reason) && step.confidence === undefined, `${name}: unsupported claims must explain the gap without a confidence value`);
    } else {
      assert(step.status === undefined || step.status === 'provided', `${name}: invalid inference status`);
      assert(text(step.method_ref) && confidenceValue(step.confidence), `${name}: each supported claim needs its own method and confidence definition`);
    }
    // A missing judgment does not require invented history. Any supplied
    // comparison or validation is still rendered evidence and must be bound.
    if (!unsupported || step.validation !== undefined) {
      assert(object(step.validation) && ['unvalidated', 'historical_exploration', 'out_of_sample', 'prospective'].includes(step.validation.status), `${name}: each claim needs an explicit validation state`);
      assert(step.validation.note === undefined || text(step.validation.note), `${name}: invalid inference validation note`);
      const history = step.validation.history_refs === undefined ? [] : step.validation.history_refs;
      assert(Array.isArray(history) && history.length <= 32 && history.every(fixedRef), `${name}: inference validation history_refs must be fixed references`);
      refs.push(...history);
      if (['out_of_sample', 'prospective'].includes(step.validation.status)) {
        assert(history.length > 0 && text(step.method_ref), `${name}: validated claims require a method and historical result references`);
      }
    }
    if (!unsupported || step.historical_basis !== undefined) refs.push(...historicalBasis(step.historical_basis, context, `${name}/${step.id}`));
  }
  return refs;
}
