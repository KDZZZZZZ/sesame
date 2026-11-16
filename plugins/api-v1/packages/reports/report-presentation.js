// Declarative projections of supplied results. No scoring, valuation or
// probability calculation belongs in this layer.
import { renderText } from './report-text.js';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const own = (value, key) => object(value) && key && Object.hasOwn(value, key) ? value[key] : undefined;
const judgmentMappings = ['subject', 'horizon', 'basis', 'condition', 'history'];

export function presentationDefinition(presentation, type) {
  if (presentation === undefined || presentation === null) return;
  const allowed = ['kind', 'value', 'label', 'lower', 'upper', 'reference', 'min', 'max', 'unit', 'unit_field', 'scale', 'scale_label', 'caption', 'meta', 'digits', ...judgmentMappings];
  if (!object(presentation) || Object.keys(presentation).some(key => !allowed.includes(key)) || !['metric', 'range', 'scores', 'judgments'].includes(presentation.kind)) throw new Error('Invalid field presentation');
  for (const key of ['value','label','lower','upper','reference','caption','unit_field','scale','scale_label',...judgmentMappings]) if (presentation[key] !== undefined && !text(presentation[key])) throw new Error(`Presentation ${key} must be nonempty text`);
  if ((presentation.scale === undefined) !== (presentation.scale_label === undefined)) throw new Error('Presentation scale guard needs both scale and scale_label');
  if (presentation.unit !== undefined && (typeof presentation.unit !== 'string' || presentation.unit.length > 100)) throw new Error('Invalid presentation unit');
  if (presentation.meta !== undefined && (!Array.isArray(presentation.meta) || presentation.meta.length > 6 || !presentation.meta.every(text))) throw new Error('Invalid presentation metadata');
  if (presentation.digits !== undefined && (!Number.isInteger(presentation.digits) || presentation.digits < 0 || presentation.digits > 6)) throw new Error('Presentation digits must be 0–6');
  const hasDomain = presentation.min !== undefined || presentation.max !== undefined;
  if (hasDomain && (!finite(presentation.min) || !finite(presentation.max) || presentation.min >= presentation.max)) throw new Error('Presentation scale needs finite min < max');
  if (presentation.kind === 'judgments') {
    if (type !== 'array' || !presentation.label || !presentation.value) throw new Error('Judgments need an array and explicit label and value mappings');
    if (Object.keys(presentation).some(key => !['kind','label','value','caption','meta',...judgmentMappings].includes(key))) throw new Error('Judgments use property mappings, not numeric scales or formatting');
  } else if (judgmentMappings.some(key => presentation[key] !== undefined)) throw new Error('Judgment mappings require a judgments presentation');
  if (presentation.kind === 'scores' && (type !== 'array' || !presentation.label || !presentation.value || !hasDomain)) throw new Error('Scores need an array, label, value and explicit scale');
  if (presentation.kind === 'range' && (type !== 'object' || !presentation.lower || !presentation.upper)) throw new Error('Range needs an object and explicit endpoint mappings');
  if (presentation.kind === 'metric') {
    if (type === 'number' || type === 'integer') {
      if (['value','label','lower','upper','reference','caption','meta','unit_field','scale','scale_label'].some(key => presentation[key] !== undefined)) throw new Error('Scalar metric does not use object property mappings');
    } else if (type !== 'object' || !presentation.value) throw new Error('Metric needs a number, integer, or an object with a value mapping');
  }
}

/** Return null if supplied values do not support this view; keep all raw data. */
export function presentValue(field, value, { escape, valueHTML, locale, tr }) {
  if (!field.presentation) return null;
  const scalar = field.type === 'number' || field.type === 'integer';
  const p = scalar ? { ...field.presentation, unit: field.presentation.unit ?? field.unit } : field.presentation;
  const scopeMatches = entry => (!p.scale || own(entry,p.scale) === p.scale_label) && (!p.unit_field || own(entry,p.unit_field) === p.unit);
  if (!(Array.isArray(value) ? value.every(scopeMatches) : scopeMatches(value))) return null;
  const number = value => new Intl.NumberFormat(locale, { maximumFractionDigits: p.digits ?? 2 }).format(value);
  const format = value => escape(finite(value) ? number(value) : value);
  const withUnit = value => `${format(value)}${p.unit ? `<span class="module-number-unit">${escape(p.unit)}</span>` : ''}`;
  const validScalar = value => finite(value) || typeof value === 'string' && value.trim().length > 0;
  const inside = value => finite(value) && value >= p.min && value <= p.max;
  const position = (value, min, max) => ((value - min) / (max - min) * 100).toFixed(4);
  const context = (source, against = []) => {
    const captionValue = own(source, p.caption);
    const caption = validScalar(captionValue) ? renderText(finite(captionValue) ? number(captionValue) : captionValue, { role: 'context', against }) : '';
    // Property labels carry meaning too: equal values under different labels
    // are not duplicates. Only a repeated mapping of the caption is omitted.
    const metadata = [...new Set(p.meta ?? [])].flatMap(key => {
      const entry = own(source, key);
      if (entry === undefined || entry === null || typeof entry === 'object' || key === p.caption && validScalar(captionValue)) return [];
      return [`<p><span>${escape(key)}</span> ${renderText(finite(entry) ? number(entry) : entry, { role: 'context', tag: 'span' })}</p>`];
    }).join('');
    return caption || metadata ? `<div class="module-visual-context" data-report-text="context">${caption}${metadata}</div>` : '';
  };
  const details = `<details class="module-value-details"><summary>${tr('数据与口径', 'Data and definitions')}</summary>${renderText(field.meaning, { role: 'evidence', className: 'module-field-definition' })}${valueHTML(value)}</details>`;
  let body;
  if (p.kind === 'judgments') {
    const prose = entry => typeof entry === 'string' && entry.trim().length > 0;
    const optionalText = ['caption', ...judgmentMappings].filter(key => p[key] !== undefined);
    // Every row must support the projection. Missing optional properties may
    // stay absent, but incompatible values and long arrays use the complete
    // fact layout instead of silently dropping rows or nested content.
    if (!Array.isArray(value) || !value.length || value.length > 24 || !Array.from(value).every(item =>
      prose(own(item,p.label)) && prose(own(item,p.value))
      && optionalText.every(key => own(item,p[key]) == null || prose(own(item,p[key])))
      && (p.meta ?? []).every(key => own(item,key) == null || prose(own(item,key)) || finite(own(item,key)) || typeof own(item,key) === 'boolean')
    )) return null;
    const support = [['basis', tr('依据', 'Basis')], ['condition', tr('改判条件', 'Change conditions')], ['history', tr('历史参照', 'Historical reference')]];
    body = `<div class="module-judgments" role="list">${value.map(item => {
      const contextKeys = [p.label, p.subject, p.horizon].filter(key => prose(own(item,key)));
      const reasons = support.filter(([key]) => prose(own(item,p[key])));
      const shown = [...contextKeys, p.value, ...reasons.map(([key]) => p[key])].map(key => own(item, key));
      return `<div class="module-judgment" role="listitem"><p class="module-judgment-context" data-report-text="context">${contextKeys.map(key => `<span>${escape(own(item,key))}</span>`).join('')}</p><p class="module-judgment-value" data-report-text="body"><strong>${escape(own(item,p.value))}</strong></p>${reasons.length ? `<dl class="module-judgment-support" data-report-text="context">${reasons.map(([key,label]) => `<div><dt>${escape(label)}</dt><dd>${escape(own(item,p[key]))}</dd></div>`).join('')}</dl>` : ''}${context(item, shown)}</div>`;
    }).join('')}</div>`;
  } else if (p.kind === 'scores') {
    if (!Array.isArray(value) || !value.length || value.length > 24 || !value.every(item => validScalar(own(item,p.label)) && inside(own(item,p.value)))) return null;
    body = `<div class="module-scores">${value.map(item => {
      const score = own(item,p.value), label = own(item,p.label);
      return `<div class="module-score"><div class="module-score-heading"><span>${format(label)}</span><strong>${withUnit(score)}</strong></div><div class="module-meter" role="meter" aria-label="${escape(label)}" aria-valuemin="${p.min}" aria-valuemax="${p.max}" aria-valuenow="${score}"><span style="width:${position(score,p.min,p.max)}%"></span></div>${context(item, [label])}</div>`;
    }).join('')}</div>${renderText(`${tr('原始尺度', 'Source scale')} ${number(p.min)}–${number(p.max)}${p.unit ? ` ${p.unit}` : ''}`, { role: 'context' })}`;
  } else if (p.kind === 'range') {
    const lower = own(value,p.lower), upper = own(value,p.upper), marker = own(value,p.reference ?? p.value);
    // Do not clip an out-of-range observation, invent a midpoint or parse a
    // number from arbitrary text. The full fact layout is the honest fallback.
    if (!finite(lower) || !finite(upper) || lower >= upper || marker !== undefined && (!finite(marker) || marker < lower || marker > upper)) return null;
    const label = p.reference ?? p.value;
    body = `${marker === undefined ? '' : `<div class="module-range-current"><span>${escape(label)}</span><strong>${withUnit(marker)}</strong></div>`}<div class="module-range-graphic" role="img" aria-label="${escape(`${field.label}: ${lower}–${upper} ${p.unit ?? ''}${marker === undefined ? '' : `; ${label} ${marker}`}`)}"><div class="module-range-track">${marker === undefined ? '' : `<span class="module-range-marker" style="left:${position(marker,lower,upper)}%"></span>`}</div></div><div class="module-range-ends"><span><small>${escape(p.lower)}</small><strong>${withUnit(lower)}</strong></span><span><small>${escape(p.upper)}</small><strong>${withUnit(upper)}</strong></span></div>${context(value)}`;
  } else {
    const main = scalar ? value : own(value,p.value);
    if (!validScalar(main)) return null;
    const scale = p.min === undefined || !inside(main) ? '' : `<div class="module-meter" role="meter" aria-label="${escape(field.label)}" aria-valuemin="${p.min}" aria-valuemax="${p.max}" aria-valuenow="${main}"><span style="width:${position(main,p.min,p.max)}%"></span></div>${renderText(`${number(p.min)}–${number(p.max)}`, { role: 'context' })}`;
    body = `<p class="module-metric-value">${withUnit(main)}</p>${scale}${context(value)}`;
  }
  return { kind: p.kind, html: `${body}${details}` };
}
