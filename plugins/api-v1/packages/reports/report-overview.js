// A compact result surface. It never derives an opinion, score or probability.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (ok, message) => { if (!ok) throw new Error(message); };
const keys = (value, allowed) => check(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'Unsupported overview property');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const short = (value, maximum, name) => check(typeof value === 'string' && value.trim().length > 0 && [...value].length <= maximum,
  `Overview ${name} must be nonempty text up to ${maximum} characters; put the explanation in the body`);

export function renderOverview(value, renderBlock, locale = 'zh-CN', hasBody = true) {
  keys(value, ['conclusion', 'meta', 'facts', 'table', 'chart']);
  const zh = /^zh/i.test(locale);
  short(value.conclusion, zh ? 48 : 180, 'conclusion');
  if (value.meta !== undefined) short(value.meta, zh ? 80 : 240, 'shared context');
  check(Array.isArray(value.facts) && value.facts.length <= 18, 'Overview needs at most 18 facts');
  check(value.facts.length || value.table || value.chart, 'Overview needs actual results');
  const labels = new Set();
  const facts = value.facts.map(item => {
    keys(item, ['label', 'value', 'format', 'note', 'tone']);
    short(item.label, zh ? 20 : 72, 'label');
    check(!labels.has(item.label), 'Overview labels must be unique'); labels.add(item.label);
    const format = item.format ?? 'phrase';
    check(['phrase', 'number', 'sentence'].includes(format), 'Overview format must be phrase, number or sentence');
    const limit = zh ? { phrase: 16, number: 36, sentence: 48 } : { phrase: 72, number: 72, sentence: 180 };
    short(item.value, limit[format], 'value');
    if (item.note !== undefined) short(item.note, zh ? 32 : 120, 'note');
    check(item.tone === undefined || ['positive','negative','neutral'].includes(item.tone), 'Overview tone must describe an actual signed financial value');
    return `<div class="report-overview-fact" data-format="${format}"${item.tone ? ` data-tone="${item.tone}"` : ''}><dt>${escape(item.label)}</dt><dd>${escape(item.value)}</dd>${item.note ? `<small>${escape(item.note)}</small>` : ''}</div>`;
  }).join('');
  let table = '', chart = '';
  if (value.table !== undefined) {
    keys(value.table, ['columns','rows','caption','column_tones']);
    check(Array.isArray(value.table.columns) && value.table.columns.length > 0 && value.table.columns.length <= 7,
      'Overview table needs 1–7 columns');
    check(Array.isArray(value.table.rows) && value.table.rows.length > 0 && value.table.rows.length <= 6,
      'Overview table needs 1–6 rows; keep the complete list in the body');
    value.table.columns.forEach(label => short(label, zh ? 16 : 60, 'column'));
    value.table.rows.flat().forEach(cell => {
      if (typeof cell === 'string') short(cell, zh ? 40 : 140, 'cell');
    });
    let column = 0;
    table = renderBlock({ ...value.table, type: 'table' }).replace(/<td(?=[\s>])/g,
      () => `<td data-label="${escape(value.table.columns[column++ % value.table.columns.length])}"`);
  }
  if (value.chart !== undefined) {
    check(object(value.chart) && value.chart.type === 'chart', 'Overview chart must use the built-in chart content');
    const height = value.chart.options?.height ?? 200;
    check(Number.isInteger(height) && height >= 180 && height <= 280, 'Overview chart height must be 180–280');
    chart = renderBlock({ ...value.chart, options: { ...value.chart.options, height } });
  }
  const more = hasBody ? `<a class="report-overview-more" href="#content-section-1">${zh ? '详细分析 ↓' : 'Full analysis ↓'}</a>` : '';
  return `<section class="report-overview" aria-label="${zh ? '主要判断' : 'Key results'}">${value.meta ? `<p class="report-overview-meta">${escape(value.meta)}</p>` : ''}<p class="report-overview-conclusion">${escape(value.conclusion)}</p>${facts ? `<dl class="report-overview-facts">${facts}</dl>` : ''}${table}${chart}${more}</section>`;
}
