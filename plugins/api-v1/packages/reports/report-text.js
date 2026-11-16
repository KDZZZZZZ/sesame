// Text ownership shared by report layouts. Only exact authored repetitions are
// removed; no interpretation, truncation, or inferred conclusions belong here.
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const textKey = value => value == null ? '' : String(value).normalize('NFC').trim().replace(/\s+/gu, ' ');
export const isDuplicateText = (value, against = []) => Boolean(textKey(value)) && against.some(other => textKey(value) === textKey(other));

export function renderText(value, { role = 'context', tag = 'p', className = '', against = [] } = {}) {
  if (!textKey(value) || isDuplicateText(value, against)) return '';
  if (!['title', 'body', 'context', 'legend', 'evidence'].includes(role) || !['p', 'span', 'strong', 'div', 'caption', 'h2', 'h3'].includes(tag))
    throw new Error('Unsupported report text role or element');
  return `<${tag}${className ? ` class="${escape(className)}"` : ''} data-report-text="${role}">${escape(value)}</${tag}>`;
}
