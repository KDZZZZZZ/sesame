// Sesame reportKit. MIT. Restored from the original Sesame report renderer.
// Packaged by the reports plugin; the only data capability is the report/1 read-only bridge.
(function installReportKit() {
  const SVG = 'http://www.w3.org/2000/svg';
  const locale = () => document.documentElement.lang || 'en';
  const formatNumber = (value, options) => new Intl.NumberFormat(locale(), options).format(value);
  const tr = (zh, en, values = {}) => (/^zh/i.test(locale()) ? zh : en).replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
  const chartInstances = new WeakMap();
  const fail = message => { const error = new Error(`reportKit: ${message}`); error.name = 'ReportSpecError'; throw error; };
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);

  // Content length is authoring guidance, never a rendering failure.
  const text = (value, path, max, required = true) => {
    if (value == null || value === '') { if (required) fail(`${path} is required.`); return ''; }
    if (typeof value !== 'string') fail(`${path} must be a string.`);
    return value;
  };
  const list = (value, path, max, required = false) => {
    if (value == null) { if (required) fail(`${path} is required.`); return []; }
    if (!Array.isArray(value)) fail(`${path} must be an array.`);
    return value;
  };
  const tones = ['positive', 'negative', 'caution', 'neutral'];
  const tone = (value, path) => { if (value == null) return 'neutral'; if (!tones.includes(value)) fail(`${path} must be one of ${tones.join(', ')}.`); return value; };

  const h = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child);
    return node;
  };
  const s = (tag, attrs = {}) => { const node = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v); return node; };
  const resolve = target => {
    const node = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(node instanceof Element)) fail(`target ${String(target)} was not found.`);
    return node;
  };

  // ── Numbers ───────────────────────────────────────────────────────────
  const formats = ['number', 'integer', 'percent', 'ratio', 'currency', 'text'];
  const formatValue = (value, options = {}) => {
    const { format = 'number', digits, unit, signed } = options;
    if (!formats.includes(format)) fail(`format must be one of ${formats.join(', ')}.`);
    if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '—';
    if (format === 'text' || typeof value !== 'number') return String(value) + (unit ? ` ${unit}` : '');
    const number = format === 'ratio' ? value * 100 : value;
    const abs = Math.abs(number);
    const max = digits ?? (format === 'integer' ? 0 : abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs === 0 ? 0 : 4);
    const out = formatNumber(number, { maximumFractionDigits: max, minimumFractionDigits: digits ?? 0 });
    const sign = signed && number > 0 ? '+' : '';
    const suffix = format === 'percent' || format === 'ratio' ? '%' : unit ? ` ${unit}` : '';
    return `${sign}${out}${suffix}`;
  };
  const compact = value => Math.abs(value) >= 10000 ? formatNumber(value, { notation: 'compact', maximumFractionDigits: 2 }) : formatNumber(value, { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 2 : 4 });
  // Axis labels carry exactly the precision the tick step needs: 9,990 / 10,000 / 10,010, not 1万 / 1万 / 1万.
  const axisFormat = values => {
    const step = values.length > 1 ? Math.abs(values[1] - values[0]) : Math.abs(values[0]) || 1;
    if (step >= 100000) return value => formatNumber(value, { notation: 'compact', maximumFractionDigits: Math.max(0, 2 - Math.floor(Math.log10(step / 1000))) });
    const digits = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
    return value => formatNumber(value, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  };
  const signTone = value => !finite(value) || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative';

  // ── Data ──────────────────────────────────────────────────────────────
  // Resolve exact fixed bindings only. Paging never substitutes a live query.
  async function rows(dataId, { maxRows = 50000 } = {}) {
    if (!window.report?.readData) fail('the report/1 data bridge is unavailable.');
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 1000000) fail('maxRows must be an integer from 1 to 1000000.');
    const out = [], seen = new Set(); let cursor;
    do {
      const page = await window.report.readData(dataId, { limit: Math.min(1000, maxRows + 1 - out.length), ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page.rows)) fail('data page did not contain rows.');
      out.push(...page.rows);
      if (out.length > maxRows) fail('row budget exceeded; bind an aggregation or explicitly raise maxRows.');
      cursor = page.page?.nextCursor;
      if (cursor && seen.has(cursor)) fail('data cursor repeated.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return out;
  }

  // ── Components ────────────────────────────────────────────────────────
  const icons = { positive: 'M5 12.5l4.5 4.5L19 7.5', negative: 'M7 7l10 10M17 7L7 17', caution: 'M12 7v6M12 16.5v.5', neutral: 'M6 12h12' };
  const toneIcon = value => { const svg = s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'kit-tone-icon' }); svg.append(s('path', { d: icons[value] })); return svg; };

  function verdict(target, spec, path = 'verdict') {
    if (!isObject(spec)) fail(`${path} must be an object.`);
    const t = tone(spec.tone, `${path}.tone`);
    const node = h('section', { class: 'kit-verdict', 'data-tone': t, 'aria-label': tr('结论', 'Conclusion') },
      h('p', { class: 'kit-verdict-kicker' }, toneIcon(t), tr('结论', 'Conclusion')),
      h('p', { class: 'kit-verdict-headline', text: text(spec.headline, `${path}.headline`, 80) }),
      spec.detail ? h('p', { class: 'kit-verdict-detail', text: text(spec.detail, `${path}.detail`, 160, false) }) : null);
    resolve(target).append(node); return node;
  }

  function metricNode(item, path) {
    if (!isObject(item)) fail(`${path} must be an object.`);
    const value = item.value;
    if (value != null && typeof value !== 'number' && typeof value !== 'string') fail(`${path}.value must be a number from report data, a short string or null.`);
    if (typeof value === 'string') text(value, `${path}.value`, 16);
    const t = item.tone === 'auto' ? signTone(value) : tone(item.tone, `${path}.tone`);
    const delta = item.delta == null ? null : (() => {
      if (!isObject(item.delta) || !finite(item.delta.value)) fail(`${path}.delta must be { value: number, label?: string }.`);
      return h('span', { class: 'kit-delta', 'data-tone': signTone(item.delta.value) }, formatValue(item.delta.value, { ...item, ...item.delta, signed: true }), item.delta.label ? h('small', { text: ` ${text(item.delta.label, `${path}.delta.label`, 16)}` }) : null);
    })();
    return h('div', { class: 'kit-metric', 'data-tone': t },
      h('dt', { text: text(item.label, `${path}.label`, 16) }),
      h('dd', {}, h('span', { class: 'kit-metric-value', text: formatValue(value, item) }), delta),
      item.hint ? h('p', { class: 'kit-metric-hint', text: text(item.hint, `${path}.hint`, 30, false) }) : null);
  }
  function metrics(target, items, path = 'metrics') {
    const entries = list(items, path, 8, true);
    const node = h('dl', { class: 'kit-metrics', style: `--cols:${entries.length <= 4 ? Math.max(1, entries.length) : entries.length <= 6 ? 3 : 4}` }, entries.map((item, i) => metricNode(item, `${path}[${i}]`)));
    resolve(target).append(node); return node;
  }

  function evidenceNode(evidence, path) {
    if (typeof evidence === 'string') return h('p', { class: 'kit-evidence-text', text: text(evidence, path, 100) });
    return h('ul', { class: 'kit-evidence' }, list(evidence, path, 4).map((item, i) => {
      if (!isObject(item)) fail(`${path}[${i}] must be { label, value, format?, unit? }.`);
      const t = item.tone === 'auto' ? signTone(item.value) : tone(item.tone, `${path}[${i}].tone`);
      return h('li', { 'data-tone': t }, h('span', { text: text(item.label, `${path}[${i}].label`, 16) }), h('b', { text: formatValue(item.value, item) }));
    }));
  }
  function findings(target, items, path = 'findings') {
    const node = h('ol', { class: 'kit-findings' }, list(items, path, 6, true).map((item, i) => {
      const p = `${path}[${i}]`;
      if (!isObject(item)) fail(`${p} must be { claim, evidence, tone?, caveat? }.`);
      const t = tone(item.tone, `${p}.tone`);
      return h('li', { 'data-tone': t }, h('span', { class: 'kit-finding-mark' }, toneIcon(t)),
        h('div', {}, h('p', { class: 'kit-claim', text: text(item.claim, `${p}.claim`, 60) }),
          item.evidence == null ? null : evidenceNode(item.evidence, `${p}.evidence`),
          item.caveat ? h('p', { class: 'kit-caveat', text: text(item.caveat, `${p}.caveat`, 80, false) }) : null));
    }));
    resolve(target).append(node); return node;
  }

  function note(target, spec, path = 'note') {
    if (!isObject(spec)) fail(`${path} must be { text, tone? }.`);
    const node = h('p', { class: 'kit-note', 'data-tone': tone(spec.tone, `${path}.tone`), text: text(spec.text, `${path}.text`, 120) });
    resolve(target).append(node); return node;
  }

  function table(target, spec, path = 'table') {
    if (!isObject(spec)) fail(`${path} must be { columns, rows, limit?, caption? }.`);
    const columns = list(spec.columns, `${path}.columns`, 8, true).map((column, i) => {
      if (typeof column === 'string') return { key: column, label: column };
      if (!isObject(column) || typeof column.key !== 'string') fail(`${path}.columns[${i}] must be a key or { key, label, format?, digits?, unit?, tone? }.`);
      return column;
    });
    const data = list(spec.rows, `${path}.rows`, 0, true), limit = spec.limit ?? 8;
    if (!Number.isInteger(limit) || limit < 1) fail(`${path}.limit must be a positive integer.`);
    const numeric = column => column.format ? column.format !== 'text' : data.some(row => finite(row?.[column.key]));
    const body = h('tbody', {}, data.map((row, i) => h('tr', { hidden: i >= limit }, columns.map(column => {
      const value = row?.[column.key];
      const t = column.tone === 'auto' ? signTone(value) : null;
      return h('td', { class: numeric(column) ? 'numeric' : null, 'data-tone': t, text: formatValue(value, column) });
    }))));
    const wrap = h('div', { class: 'report-table kit-table' }, h('table', {},
      spec.caption ? h('caption', { text: text(spec.caption, `${path}.caption`, 60) }) : null,
      h('thead', {}, h('tr', {}, columns.map(column => h('th', { class: numeric(column) ? 'numeric' : null, scope: 'col', text: column.label ?? column.key })))), body));
    const nodes = [wrap];
    if (data.length > limit) {
      const more = h('details', { class: 'kit-more' }, h('summary', { text: tr('显示其余 {count} 行', 'Show {count} more rows', { count: data.length - limit }) }));
      more.addEventListener('toggle', () => { body.querySelectorAll('tr').forEach((tr, i) => { tr.hidden = !more.open && i >= limit; }); });
      nodes.push(more);
    }
    if (!data.length) nodes.push(h('p', { class: 'kit-empty', text: tr('没有符合条件的记录。', 'No matching records.') }));
    resolve(target).append(...nodes); return wrap;
  }

  // ── Charts ────────────────────────────────────────────────────────────
  const kinds = ['line', 'area', 'bar', 'hbar', 'scatter', 'heatmap'];
  let gradientId = 0;
  // SVG presentation attributes accept CSS variables, so a theme switch keeps chart selections intact.
  const css = name => `var(${name},var(--report-default-${name.slice(2)}))`;
  const palette = () => [1, 2, 3, 4, 5, 6].map(i => css(`--chart-series-${i}`));
  const niceStep = (span, count) => { const raw = span / Math.max(1, count), power = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / power; return (n >= 7.5 ? 10 : n >= 3.5 ? 5 : n >= 1.5 ? 2 : 1) * power; };
  const ticks = (low, high, count) => {
    if (low === high) { const pad = Math.abs(low) * 0.1 || 1; low -= pad; high += pad; }
    const step = niceStep(high - low, count), start = Math.floor(low / step) * step, end = Math.ceil(high / step) * step, out = [];
    for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toPrecision(12)));
    return out;
  };
  // Broker and dataset times are wall-clock strings; position them as UTC and print them unchanged.
  const parseTime = value => {
    if (finite(value)) return value;
    if (typeof value !== 'string' || !/^\d{4}[-.]\d\d[-.]\d\d/.test(value)) return NaN;
    const iso = value.replace(/^(\d{4})\.(\d\d)\.(\d\d)/, '$1-$2-$3').replace(' ', 'T');
    if (/(Z|[+-]\d\d:?\d\d)$/i.test(iso)) return Date.parse(iso);
    return Date.parse(`${iso.length === 10 ? `${iso}T00:00:00` : iso}Z`);
  };
  const timeLabel = (ms, span) => {
    const d = new Date(ms), pad = n => String(n).padStart(2, '0');
    const date = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    return span > 2 * 86400000 ? (span > 400 * 86400000 ? `${d.getUTCFullYear()}-${date}` : date) : span > 86400000 ? `${date} ${time}` : time;
  };

  function normalizeChart(spec, path) {
    if (!isObject(spec)) fail(`${path} must be an object.`);
    if (!kinds.includes(spec.kind)) fail(`${path}.kind must be one of ${kinds.join(', ')}.`);
    const data = list(spec.data, `${path}.data`, 0, true);
    if (data.length > 20000) fail(`${path}: aggregate data before drawing more than 20000 rows.`);
    const chart = { ...spec, path, data };
    text(spec.title, `${path}.title`, 30);
    text(spec.caption, `${path}.caption`, 80);
    if (spec.kind === 'heatmap') {
      for (const key of ['x', 'y', 'value']) if (typeof spec[key] !== 'string') fail(`${path}.${key} must name a row field.`);
      return chart;
    }
    if (typeof spec.x !== 'string') fail(`${path}.x must name a row field.`);
    const ys = Array.isArray(spec.y) ? spec.y : [spec.y];
    if (!ys.length || ys.some(y => typeof y !== 'string')) fail(`${path}.y must name a numeric row field or an array of fields.`);
    if (spec.series != null && (typeof spec.series !== 'string' || ys.length > 1)) fail(`${path}.series must name one grouping field and needs a single y.`);
    const xValues = data.map(row => row?.[spec.x]).filter(value => value != null);
    const xType = spec.xType ?? (['bar', 'hbar'].includes(spec.kind) ? 'category' : xValues.every(finite) ? 'number' : xValues.every(value => !Number.isNaN(parseTime(value))) ? 'time' : 'category');
    if (!['time', 'number', 'category'].includes(xType)) fail(`${path}.xType must be time, number or category.`);
    const groups = new Map();
    for (const row of data) {
      const names = spec.series ? [[String(row?.[spec.series] ?? '—'), ys[0]]] : ys.map(y => [spec.labels?.[y] ?? y, y]);
      for (const [name, key] of names) {
        const raw = row?.[key], y = raw == null || raw === '' ? null : Number(raw);
        if (y != null && !Number.isFinite(y)) fail(`${path}: field "${key}" holds a non-numeric value (${JSON.stringify(raw).slice(0, 40)}).`);
        const xRaw = row?.[spec.x];
        const x = xType === 'time' ? parseTime(xRaw) : xType === 'number' ? Number(xRaw) : String(xRaw ?? '—');
        if (xType !== 'category' && !Number.isFinite(x)) fail(`${path}: field "${spec.x}" holds a value that is not a ${xType} (${JSON.stringify(xRaw).slice(0, 40)}).`);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push({ x, y, raw: xRaw, rawValue: raw, row });
      }
    }
    if (groups.size > 8) fail(`${path} draws ${groups.size} series (limit 8). Aggregate or pick the series that matter.`);
    chart.xType = xType;
    chart.series = [...groups].map(([name, points]) => ({ name, points: xType === 'category' ? points : points.sort((a, b) => a.x - b.x) }));
    return chart;
  }

  function chart(target, spec, path = 'chart') {
    const model = normalizeChart(spec, path);
    const colors = palette(), hidden = new Set();
    const figure = h('figure', { class: 'kit-chart', 'data-kind': model.kind });
    const head = h('figcaption', { class: 'kit-chart-head' }, h('strong', { text: model.title }), h('span', { class: 'kit-chart-caption', text: model.caption }));
    const legend = model.kind !== 'heatmap' && model.series.length > 1 ? h('div', { class: 'kit-legend' }, model.series.map((series, i) => {
      const button = h('button', { type: 'button', 'data-kit-control': '', 'aria-pressed': 'true', style: `--swatch:${colors[i % colors.length]}` }, h('i'), series.name);
      button.addEventListener('click', () => { hidden.has(series.name) ? hidden.delete(series.name) : hidden.add(series.name); button.setAttribute('aria-pressed', String(!hidden.has(series.name))); draw(); });
      return button;
    })) : null;
    const stage = h('div', { class: 'kit-chart-stage' });
    const tip = h('div', { class: 'kit-tooltip', 'aria-hidden': 'true', hidden: true });
    stage.append(tip);
    figure.append(...[head, legend, stage].filter(Boolean));
    resolve(target).append(figure);
    let svg, width = 0, frame, destroyed = false;
    const draw = () => {
      if (destroyed) return;
      width = Math.max(240, Math.round(stage.clientWidth || figure.clientWidth || 640));
      svg?.remove();
      const empty = model.kind === 'heatmap' ? !model.data.length : !model.series.some(series => !hidden.has(series.name) && series.points.some(point => point.y != null));
      if (empty) {
        svg = s('svg', { viewBox: `0 0 ${width} 200`, class: 'kit-svg' });
        const label = s('text', { class: 'kit-axis', x: width / 2, y: 100, 'text-anchor': 'middle' }); label.textContent = tr('没有可绘制的数值', 'No values to draw'); svg.append(label);
      } else svg = (model.kind === 'heatmap' ? drawHeatmap : model.kind === 'hbar' ? drawHbar : model.kind === 'bar' ? drawBars : drawXY)(model, width, colors, hidden, tip);
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${model.title}. ${model.caption}`);
      stage.prepend(svg);
    };
    draw();
    const observer = new ResizeObserver(() => { const next = stage.clientWidth; if (!next || Math.abs(Math.max(240, Math.round(next)) - width) < 2) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); });
    observer.observe(stage);
    chartInstances.set(figure, () => { destroyed = true; observer.disconnect(); cancelAnimationFrame(frame); });
    return figure;
  }

  const showTip = (tip, stage, x, y, title, rows) => {
    tip.replaceChildren(h('strong', { text: title }), ...rows.map(([label, value, color]) => h('span', {}, color ? h('i', { style: `background:${color}` }) : null, h('em', { text: label }), h('b', { text: value }))));
    tip.hidden = false;
    const box = stage.getBoundingClientRect(), w = tip.offsetWidth, hgt = tip.offsetHeight;
    tip.style.left = `${Math.min(Math.max(4, x + 14), box.width - w - 4)}px`;
    tip.style.top = `${Math.max(4, y - hgt - 10)}px`;
  };
  // One width estimate for every label: CJK glyphs are about 1em wide, other glyphs about 0.58em.
  const labelWidth = (label, size = 10.5) => { let w = 0; for (const c of String(label)) w += /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(c) ? size : size * 0.58; return w; };
  const axisLabel = (attrs, label, room, size = 10.5) => {
    const node = s('text', attrs); let shown = String(label);
    if (labelWidth(shown, size) > room) { while (shown.length > 1 && labelWidth(shown + '…', size) > room) shown = shown.slice(0, -1); shown += '…'; const title = s('title'); title.textContent = String(label); node.append(title); }
    node.append(document.createTextNode(shown)); return node;
  };
  const yAxis = (svg, scale, values, left, right, format) => {
    for (const value of values) {
      const y = scale(value);
      svg.append(s('line', { class: 'kit-grid', x1: left, x2: right, y1: y, y2: y }));
      const label = s('text', { class: 'kit-axis', x: left - 8, y: y + 3.5, 'text-anchor': 'end' }); label.textContent = format(value); svg.append(label);
    }
  };

  const selectable = (node, model, point) => {
    if (typeof model.onSelect !== 'function') return node;
    const index = model.data.indexOf(point.row);
    node.setAttribute('role', 'button'); node.setAttribute('tabindex', '0');
    node.setAttribute('data-row-index', index);
    node.setAttribute('aria-label', `${point.raw}: ${formatValue(point.rawValue, { unit: model.unit })}`);
    const select = () => { const svg = node.closest('svg'); svg?.querySelectorAll('.kit-selected').forEach(mark => mark.classList.remove('kit-selected')); node.classList.add('kit-selected'); model.onSelect(point.row, index); };
    node.addEventListener('click', select);
    node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    return node;
  };

  function drawXY(model, width, colors, hidden, tip) {
    const height = model.height ?? (width < 420 ? 200 : 240);
    const visible = model.series.filter(series => !hidden.has(series.name));
    const points = visible.flatMap(series => series.points.filter(p => p.y != null));
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'kit-svg' });
    if (!points.length) { const t = s('text', { class: 'kit-axis', x: width / 2, y: height / 2, 'text-anchor': 'middle' }); t.textContent = tr('没有可绘制的数值', 'No values to draw'); svg.append(t); return svg; }
    const ysAll = points.map(p => p.y).concat(model.baseline != null ? [model.baseline] : []);
    const yTicks = ticks(Math.min(...ysAll), Math.max(...ysAll), height < 220 ? 4 : 5);
    const format = axisFormat(yTicks);
    const left = Math.max(...yTicks.map(v => format(v).length)) * 6.6 + 14, right = width - 14, top = 12, bottom = height - 26;
    const y = v => bottom - (v - yTicks[0]) / (yTicks.at(-1) - yTicks[0] || 1) * (bottom - top);
    const categories = model.xType === 'category' ? [...new Set(model.series.flatMap(series => series.points.map(p => p.x)))] : null;
    const xs = points.map(p => categories ? categories.indexOf(p.x) : p.x), lo = Math.min(...xs), hi = Math.max(...xs);
    const x = v => left + ((categories ? categories.indexOf(v) : v) - lo) / (hi - lo || 1) * (right - left);
    yAxis(svg, y, yTicks, left, right, format);
    const xNumber = axisFormat(ticks(lo, hi, 5));
    const xLabel = v => model.xType === 'time' ? timeLabel(v, hi - lo) : model.xType === 'number' ? xNumber(v) : String(v);
    const xCount = Math.max(2, Math.min(categories ? categories.length : 6, Math.floor((right - left) / 90)));
    for (let i = 0; i < xCount; i++) {
      const value = categories ? categories[Math.round(i * (categories.length - 1) / (xCount - 1))] : lo + (hi - lo) * i / (xCount - 1);
      svg.append(axisLabel({ class: 'kit-axis', x: x(value), y: height - 8, 'text-anchor': i === 0 ? 'start' : i === xCount - 1 ? 'end' : 'middle' }, xLabel(value), (right - left) / Math.max(1, xCount - 1) - 8));
    }
    if (model.baseline != null) svg.append(s('line', { class: 'kit-baseline', x1: left, x2: right, y1: y(model.baseline), y2: y(model.baseline) }));
    for (const mark of list(model.marks, `${model.path}.marks`, 6)) {
      const at = model.xType === 'time' ? parseTime(mark.x) : mark.x, px = x(at);
      if (!Number.isFinite(px)) continue;
      svg.append(s('line', { class: 'kit-mark', x1: px, x2: px, y1: top, y2: bottom }));
      const label = s('text', { class: 'kit-mark-label', x: px + 5, y: top + 9 }); label.textContent = text(mark.label, `${model.path}.marks.label`, 12); svg.append(label);
    }
    model.series.forEach((series, i) => {
      if (hidden.has(series.name)) return;
      const color = colors[i % colors.length], pts = series.points.filter(p => p.y != null);
      if (model.kind === 'scatter') { for (const p of pts) svg.append(selectable(s('circle', { cx: x(p.x), cy: y(p.y), r: 3.5, fill: color, class: 'kit-dot' }), model, p)); return; }
      const segments = []; let segment = [];
      for (const p of series.points) { if (p.y == null) { if (segment.length) segments.push(segment); segment = []; } else segment.push(p); }
      if (segment.length) segments.push(segment);
      const lineOf = points => points.map((p, j) => `${j ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
      const line = segments.map(lineOf).join('');
      if (model.kind === 'area' && pts.length > 1) {
        const id = `kit-grad-${++gradientId}`, defs = s('defs'), grad = s('linearGradient', { id, x1: 0, x2: 0, y1: 0, y2: 1 });
        grad.append(s('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': visible.length > 1 ? 0.14 : 0.26 }), s('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
        defs.append(grad); svg.append(defs);
        const floor = y(Math.max(yTicks[0], Math.min(model.baseline ?? yTicks[0], yTicks.at(-1))));
        for (const segment of segments) if (segment.length > 1) svg.append(s('path', { d: `${lineOf(segment)}L${x(segment.at(-1).x).toFixed(1)},${floor}L${x(segment[0].x).toFixed(1)},${floor}Z`, fill: `url(#${id})` }));
      }
      svg.append(s('path', { d: line, fill: 'none', stroke: color, class: 'kit-line' }));
      if (pts.length <= 24) for (const p of pts) svg.append(selectable(s('circle', { cx: x(p.x), cy: y(p.y), r: 2.5, fill: color, class: 'kit-dot' }), model, p));
    });
    // Hover: nearest x (lines) or nearest point (scatter), values for every visible series.
    const cross = s('line', { class: 'kit-crosshair', y1: top, y2: bottom, visibility: 'hidden' }), hot = s('g'); svg.append(cross, hot);
    const overlay = s('rect', { x: left, y: top, width: right - left, height: bottom - top, fill: 'transparent' }); svg.append(overlay);
    const unitOf = { format: model.format, digits: model.digits, unit: model.unit };
    const move = event => {
      const box = svg.getBoundingClientRect(), px = (event.clientX - box.left) * width / box.width, py = (event.clientY - box.top) * height / box.height;
      let anchor = null, best = Infinity;
      for (const p of points) { const d = model.kind === 'scatter' ? Math.hypot(x(p.x) - px, y(p.y) - py) : Math.abs(x(p.x) - px); if (d < best) { best = d; anchor = p; } }
      if (!anchor) return;
      if (event.type === 'pointerdown' && typeof model.onSelect === 'function') {
        svg.querySelectorAll('[data-row-index]').forEach(mark => mark.classList.toggle('kit-selected', Number(mark.getAttribute('data-row-index')) === model.data.indexOf(anchor.row)));
        model.onSelect(anchor.row, model.data.indexOf(anchor.row));
      }
      const ax = x(anchor.x); cross.setAttribute('x1', ax); cross.setAttribute('x2', ax); cross.setAttribute('visibility', 'visible'); hot.replaceChildren();
      const rows = [];
      model.series.forEach((series, i) => {
        if (hidden.has(series.name)) return;
        const hit = model.kind === 'scatter' ? (series.points.includes(anchor) ? anchor : null) : series.points.find(p => p.x === anchor.x || (categories && p.x === anchor.x));
        if (!hit || hit.y == null) return;
        hot.append(s('circle', { cx: x(hit.x), cy: y(hit.y), r: 4.5, fill: colors[i % colors.length], class: 'kit-hot' }));
        rows.push([series.name, formatValue(hit.rawValue, unitOf), colors[i % colors.length]]);
        if (model.kind === 'scatter') rows.push([model.x, model.xType === 'time' ? String(hit.raw) : formatValue(hit.x, {})]);
      });
      showTip(tip, svg, ax / width * box.width, y(anchor.y) / height * box.height, model.xType === 'time' ? String(anchor.raw) : xLabel(anchor.x), rows);
    };
    overlay.addEventListener('pointermove', move); overlay.addEventListener('pointerdown', move);
    overlay.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hot.replaceChildren(); tip.hidden = true; });
    return svg;
  }

  function drawBars(model, width, colors, hidden, tip) {
    const height = model.height ?? (width < 420 ? 200 : 240);
    const visible = model.series.filter(series => !hidden.has(series.name));
    const categories = [...new Set(model.series.flatMap(series => series.points.map(p => p.x)))];
    const values = visible.flatMap(series => series.points.map(p => p.y)).filter(v => v != null).concat(0, model.baseline ?? 0);
    const yTicks = ticks(Math.min(...values), Math.max(...values), height < 220 ? 4 : 5), format = axisFormat(yTicks);
    const left = Math.max(...yTicks.map(v => format(v).length)) * 6.6 + 14, right = width - 10, top = 16, bottom = height - 26;
    const y = v => bottom - (v - yTicks[0]) / (yTicks.at(-1) - yTicks[0] || 1) * (bottom - top);
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'kit-svg' });
    yAxis(svg, y, yTicks, left, right, format);
    const band = (right - left) / Math.max(1, categories.length), inner = Math.min(band * 0.72, 56), bar = inner / Math.max(1, visible.length);
    // Gain/loss colouring only for a single series; several series keep their legend colours.
    const signed = model.tone === 'signed' && model.series.length === 1, unitOf = { format: model.format, digits: model.digits, unit: model.unit };
    const labelEvery = Math.ceil(categories.length / Math.max(1, Math.floor((right - left) / 64)));
    categories.forEach((category, c) => {
      const cx = left + band * c + band / 2;
      if (c % labelEvery === 0) svg.append(axisLabel({ class: 'kit-axis', x: cx, y: height - 8, 'text-anchor': 'middle' }, category, band * labelEvery - 6));
      visible.forEach((series, i) => {
        const p = series.points.find(point => point.x === category); if (!p || p.y == null) return;
        const color = signed ? css(p.y >= 0 ? '--chart-up' : '--chart-down') : colors[model.series.indexOf(series) % colors.length];
        const bx = cx - inner / 2 + bar * i, top0 = Math.min(y(p.y), y(0)), hgt = Math.max(1, Math.abs(y(p.y) - y(0)));
        const rect = s('rect', { x: bx + 1, y: top0, width: Math.max(2, bar - 2), height: hgt, rx: Math.min(4, bar / 4), fill: color, class: 'kit-bar' });
        selectable(rect, model, p);
        rect.addEventListener('pointerenter', () => showTip(tip, svg, (bx + bar / 2) / width * svg.getBoundingClientRect().width, top0 / height * svg.getBoundingClientRect().height, category, [[series.name, formatValue(p.rawValue, unitOf), color]]));
        rect.addEventListener('pointerleave', () => { tip.hidden = true; });
        svg.append(rect);
        if (categories.length * visible.length <= 12 && bar >= 26) {
          const label = s('text', { class: 'kit-value', x: bx + bar / 2, y: p.y >= 0 ? top0 - 5 : top0 + hgt + 12, 'text-anchor': 'middle' });
          label.textContent = formatValue(p.y, { ...unitOf, unit: undefined }); svg.append(label);
        }
      });
    });
    svg.append(s('line', { class: 'kit-baseline', x1: left, x2: right, y1: y(model.baseline ?? 0), y2: y(model.baseline ?? 0) }));
    return svg;
  }

  // Grouped horizontal bars: one row per category, one bar per visible series.
  function drawHbar(model, width, colors, hidden, tip) {
    const visible = model.series.filter(item => !hidden.has(item.name));
    const shown = visible.length ? visible : [model.series[0]];
    const categories = [...new Set(model.series.flatMap(series => series.points.map(p => p.x)))];
    const values = shown.flatMap(series => series.points.map(p => p.y)).filter(v => v != null).concat(0), lo = Math.min(...values), hi = Math.max(...values);
    const labelRoom = Math.min(width * 0.4, Math.max(...categories.map(c => labelWidth(c, 11.5))) + 4);
    const bar = shown.length > 1 ? 12 : 16, gap = 3, row = Math.max(30, shown.length * (bar + gap) + 12);
    const height = model.height ?? categories.length * row + 12;
    const left = labelRoom + 12, right = width - 74;
    const x = v => left + (v - lo) / (hi - lo || 1) * (right - left);
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'kit-svg' });
    const signed = model.tone === 'signed' && model.series.length === 1, unitOf = { format: model.format, digits: model.digits, unit: model.unit };
    categories.forEach((category, c) => {
      const top = 6 + c * row, start = top + (row - (shown.length * (bar + gap) - gap)) / 2;
      svg.append(axisLabel({ class: 'kit-axis kit-category', x: left - 10, y: top + row / 2 + 4, 'text-anchor': 'end' }, category, labelRoom, 11.5));
      shown.forEach((series, i) => {
        const p = series.points.find(point => point.x === category); if (!p || p.y == null) return;
        const color = signed ? css(p.y >= 0 ? '--chart-up' : '--chart-down') : colors[model.series.indexOf(series) % colors.length];
        const x0 = Math.min(x(p.y), x(0)), w = Math.max(2, Math.abs(x(p.y) - x(0))), y0 = start + i * (bar + gap);
        const rect = s('rect', { x: x0, y: y0, width: w, height: bar, rx: Math.min(4, bar / 3), fill: color, class: 'kit-bar' });
        selectable(rect, model, p);
        rect.addEventListener('pointerenter', () => { const box = svg.getBoundingClientRect(); showTip(tip, svg, (x0 + w) / width * box.width, y0 / height * box.height, category, [[series.name, formatValue(p.rawValue, unitOf), color]]); });
        rect.addEventListener('pointerleave', () => { tip.hidden = true; });
        const value = s('text', { class: 'kit-value', x: Math.max(x(p.y), x(0)) + 6, y: y0 + bar / 2 + 3.5 }); value.textContent = formatValue(p.y, unitOf);
        svg.append(rect, value);
      });
    });
    svg.append(s('line', { class: 'kit-baseline', x1: x(0), x2: x(0), y1: 4, y2: height - 4 }));
    return svg;
  }

  function drawHeatmap(model, width, colors, hidden, tip) {
    const xs = [...new Set(model.data.map(row => String(row?.[model.x])))], ys = [...new Set(model.data.map(row => String(row?.[model.y])))];
    const rawCells = new Map();
    for (const row of model.data) { const key = JSON.stringify([String(row?.[model.x]), String(row?.[model.y])]); if (rawCells.has(key)) fail(`${model.path}: duplicate heatmap cell; aggregate explicitly.`); rawCells.set(key, row?.[model.value] ?? null); }
    const cells = new Map([...rawCells].map(([key, value]) => [key, value === null ? null : Number(value)]));
    const values = [...cells.values()].filter(Number.isFinite);
    if (values.length !== [...cells.values()].filter(v => v != null).length) fail(`${model.path}: field "${model.value}" holds non-numeric values.`);
    const lo = Math.min(...values), hi = Math.max(...values), diverging = lo < 0 && hi > 0, extent = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    const left = Math.min(width * 0.3, Math.max(...ys.map(v => labelWidth(v, 11.5))) + 14);
    const cell = Math.max(18, Math.min(56, (width - left - 8) / xs.length));
    const height = ys.length * cell + 30;
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'kit-svg' });
    const up = css('--chart-up'), down = css('--chart-down'), seq = css('--violet');
    const fill = v => {
      if (v == null || !Number.isFinite(v)) return css('--heat-neutral');
      const t = diverging ? Math.abs(v) / extent : (v - lo) / (hi - lo || 1);
      const base = diverging ? (v >= 0 ? up : down) : seq;
      return `color-mix(in srgb, ${base} ${Math.round(12 + t * 48)}%, ${css('--surface-tertiary')})`;
    };
    const unitOf = { format: model.format, digits: model.digits, unit: model.unit };
    ys.forEach((yv, r) => {
      svg.append(axisLabel({ class: 'kit-axis kit-category', x: left - 8, y: r * cell + cell / 2 + 4, 'text-anchor': 'end' }, yv, left - 12, 11.5));
      xs.forEach((xv, c) => {
        const v = cells.get(JSON.stringify([xv, yv])) ?? null, cx = left + c * cell, cy = r * cell;
        const rect = s('rect', { x: cx + 1.5, y: cy + 1.5, width: cell - 3, height: cell - 3, rx: 5, fill: fill(v), class: 'kit-cell' });
        rect.addEventListener('pointerenter', () => { const box = svg.getBoundingClientRect(); showTip(tip, svg, (cx + cell) / width * box.width, cy / height * box.height, `${model.y} ${yv} · ${model.x} ${xv}`, [[model.value, formatValue(rawCells.get(JSON.stringify([xv, yv])), unitOf)]]); });
        rect.addEventListener('pointerleave', () => { tip.hidden = true; });
        svg.append(rect);
        if (cell >= 40 && v != null) { const t = s('text', { class: 'kit-cell-value', x: cx + cell / 2, y: cy + cell / 2 + 4, 'text-anchor': 'middle' }); t.textContent = compact(v); svg.append(t); }
      });
    });
    const every = Math.ceil(xs.length / Math.max(1, Math.floor((width - left) / 48)));
    xs.forEach((xv, c) => { if (c % every) return; const t = s('text', { class: 'kit-axis', x: left + c * cell + cell / 2, y: height - 10, 'text-anchor': 'middle' }); t.textContent = xv; svg.append(t); });
    return svg;
  }

  // ── Whole report ──────────────────────────────────────────────────────
  const blockTypes = ['chart', 'findings', 'metrics', 'table', 'note', 'custom'];
  function block(parent, spec, path) {
    if (!isObject(spec) || !blockTypes.includes(spec.type)) fail(`${path}.type must be one of ${blockTypes.join(', ')}.`);
    if (spec.type === 'chart') return chart(parent, spec, path);
    if (spec.type === 'findings') return findings(parent, spec.items, `${path}.items`);
    if (spec.type === 'metrics') return metrics(parent, spec.items, `${path}.items`);
    if (spec.type === 'table') return table(parent, spec, path);
    if (spec.type === 'note') return note(parent, spec, path);
    if (typeof spec.render !== 'function') fail(`${path}.render must be a function (element) => void for a custom block.`);
    const host = h('div', { class: 'kit-custom' }); parent.append(host); spec.render(host); return host;
  }

  function render(target, spec) {
    if (!isObject(spec)) fail('render(target, spec) needs a report outline object.');
    const root = resolve(target);
    destroy(root);
    root.classList.add('report', 'kit-report');
    const header = h('header', { class: 'kit-header' },
      spec.eyebrow ? h('p', { class: 'kit-eyebrow', text: text(spec.eyebrow, 'eyebrow', 24, false) }) : null,
      h('h1', { text: text(spec.title, 'title', 40) }),
      spec.subtitle ? h('p', { class: 'kit-subtitle', text: text(spec.subtitle, 'subtitle', 80, false) }) : null,
      spec.meta ? h('ul', { class: 'kit-meta' }, list(spec.meta, 'meta', 6).map((item, i) => {
        if (!isObject(item)) fail(`meta[${i}] must be { label, value }.`);
        return h('li', {}, h('span', { text: text(item.label, `meta[${i}].label`, 10) }), h('b', { text: text(String(item.value ?? '—'), `meta[${i}].value`, 30) }));
      })) : null);
    root.replaceChildren(header);
    verdict(root, spec.verdict, 'verdict');
    if (spec.metrics) metrics(root, spec.metrics, 'metrics');
    list(spec.sections, 'sections', 6, true).forEach((section, i) => {
      const path = `sections[${i}]`;
      if (!isObject(section)) fail(`${path} must be { title, takeaway, blocks }.`);
      const node = h('section', { class: 'kit-section', id: section.id ?? null },
        h('h2', { text: text(section.title, `${path}.title`, 20) }),
        h('p', { class: 'kit-takeaway', text: text(section.takeaway, `${path}.takeaway`, 80) }));
      root.append(node);
      list(section.blocks, `${path}.blocks`, 6, true).forEach((item, j) => block(node, item, `${path}.blocks[${j}]`));
    });
    if (spec.method) {
      const method = spec.method;
      if (!isObject(method)) fail('method must be { steps?, limits?, sources? }.');
      const group = (key, label) => {
        const items = list(method[key], `method.${key}`, 8);
        return items.length ? h('div', { class: 'kit-method-group' }, h('h3', { text: label }), h('ul', {}, items.map((item, i) => h('li', { text: text(item, `method.${key}[${i}]`, 100) })))) : null;
      };
      const sources = list(method.sources, 'method.sources', 12);
      root.append(h('details', { class: 'kit-appendix' },
        h('summary', {}, h('span', { text: tr('方法、限制与来源', 'Method, limits and sources') })),
        h('div', { class: 'kit-appendix-body' },
          group('steps', tr('方法', 'Method')), group('limits', tr('限制', 'Limits')),
          sources.length ? h('div', { class: 'kit-method-group' }, h('h3', { text: tr('来源', 'Sources') }), h('dl', { class: 'kit-sources' }, sources.flatMap((item, i) => {
            if (!isObject(item)) fail(`method.sources[${i}] must be { label, value }.`);
            return [h('dt', { text: text(item.label, `method.sources[${i}].label`, 16) }), h('dd', { text: String(item.value ?? '—') })];
          }))) : null)));
    }
    return root;
  }

  function destroy(target) {
    const root = resolve(target);
    window.SesameCharts?.destroy(root);
    for (const figure of [root, ...root.querySelectorAll('.kit-chart')]) { chartInstances.get(figure)?.(); chartInstances.delete(figure); }
  }

  Object.defineProperty(window, 'reportKit', { value: Object.freeze({ rows, render, verdict, metrics, findings, chart, table, note, destroy, format: formatValue }) });
})();
