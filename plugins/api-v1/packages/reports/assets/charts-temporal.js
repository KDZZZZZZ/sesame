/* Sesame temporal charts — MIT, Sesame contributors.
 * Original SVG implementation; no Lieflat code or third-party chart runtime. */
(function (global) {
  'use strict';
  if (!global.SesameCharts?.register) throw Error('Load SesameCharts before charts-temporal.js');
  const fail = message => { throw Error(`SesameCharts: ${message}`); };
  const text = (value, name) => typeof value === 'string' && value.trim() ? value : fail(`${name} must be a nonempty string`);
  const line = 'var(--border,var(--report-default-border))';
  const color = index => `var(--chart-series-${index % 6 + 1},var(--report-default-chart-series-${index % 6 + 1}))`;
  const short = (value, limit = 18) => String(value).length > limit ? String(value).slice(0, limit - 1) + '…' : String(value);
  const views = new WeakMap();
  const listen = (ctx, target, event, handler) => { target.addEventListener(event, handler); ctx.onCleanup(() => target.removeEventListener(event, handler)); };
  function rememberView(ctx, saved) {
    const render = {}; saved.render = render; views.set(ctx.target, saved);
    ctx.onCleanup(() => queueMicrotask(() => {
      // Resize redraw is synchronous and adopts the same view first. A
      // destroyed chart releases its saved spec/rows even if its DOM survives.
      if (saved.render === render && views.get(ctx.target) === saved) views.delete(ctx.target);
    }));
  }
  function empty(ctx) {
    if (!Array.isArray(ctx.rows) || ctx.rows.length > 2500 || ctx.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) fail('expected at most 2,500 source objects');
    if (!ctx.rows.length) { ctx.note(ctx.spec.emptyLabel || 'No observations'); return true; }
    return false;
  }
  function timezone(spec) {
    const zone = text(spec.timezone, 'timezone');
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); } catch { fail('timezone must be an explicit valid IANA time zone'); }
    return zone;
  }
  function dateOnly(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return null;
    const milliseconds = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) fail('invalid calendar date');
    return milliseconds;
  }
  function instant(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime())) return value;
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) fail('timestamps need an explicit UTC offset; date-only values use YYYY-MM-DD');
    if (dateOnly(value.slice(0, 10)) === null) fail('invalid timestamp date');
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) fail('invalid timestamp');
    return milliseconds;
  }
  function day(value, zone) {
    if (dateOnly(value) !== null) return value;
    const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant(value));
    const part = name => parts.find(item => item.type === name).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function temporal(values) {
    const calendar = values.map(value => dateOnly(value) !== null);
    if (calendar.some(Boolean) && !calendar.every(Boolean)) fail('do not mix calendar dates and instants in one timeline');
    return values.map(value => calendar[0] ? dateOnly(value) : instant(value));
  }
  function timeLabel(value, zone) {
    if (dateOnly(value) !== null) return value;
    const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant(value));
    const part = name => parts.find(item => item.type === name).value;
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
  }
  function axisText(ctx, x, y, value, anchor = 'middle', limit = 18) {
    const label = ctx.node('text', { x, y, 'text-anchor': anchor, class: 'sc-axis' }, short(value, limit));
    label.append(ctx.node('title', {}, value)); ctx.svg.append(label); return label;
  }
  function addMark(ctx, marks, node, row, index, label) { ctx.mark(node, row, index, label); marks.set(index, node); return node; }
  function publishFilter(ctx, indices) {
    const rows = indices.map(index => ctx.rows[index]);
    ctx.target.dispatchEvent(new CustomEvent('chartfilter', { bubbles: true, detail: { kind: ctx.spec.kind, rows, indices } }));
    ctx.spec.onFilter?.(rows, indices);
  }
  function controls(ctx) { const bar = ctx.html('div', 'report-toolbar'); bar.style.margin = '12px 0'; ctx.frame.append(bar); return bar; }
  function evidence(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 30) fail('evidence must be an array of at most 30 {label,href} links');
    return value.map(item => {
      const label = text(item?.label, 'evidence label'), href = text(item?.href, 'evidence href');
      if (href.trim() !== href || /[\u0000-\u0020\u007f]/.test(href)) fail('invalid evidence href');
      let url; try { url = new URL(href, 'https://sesame.invalid/'); } catch { fail('invalid evidence href'); }
      if (!['http:', 'https:'].includes(url.protocol)) fail('evidence links must be report fragments, relative paths, or HTTP(S) links');
      return { label, href };
    });
  }
  // Every inspectable observation is an original source row, never a synthetic
  // calendar cell or an interpolated rank. JSON preserves exact source strings.
  function inspector(ctx, marks, label, links = () => []) {
    if (!ctx.spec.inspector) return () => {};
    const panel = ctx.html('details', 'report-inspect'), summary = ctx.html('summary', null, `Source rows · ${ctx.rows.length}`);
    const select = ctx.html('select'), output = ctx.html('pre'), linkList = ctx.html('p');
    select.setAttribute('aria-label', 'Inspect source row'); select.style.maxWidth = '100%';
    select.append(ctx.html('option', null, 'Choose an observation'));
    select.firstChild.value = '';
    ctx.rows.forEach((row, index) => { const option = ctx.html('option', null, short(label(row, index), 100)); option.value = String(index); select.append(option); });
    output.hidden = true; output.style.maxHeight = '280px'; output.style.overflow = 'auto'; output.setAttribute('aria-live', 'polite');
    panel.append(summary, select, output, linkList); ctx.frame.append(panel);
    const show = event => {
      const { row, index } = event.detail || {};
      if (ctx.rows[index] !== row) return;
      select.value = String(index); output.textContent = JSON.stringify(row, null, 2); output.hidden = false; linkList.replaceChildren();
      for (const entry of links(row, index)) { const anchor = ctx.html('a', null, entry.label); anchor.href = entry.href; anchor.rel = 'noopener noreferrer'; anchor.style.marginRight = '16px'; linkList.append(anchor); }
    };
    listen(ctx, ctx.target, 'chartselect', show);
    listen(ctx, select, 'change', () => { if (select.value !== '') marks.get(Number(select.value))?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    return indices => {
      const visible = new Set(indices); [...select.options].slice(1).forEach(option => { option.disabled = !visible.has(Number(option.value)); });
      summary.textContent = `Source rows · ${indices.length} / ${ctx.rows.length}`;
      if (select.value !== '' && !visible.has(Number(select.value))) { select.value = ''; output.hidden = true; linkList.replaceChildren(); }
    };
  }
  function evidencePanel(ctx, observations) {
    const panel = ctx.html('p', 'report-source', 'Select an event to inspect its evidence.');
    panel.setAttribute('aria-live', 'polite'); panel.style.overflowWrap = 'anywhere'; ctx.frame.append(panel);
    listen(ctx, ctx.target, 'chartselect', event => {
      const { row, index } = event.detail || {}, item = observations[index];
      if (!item || item.row !== row) return;
      panel.replaceChildren(ctx.html('span', null, `${item.item} · ${item.state}${item.links.length ? ' · ' : ' · No attached evidence link.'}`));
      for (const entry of item.links) { const anchor = ctx.html('a', null, entry.label); anchor.href = entry.href; anchor.rel = 'noopener noreferrer'; anchor.style.marginRight = '16px'; panel.append(anchor); }
    });
  }

  function calendar(ctx) {
    if (empty(ctx)) return;
    const { spec, rows, width, svg, node, numeric } = ctx, zone = timezone(spec);
    const dateKey = spec.date || spec.x || 'date', valueKey = spec.value || spec.y || 'value', statusKey = spec.status || 'status';
    const weekStart = spec.weekStart ?? 1;
    if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) fail('weekStart must be 0–6');
    const seen = new Map(), observations = rows.map((row, index) => {
      const date = day(row[dateKey], zone), value = numeric(row[valueKey]), status = row[statusKey] ?? (value === null ? 'missing' : 'observed');
      if (!['observed', 'closed', 'missing'].includes(status)) fail('calendar status must be observed, closed, or missing');
      if (status === 'observed' && value === null || status !== 'observed' && value !== null) fail('observed dates need a value; closed/missing dates require null or absent value');
      if (seen.has(date)) fail('duplicate calendar day; explicitly aggregate the fixed source first');
      const observation = { row, index, date, value, status }; seen.set(date, observation); return observation;
    });
    const sorted = [...seen.keys()].sort(), from = spec.from ?? sorted[0], to = spec.to ?? sorted.at(-1);
    const start = dateOnly(from), end = dateOnly(to);
    if (start === null || end === null || start > end || (end - start) / 86400000 >= 2500) fail('calendar range must be 1–2,500 calendar days');
    if (sorted[0] < from || sorted.at(-1) > to) fail('calendar range excludes source observations');
    const months = [], cursor = new Date(start); cursor.setUTCDate(1);
    while (cursor.getTime() <= end) { months.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
    const max = Math.max(1, ...observations.filter(item => item.status === 'observed').map(item => Math.abs(item.value))), marks = new Map();
    const label = row => { const observation = seen.get(day(row[dateKey], zone)); return `${observation.date} (${zone}) · ${observation.status === 'observed' ? String(row[valueKey]) + (spec.unit ? ` ${spec.unit}` : '') : observation.status}`; };
    const years = [...new Set(months.map(month => month.slice(0, 4)))], paged = months.length > 12;
    let saved = views.get(ctx.target); if (saved?.spec !== spec || saved.kind !== 'calendar') saved = { spec, kind: 'calendar', year: years[0] };
    rememberView(ctx, saved);
    const pageNote = ctx.html('p', 'sc-missing-note'), explanation = ctx.html('p', 'sc-missing-note');
    pageNote.setAttribute('data-calendar-range', ''); pageNote.setAttribute('role', 'status');
    let select;
    if (paged) {
      const bar = controls(ctx), yearLabel = ctx.html('label', null, 'Year'); select = ctx.html('select'); select.setAttribute('aria-label', 'Calendar year');
      years.forEach(year => { const option = ctx.html('option', null, year); option.value = year; select.append(option); });
      select.value = saved.year; yearLabel.append(select); bar.append(yearLabel); ctx.frame.insertBefore(bar, svg); ctx.frame.insertBefore(pageNote, svg);
    }
    ctx.frame.append(explanation);
    const inspect = inspector(ctx, marks, label);
    const draw = () => {
      const visibleMonths = paged ? months.filter(month => month.startsWith(saved.year + '-')) : months;
      const pageFrom = paged && from < `${saved.year}-01-01` ? `${saved.year}-01-01` : from, pageTo = paged && to > `${saved.year}-12-31` ? `${saved.year}-12-31` : to;
      pageNote.textContent = `Current: ${pageFrom} – ${pageTo} · Full range: ${from} – ${to}`;
      svg.replaceChildren(); marks.clear(); ctx.frame.querySelector('.sc-tooltip').hidden = true;
      const columns = Math.max(1, Math.min(visibleMonths.length, 3, Math.floor((width - 24) / 250))), gap = 22, left = 12;
      const panelWidth = (width - left * 2 - gap * (columns - 1)) / columns, cell = Math.min(44, panelWidth / 7), rowHeights = [];
      const blocks = visibleMonths.map((month, position) => {
        const monthStart = new Date(month + '-01T00:00:00Z'), next = new Date(monthStart); next.setUTCMonth(next.getUTCMonth() + 1);
        const offset = (monthStart.getUTCDay() - weekStart + 7) % 7;
        const first = Math.max(start, monthStart.getTime()), last = Math.min(end, next.getTime() - 86400000);
        const firstWeek = Math.floor((offset + new Date(first).getUTCDate() - 1) / 7), lastWeek = Math.floor((offset + new Date(last).getUTCDate() - 1) / 7);
        const row = Math.floor(position / columns), height = (lastWeek - firstWeek + 1) * cell + 66;
        rowHeights[row] = Math.max(rowHeights[row] || 0, height);
        return { month, monthStart, next, offset, firstWeek, row };
      });
      let total = 0; const rowOffsets = rowHeights.map(height => { const y = total; total += height; return y; });
      ctx.setHeight(Math.max(120, total + 8));
      let absent = 0;
      blocks.forEach(({ month, monthStart, next, offset, firstWeek, row }, position) => {
        const x = left + position % columns * (panelWidth + gap) + (panelWidth - cell * 7) / 2, y = rowOffsets[row];
        axisText(ctx, x, y + 18, month, 'start');
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (let weekday = 0; weekday < 7; weekday++) axisText(ctx, x + (weekday + .5) * cell, y + 40, weekdays[(weekday + weekStart) % 7]);
        for (let time = monthStart.getTime(), number = 1; time < next.getTime(); time += 86400000, number++) {
          const date = new Date(time).toISOString().slice(0, 10); if (date < from || date > to) continue;
          const item = seen.get(date), status = item?.status ?? 'missing', slot = offset + number - 1, cx = x + slot % 7 * cell, cy = y + 50 + (Math.floor(slot / 7) - firstWeek) * cell;
          const opacity = status === 'observed' ? .22 + .68 * Math.abs(item.value) / max : 1;
          const group = node('g', { 'data-date': date, 'data-state': item ? status : 'no-source-row' });
          group.append(node('rect', { x: cx + 2, y: cy + 2, width: cell - 4, height: cell - 4, rx: 3, fill: status === 'observed' ? item.value < 0 ? 'var(--danger,var(--report-default-danger))' : color(1) : 'none', opacity, stroke: status === 'observed' ? 'none' : line, 'stroke-dasharray': status === 'missing' ? '2 3' : 'none' }));
          group.append(node('text', { x: cx + 6, y: cy + 14, class: `sc-axis${status === 'observed' ? ` sc-cell-value${opacity > .6 ? ' sc-cell-inverse' : ''}` : ''}`, stroke: 'none' }, number));
          if (status !== 'observed' || item.value === 0) group.append(node('text', { x: cx + cell / 2, y: cy + cell - 8, 'text-anchor': 'middle', class: 'sc-cell-value', stroke: 'none' }, status === 'closed' ? '×' : status === 'missing' ? '—' : '0'));
          if (item) addMark(ctx, marks, group, item.row, item.index, label(item.row));
          else { absent++; group.append(node('title', {}, `${date} (${zone}) · no source row; status unknown`)); svg.append(group); }
        }
      });
      explanation.textContent = `${zone} · 0 = observed zero · × = explicitly closed · — = missing. ${absent ? `${absent} dates have no source row; closure is not inferred.` : ''}`;
      const indices = observations.filter(item => item.date >= pageFrom && item.date <= pageTo).map(item => item.index); inspect(indices); publishFilter(ctx, indices);
    };
    if (select) listen(ctx, select, 'change', () => { if (years.includes(select.value)) { saved.year = select.value; draw(); } });
    draw();
  }

  function parallel(ctx) {
    if (empty(ctx)) return;
    const { spec, rows, width, node, svg, numeric, extent, scale, format } = ctx, dimensions = spec.dimensions;
    if (!Array.isArray(dimensions) || dimensions.length < 3 || dimensions.length > 6) fail('parallel requires 3–6 explicit dimensions');
    const keys = dimensions.map(dimension => text(dimension?.key, 'dimension key'));
    if (new Set(keys).size !== keys.length) fail('dimension keys must be unique');
    const values = rows.map(row => dimensions.map(dimension => numeric(row[dimension.key])));
    const domains = dimensions.map((dimension, index) => {
      const observations = values.map(row => row[index]).filter(value => value !== null);
      if (!dimension.domain) return extent(observations);
      if (!Array.isArray(dimension.domain) || dimension.domain.length !== 2) fail('dimension domain must have two numbers');
      const domain = dimension.domain.map(numeric);
      if (domain.some(value => value === null) || domain[0] >= domain[1] || observations.some(value => value < domain[0] || value > domain[1])) fail('dimension domain must increase and contain every observed value');
      return domain;
    });
    const height = Math.max(290, ctx.height), left = 36, right = width - 36, top = 62, bottom = height - 55;
    ctx.setHeight(height);
    const sx = scale([0, dimensions.length - 1], [left, right]);
    const labelLimit = Math.max(6, Math.min(18, Math.floor((right - left) / (dimensions.length - 1) / 6) - 1));
    const ys = domains.map((domain, index) => scale(domain, dimensions[index].invert ? [top, bottom] : [bottom, top]));
    dimensions.forEach((dimension, index) => {
      svg.append(node('line', { x1: sx(index), x2: sx(index), y1: top, y2: bottom, class: 'sc-grid' }));
      axisText(ctx, sx(index), 20, dimension.label || dimension.key, 'middle', labelLimit);
      axisText(ctx, sx(index), 36, `${dimension.unit || ''}${dimension.invert ? ' ↓' : ''}`, 'middle', labelLimit);
      const domain = domains[index];
      let labels = domain.map(value => value !== 0 && (Math.abs(value) < .001 || Math.abs(value) >= 1e7) ? value.toExponential() : format(value));
      if (labels[0] === labels[1]) labels = domain.map(value => String(value));
      const ambiguous = short(labels[0], labelLimit) === short(labels[1], labelLimit);
      domain.forEach((value, side) => {
        const tick = axisText(ctx, sx(index), ys[index](value) + (ys[index](value) === top ? -7 : 17), ambiguous ? side === 0 ? 'min' : 'max' : labels[side], 'middle', labelLimit);
        tick.setAttribute('data-domain-value', String(value)); tick.querySelector('title').textContent = String(value);
      });
      if (values.every(row => row[index] === null)) axisText(ctx, sx(index), (top + bottom) / 2, 'No values');
    });
    const groups = spec.group ? [...new Set(rows.map(row => String(row[spec.group] ?? 'missing')))] : [], marks = new Map();
    const label = row => `${row[spec.label || 'label'] ?? 'Observation'} · ${dimensions.map(dimension => `${dimension.label || dimension.key}: ${row[dimension.key] ?? 'missing'}${dimension.unit ? ` ${dimension.unit}` : ''}`).join(' · ')}`;
    values.forEach((row, index) => {
      let drawing = false, path = '';
      row.forEach((value, dimension) => { if (value === null) { drawing = false; return; } path += `${drawing ? 'L' : 'M'}${sx(dimension)},${ys[dimension](value)} `; drawing = true; });
      const group = node('g', { 'data-parallel-row': index, opacity: .65 }), stroke = color(spec.group ? groups.indexOf(String(rows[index][spec.group] ?? 'missing')) : 1);
      group.append(node('path', { d: path, fill: 'none', stroke, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
      row.forEach((value, dimension) => { if (value !== null) group.append(node('circle', { cx: sx(dimension), cy: ys[dimension](value), r: 3, fill: stroke, stroke: 'none' })); });
      addMark(ctx, marks, group, rows[index], index, label(rows[index]));
    });
    let saved = views.get(ctx.target); if (saved?.spec !== spec || saved.kind !== 'parallel') { saved = { spec, kind: 'parallel', ranges: dimensions.map(() => ['', '']), missing: true }; views.set(ctx.target, saved); }
    rememberView(ctx, saved);
    const bar = controls(ctx), inputs = [], message = ctx.html('p', 'sc-missing-note'), missingLabel = ctx.html('label', null, 'Include rows with missing dimensions');
    message.setAttribute('role', 'status'); ctx.frame.append(message);
    dimensions.forEach((dimension, index) => {
      const label = ctx.html('label', null, dimension.label || dimension.key); label.style.flexWrap = 'wrap';
      const range = ctx.html('span', 'report-source', `${String(domains[index][0])} – ${String(domains[index][1])}${dimension.unit ? ` ${dimension.unit}` : ''}`);
      range.setAttribute('data-dimension-range', dimension.key); range.style.overflowWrap = 'anywhere'; range.style.maxWidth = '100%'; label.append(range);
      const pair = ['minimum', 'maximum'].map((boundary, side) => {
        const input = ctx.html('input'); input.type = 'number'; input.step = 'any'; input.value = saved.ranges[index][side]; input.placeholder = String(domains[index][side]); input.style.width = '76px'; input.setAttribute('aria-label', `${dimension.label || dimension.key} ${boundary}`); label.append(input); return input;
      }); inputs.push(pair); bar.append(label);
    });
    const includeMissing = ctx.html('input'); includeMissing.type = 'checkbox'; includeMissing.checked = saved.missing; missingLabel.prepend(includeMissing); bar.append(missingLabel);
    const reset = ctx.html('button', null, 'Reset filters'); reset.type = 'button'; bar.append(reset);
    const inspect = inspector(ctx, marks, label);
    const apply = () => {
      const ranges = inputs.map(pair => pair.map(input => input.value === '' ? null : Number(input.value)));
      const invalid = inputs.some((pair, index) => pair.some(input => input.validity.badInput || input.value !== '' && !Number.isFinite(Number(input.value))) || ranges[index][0] !== null && ranges[index][1] !== null && ranges[index][0] > ranges[index][1]);
      inputs.flat().forEach(input => input.setAttribute('aria-invalid', String(invalid)));
      if (invalid) { message.textContent = 'Enter finite bounds with minimum ≤ maximum; the last valid filter remains active.'; return; }
      saved.ranges = inputs.map(pair => pair.map(input => input.value)); saved.missing = includeMissing.checked;
      const indices = values.flatMap((row, index) => row.every((value, dimension) => value === null ? saved.missing : (ranges[dimension][0] === null || value >= ranges[dimension][0]) && (ranges[dimension][1] === null || value <= ranges[dimension][1])) ? [index] : []);
      const selected = new Set(indices); marks.forEach((mark, index) => { mark.style.display = selected.has(index) ? '' : 'none'; mark.setAttribute('tabindex', selected.has(index) ? '0' : '-1'); });
      inspect(indices); message.textContent = `${indices.length} / ${rows.length} source rows match. Missing values remain missing.`; publishFilter(ctx, indices);
    };
    inputs.flat().forEach(input => listen(ctx, input, 'input', apply)); listen(ctx, includeMissing, 'change', apply);
    listen(ctx, reset, 'click', () => { inputs.flat().forEach(input => { input.value = ''; }); includeMissing.checked = true; apply(); }); apply();
    ctx.note('Each axis has its own stated scale. Lines compare source dimensions; no weights, composite score, or ranking are calculated. Missing dimensions break the line.');
  }

  function bump(ctx) {
    if (empty(ctx)) return;
    const { spec, rows, width, svg, node, numeric, scale } = ctx, zone = timezone(spec);
    const timeKey = spec.time || spec.x || 'time', itemKey = spec.item || 'item', rankKey = spec.rank || spec.y || 'rank';
    const universe = spec.universe;
    if (!Array.isArray(universe) || !universe.length || universe.length > 50 || universe.some(item => typeof item !== 'string' || !item.trim()) || new Set(universe).size !== universe.length) fail('bump requires a fixed universe of 1–50 unique item names');
    if (!['competition', 'dense', 'ordinal', 'as_reported'].includes(spec.ties)) fail('declare ties as competition, dense, ordinal, or as_reported');
    const periodValues = spec.periods ?? [...new Set(rows.map(row => row[timeKey]))];
    if (!Array.isArray(periodValues)) fail('bump periods must be an array');
    const times = temporal(periodValues);
    if (!times.length || times.length > 2500 || new Set(times).size !== times.length) fail('bump periods must be unique');
    const periods = periodValues.map((value, index) => ({ value, time: times[index] })).sort((a, b) => a.time - b.time), positions = new Map(periods.map((period, index) => [period.time, index]));
    const rowTimes = temporal([...periodValues, ...rows.map(row => row[timeKey])]).slice(periodValues.length), cells = new Map();
    const observations = rows.map((row, index) => {
      const item = text(row[itemKey], 'item'), rawRank = row[rankKey], rank = numeric(rawRank), period = positions.get(rowTimes[index]);
      if (!universe.includes(item) || period === undefined) fail('bump source rows must belong to the fixed universe and periods');
      if (typeof rawRank === 'string' && rawRank !== '' && !/^-?(?:0|[1-9]\d*)(?:\.0+)?$/.test(rawRank)) fail('rank strings must be exact integers; fractional digits cannot be rounded into a rank');
      if (rank !== null && (!Number.isInteger(rank) || rank < 1 || rank > universe.length)) fail('rank must be null or a positive integer within the declared universe');
      const key = `${period}:${universe.indexOf(item)}`; if (cells.has(key)) fail('duplicate item/time rank');
      const observation = { row, index, item, rank, period }; cells.set(key, observation); return observation;
    });
    const ties = new Map();
    observations.filter(item => item.rank !== null).forEach(item => { const key = `${item.period}:${item.rank}`; if (!ties.has(key)) ties.set(key, []); ties.get(key).push(item); });
    for (const values of ties.values()) if (spec.ties === 'ordinal' && values.length > 1) fail('ordinal ranks cannot tie');
    if (spec.ties === 'competition') periods.forEach((_, period) => {
      const counts = new Map(); observations.filter(item => item.period === period && item.rank !== null).forEach(item => counts.set(item.rank, (counts.get(item.rank) || 0) + 1));
      let nextPossible = 1;
      for (const [rank, count] of [...counts].sort((a, b) => a[0] - b[0])) {
        if (rank < nextPossible || rank + count - 1 > universe.length) fail('ranks contradict competition ties: observed ties already occupy these rank slots');
        nextPossible = rank + count;
      }
    });
    if (spec.ties === 'dense') periods.forEach((_, period) => {
      const counts = new Map(); observations.filter(item => item.period === period && item.rank !== null).forEach(item => counts.set(item.rank, (counts.get(item.rank) || 0) + 1));
      // Every lower dense rank needs at least one member. Known ties occupy
      // additional members even when other rows or ranks are missing.
      const minimumMembers = Math.max(0, ...counts.keys()) + [...counts.values()].reduce((extra, count) => extra + count - 1, 0);
      if (minimumMembers > universe.length) fail('ranks contradict dense ties: known ties require more members than the fixed universe');
    });
    if (['competition', 'dense'].includes(spec.ties)) periods.forEach((_, period) => {
      const values = observations.filter(item => item.period === period && item.rank !== null); if (values.length !== universe.length) return;
      let expected = 1; const ranks = [...new Set(values.map(item => item.rank))].sort((a, b) => a - b);
      for (const rank of ranks) { if (rank !== expected) fail(`ranks contradict ${spec.ties} ties in a complete period`); expected += spec.ties === 'dense' ? 1 : values.filter(item => item.rank === rank).length; }
    });
    const height = Math.max(290, ctx.height), top = 32, bottom = height - 90, missingY = height - 54;
    ctx.setHeight(height);
    const sx = scale(periods.length === 1 ? [periods[0].time - 1, periods[0].time + 1] : [periods[0].time, periods.at(-1).time], [54, width - 44]);
    const sy = scale([1, Math.max(2, universe.length)], [top, bottom]), marks = new Map(), paths = new Map();
    const stride = Math.max(1, Math.ceil(universe.length / 8));
    for (let rank = 1; rank <= universe.length; rank++) if (rank === 1 || rank === universe.length || rank % stride === 0) { axisText(ctx, 36, sy(rank) + 4, rank, 'end'); svg.append(node('line', { x1: 48, x2: width - 38, y1: sy(rank), y2: sy(rank), class: 'sc-grid' })); }
    axisText(ctx, 12, 15, 'Rank', 'start'); axisText(ctx, 36, missingY + 4, '—', 'end');
    const label = item => `${timeLabel(item.row[timeKey], zone)} (${zone}) · ${item.item} · ${item.rank === null ? 'missing rank' : `rank ${item.row[rankKey]}${ties.get(`${item.period}:${item.rank}`).length > 1 ? ' (tie)' : ''}`} · source time: ${item.row[timeKey]}`;
    const px = item => { const peers = item.rank === null ? [] : ties.get(`${item.period}:${item.rank}`); return sx(periods[item.period].time) + (peers.length > 1 ? (peers.indexOf(item) - (peers.length - 1) / 2) * Math.min(5, 20 / peers.length) : 0); };
    universe.forEach((item, index) => {
      let drawing = false, path = '';
      periods.forEach((_, period) => { const cell = cells.get(`${period}:${index}`); if (!cell || cell.rank === null) { drawing = false; return; } path += `${drawing ? 'L' : 'M'}${px(cell)},${sy(cell.rank)} `; drawing = true; });
      const shape = node('path', { d: path, fill: 'none', stroke: color(index), 'stroke-width': 1.8, 'data-bump-item': item }); svg.append(shape); paths.set(item, shape);
    });
    observations.forEach(item => addMark(ctx, marks, node('circle', { cx: px(item), cy: item.rank === null ? missingY : sy(item.rank), r: 4.5, fill: item.rank === null ? 'none' : color(universe.indexOf(item.item)), stroke: color(universe.indexOf(item.item)), 'stroke-dasharray': item.rank === null ? '2 2' : 'none', 'data-rank': item.rank ?? 'missing' }), item.row, item.index, label(item)));
    const axisLimit = Math.max(8, Math.min(18, Math.floor((width - 110) / 12))), ticks = periods.map(period => ({ x: sx(period.time), label: timeLabel(period.value, zone) }));
    let previousEnd = -Infinity;
    ticks.forEach((tick, index) => {
      const size = Math.min(axisLimit, tick.label.length) * 6, first = index === 0, last = index === ticks.length - 1;
      const lastStart = ticks.at(-1).x - Math.min(axisLimit, ticks.at(-1).label.length) * 6;
      if (!first && !last && (tick.x - size / 2 < previousEnd + 12 || tick.x + size / 2 > lastStart - 12)) return;
      axisText(ctx, tick.x, height - 16, tick.label, ticks.length === 1 ? 'middle' : first ? 'start' : last ? 'end' : 'middle', axisLimit);
      previousEnd = tick.x + (first ? size : last ? 0 : size / 2);
    });
    let saved = views.get(ctx.target); if (saved?.spec !== spec || saved.kind !== 'bump') { saved = { spec, kind: 'bump', active: new Set(universe) }; views.set(ctx.target, saved); }
    rememberView(ctx, saved);
    const bar = controls(ctx), active = saved.active, inspect = inspector(ctx, marks, (_row, index) => label(observations[index]));
    const apply = () => {
      paths.forEach((path, item) => { path.style.display = active.has(item) ? '' : 'none'; });
      marks.forEach((mark, index) => { const show = active.has(observations[index].item); mark.style.display = show ? '' : 'none'; mark.setAttribute('tabindex', show ? '0' : '-1'); });
      const indices = observations.filter(value => active.has(value.item)).map(value => value.index); inspect(indices); publishFilter(ctx, indices);
    };
    universe.forEach((item, index) => {
      const button = ctx.html('button', null, item); button.type = 'button'; button.setAttribute('aria-pressed', String(active.has(item))); button.style.color = color(index); bar.append(button);
      listen(ctx, button, 'click', () => {
        if (active.has(item)) active.delete(item); else active.add(item); button.setAttribute('aria-pressed', String(active.has(item)));
        apply();
      });
    }); apply();
    const omitted = universe.length * periods.length - rows.length;
    ctx.note(`${zone} · fixed universe: ${universe.length} items · tie rule: ${spec.ties}. Ranks are supplied by the source and never recalculated when filtering. Equal-rank dots are offset sideways only for selection. Gaps indicate missing ranks${omitted ? `; ${omitted} item/period cells have no source row` : ''}.`);
  }

  function lifecycle(ctx) {
    if (empty(ctx)) return;
    const { spec, rows, width, svg, node, scale } = ctx, zone = timezone(spec);
    const timeKey = spec.time || spec.x || 'time', itemKey = spec.item || 'item', stateKey = spec.state || 'state', idKey = spec.event || 'id', evidenceKey = spec.evidence || 'evidence';
    const times = temporal(rows.map(row => row[timeKey])), ids = new Set(), items = [], states = [], duplicate = new Map();
    const observations = rows.map((row, index) => {
      const id = text(row[idKey], 'event ID'), item = text(row[itemKey], 'event item'), state = text(row[stateKey], 'event state');
      if (ids.has(id)) fail('lifecycle event IDs must be unique'); ids.add(id);
      if (!items.includes(item)) items.push(item); if (!states.includes(state)) states.push(state);
      const links = evidence(row[evidenceKey]), key = JSON.stringify([item, times[index]]);
      if (!duplicate.has(key)) duplicate.set(key, []);
      const observation = { row, index, item, state, time: times[index], links }; duplicate.get(key).push(observation); return observation;
    });
    const left = Math.min(105, Math.max(64, width * .2)), right = width - 25, min = Math.min(...times), max = Math.max(...times), sx = scale(min === max ? [min - 1, max + 1] : [min, max], [left, right]);
    const offsets = new Map(); let height = 40;
    items.forEach(item => { const count = Math.max(1, ...[...duplicate.values()].filter(values => values[0].item === item).map(values => values.length)); const lane = Math.max(72, count * 24 + 24); offsets.set(item, height + lane / 2); height += lane; });
    ctx.setHeight(height + 44);
    items.forEach(item => { const y = offsets.get(item); axisText(ctx, left - 12, y + 4, item, 'end'); svg.append(node('line', { x1: left, x2: right, y1: y, y2: y, stroke: line, 'stroke-dasharray': '2 5' })); });
    const marks = new Map(), label = item => `${timeLabel(item.row[timeKey], zone)} (${zone}) · ${item.item} · ${item.state} · ${item.links.length} evidence links · source time: ${item.row[timeKey]}`;
    observations.forEach(item => {
      const peers = duplicate.get(JSON.stringify([item.item, item.time])), y = offsets.get(item.item) + (peers.indexOf(item) - (peers.length - 1) / 2) * 24, x = sx(item.time);
      const group = node('g', { 'data-lifecycle-state': item.state });
      group.append(node('circle', { cx: x, cy: y, r: 5, fill: color(states.indexOf(item.state)), stroke: 'none' }));
      const labelNode = node('text', { x, y: y - 12, class: 'sc-axis', 'text-anchor': x > width - 80 ? 'end' : x < left + 40 ? 'start' : 'middle', stroke: 'none' }, short(item.state, 16)); group.append(labelNode);
      addMark(ctx, marks, group, item.row, item.index, label(item));
    });
    axisText(ctx, left, height + 25, timeLabel(rows[times.indexOf(min)][timeKey], zone), 'start');
    if (min !== max) axisText(ctx, right, height + 25, timeLabel(rows[times.indexOf(max)][timeKey], zone), 'end');
    inspector(ctx, marks, (_row, index) => label(observations[index]), (_row, index) => observations[index].links);
    if (!spec.inspector) evidencePanel(ctx, observations);
    const unsupported = observations.filter(item => !item.links.length).length;
    ctx.note(`${zone} · recorded events only; spacing represents recorded time, not duration or causality. Select a source row to inspect its supplied evidence/report links.${unsupported ? ` ${unsupported} events have no attached evidence link.` : ''}`);
  }
  for (const [kind, renderer] of Object.entries({ calendar, parallel, bump, lifecycle })) global.SesameCharts.register(kind, renderer);
})(window);
