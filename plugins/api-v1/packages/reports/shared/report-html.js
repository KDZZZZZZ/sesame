// Conservative source analysis, not an HTML sanitizer. Runtime CSP, bundle
// digests and the renderer remain authoritative. Unknown executable/dynamic
// content may be rendered in isolation, but must never be silently relocated.
const namedEntities = Object.freeze({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', colon: ':', sol: '/', bsol: '\\', period: '.', num: '#', Tab: '\t', NewLine: '\n' });
function decodeAttribute(value) {
  let known = true;
  const text = value.replace(/&(#(?:x[\da-f]+|\d+);?|[a-z][\da-z]*;?)/gi, (entity, name) => {
    if (name[0] === '#') {
      const hex = /^#x/i.test(name), number = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)) return String.fromCodePoint(number);
    } else if (name.endsWith(';') && Object.hasOwn(namedEntities, name.slice(0, -1))) return namedEntities[name.slice(0, -1)];
    known = false; return entity;
  });
  return { text, known };
}

/** selfContained is true, false (known dependency), or null (cannot prove). */
export function analyzeReportHtml(html) {
  if (typeof html !== 'string') return { selfContained: false, relocatable: false, elements: [], reasons: [{ code: 'invalid_html', message: 'Expected HTML text.' }] };
  const reasons = [], elements = [];
  let dependency = false, uncertain = false;
  const issue = (code, message, knownDependency = false) => {
    if (knownDependency) dependency = true; else uncertain = true;
    if (reasons.length < 20 && !reasons.some(reason => reason.code === code && reason.message === message)) reasons.push({ code, message });
  };
  const url = (value, where, navigation = false) => {
    const decoded = decodeAttribute(value);
    if (!decoded.known) issue('ambiguous_url', `${where} contains an unresolved HTML entity.`);
    const target = decoded.text.trim();
    if (/^[#]/.test(target)) return;
    if (/^data:/i.test(target) && !navigation) return;
    if (navigation) {
      try { const parsed = new URL(target); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return; } catch { /* Relative or malformed links depend on the source location. */ }
    }
    issue('resource_dependency', `${where} is not a self-contained ${navigation ? 'link' : 'resource'}.`, true);
  };
  const css = (value, where) => {
    let text = '', quote = '';
    for (let index = 0; index < value.length; index++) {
      const char = value[index];
      if (char === '\\') { text += char + (value[++index] ?? ''); continue; }
      if (quote) { text += char; if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; text += char; continue; }
      if (char === '/' && value[index + 1] === '*') {
        const end = value.indexOf('*/', index + 2);
        if (end < 0) { issue('dynamic_css', `${where} has an unclosed comment.`); break; }
        text += ' '; index = end + 1;
      } else text += char;
    }
    if (quote) issue('dynamic_css', `${where} has an unclosed string.`);
    if (text.includes('\\') || /\b(?:image-set|image|src)\s*\(/i.test(text)) issue('dynamic_css', `${where} contains CSS resource syntax that cannot be proved location independent.`);
    if (/@import\b/i.test(text)) issue('resource_dependency', `${where} imports a stylesheet.`, true);
    for (const match of text.matchAll(/\burl\s*\(/gi)) {
      const start = match.index + match[0].length, end = text.indexOf(')', start);
      if (end < 0) { issue('ambiguous_url', `${where} contains an unclosed CSS URL.`); break; }
      const resource = text.slice(start, end).trim();
      const quoted = /^(["'])([^\\]*)\1$/.exec(resource);
      if (quoted && !quoted[2].includes(quoted[1])) url(quoted[2], `${where} url()`);
      else if (!/[\s'"()\\]/.test(resource)) url(resource, `${where} url()`);
      else issue('ambiguous_url', `${where} contains a dynamic or malformed CSS URL.`);
    }
  };
  // Fully consume each tag, including unquoted and entity-encoded attributes.
  // Raw script/style text is consumed separately; it is never parsed as markup.
  let offset = 0;
  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start < 0) break;
    const comment = html.startsWith('<!--', start);
    const end = html.indexOf(comment ? '-->' : '>', start + (comment ? 4 : 1));
    if (end < 0) { issue('ambiguous_html', 'HTML contains unclosed markup.'); break; }
    const text = html.slice(start, end + (comment ? 3 : 1));
    offset = end + (comment ? 3 : 1);
    if (comment) {
      if (/^<!--(?:>|->)/.test(text) || text.includes('--!>') || text.slice(4).includes('<!--'))
        issue('ambiguous_html', 'HTML has a comment with ambiguous browser parsing.');
      continue;
    }
    if (/^<!doctype\s+html\s*>$/i.test(text) || /^<\/[a-z][\w:-]*\s*>$/i.test(text)) continue;
    const head = /^<([a-z][\w:-]*)/i.exec(text);
    if (!head || text.slice(1).includes('<')) { issue('ambiguous_html', 'HTML contains markup that cannot be safely classified.'); continue; }
    const name = head[1].toLowerCase();
    let tail = text.slice(head[0].length, -1).replace(/\/$/, ''), cursor = 0;
    const attributes = [], attributeNames = new Set(), attribute = /\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/gy;
    while (cursor < tail.length) {
      if (!tail.slice(cursor).trim()) break;
      attribute.lastIndex = cursor;
      const part = attribute.exec(tail);
      if (!part) { issue('ambiguous_html', `<${name}> has an ambiguous attribute.`); break; }
      const key = part[1].toLowerCase(), value = part[2] ?? part[3] ?? part[4] ?? '';
      if (attributeNames.has(key)) issue('ambiguous_html', `<${name}> repeats an attribute.`);
      attributeNames.add(key); attributes.push({ name: key, value }); cursor = attribute.lastIndex;
      if (key === 'style') { const decoded = decodeAttribute(value); if (!decoded.known) issue('ambiguous_url', 'Style contains unresolved HTML entities.'); css(decoded.text, 'style attribute'); }
      else if (/^on/.test(key)) issue('dynamic_html', 'An event handler can construct location-dependent resources.');
      else if (['srcset', 'imagesrcset', 'srcdoc', 'ping', 'archive', 'xml:base'].includes(key)) issue('resource_dependency', `${key} requires a packaged or explicitly resolved resource.`, true);
      else if (['src', 'href', 'xlink:href', 'poster', 'action', 'formaction', 'data', 'codebase', 'background', 'cite', 'longdesc', 'profile', 'manifest', 'usemap'].includes(key))
        url(value, `<${name}> ${key}`, ['a', 'area'].includes(name) && ['href', 'xlink:href'].includes(key));
    }
    elements.push({ name, attributes });
    if (['animate', 'animatemotion', 'animatetransform', 'set'].includes(name) || /[:-]/.test(name))
      issue('dynamic_html', `<${name}> can construct location-dependent resources.`);
    if (['base', 'iframe', 'object', 'embed', 'applet', 'portal', 'fencedframe', 'link', 'form'].includes(name) || name === 'meta' && attributes.some(attr => attr.name === 'http-equiv'))
      issue('resource_dependency', `<${name}> requires its original resource context.`, true);
    if (['script', 'style', 'textarea', 'title', 'xmp', 'plaintext'].includes(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'gi'); close.lastIndex = offset;
      const end = close.exec(html);
      if (!end) { issue('ambiguous_html', `<${name}> is not closed.`); break; }
      const body = html.slice(offset, end.index);
      if (name === 'style') css(body, '<style>');
      if (name === 'script' && !attributes.some(attr => attr.name === 'type' && /^(?:application\/(?:ld\+)?json|importmap)$/i.test(attr.value.trim())))
        issue('dynamic_html', 'Executable scripts can construct resources; do not relocate without a resource contract.');
      if (name === 'script' && attributes.some(attr => attr.name === 'type' && attr.value.trim().toLowerCase() === 'importmap')) issue('dynamic_html', 'An import map is location dependent.');
      if (['xmp', 'plaintext'].includes(name)) issue('ambiguous_html', `<${name}> has legacy parsing semantics.`);
      offset = close.lastIndex;
    }
  }
  if (html.slice(offset).includes('<')) issue('ambiguous_html', 'HTML contains unclosed or ambiguous markup.');
  const selfContained = dependency ? false : uncertain ? null : true;
  return { selfContained, relocatable: selfContained === true, elements, reasons };
}
