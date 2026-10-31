import { fetchSource, unavailableSource } from './fetch.js';
import { digest, now, requireValue } from './support.js';

const endpoint = 'https://lite.duckduckgo.com/lite/';
const ranges = { any: '', day: 'd', week: 'w', month: 'm', year: 'y' };
const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (raw, value) => {
  if (value[0] !== '#') return entities[value.toLowerCase()] ?? raw;
  const n = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
});
const plain = text => decode(text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function attributes(text) {
  const attrs = {};
  for (const match of text.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const key = match[1].toLowerCase();
    if (!Object.hasOwn(attrs, key)) attrs[key] = decode(match[2] ?? match[3] ?? match[4]);
  }
  return attrs;
}
const hasClass = (attrs, name) => (attrs.class ?? '').split(/\s+/).includes(name);
function resultUrl(href) {
  try {
    let url = new URL(href, endpoint);
    if (url.hostname === 'duckduckgo.com' && url.pathname === '/l/') url = new URL(url.searchParams.get('uddg'));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /(^|\.)duckduckgo\.com$/i.test(url.hostname)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function searchRequest({ query, site, time_range = 'any', limit = 10 } = {}) {
  requireValue(typeof query === 'string' && query.trim().length > 0 && query.length <= 500, 'query 需为 1–500 字符的公开检索词');
  requireValue(Object.hasOwn(ranges, time_range), 'time_range 仅支持 any/day/week/month/year');
  requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 20, 'limit 需为 1–20');
  if (site !== undefined) requireValue(typeof site === 'string' && site.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(site), 'site 需为无协议、端口或路径的域名');
  const requested = { query: query.trim(), site: site?.toLowerCase() ?? null, time_range, limit };
  const url = new URL(endpoint);
  url.searchParams.set('q', `${requested.site ? `site:${requested.site} ` : ''}${requested.query}`);
  if (ranges[time_range]) url.searchParams.set('df', ranges[time_range]);
  return { ...requested, url: url.href };
}

// A bounded adapter for the public non-JavaScript page, not an undocumented JSON API.
export function parseSearchPage(html, { site = null, limit = 10 } = {}) {
  if (/<(?:form|div)\b[^>]*(?:challenge-form|anomaly-modal)|(?:src|action)\s*=\s*["'][^"']*anomaly\.js/i.test(html)) {
    return { error: { code: 'search_challenge', message: '搜索入口要求人工验证；本次未取得搜索证据' } };
  }
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
    .filter(match => hasClass(attributes(match[1]), 'result-link'));
  if (!anchors.length) {
    const noResults = /class\s*=\s*["'][^"']*\bno-results\b/i.test(html) || /<[^>]+>\s*No (?:more )?results(?: found)?(?:\.|\s+for\b)/i.test(html);
    if (!noResults) return { error: { code: 'search_format_error', message: '搜索页面未包含可识别结果或明确零结果标记；不能视为空样本' } };
  }
  const rows = [], seen = new Set();
  for (let index = 0; index < anchors.length; index++) {
    const match = anchors[index], attrs = attributes(match[1]), url = resultUrl(attrs.href);
    if (!url) continue;
    const host = new URL(url).hostname.toLowerCase();
    if (site && host !== site && !host.endsWith(`.${site}`)) continue;
    if (seen.has(url)) continue;
    const title = plain(match[2]);
    if (!title) continue;
    seen.add(url);
    const tail = html.slice(match.index + match[0].length, anchors[index + 1]?.index ?? html.length);
    const snippet = [...tail.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td\s*>/gi)].find(item => hasClass(attributes(item[1]), 'result-snippet'));
    rows.push({ rank: index + 1, title, url, snippet: snippet ? plain(snippet[2]).slice(0, 2000) : '', published_at: null });
  }
  return { results: rows.slice(0, limit), coverage: { scope: 'first_page', candidate_count: anchors.length, eligible_count: rows.length,
    returned_count: Math.min(rows.length, limit), excluded_count: anchors.length - rows.length,
    has_more: rows.length > limit || /class\s*=\s*["']next_form["']/i.test(html), publication_times_verified: false } };
}

export async function searchWeb(input, signal, fetcher = fetchSource) {
  const request = searchRequest(input);
  const source = await fetcher(request.url, signal);
  if (source.status === 'unavailable') return source;
  const final = new URL(source.url);
  if (final.hostname !== 'lite.duckduckgo.com' || !final.pathname.startsWith('/lite')) return unavailableSource(source.url, 'search_format_error', '搜索入口跳转到了非预期页面；未取得可核验结果');
  const parsed = parseSearchPage(source.text, request);
  if (parsed.error) return unavailableSource(source.url, parsed.error.code, parsed.error.message);
  const retrieved_at = now();
  return { source, request, ...parsed, provenance: { kind: 'observed', source_kind: 'external', provider: source.url,
    as_of: retrieved_at, data_hash: digest(source.bytes), content_type: source.content_type, encoding: source.encoding },
    rows: parsed.results.map(row => ({ ...row, provider: 'duckduckgo_lite', evidence_kind: 'search_result', retrieved_at })) };
}
