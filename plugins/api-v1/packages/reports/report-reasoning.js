// Presentation only: project supplied facts, explanations and evidence. The
// caller validates the result contract and selects/estimates all research data.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length ? value : '';
const count = value => Number.isSafeInteger(value) && value >= 0;
const safeEscape = value => String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const agreements = {
  supporting: ['支持', 'Supports'], conflicting: ['冲突', 'Conflicts'],
  mixed: ['结果混合', 'Mixed results'], insufficient: ['依据不足', 'Insufficient evidence'],
};
const labels = {
  scenario:['历史情景','Historical scenario'], target:['结果定义','Outcome definition'], horizon:['观察期限','Horizon'],
  matching_method_ref:['匹配方法','Matching method'], window:['观察窗口','Observed window'], start:['开始','Start'], end:['结束','End'], as_of:['截点','As of'],
  sample:['样本','Sample'], matched:['匹配','Matched'], resolved:['已结算','Resolved'], pending:['待结算','Pending'], excluded:['排除','Excluded'], effective:['有效样本量','Effective sample'],
  outcomes:['实际结果','Observed outcomes'], label:['结果','Outcome'], count:['数量','Count'],
  baseline:['基准','Baseline'], status:['状态','Status'], description:['说明','Description'], ref:['引用','Reference'], refs:['固定引用','Fixed references'],
  dependence:['样本依赖','Sample dependence'], uncertainty:['不确定性','Uncertainty'], limitations:['限制','Limitations'],
  sampling:['样本选择','Sample selection'], policy:['选择规则','Selection policy'], subject:['研究品种','Subject'], selected_scope:['选样范围','Selected scope'],
  instruments:['样本品种','Sample instruments'], recent_window:['近期检索窗口','Recent search window'], primary_search:['首轮检索','Primary search'], eligible_count:['符合条件数量','Eligible cases'],
  comparability:['可比性','Comparability'], override_reason:['自定义范围原因','Custom scope reason'],
  id:['标识','ID'], revision:['修订','Revision'], digest:['内容摘要','Digest'], kind:['引用种类','Reference kind'], schemaVersion:['格式版本','Schema version'],
  definition:['定义','Definition'], estimate:['给定估计','Supplied estimate'], assessment:['评价','Assessment'], interval:['给定区间','Supplied interval'],
  lower:['下界','Lower'], upper:['上界','Upper'], level:['区间水平','Interval level'], method_ref:['方法','Method'],
  mechanism:['机制','Mechanism'], assumptions:['成立条件','Assumptions'], expected_observation:['预期观察','Expected observation'],
  interpretation:['对照解释','Comparison explanation'], theory_refs:['知识来源','Knowledge sources'], history_refs:['验证引用','Validation references'], note:['说明','Note'], reason:['结果说明','Result explanation'],
  confidence:['给定置信度','Supplied confidence'], validation:['验证记录','Validation record'], evidence_refs:['证据引用','Evidence references'],
};

function helpersFor(helpers = {}) {
  const escape = typeof helpers.escape === 'function' ? helpers.escape : safeEscape;
  const tr = typeof helpers.tr === 'function' ? helpers.tr : chinese => chinese;
  return { ...helpers, escape, tr, label: (chinese, english) => escape(tr(chinese, english)) };
}

// A readable, lossless fallback for supplied evidence when the host does not
// provide historyHTML/confidenceHTML. Never parses prose, URLs or numbers.
function structured(value, helpers) {
  const { escape, tr } = helpers;
  if (value === undefined) return '';
  if (value === null) return '<span>—</span>';
  if (typeof value !== 'object') return escape(value);
  if (Array.isArray(value)) return `<ul class="report-reasoning-detail-list">${value.map(item => `<li>${structured(item, helpers)}</li>`).join('')}</ul>`;
  return `<dl class="report-reasoning-definition">${Object.entries(value).map(([key, entry]) => `<div><dt>${escape(labels[key] ? tr(...labels[key]) : key)}</dt><dd>${structured(entry, helpers)}</dd></div>`).join('')}</dl>`;
}

function suppliedConfidence(value, helpers) {
  if (!object(value.confidence)) return '';
  const { escape, label } = helpers, supplied = value.confidence;
  const fallback = `<p><strong>${escape(supplied.estimate === undefined ? supplied.assessment ?? '' : supplied.estimate)}</strong>${text(supplied.definition) ? ` · ${escape(supplied.definition)}` : ''}</p>${supplied.estimate !== undefined && text(supplied.assessment) ? `<p>${escape(supplied.assessment)}</p>` : ''}${object(supplied.interval) ? `<p>${label('区间', 'Interval')} ${escape(supplied.interval.lower)}–${escape(supplied.interval.upper)} · ${label('水平', 'level')} ${escape(supplied.interval.level)}</p>` : ''}`;
  const content = typeof helpers.confidenceHTML === 'function'
    ? helpers.confidenceHTML(value.confidence)
    : fallback;
  return `<div class="report-reasoning-confidence">${content}</div>`;
}

function historicalShare(basis, helpers) {
  const total = basis?.sample?.resolved, outcomes = basis?.outcomes;
  // Only a small, complete set of original counts becomes a graphic. This is
  // an observed count/denominator ratio, never a new confidence estimate.
  if (!count(total) || !total || !Array.isArray(outcomes) || !outcomes.length || outcomes.length > 4
    || !outcomes.every(row => object(row) && text(row.label) && count(row.count))
    || outcomes.reduce((sum, row) => sum + row.count, 0) !== total) return '';
  const { escape, label } = helpers;
  return `<figure class="report-reasoning-shares"><figcaption>${label('历史比例', 'Historical proportions')}</figcaption><ul role="list">${outcomes.map(row => {
    const width = row.count / total * 100;
    const share = new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(width);
    return `<li><div class="report-reasoning-share-label"><span>${escape(row.label)}</span><span>${row.count}/${total} · ${share}%</span></div><span class="report-reasoning-share-track" aria-hidden="true"><span style="width:${width}%"></span></span></li>`;
  }).join('')}</ul></figure>`;
}

function historyProjection(value, history, helpers) {
  const basis = object(value.historical_basis) ? value.historical_basis : undefined;
  const display = ['summary', 'hidden'].includes(helpers.historyDisplay) ? helpers.historyDisplay : 'full';
  if (display === 'hidden') return { status: history?.status ?? (basis ? 'linked' : 'pending'), hidden: true, html: '', full: '' };
  const callback = typeof helpers.historyHTML === 'function' ? helpers.historyHTML : null;
  // A caller may resolve a real outer context in this callback. Empty markup
  // never establishes a link; the default host callback returns '' for no basis.
  const context = !basis && history?.status === 'linked' && callback
    ? callback(undefined, value.validation, 'summary') : '';
  const linked = Boolean(basis || typeof context === 'string' && context.trim());
  const requested = history?.status;
  const status = requested === 'linked' && !linked ? 'pending'
    : ['linked', 'pending', 'unavailable', 'not_applicable'].includes(requested) ? requested
    : linked ? 'linked' : value.status === 'unavailable' ? 'unavailable' : 'pending';
  const { escape, label } = helpers;
  const defaultNotes = {
    pending: ['历史对照待补充', 'Historical comparison pending'],
    unavailable: ['暂无可比历史', 'Comparable history unavailable'],
    not_applicable: ['本项无需历史对照', 'Historical comparison is not needed for this item'],
  };
  const unresolved = requested === 'linked' && !linked;
  const note = text(history?.note) || (!linked ? text(value.reason) : '');
  const noteHTML = `${unresolved ? `<p class="report-reasoning-gap">${label('历史依据待关联', 'Historical evidence not linked')}</p>` : ''}${note ? `<p class="report-reasoning-note">${escape(note)}</p>` : defaultNotes[status] ? `<p class="report-reasoning-gap">${label(...defaultNotes[status])}</p>` : ''}`;
  const resolved = basis?.sample?.resolved;
  const countHTML = count(resolved) ? `<p class="report-reasoning-sample"><strong>${resolved}</strong> ${label('个已结算情景', 'resolved cases')}</p>` : '';
  const suppliedSummary = display === 'summary' && basis && callback ? callback(basis, value.validation, 'summary') : '';
  const compact = status === 'linked'
    ? display === 'summary' ? (text(suppliedSummary) || (basis ? countHTML : context))
      : `${countHTML}${basis ? historicalShare(basis, helpers) : context}`
    : '';
  const full = display === 'full' && basis ? callback ? callback(basis, value.validation, 'full') : structured(basis, helpers) : '';
  // If an enclosing caller already rendered complete evidence, it can return
  // an empty full body and a real summary link. We do not invent that link.
  return { status, html: `${noteHTML}${compact}`, full };
}

function comparison(value, helpers) {
  const key = value.knowledge_basis?.agreement ?? value.status;
  return Object.hasOwn(agreements, key) ? `<span class="report-reasoning-comparison" data-agreement="${key}">${helpers.label(...agreements[key])}</span>` : '';
}

function details(value, history, helpers) {
  const { label } = helpers;
  const knowledge = value.knowledge_basis;
  const items = [];
  if (history) items.push(`<div class="report-reasoning-history-detail">${history}</div>`);
  if (object(knowledge)) {
    const supplied = Object.fromEntries(['mechanism','assumptions','expected_observation','interpretation','theory_refs'].filter(key => knowledge[key] !== undefined).map(key => [key, knowledge[key]]));
    if (Object.keys(supplied).length) items.push(structured(supplied, helpers));
  }
  const references = Object.fromEntries(['confidence','reason','method_ref','validation','evidence_refs','theory_refs'].filter(key => value[key] !== undefined).map(key => {
    if (key === 'validation' && helpers.historyDisplay === 'hidden' && object(value.validation)) {
      const { history_refs, ...validation } = value.validation;
      return [key, validation];
    }
    return [key, value[key]];
  }));
  if (Object.keys(references).length) items.push(structured(references, helpers));
  return items.length ? `<details class="report-reasoning-details"><summary>${label('完整依据', 'Evidence details')}</summary><div class="report-reasoning-details-body">${items.join('')}</div></details>` : '';
}

/**
 * Return an HTML string only when value.reasoning exists. All prose is escaped.
 * historyHTML and confidenceHTML are trusted host-rendered HTML callbacks;
 * historyHTML accepts (basis, validation, display), confidenceHTML(confidence).
 * Optional historyDisplay: full (default), summary, or hidden.
 * No validation, fetching, matching, model invocation or confidence estimation.
 */
export function renderReasoning(value, helpers = {}) {
  if (!object(value) || !object(value.reasoning)) return '';
  const h = helpersFor(helpers), { escape, label } = h, reasoning = value.reasoning;
  const history = historyProjection(value, reasoning.history, h);
  const list = (values, ordered) => {
    const rows = Array.isArray(values) ? values.filter(entry => text(entry)) : [];
    const tag = ordered ? 'ol' : 'ul';
    return `<${tag} class="report-reasoning-list" role="list">${rows.map(entry => `<li>${escape(entry)}</li>`).join('')}</${tag}>`;
  };
  const heading = text(value.claim) ? `<h4 class="report-reasoning-claim">${escape(value.claim)}</h4>` : '';
  const step = (key, chinese, english, content) => `<section class="report-reasoning-step" data-step="${key}" aria-label="${label(chinese, english)}"><h5 class="report-reasoning-label">${label(chinese, english)}</h5>${content}</section>`;
  const conclusion = text(reasoning.conclusion) ? `<div class="report-reasoning-conclusion"><span class="report-reasoning-label">${label('判断', 'Judgment')}</span><p>${escape(reasoning.conclusion)}</p>${suppliedConfidence(value, h)}</div>` : suppliedConfidence(value, h);
  return `<section class="report-reasoning" data-history-status="${escape(history.status)}">${heading}<div class="report-reasoning-flow${history.hidden ? ' report-reasoning-flow-short' : ''}">${step('observations','观察','Observations',list(reasoning.observations, false))}${step('explanation','解释','Explanation',list(reasoning.steps, true))}${history.hidden ? '' : step('history','历史对照','Historical comparison',`${comparison(value, h)}${history.html}`)}</div>${conclusion}${details(value, history.full, h)}</section>`;
}

/** Backward-compatible projection of an inference without a reasoning block. */
export function renderInference(value, helpers = {}) {
  if (!object(value)) return '';
  if (object(value.reasoning)) return renderReasoning(value, helpers);
  const h = helpersFor(helpers), history = historyProjection(value, undefined, h);
  const claim = text(value.claim) ? `<h4 class="report-reasoning-claim">${h.escape(value.claim)}</h4>` : '';
  const reason = (history.hidden || history.status === 'linked') && text(value.reason) ? `<p class="report-reasoning-note">${h.escape(value.reason)}</p>` : '';
  const interpretation = text(value.knowledge_basis?.interpretation) ? `<p class="report-reasoning-note">${h.escape(value.knowledge_basis.interpretation)}</p>` : '';
  return `<section class="report-reasoning-inference" data-history-status="${h.escape(history.status)}">${claim}${reason}${suppliedConfidence(value, h)}${history.hidden ? '' : `${comparison(value, h)}${interpretation}<div class="report-reasoning-legacy-history">${history.html}</div>`}${details(value, history.full, h)}</section>`;
}
