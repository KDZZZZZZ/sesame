/* Sesame composition charts — MIT, Sesame contributors.
 * Independent SVG implementation of standard visual encodings. No upstream
 * template code, third-party runtime, network requests or calculated research. */
(function (global) {
  'use strict';
  const fail = message => { throw Error(`SesameCharts: ${message}`); };
  if (!global.SesameCharts?.register) fail('load SesameCharts first');
  const color = i => `var(--chart-series-${i % 6 + 1},var(--report-default-chart-series-${i % 6 + 1}))`;
  const muted = 'var(--report-muted)', ink = 'var(--report-ink)', grid = 'var(--border,var(--report-default-border))';
  const zh = () => /^zh(?:-|$)/i.test(document.documentElement.lang);
  const words = (cn, en) => zh() ? cn : en;
  const key = (spec, name, fallback = name) => {
    const value = spec[name] ?? fallback;
    if (typeof value !== 'string' || !value.trim()) fail(`${name} needs a source column`);
    return value;
  };
  const category = value => {
    if (!(typeof value === 'string' && value.trim() || typeof value === 'number' && Number.isFinite(value))) fail('category labels must be nonempty text or finite numbers');
    return String(value);
  };
  const number = (ctx, value, nonnegative = false) => {
    const n = ctx.numeric(value);
    if (n === null || nonnegative && n < 0) fail(nonnegative ? 'nonnegative values required; missing is not zero' : 'finite values required; missing is not zero');
    return n;
  };
  const count = (ctx, value) => {
    const n = number(ctx, value, true);
    if (!Number.isSafeInteger(n)) fail('counts must be nonnegative safe integers');
    return n;
  };
  const display = value => new Intl.NumberFormat(zh() ? 'zh-CN' : 'en', { maximumFractionDigits: 2, ...(Math.abs(value) >= 1e7 ? { notation: 'compact' } : {}) }).format(value);
  function label(ctx, x, y, value, anchor = 'middle', available = 100, attrs = {}) {
    const full = String(value), characters = Array.from(full);
    const length = value => Array.from(value).reduce((sum, char) => sum + (/^[\x20-\x7e]$/.test(char) ? 6.5 : 11.5), 0);
    let shown = full;
    if (length(full) > available) { while (characters.length > 1 && length(characters.join('') + '…') > available) characters.pop(); shown = characters.join('') + '…'; }
    const text = ctx.node('text', { x, y, 'text-anchor': anchor, class: 'sc-axis', ...attrs }, shown);
    if (attrs.fill) text.style.fill = attrs.fill;
    text.append(ctx.node('title', {}, full)); ctx.svg.append(text); return text;
  }
  function tone(ctx, value, index = 0) {
    if (ctx.spec.tone != null && !['neutral', 'signed'].includes(ctx.spec.tone)) fail('tone must be neutral or signed');
    return ctx.spec.tone === 'signed' ? value === 0 ? muted : value > 0 ? 'var(--report-positive)' : 'var(--report-negative)' : color(index);
  }
  function legend(ctx, values) {
    const el = ctx.html('div', 'sc-composition-legend');
    values.forEach((value, i) => {
      const item = ctx.html('span'), swatch = ctx.html('i'); swatch.style.background = color(i);
      item.append(swatch, document.createTextNode(value)); el.append(item);
    });
    ctx.frame.append(el);
  }
  // Long-form complete grids keep missing categories distinct from real zeros.
  function matrix(ctx, xKey, seriesKey, valueKey, maxX, maxSeries, signed = false) {
    const xs = [], series = [], cells = new Map();
    ctx.rows.forEach((row, index) => {
      const x = category(row[xKey]), group = category(row[seriesKey]), id = JSON.stringify([x, group]);
      if (cells.has(id)) fail('duplicate category pair; aggregate explicitly before charting');
      if (!xs.includes(x)) xs.push(x);
      if (!series.includes(group)) series.push(group);
      cells.set(id, { row, index, x, group, value: number(ctx, row[valueKey], !signed) });
    });
    if (xs.length > maxX || series.length > maxSeries) fail(`chart supports at most ${maxX} columns and ${maxSeries} series`);
    if (cells.size !== xs.length * series.length) fail('every category pair needs an explicit source row; missing is not zero');
    return { xs, series, get: (x, group) => cells.get(JSON.stringify([x, group])) };
  }
  function unitCount(value, unit) {
    // Match decimal units exactly, including scientific notation, without
    // rounding a partial observation into a whole tick.
    const parts = value => {
      const match = String(value).match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
      if (!match) fail('ticks require nonnegative quantities');
      return { n: BigInt(match[1] + (match[2] || '')), scale: (match[2] || '').length - Number(match[3] || 0) };
    };
    const a = parts(value), b = parts(unit), scale = Math.max(a.scale, b.scale);
    const n = a.n * 10n ** BigInt(scale - a.scale), d = b.n * 10n ** BigInt(scale - b.scale);
    if (n % d) fail('each quantity must be a whole multiple of unitValue');
    const result = n / d;
    if (result > 500n) fail('more than 500 ticks; choose an explicit larger exact unitValue');
    return Number(result);
  }
  function unit(ctx) {
    const value = ctx.spec.unitValue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('unitValue must explicitly state the positive amount represented by each tick');
    return value;
  }
  function total(values) {
    const result = values.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(result)) fail('total exceeds the supported numeric range');
    return result;
  }
  function stream(ctx) {
    const { spec, width, svg, node } = ctx;
    const table = matrix(ctx, key(spec, 'x'), key(spec, 'series'), key(spec, 'value'), 300, 8);
    if (table.xs.length < 2) fail('stream needs at least two observations per series');
    const type = spec.xType ?? 'category';
    if (!['time', 'number', 'category'].includes(type)) fail('stream xType must be time, number or category');
    let xs = [...table.xs], positions;
    if (type === 'category') positions = xs.map((_, i) => i);
    else {
      const read = value => {
        if (type === 'number') return number(ctx, value);
        if (!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d))?$/.test(value)) fail('stream times need ISO dates or timestamps with UTC offsets');
        const n = Date.parse(value);
        if (!Number.isFinite(n)) fail('invalid stream timestamp');
        const day = value.slice(0, 10), check = new Date(Date.parse(day + 'T00:00:00Z'));
        if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== day) fail('invalid stream calendar date');
        return n;
      };
      xs.sort((a, b) => read(a) - read(b)); positions = xs.map(read);
      if (new Set(positions).size !== positions.length) fail('stream positions must be unique');
    }
    const sums = xs.map(x => total(table.series.map(group => table.get(x, group).value)));
    const height = Math.max(240, ctx.height), sx = ctx.scale([positions[0], positions.at(-1)], [16, width - 16]);
    const maximum = Math.max(...sums), sy = ctx.scale([-Math.max(1, maximum) / 2, Math.max(1, maximum) / 2], [height - 44, 16]);
    ctx.setHeight(height);
    const bottom = sums.map(value => -value / 2);
    table.series.forEach((group, i) => {
      const lower = [...bottom], upper = xs.map((x, j) => bottom[j] += table.get(x, group).value);
      const points = upper.map((value, j) => [sx(positions[j]), sy(value)]).concat(lower.map((value, j) => [sx(positions[j]), sy(value)]).reverse());
      svg.append(node('path', { d: 'M' + points.map(p => p.join(',')).join('L') + 'Z', fill: color(i), stroke: 'var(--report-paper)', 'stroke-width': 1.5, 'data-series': group }));
      xs.forEach((x, j) => {
        const cell = table.get(x, group);
        ctx.mark(node('circle', { cx: sx(positions[j]), cy: sy((lower[j] + upper[j]) / 2), r: 6, fill: 'transparent' }), cell.row, cell.index, `${x} · ${group} · ${cell.value} ${spec.unit || ''}`);
      });
    });
    const stride = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(width / 130))));
    xs.forEach((x, i) => { if (i === 0 || i === xs.length - 1 || i % stride === 0 && sx(positions.at(-1)) - sx(positions[i]) > 110) label(ctx, sx(positions[i]), height - 15, x, i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle', 128); });
    legend(ctx, table.series);
  }
  function rungs(ctx, paired) {
    const { spec, width, svg, node } = ctx, amount = unit(ctx), xKey = key(spec, 'x');
    let xs, series, get;
    if (paired) {
      const fields = [key(spec, 'before'), key(spec, 'after')], labels = spec.labels ?? {};
      series = fields.map((field, i) => labels[field] || words(i ? '调整后' : '调整前', i ? 'After' : 'Before'));
      if (new Set(fields).size !== 2 || new Set(series).size !== 2) fail('paired comparison requires two distinct source columns and labels');
      xs = ctx.rows.map(row => category(row[xKey]));
      if (new Set(xs).size !== xs.length || xs.length > 12) fail('paired rungs need at most 12 unique categories');
      get = (x, group) => { const index = xs.indexOf(x), row = ctx.rows[index]; return { row, index, value: number(ctx, row[fields[series.indexOf(group)]]) }; };
    } else ({ xs, series, get } = matrix(ctx, xKey, key(spec, 'series'), key(spec, 'value'), 12, 6));
    const values = xs.flatMap(x => series.map(group => get(x, group).value));
    const counts = values.map(value => unitCount(Math.abs(value), amount));
    if (total(counts) > 2500) fail('too many ticks; choose a larger explicit unitValue');
    const maxima = paired ? values : xs.map(x => total(series.map(group => get(x, group).value)));
    const max = Math.max(0, ...maxima), min = Math.min(0, ...maxima), span = max - min || amount;
    const tallest = paired ? Math.max(...counts) : Math.max(...xs.map(x => total(series.map(group => unitCount(get(x, group).value, amount)))));
    const chartHeight = Math.max(ctx.height, 170 + tallest * 2);
    ctx.setHeight(chartHeight);
    const top = 36, bottom = chartHeight - 56, sy = ctx.scale([min, min + span], [bottom, top]), band = (width - 32) / xs.length, bw = Math.min(30, band / (paired ? 3.5 : 2));
    svg.append(node('line', { x1: 16, x2: width - 16, y1: sy(0), y2: sy(0), stroke: grid }));
    xs.forEach((x, i) => {
      let base = 0;
      series.forEach((group, s) => {
        const cell = get(x, group), count = unitCount(Math.abs(cell.value), amount), center = 16 + band * (i + .5) + (paired ? (s - .5) * (bw + 6) : 0);
        const start = paired ? 0 : base, end = start + cell.value, fill = paired ? tone(ctx, cell.value, s ? 0 : 2) : color(s);
        const mark = node('g', { 'data-series': group });
        for (let tick = 0; tick < count; tick++) {
          const y = sy(start + Math.sign(cell.value) * (tick + .5) * amount);
          mark.append(node('line', { x1: center - bw / 2, x2: center + bw / 2, y1: y, y2: y, stroke: fill, 'stroke-width': 1.1 }));
        }
        const high = Math.min(sy(start), sy(end)), low = Math.max(sy(start), sy(end));
        mark.append(node('rect', { x: center - bw / 2, y: high - 2, width: bw, height: Math.max(4, low - high + 4), fill: 'transparent' }));
        ctx.mark(mark, cell.row, cell.index, `${x} · ${group} · ${cell.value} ${spec.unit || ''}`);
        if (paired) label(ctx, center, cell.value < 0 ? sy(end) + 15 : sy(end) - 8, display(cell.value), 'middle', band / 2, { fill });
        base = end;
      });
      if (!paired) label(ctx, 16 + band * (i + .5), sy(base) - 10, display(base), 'middle', band);
      label(ctx, 16 + band * (i + .5), chartHeight - 20, x, 'middle', band - 4);
    });
    if (paired) {
      const el = ctx.html('p', 'sc-missing-note', `${series[0]} / ${series[1]} · ${words('每格', 'Each tick')} ${amount} ${spec.unit || ''}`);
      ctx.frame.append(el);
    } else { legend(ctx, series); ctx.note(`${words('每格', 'Each tick')} ${amount} ${spec.unit || ''}`); }
  }
  function dotHeatmap(ctx) {
    const { spec, width, svg, node } = ctx, xKey = key(spec, 'x'), yKey = key(spec, 'y'), valueKey = key(spec, 'value');
    const xs = [], ys = [], seen = new Set();
    const cells = ctx.rows.map((row, index) => {
      const x = category(row[xKey]), y = category(row[yKey]), id = JSON.stringify([x, y]);
      if (seen.has(id)) fail('duplicate dot-heatmap cell'); seen.add(id);
      if (!xs.includes(x)) xs.push(x); if (!ys.includes(y)) ys.push(y);
      return { row, index, x, y, value: ctx.numeric(row[valueKey]) };
    });
    if (xs.length > 24 || ys.length > 24 || cells.length !== xs.length * ys.length) fail('dot heatmap needs an explicit grid, at most 24 × 24; use null for missing');
    const left = Math.min(85, width * .22), band = (width - left - 16) / xs.length, rowHeight = Math.max(25, Math.min(40, band));
    const height = Math.max(160, ys.length * rowHeight + 72); ctx.setHeight(height);
    const maximum = Math.max(...cells.map(cell => Math.abs(cell.value ?? 0))), radius = Math.min(16, band * .42, rowHeight * .4);
    cells.forEach(cell => {
      const x = left + (xs.indexOf(cell.x) + .5) * band, y = 18 + (ys.indexOf(cell.y) + .5) * rowHeight, mark = node('g');
      if (cell.value === null) mark.append(node('path', { d: `M${x - 3},${y - 3}l6,6m-6,0l6,-6`, stroke: muted, 'stroke-width': 1 }));
      else mark.append(node('circle', { cx: x, cy: y, r: cell.value === 0 ? 2 : radius * Math.sqrt(Math.abs(cell.value) / maximum), fill: cell.value === 0 ? 'none' : tone(ctx, cell.value, 0), stroke: cell.value === 0 ? muted : 'none', 'data-value': cell.value }));
      mark.append(node('circle', { cx: x, cy: y, r: Math.max(5, radius), fill: 'transparent' }));
      ctx.mark(mark, cell.row, cell.index, `${cell.y} · ${cell.x} · ${cell.value === null ? words('缺失', 'Missing') : cell.value + ' ' + (spec.unit || '')}`);
    });
    const stride = Math.max(1, Math.ceil(55 / band));
    xs.forEach((x, i) => { if (i % stride === 0) label(ctx, left + (i + .5) * band, 38 + ys.length * rowHeight, x, 'middle', band * stride); });
    ys.forEach((y, i) => label(ctx, left - 10, 22 + (i + .5) * rowHeight, y, 'end', left - 10));
    ctx.note(`${words('圆面积表示数值大小；空心为 0，× 为缺失。最大值', 'Circle area represents magnitude; hollow = 0, × = missing. Maximum magnitude')} ${display(maximum)} ${spec.unit || ''}`);
  }
  function funnel(ctx) {
    const { spec, width, rows, svg, node } = ctx, xKey = key(spec, 'x'), valueKey = key(spec, 'value');
    if (rows.length < 2 || rows.length > 12) fail('funnel needs 2–12 ordered stages');
    const values = rows.map(row => count(ctx, row[valueKey])), labels = rows.map(row => category(row[xKey]));
    if (new Set(labels).size !== labels.length || values.some((value, i) => i && value > values[i - 1])) fail('funnel stages must be unique and counts cannot increase');
    const left = 48, right = Math.min(145, width * .34), full = width - left - right, center = left + full / 2;
    const height = Math.max(280, rows.length * 62); ctx.setHeight(height);
    const y = i => 24 + i * (height - 55) / (rows.length - 1), w = value => values[0] ? full * value / values[0] : 0;
    rows.forEach((row, i) => {
      const span = w(values[i]), mark = node('g');
      if (i < rows.length - 1) {
        const next = w(values[i + 1]);
        for (let strand = 0; strand <= 24; strand++) {
          const t = strand / 24 - .5, x1 = center + t * span, x2 = center + t * next, mid = (y(i) + y(i + 1)) / 2;
          svg.append(node('path', { d: `M${x1},${y(i) + 7}C${x1},${mid} ${x2},${mid} ${x2},${y(i + 1) - 7}`, fill: 'none', stroke: color(i % 2 ? 1 : 2), 'stroke-width': .55, opacity: .5 }));
        }
      }
      for (let x = center - span / 2; x <= center + span / 2 && span > 0; x += 3) mark.append(node('line', { x1: x, x2: x, y1: y(i) - 6, y2: y(i) + 6, stroke: color(i % 2 ? 1 : 0), 'stroke-width': 1 }));
      mark.append(node('rect', { x: center - Math.max(3, span) / 2, y: y(i) - 8, width: Math.max(3, span), height: 16, fill: 'transparent' }));
      ctx.mark(mark, row, i, `${labels[i]} · ${values[i]} ${spec.unit || ''}`);
      label(ctx, width - right + 12, y(i) - 3, labels[i], 'start', right - 16);
      label(ctx, width - right + 12, y(i) + 15, display(values[i]), 'start', right - 16, { fill: color(0), 'font-weight': 650 });
      if (i) label(ctx, 1, y(i) - 18, values[i - 1] ? `${display(values[i] / values[i - 1] * 100)}%` : '—', 'start', 48);
    });
    ctx.note(words('宽度表示剩余数量；左侧为较上一步留下的比例。', 'Width shows the remaining count; percentages compare each stage with the preceding stage.'));
  }
  function categoryLinks(ctx) {
    const { spec, rows, width, svg, node } = ctx, itemKey = key(spec, 'item'), groupKey = key(spec, 'group');
    const items = rows.map(row => category(row[itemKey])), groups = [...new Set(rows.map(row => category(row[groupKey])))];
    if (new Set(items).size !== rows.length || rows.length > 60 || groups.length > 12) fail('category links need at most 60 unique items and 12 groups; each item belongs to one group');
    const height = Math.max(260, rows.length * 21 + 24); ctx.setHeight(height);
    const left = Math.min(130, width * .33), right = width - Math.min(145, width * .36), top = 18;
    const gy = group => top + (groups.indexOf(group) + .5) * (height - 36) / groups.length;
    rows.forEach((row, i) => {
      const group = category(row[groupKey]), y = top + (i + .5) * (height - 36) / rows.length, destination = gy(group), mark = node('g');
      mark.append(node('path', { d: `M${left},${y}C${left + (right - left) * .45},${y} ${right - (right - left) * .4},${destination} ${right},${destination}`, fill: 'none', stroke: color(groups.indexOf(group)), opacity: .4, 'stroke-width': 1 }));
      mark.append(node('circle', { cx: left, cy: y, r: 2, fill: color(groups.indexOf(group)) }));
      ctx.mark(mark, row, i, `${items[i]} → ${group}`);
      label(ctx, left - 9, y + 4, items[i], 'end', left - 12);
    });
    groups.forEach((group, i) => {
      const n = rows.filter(row => category(row[groupKey]) === group).length;
      svg.append(node('circle', { cx: right, cy: gy(group), r: 5, fill: color(i) }));
      label(ctx, right + 13, gy(group) + 4, `${group} · ${n}`, 'start', width - right - 15);
    });
  }
  function outcomeTally(ctx) {
    const { spec, rows, width, svg, node } = ctx, xKey = key(spec, 'x'), valueKey = key(spec, 'value'), totalKey = key(spec, 'total'), amount = unit(ctx);
    if (rows.length > 12 || typeof spec.overlap !== 'boolean') fail('outcome tally needs at most 12 rows and an explicit overlap true/false');
    if (!Number.isSafeInteger(amount)) fail('sample ticks need an integer unitValue');
    const samples = rows.map(row => ({ n: count(ctx, row[totalKey]), hit: count(ctx, row[valueKey]), label: category(row[xKey]) }));
    if (new Set(samples.map(s => s.label)).size !== samples.length) fail('duplicate outcome');
    samples.forEach(s => { if (!s.n || s.hit > s.n) fail('outcome counts need 0 ≤ count ≤ positive total'); unitCount(s.n, amount); unitCount(s.hit, amount); });
    if (total(samples.map(s => unitCount(s.n, amount))) > 2500) fail('more than 2500 sample ticks; choose an explicit larger exact unitValue');
    if (!spec.overlap && (new Set(samples.map(s => s.n)).size !== 1 || total(samples.map(s => s.hit)) > samples[0].n)) fail('nonoverlapping outcomes must share one sample total and cannot exceed it');
    ctx.setHeight(Math.max(150, rows.length * 80 + 12));
    samples.forEach((sample, i) => {
      const y = i * 80 + 22, count = unitCount(sample.n, amount), hits = unitCount(sample.hit, amount), step = (width - 24) / count, mark = node('g');
      label(ctx, 10, y, sample.label, 'start', width * .57);
      label(ctx, width - 10, y, `${sample.hit} / ${sample.n} · ${display(sample.hit / sample.n * 100)}%`, 'end', width * .43, { fill: color(0), 'font-weight': 650 });
      for (let tick = 0; tick < count; tick++) {
        const x = 12 + (tick + .5) * step, hit = tick < hits;
        mark.append(node('line', { x1: x, x2: x, y1: y + (hit ? 12 : 24), y2: y + 40, stroke: hit ? color(0) : grid, 'stroke-width': Math.min(1.2, step * .6) }));
      }
      mark.append(node('rect', { x: 10, y: y + 9, width: width - 20, height: 34, fill: 'transparent' }));
      ctx.mark(mark, rows[i], i, `${sample.label} · ${sample.hit} / ${sample.n}`);
    });
    ctx.note(`${words('每格', 'Each tick')} ${amount} ${words('个样本', 'samples')} · ${spec.overlap ? words('各行可重复计数，不相加。', 'Outcomes may overlap; do not add rows.') : words('各行互不重复。', 'Outcomes are mutually exclusive.')}`);
  }
  const raceViews = new WeakMap();
  function rankRace(ctx) {
    const { spec, width, svg, node } = ctx;
    const table = matrix(ctx, key(spec, 'time'), key(spec, 'item'), key(spec, 'value'), 120, 12, true);
    if (table.xs.length < 2) fail('rank race needs at least two ordered frames');
    const frame = spec.frame === undefined ? table.xs.at(-1) : String(spec.frame);
    if (!table.xs.includes(frame)) fail('frame must identify a supplied observation');
    let saved = raceViews.get(ctx.target);
    if (saved?.spec !== spec) saved = { spec, frame };
    raceViews.set(ctx.target, saved);
    const render = {}; saved.render = render;
    let timer = null, animation = null, stopped = false, positions;
    const motion = global.matchMedia('(prefers-reduced-motion: reduce)');
    const left = Math.min(100, width * .28), right = 66, top = 15, rowHeight = 35, plotHeight = table.series.length * rowHeight;
    ctx.setHeight(Math.max(200, plotHeight + 80));
    const values = ctx.rows.map(row => number(ctx, row[key(spec, 'value')]));
    const domain = [Math.min(0, ...values), Math.max(0, ...values)];
    if (domain[0] === domain[1]) domain[1] = 1;
    const sx = ctx.scale(domain, [left, width - right]), zero = sx(0);
    const controls = ctx.html('div', 'sc-race-controls'), play = ctx.html('button', null, words('播放', 'Play')), slider = ctx.html('input'), caption = ctx.html('span');
    play.type = 'button'; slider.type = 'range'; slider.min = '0'; slider.max = String(table.xs.length - 1); slider.step = '1'; slider.setAttribute('aria-label', words('选择时间', 'Select frame'));
    controls.append(play, slider, caption); ctx.frame.append(controls);
    const draw = (selected, animate = false) => {
      if (animation !== null) global.cancelAnimationFrame(animation);
      saved.frame = selected; slider.value = String(table.xs.indexOf(selected)); caption.textContent = selected;
      const sorted = table.series.map(item => table.get(selected, item)).sort((a, b) => b.value - a.value || table.series.indexOf(a.group) - table.series.indexOf(b.group));
      const next = new Map(sorted.map((cell, rank) => [cell.group, { y: top + rank * rowHeight, x: sx(cell.value) }]));
      const before = positions || next; positions = next;
      svg.replaceChildren(); ctx.frame.querySelector('.sc-tooltip').hidden = true;
      svg.append(node('line', { x1: zero, x2: zero, y1: top - 5, y2: top + plotHeight, stroke: grid }));
      const nodes = sorted.map(cell => {
        const group = node('g', { 'data-item': cell.group }), bar = node('rect', { height: 22, rx: 11, fill: tone(ctx, cell.value, table.series.indexOf(cell.group)), 'data-value': cell.value });
        group.append(bar); ctx.mark(group, cell.row, cell.index, `${selected} · ${cell.group} · ${cell.value} ${spec.unit || ''}`);
        const name = label(ctx, left - 9, 0, cell.group, 'end', left - 12), value = label(ctx, 0, 0, display(cell.value), 'start', 60, { fill: ink });
        return { cell, group, bar, name, value };
      });
      const year = label(ctx, width - 12, ctx.height - 8, selected, 'end', width - 24, { 'font-size': 28, fill: muted, opacity: .35, 'data-race-frame': selected });
      year.style.fontSize = '28px';
      const started = global.performance.now(), duration = animate && !motion.matches ? 450 : 0;
      const update = now => {
        if (stopped) return;
        const progress = duration ? Math.min(1, (now - started) / duration) : 1, t = 1 - (1 - progress) ** 3;
        for (const { cell, group, bar, name, value } of nodes) {
          const a = before.get(cell.group), b = next.get(cell.group), y = a.y + (b.y - a.y) * t, x = a.x + (b.x - a.x) * t;
          group.setAttribute('transform', `translate(0,${y})`); bar.setAttribute('x', Math.min(x, zero)); bar.setAttribute('width', Math.abs(x - zero));
          name.setAttribute('y', y + 16); value.setAttribute('y', y + 16); value.setAttribute('x', cell.value < 0 ? zero + 7 : x + 7);
        }
        animation = progress < 1 ? global.requestAnimationFrame(update) : null;
      };
      update(started);
    };
    const pause = () => { if (timer !== null) global.clearInterval(timer); timer = null; play.textContent = words('播放', 'Play'); play.setAttribute('aria-pressed', 'false'); };
    const onPlay = () => {
      if (timer !== null) { pause(); return; }
      play.textContent = words('暂停', 'Pause'); play.setAttribute('aria-pressed', 'true');
      const next = () => draw(table.xs[(table.xs.indexOf(saved.frame) + 1) % table.xs.length], true);
      next(); timer = global.setInterval(next, 1500);
    };
    const onInput = () => { pause(); draw(table.xs[Number(slider.value)]); };
    const onMotion = () => { if (motion.matches) { pause(); draw(saved.frame); } };
    play.addEventListener('click', onPlay); slider.addEventListener('input', onInput); motion.addEventListener('change', onMotion);
    ctx.onCleanup(() => {
      stopped = true; pause(); if (animation !== null) global.cancelAnimationFrame(animation);
      play.removeEventListener('click', onPlay); slider.removeEventListener('input', onInput); motion.removeEventListener('change', onMotion);
      queueMicrotask(() => { if (saved.render === render && raceViews.get(ctx.target) === saved) raceViews.delete(ctx.target); });
    });
    pause(); draw(saved.frame);
  }
  function spectrum(ctx) {
    const { spec, rows, width, svg, node } = ctx, itemKey = key(spec, 'label', 'item'), dimensions = spec.dimensions;
    const items = rows.map(row => category(row[itemKey]));
    if (rows.length > 12 || new Set(items).size !== items.length || !Array.isArray(dimensions) || dimensions.length < 1 || dimensions.length > 10) fail('spectrum needs 1–10 dimensions and at most 12 unique items');
    if (!items.includes(spec.focus)) fail('spectrum focus must identify one supplied item');
    if (new Set(dimensions.map(d => d?.field)).size !== dimensions.length) fail('spectrum dimensions must be unique');
    const left = Math.min(106, width * .25), right = width - left, rowHeight = 72;
    ctx.setHeight(Math.max(120, dimensions.length * rowHeight + 25));
    let missing = 0;
    dimensions.forEach((dimension, d) => {
      const field = key(dimension, 'field'), low = number(ctx, dimension.min), high = number(ctx, dimension.max);
      if (high <= low) fail('spectrum min must be less than max');
      const leftLabel = category(dimension.left), rightLabel = category(dimension.right), y = 30 + d * rowHeight, sx = ctx.scale([low, high], [left, right]);
      svg.append(node('line', { x1:left, x2:right, y1:y, y2:y, stroke:color(2), 'stroke-width':1 }));
      for (let n = 0; n <= 4; n++) { const x = left + (right - left) * n / 4; svg.append(node('line', { x1:x, x2:x, y1:y-3, y2:y+3, stroke:grid })); }
      label(ctx, left-10, y+4, leftLabel, 'end', left-13); label(ctx, right+10, y+4, rightLabel, 'start', left-13);
      label(ctx, left, y+23, display(low), 'start', 65); label(ctx, right, y+23, `${display(high)}${dimension.unit || ''}`, 'end', 85);
      rows.map((row,index)=>({row,index})).sort((a,b)=>Number(items[a.index]===spec.focus)-Number(items[b.index]===spec.focus)).forEach(({row,index})=>{
        const value = ctx.numeric(row[field]);
        if (value === null) { missing++; return; }
        if (value < low || value > high) fail('spectrum value is outside its stated bounds');
        const focused = items[index] === spec.focus;
        ctx.mark(node('circle', { cx:sx(value), cy:y, r:focused?7:3, fill:focused?color(0):color(1), stroke:focused?'var(--report-paper)':'none', 'stroke-width':1.5, 'data-dimension':field, 'data-value':value }), row, index, `${items[index]} · ${dimension.label || `${leftLabel} / ${rightLabel}`} · ${value}${dimension.unit || ''}`);
      });
    });
    ctx.note(`${words('大点', 'Large dot')}: ${spec.focus} · ${words('小点：对照方案', 'Small dots: comparison items')}${missing ? ` · ${missing} ${words('项缺失，未标点', 'missing observations omitted')}` : ''}`);
  }
  function tickDonut(ctx) {
    const { spec, rows, width, svg, node } = ctx, xKey = key(spec, 'x'), valueKey = key(spec, 'value'), amount = unit(ctx);
    const names = rows.map(row=>category(row[xKey])), values = rows.map(row=>number(ctx,row[valueKey],true)), counts = values.map(value=>unitCount(value,amount)), ticks = total(counts);
    if (rows.length > 8 || new Set(names).size !== names.length || ticks < 1 || ticks > 360) fail('tick donut needs 1–8 unique parts and 1–360 exact ticks');
    const height = Math.max(280, Math.min(ctx.height, 420)), cx = width / 2, cy = height / 2, radius = Math.min(width * .24, height * .32), inner = radius - 15;
    ctx.setHeight(height);
    let offset = 0;
    const annotations = rows.map((row,i)=>{
      const mark = node('g', { 'data-part':names[i], 'data-tick-count':counts[i] });
      for (let tick = 0; tick < counts[i]; tick++) {
        const a = (offset + tick + .5) / ticks * Math.PI * 2 - Math.PI / 2;
        mark.append(node('line', { x1:cx+Math.cos(a)*inner, y1:cy+Math.sin(a)*inner, x2:cx+Math.cos(a)*radius, y2:cy+Math.sin(a)*radius, stroke:color(i), 'stroke-width':1.2 }));
      }
      const angle = (offset + counts[i] / 2) / ticks * Math.PI * 2 - Math.PI / 2, side = Math.cos(angle) >= 0 ? 1 : -1;
      const entry = { i, row, x:cx+Math.cos(angle)*(radius+5), y:cy+Math.sin(angle)*(radius+5), side };
      offset += counts[i]; ctx.mark(mark,row,i,`${names[i]} · ${values[i]} ${spec.unit || ''}`); return entry;
    });
    for (const side of [-1,1]) {
      const labels = annotations.filter(a=>a.side===side).sort((a,b)=>a.y-b.y);
      labels.forEach((entry,i)=>{
        const y = Math.max(20+i*26, Math.min(height-20-(labels.length-i-1)*26, entry.y));
        entry.labelY = i ? Math.max(y,labels[i-1].labelY+26) : y;
      });
      labels.forEach(entry=>{
        const x = cx+side*(radius+19), y = entry.labelY;
        svg.append(node('path',{d:`M${entry.x},${entry.y}L${x-side*5},${y}`,fill:'none',stroke:color(entry.i),'stroke-width':.7}));
        label(ctx,x,y+4,`${names[entry.i]} · ${display(values[entry.i])}`,side===1?'start':'end',width/2-radius-21,{fill:color(entry.i)});
      });
    }
    const center = label(ctx,cx,cy-1,display(total(values)),'middle',inner*.8,{fill:color(0),'font-weight':650}); center.style.fontSize = '26px';
    label(ctx,cx,cy+23,`${words('每格', 'Each tick')} ${amount}${spec.unit || ''}`,'middle',inner*1.9);
    ctx.note(words('从正上方开始，顺时针读取；所有部分合为总数。','Read clockwise from the top; every part contributes to the total.'));
  }
  function horizontalPositions(ctx, xKey, type) {
    if (!['time','number','category'].includes(type)) fail('xType must be time, number or category');
    const seen = new Set();
    const entries = ctx.rows.map((row,index)=>{
      const x = category(row[xKey]); let position = index;
      if (type === 'time') {
        if (!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d))?$/.test(x)) fail('time needs ISO dates or timestamps with UTC offsets');
        position = Date.parse(x); const day = x.slice(0,10), date = new Date(Date.parse(day+'T00:00:00Z'));
        if (!Number.isFinite(position) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==day) fail('invalid calendar date');
      } else if (type === 'number') position = number(ctx,row[xKey]);
      const id = type === 'category' ? x : position;
      if (seen.has(id)) fail('duplicate horizontal observation'); seen.add(id);
      return {row,index,x,position};
    });
    return entries.sort((a,b)=>a.position-b.position);
  }
  function barcode(ctx) {
    const { spec, width, svg, node } = ctx, entries = horizontalPositions(ctx,key(spec,'x'),spec.xType??'category'), valueKey = key(spec,'value');
    const highlights = spec.highlights ?? [];
    if (!Array.isArray(highlights) || highlights.length > 6 || new Set(highlights.map(String)).size !== highlights.length) fail('barcode highlights need at most 6 unique supplied x values');
    entries.forEach(entry=>entry.value=ctx.numeric(entry.row[valueKey]));
    if (highlights.some(value=>!entries.some(entry=>entry.x===String(value)&&entry.value!==null))) fail('barcode highlight must identify an observed value');
    const height = Math.max(260,ctx.height), left = 18, right = width-18, top = highlights.length ? 64 : 32, bottom = height-58;
    ctx.setHeight(height);
    const sx = ctx.scale([entries[0].position,entries.at(-1).position],[left,right]), values = entries.map(e=>e.value).filter(v=>v!==null), lo = Math.min(0,...values), hi = Math.max(0,...values);
    const sy = ctx.scale(lo===hi?[lo,lo+1]:[lo,hi],[bottom,top]), selected = entries.filter(entry=>highlights.map(String).includes(entry.x));
    svg.append(node('line',{x1:left,x2:right,y1:sy(0),y2:sy(0),stroke:grid}));
    const radius = Math.max(1.5,Math.min(3.5,(right-left)/Math.max(entries.length,1)*.3));
    entries.forEach(entry=>{
      const x = sx(entry.position), mark = node('g');
      svg.append(node('line',{x1:x,x2:x,y1:top,y2:bottom,stroke:grid,'stroke-width':.5}));
      if (entry.value === null) mark.append(node('path',{d:`M${x-2},${bottom+8}l4,4m-4,0l4,-4`,stroke:muted,'stroke-width':1}));
      else {
        const fill = tone(ctx,entry.value), y = sy(entry.value);
        mark.append(node('line',{x1:x,x2:x,y1:sy(0),y2:y,stroke:fill,'stroke-width':.8}),node('circle',{cx:x,cy:y,r:radius,fill,'data-value':entry.value,'data-x':entry.x}));
      }
      ctx.mark(mark,entry.row,entry.index,`${entry.x} · ${entry.value===null?words('缺失','Missing'):entry.value+' '+(spec.unit||'')}`);
    });
    selected.forEach((entry,i)=>{
      const slot = (right-left)/selected.length, x = left+slot*(i+.5);
      svg.append(node('path',{d:`M${x},28L${sx(entry.position)},${sy(entry.value)-5}`,fill:'none',stroke:color(2),'stroke-width':.6}));
      label(ctx,x,20,display(entry.value),'middle',slot-4,{fill:color(0),'font-weight':650});
    });
    const stride = Math.max(1,Math.ceil(entries.length/Math.max(2,Math.floor(width/120))));
    entries.forEach((entry,i)=>{if(i===0||i===entries.length-1||i%stride===0&&sx(entries.at(-1).position)-sx(entry.position)>110)label(ctx,sx(entry.position),height-14,entry.x,i===0?'start':i===entries.length-1?'end':'middle',120);});
    ctx.note(`${words('每点是一条观测；竖线从零起，× 为缺失。','Each dot is an observation; stems start at zero, × means missing.')} ${spec.unit || ''}`);
  }
  function bubbleLedger(ctx) {
    const { spec, rows, width, svg, node } = ctx, xKey = key(spec,'x'), yearKey = key(spec,'y','year'), valueKey = key(spec,'value'), statusKey = key(spec,'status');
    const groups = [], years = [], seen = new Set(), events = new Map();
    const cells = rows.map((row,index)=>{
      const group = category(row[xKey]), year = number(ctx,row[yearKey]), id = JSON.stringify([group,year]);
      if (!Number.isSafeInteger(year)||year<1000||year>9999||seen.has(id)) fail('ledger needs a unique category/year pair and four-digit calendar years'); seen.add(id);
      if (!groups.includes(group))groups.push(group); if(!years.includes(year))years.push(year);
      const value = ctx.numeric(row[valueKey]), status = row[statusKey] ?? (value===null?'missing':'observed');
      if (!['observed','partial','missing'].includes(status)||status==='missing'&&value!==null||status!=='missing'&&value===null) fail('ledger status must agree with observed/partial values or explicit missing null');
      if (spec.event && row[spec.event]!=null && row[spec.event]!=='') {const event=category(row[spec.event]);if(events.has(year)&&events.get(year)!==event)fail('ledger events must agree for the same year');events.set(year,event);}
      return {row,index,group,year,value,status};
    });
    years.sort((a,b)=>a-b);
    if (groups.length>16||years.length>25||years.at(-1)-years[0]>30||cells.length!==groups.length*years.length) fail('ledger needs a complete grid, at most 16 categories and 25 observed years spanning 30 years; use null for missing');
    const left = 47, right = 12, band = (width-left-right)/groups.length, rowHeight = Math.max(30,Math.min(46,band*1.15)), top = 42;
    const height = Math.max(180,(years.at(-1)-years[0]+1)*rowHeight+top+24); ctx.setHeight(height);
    const sy = year=>top+rowHeight/2+(year-years[0])*rowHeight, maximum = Math.max(0,...cells.map(c=>Math.abs(c.value??0))), maxRadius = Math.min(band*.45,rowHeight*.45);
    years.forEach(year=>{svg.append(node('line',{x1:left,x2:width-right,y1:sy(year),y2:sy(year),stroke:grid,'stroke-width':.6}));label(ctx,left-9,sy(year)+4,year,'end',38);});
    groups.forEach((group,i)=>label(ctx,left+(i+.5)*band,20,group,'middle',band-3));
    cells.forEach(cell=>{
      const x = left+(groups.indexOf(cell.group)+.5)*band, y = sy(cell.year), r = cell.value===null?4:cell.value===0?2:maxRadius*Math.sqrt(Math.abs(cell.value)/maximum), mark = node('g',{'data-status':cell.status});
      const fill = cell.value===null?muted:tone(ctx,cell.value,groups.indexOf(cell.group));
      mark.append(node('circle',{cx:x,cy:y,r,fill:cell.value===null||cell.value===0?'none':fill,'fill-opacity':.14,stroke:fill,'stroke-width':.7,...(cell.status!=='observed'?{'stroke-dasharray':'2 2'}:{}),'data-value':cell.value??'missing'}));
      if(cell.value!==null&&cell.value!==0)mark.append(node('circle',{cx:x,cy:y,r:1.8,fill}));
      mark.append(node('circle',{cx:x,cy:y,r:Math.max(r,6),fill:'transparent'}));
      ctx.mark(mark,cell.row,cell.index,`${cell.year} · ${cell.group} · ${cell.value===null?words('缺失','Missing'):cell.value+' '+(spec.unit||'')}${cell.status==='partial'?words(' · 资料不完整',' · Partial coverage'):''}`);
    });
    ctx.note(words('圆面积表示数值大小；虚线为资料不完整，空心小点为 0。','Circle area represents magnitude; dashed outlines indicate incomplete coverage; small hollow dots indicate zero.'));
    if(events.size){const notes=ctx.html('div','sc-ledger-events');for(const[year,event]of [...events].sort((a,b)=>a[0]-b[0])){const entry=ctx.html('span'),time=ctx.html('strong',null,year);entry.append(time,document.createTextNode(' '+event));notes.append(entry);}ctx.frame.append(notes);}
  }
  for (const [kind, renderer] of Object.entries({ stream, 'stacked-rungs': ctx => rungs(ctx, false), 'dot-heatmap': dotHeatmap, funnel, 'category-links': categoryLinks, 'outcome-tally': outcomeTally, 'paired-rungs': ctx => rungs(ctx, true), 'rank-race': rankRace, spectrum, 'tick-donut': tickDonut, barcode, 'bubble-ledger': bubbleLedger })) global.SesameCharts.register(kind, renderer);
})(window);
