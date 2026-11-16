// Display supplied label/value pairs. This component has no research schema.
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = value => typeof value === 'string' && value.trim() && value.length <= 20000;
const pair = (item, details = false) => item && typeof item === 'object' && !Array.isArray(item)
  && Object.keys(item).every(key => ['label', 'value', ...(details ? ['details'] : [])].includes(key))
  && text(item.label) && text(item.value);

export function renderJudgments(items) {
  if (!Array.isArray(items) || !items.length || items.length > 200 || !items.every(item => pair(item, true)
    && (item.details === undefined || Array.isArray(item.details) && item.details.length <= 12 && item.details.every(entry => pair(entry))))) {
    throw new Error('Judgments need 1–200 supplied label/value pairs and optional named details');
  }
  return `<div class="report-judgments" role="list">${items.map(item => `<div class="report-judgment-item" role="listitem"><p>${escape(item.label)}</p><strong>${escape(item.value)}</strong>${item.details?.length ? `<dl>${item.details.map(entry => `<div><dt>${escape(entry.label)}</dt><dd>${escape(entry.value)}</dd></div>`).join('')}</dl>` : ''}</div>`).join('')}</div>`;
}
