/* Sesame statistical charts — MIT, Sesame contributors.
 * Independent SVG renderers. Statistics and density estimates arrive as fixed
 * data; this file only validates their shape and maps values to geometry. */
(function (global) {
  'use strict';
  const api = global.SesameCharts;
  if (!api || typeof api.register !== 'function') throw new Error('SesameCharts statistics require the chart extension registry');
  const fail = message => { throw new Error(`SesameCharts statistics: ${message}`); };
  const field = (spec, name, fallback) => spec[name] ?? fallback;
  const exact = value => value === null || value === undefined || value === '' ? 'missing' : String(value);
  const color = 'var(--chart-series-1,var(--foreground,#151515))';
  const up = 'var(--success,#347c49)', down = 'var(--danger,#c83b40)';
  const number = (ctx, value, label) => {
    const n = ctx.numeric(value);
    if (n === null) fail(`${label} is missing`);
    return n;
  };
  const count = (ctx, value, label) => {
    const n = number(ctx, value, label);
    if (!Number.isSafeInteger(n) || n < 0) fail(`${label} must be a nonnegative safe integer`);
    const parsed = decimal(ctx, value, label);
    if (parsed.s > 0 && parsed.c % 10n ** BigInt(parsed.s) !== 0n) fail(`${label} must be an exact integer`);
    return n;
  };
  const method = spec => {
    if (typeof spec.method !== 'string' || !spec.method.trim()) fail('method must identify the registered statistical or binning method');
    return spec.method.trim();
  };
  function domain(values, zero = false) {
    const all = zero ? [0, ...values] : values;
    if (!all.length) return [0, 1];
    let lo = Math.min(...all), hi = Math.max(...all);
    if (lo === hi) {
      if (lo === 0) return [0, 1];
      const d = Math.abs(lo) * .05 || Number.MIN_VALUE;
      lo = Number.isFinite(lo - d) ? lo - d : lo;
      hi = Number.isFinite(hi + d) ? hi + d : hi;
      if (lo === hi) return lo > 0 ? [0, lo] : [lo, 0];
    }
    return [lo, hi];
  }
  const tickValue = (range, i, total) => {
    const value = range[0] * (1 - i / total) + range[1] * (i / total);
    // Suppress cancellation noise at an interior zero tick, not actual source
    // values or either endpoint (which may intentionally be very small).
    return i > 0 && i < total && range[0] < 0 && range[1] > 0 && Math.abs(value) <= Math.max(Math.abs(range[0]), Math.abs(range[1])) * Number.EPSILON * 4 ? 0 : value;
  };
  const tickText = (ctx, value) => value !== 0 && (Math.abs(value) >= 1e7 || Math.abs(value) < 1e-4) ? value.toExponential(2) : ctx.format(value);
  function line(ctx, attrs) { ctx.svg.append(ctx.node('line', { class: 'sc-grid', ...attrs })); }
  function label(ctx, x, y, value, anchor = 'middle') {
    const text = String(value), max = Math.max(5, Math.floor((ctx.pad.left - 15) / 6));
    const n = ctx.node('text', { x, y, 'text-anchor': anchor, class: 'sc-axis' }, anchor === 'end' && text.length > max ? `${text.slice(0, max - 1)}…` : text);
    n.append(ctx.node('title', {}, text));ctx.svg.append(n);return n;
  }
  function xAxis(ctx, range, height) {
    const left = ctx.pad.left, right = ctx.width - ctx.pad.right, bottom = height - ctx.pad.bottom;
    const sx = ctx.scale(range, [left, right]), ticks = ctx.width < 420 ? 3 : 4;
    for (let i = 0; i <= ticks; i++) {
      const value = tickValue(range, i, ticks), x = sx(value);
      line(ctx, { x1: x, x2: x, y1: ctx.pad.top, y2: bottom });
      label(ctx, x, bottom + 21, tickText(ctx, value), i === 0 ? 'start' : i === ticks ? 'end' : 'middle');
    }
    if (ctx.spec.unit) label(ctx, right, height - 5, ctx.spec.unit, 'end');
    return sx;
  }
  function yAxis(ctx, range, height, unit = ctx.spec.unit) {
    const sy = ctx.scale(range, [height - ctx.pad.bottom, ctx.pad.top]);
    for (let i = 0; i <= 4; i++) {
      const value = tickValue(range, i, 4), y = sy(value);
      line(ctx, { x1: ctx.pad.left, x2: ctx.width - ctx.pad.right, y1: y, y2: y });
      label(ctx, ctx.pad.left - 9, y + 4, tickText(ctx, value), 'end');
    }
    if (unit) label(ctx, ctx.pad.left, 12, unit, 'start');
    return sy;
  }
  function groups(ctx, key, fallback = 'Observations') {
    const result = new Map();
    ctx.rows.forEach((row, index) => {
      const name = key ? String(row[key] ?? 'Missing group') : fallback;
      if (!result.has(name)) result.set(name, []);
      result.get(name).push({ row, index });
    });
    if (result.size > 40) fail('more than 40 groups; filter or split this fixed dataset');
    return [...result].map(([name, points]) => ({ name, points }));
  }
  function missingMark(ctx, row, index, x, y, description) {
    const n = ctx.node('g', { 'data-missing': 'true' });
    n.append(ctx.node('circle', { cx: x, cy: y, r: 5, class: 'sc-missing', fill: 'none', 'stroke-dasharray': '2 2' }), ctx.node('text', { x: x + 9, y: y + 4, class: 'sc-axis' }, '—'));
    ctx.mark(n, row, index, description);
  }
  const metadata = (ctx, text) => ctx.note(text);

  // The reconciliation operates on decimal coefficients, never floating point
  // sums. SVG coordinates are approximate; tooltip strings remain untouched.
  function decimal(ctx, value, name) {
    number(ctx, value, name);
    const text = String(value);
    if (text.length > 2048) fail(`${name} exceeds the decimal digit budget`);
    const match = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match) fail(`${name} must be decimal`);
    const scale = (match[3] || '').length - Number(match[4] || 0);
    if (Math.abs(scale) > 512) fail(`${name} exceeds the decimal scale budget`);
    return { c: BigInt(`${match[1]}${match[2]}${match[3] || ''}`), s: scale };
  }
  function add(a, b, sign = 1n) {
    const s = Math.max(a.s, b.s, 0);
    return { c: a.c * 10n ** BigInt(s - a.s) + sign * b.c * 10n ** BigInt(s - b.s), s };
  }
  function decimalText(value) {
    const negative = value.c < 0n, digits = String(negative ? -value.c : value.c);
    const out = value.s <= 0 ? digits + '0'.repeat(-value.s) : digits.padStart(value.s + 1, '0').slice(0, -value.s) + '.' + digits.padStart(value.s + 1, '0').slice(-value.s);
    return `${negative ? '-' : ''}${out}`;
  }
  const magnitude = value => ({ ...value, c: value.c < 0n ? -value.c : value.c });
  function reconciles(a, b, tolerance) { return add(magnitude(add(a, b, -1n)), tolerance, -1n).c <= 0n; }

  api.register('waterfall', ctx => {
    const { spec, rows, width, height, pad } = ctx, x = field(spec, 'x', 'label'), y = field(spec, 'y', 'value'), type = field(spec, 'type', 'type');
    if (rows.length < 2 || rows[0][type] !== 'start' || rows.at(-1)[type] !== 'end') fail('waterfall requires an explicit start row and a final end row');
    const tolerance = decimal(ctx, spec.balanceTolerance ?? 0, 'balanceTolerance');
    if (tolerance.c < 0n) fail('balanceTolerance must be nonnegative');
    let running, tolerated = 0;
    const plotted = rows.map((row, index) => {
      const kind = row[type], value = decimal(ctx, row[y], `waterfall row ${index}`), before = running;
      if (index === 0) running = value;
      else if (kind === 'delta') running = add(running, value);
      else if (kind === 'total' || kind === 'end') {
        if (!reconciles(running, value, tolerance)) fail(`waterfall ${kind} row ${index} does not reconcile with the start and changes`);
        if (add(running, value, -1n).c !== 0n) tolerated++;
      } else fail(`waterfall row ${index} has an invalid type`);
      if (index > 0 && index < rows.length - 1 && kind === 'end') fail('waterfall end must be the final row');
      const a = kind === 'delta' ? number(ctx, decimalText(before), 'waterfall cumulative balance') : 0;
      const b = kind === 'delta' ? number(ctx, decimalText(running), 'waterfall cumulative balance') : number(ctx, row[y], 'waterfall total');
      return { row, index, kind, a, b };
    });
    const sy = yAxis(ctx, domain(plotted.flatMap(p => [p.a, p.b]), true), height), band = (width - pad.left - pad.right) / rows.length;
    plotted.forEach((p, i) => {
      const left = pad.left + (i + .16) * band, w = band * .68, top = Math.min(sy(p.a), sy(p.b)), h = Math.max(1, Math.abs(sy(p.b) - sy(p.a)));
      if (i > 0) line(ctx, { x1: pad.left + (i - .16) * band, x2: left, y1: sy(plotted[i - 1].b), y2: sy(plotted[i - 1].b), 'stroke-dasharray': '3 3' });
      const fill = p.kind === 'delta' ? (p.b < p.a ? down : up) : color;
      ctx.mark(ctx.node('rect', { x: left, y: top, width: w, height: h, rx: 2, fill, 'data-stat-mark': 'waterfall', 'data-start': p.a, 'data-end': p.b }), p.row, p.index, `${exact(p.row[x])} · ${p.kind}: ${exact(p.row[y])}${spec.unit ? ` ${spec.unit}` : ''}`);
      if (rows.length <= Math.max(3, Math.floor((width - pad.left - pad.right) / 50))) label(ctx, left + w / 2, height - 23, String(p.row[x] ?? '').slice(0, 12));
    });
    metadata(ctx, tolerated ? `Balances reconcile within the declared tolerance ${exact(spec.balanceTolerance)}; ${tolerated} displayed total(s) include registered rounding differences.` : 'Start + registered changes = end.');
  });

  api.register('dumbbell', ctx => {
    const { spec, rows, pad } = ctx, x = field(spec, 'x', 'label'), before = field(spec, 'before', 'before'), after = field(spec, 'after', 'after');
    if (rows.length > 40) fail('more than 40 comparisons; filter or split this fixed dataset');
    const values = rows.flatMap(r => [ctx.numeric(r[before]), ctx.numeric(r[after])]).filter(v => v !== null);
    const height = Math.max(ctx.height, pad.top + pad.bottom + rows.length * 46);ctx.setHeight(height);
    const sx = xAxis(ctx, domain(values), height), band = (height - pad.top - pad.bottom) / rows.length;
    let missing = 0;
    rows.forEach((row, index) => {
      const a = ctx.numeric(row[before]), b = ctx.numeric(row[after]), cy = pad.top + (index + .5) * band, g = ctx.node('g', { 'data-stat-mark': 'dumbbell' });
      label(ctx, pad.left - 10, cy + 4, row[x] ?? '', 'end');
      if (a !== null && b !== null) g.append(ctx.node('line', { x1: sx(a), x2: sx(b), y1: cy, y2: cy, stroke: color, 'stroke-width': 1.5 }));
      if (a !== null) g.append(ctx.node('circle', { cx: sx(a), cy, r: 5, fill: 'var(--surface-secondary,#fff)', stroke: color, 'stroke-width': 1.5, 'data-endpoint': 'before' }));
      if (b !== null) g.append(ctx.node('circle', { cx: sx(b), cy, r: 5, fill: color, 'data-endpoint': 'after' }));
      const description = `${exact(row[x])} · ${spec.beforeLabel || before}: ${exact(row[before])}; ${spec.afterLabel || after}: ${exact(row[after])}${spec.unit ? ` ${spec.unit}` : ''}`;
      if (a === null || b === null) { missing++; if (a === null && b === null) { missingMark(ctx, row, index, pad.left + 8, cy, description);return; } g.append(ctx.node('text', { x: ctx.width - pad.right, y: cy - 8, 'text-anchor': 'end', class: 'sc-axis' }, `${a === null ? spec.beforeLabel || before : spec.afterLabel || after}: —`)); }
      ctx.mark(g, row, index, description);
    });
    metadata(ctx, `Hollow = ${spec.beforeLabel || before}; filled = ${spec.afterLabel || after}.${missing ? ` ${missing} incomplete comparison(s); missing endpoints are not connected.` : ''}`);
  });

  api.register('strip', ctx => {
    const { spec, pad } = ctx, y = field(spec, 'y', 'value'), grouped = groups(ctx, spec.x);
    const jitter = spec.jitter ?? .3;
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > .4) fail('strip jitter must be between 0 and 0.4');
    const values = ctx.rows.map(r => ctx.numeric(r[y])).filter(v => v !== null), height = Math.max(ctx.height, pad.top + pad.bottom + grouped.length * 62);ctx.setHeight(height);
    const sx = xAxis(ctx, domain(values), height), band = (height - pad.top - pad.bottom) / grouped.length;
    let missing = 0;
    grouped.forEach((group, gi) => {
      const cy = pad.top + (gi + .5) * band;label(ctx, pad.left - 10, cy + 4, group.name, 'end');
      line(ctx, { x1: pad.left, x2: ctx.width - pad.right, y1: cy, y2: cy });
      group.points.forEach(({ row, index }, j) => {
        const value = ctx.numeric(row[y]), offset = ((j * .6180339887498949) % 1 - .5) * band * jitter * 2;
        if (value === null) { missing++;return; }
        ctx.mark(ctx.node('circle', { cx: sx(value), cy: cy + offset, r: 3.5, class: 'sc-point', 'data-stat-mark': 'strip' }), row, index, `${group.name} · ${y}: ${exact(row[y])}${spec.unit ? ` ${spec.unit}` : ''}${spec.id ? ` · ${exact(row[spec.id])}` : ''}`);
      });
    });
    metadata(ctx, `One point = one registered row; vertical offset only separates overlapping points.${missing ? ` ${missing} missing value(s) are omitted, not plotted at zero.` : ''}`);
  });

  api.register('histogram', ctx => {
    const { spec, rows, height, pad } = ctx, x = field(spec, 'x', 'lower'), end = field(spec, 'xEnd', 'upper'), y = field(spec, 'y', 'count'), description = method(spec), sampleCount = count(ctx, spec.sampleCount, 'sampleCount');
    const density = spec.valueType === 'density';
    if (spec.valueType !== undefined && !['count', 'density'].includes(spec.valueType)) fail('histogram valueType must be count or density');
    let missing = 0, total = 0n;
    const bins = rows.map((row, index) => {
      const a = number(ctx, row[x], 'bin lower bound'), b = number(ctx, row[end], 'bin upper bound'), value = ctx.numeric(row[y]);
      if (b <= a) fail('histogram bin upper bound must exceed its lower bound');
      if (value === null) missing++;
      else if (density) {
        if (value < 0) fail('histogram density cannot be negative');
        if (!sampleCount) fail('registered histogram density requires a positive sample count');
      }
      else total += BigInt(count(ctx, row[y], 'bin count'));
      return { row, index, a, b, value, width: add(decimal(ctx, row[end], 'bin upper bound'), decimal(ctx, row[x], 'bin lower bound'), -1n) };
    }).sort((a, b) => a.a - b.a);
    bins.forEach((bin, i) => {
      if (i && add(decimal(ctx, bin.row[x], 'bin lower bound'), decimal(ctx, bins[i - 1].row[end], 'bin upper bound'), -1n).c < 0n) fail('histogram bins overlap');
      if (!density && !reconciles(bin.width, bins[0].width, { c: 0n, s: 0 })) fail('unequal bins require registered density values and valueType:"density"');
    });
    if (!density && (total > BigInt(sampleCount) || !missing && total !== BigInt(sampleCount))) fail('registered bin counts do not reconcile with sampleCount');
    const range = [bins[0].a, bins.at(-1).b], sx = ctx.scale(range, [pad.left, ctx.width - pad.right]), sy = yAxis(ctx, domain(bins.filter(b => b.value !== null).map(b => b.value), true), height, density ? 'density' : 'count');
    const baseline = sy(0);
    bins.forEach(bin => {
      const left = sx(bin.a), width = Math.max(.5, sx(bin.b) - left), description = `[${exact(bin.row[x])}, ${exact(bin.row[end])}${spec.lastBinClosed && bin === bins.at(-1) ? ']' : ')'} · ${y}: ${exact(bin.row[y])} · n=${sampleCount}`;
      if (bin.value === null) { missingMark(ctx, bin.row, bin.index, left + width / 2, baseline - 6, description);return; }
      ctx.mark(ctx.node('rect', { x: left + Math.min(.5, width / 10), y: sy(bin.value), width: Math.max(.4, width - Math.min(1, width / 5)), height: Math.max(.8, baseline - sy(bin.value)), fill: color, 'data-stat-mark': 'histogram', 'data-bin-lower': bin.a, 'data-bin-upper': bin.b }), bin.row, bin.index, description);
    });
    const boundaries = [...new Set(bins.flatMap(bin => [bin.a, bin.b]))].sort((a, b) => a - b);
    let previousX = -Infinity;
    boundaries.forEach((value, i) => {
      const position = sx(value), last = i === boundaries.length - 1;
      if (last || position - previousX >= 48 && (i === 0 || sx(boundaries.at(-1)) - position >= 48)) {
        label(ctx, position, height - 19, tickText(ctx, value), i === 0 ? 'start' : last ? 'end' : 'middle');previousX = position;
      }
    });
    if (spec.unit) label(ctx, ctx.width - pad.right, height - 3, spec.unit, 'end');
    metadata(ctx, `${description} · n=${sampleCount} · height=${density ? 'registered density; area follows the supplied normalization' : 'registered count; equal-width bins'}.${missing ? ` ${missing} missing bin(s); their counts are unknown.` : ''}`);
  });

  api.register('boxplot', ctx => {
    const { spec, rows, pad } = ctx, description = method(spec), x = field(spec, 'x', 'group'), n = field(spec, 'n', 'n');
    if (rows.length > 40) fail('more than 40 boxes; filter or split this fixed dataset');
    const keys = ['low', 'q1', 'median', 'q3', 'high'].map(k => field(spec, k, k)), outliers = field(spec, 'outliers', 'outliers');
    let missing = 0;
    const summaries = rows.map((row, index) => {
      const samples = count(ctx, row[n], 'box sample count'), values = keys.map(k => ctx.numeric(row[k])), rawOutliers = row[outliers] ?? [];
      if (!Array.isArray(rawOutliers)) fail('box outliers must be an array of registered values');
      if (rawOutliers.length > 2500) fail('box plot exceeds 2,500 selectable marks; filter the registered outliers');
      const outside = rawOutliers.map(v => number(ctx, v, 'outlier'));
      if (values.some(v => v === null)) { missing++;if (outside.length) fail('outliers require complete registered box statistics');return { row, index, samples, values: null, outside: [] }; }
      if (!samples) fail('a box with values must have a positive sample count');
      if (outside.length >= samples) fail('registered outlier count must be smaller than the box sample count');
      const decimals = keys.map(key => decimal(ctx, row[key], `box ${key}`));
      if (decimals.some((v, i) => i && add(v, decimals[i - 1], -1n).c < 0n)) fail('box statistics must satisfy low ≤ q1 ≤ median ≤ q3 ≤ high');
      if (rawOutliers.some(v => { const d = decimal(ctx, v, 'outlier');return add(d, decimals[0], -1n).c >= 0n && add(d, decimals[4], -1n).c <= 0n; })) fail('registered outliers must lie outside the declared whiskers');
      return { row, index, samples, values, outside, rawOutliers };
    });
    if (summaries.reduce((n, s) => n + s.outside.length, rows.length) > 2500) fail('box plot exceeds 2,500 selectable marks; filter the registered outliers');
    const height = Math.max(ctx.height, pad.top + pad.bottom + rows.length * 58);ctx.setHeight(height);
    const sx = xAxis(ctx, domain(summaries.flatMap(s => s.values ? [...s.values, ...s.outside] : [])), height), band = (height - pad.top - pad.bottom) / rows.length;
    summaries.forEach(summary => {
      const { row, index, values } = summary, cy = pad.top + (index + .5) * band, name = exact(row[x]);label(ctx, pad.left - 10, cy + 4, name, 'end');
      const desc = `${name} · ${keys.map(k => `${k}=${exact(row[k])}`).join('; ')} · n=${summary.samples}`;
      if (!values) { missingMark(ctx, row, index, pad.left + 9, cy, desc);return; }
      const [lo, q1, median, q3, hi] = values, g = ctx.node('g', { 'data-stat-mark': 'boxplot' });
      g.append(ctx.node('line', { x1: sx(lo), x2: sx(hi), y1: cy, y2: cy, stroke: color }), ctx.node('rect', { x: sx(q1), y: cy - 10, width: Math.max(1, sx(q3) - sx(q1)), height: 20, rx: 2, fill: color, 'fill-opacity': .15, stroke: color }));
      [lo, hi].forEach(v => g.append(ctx.node('line', { x1: sx(v), x2: sx(v), y1: cy - 6, y2: cy + 6, stroke: color })));
      g.append(ctx.node('line', { x1: sx(median), x2: sx(median), y1: cy - 10, y2: cy + 10, stroke: color, 'stroke-width': 2, 'data-box-median': exact(row[keys[2]]) }));ctx.mark(g, row, index, desc);
      summary.outside.forEach((v, j) => ctx.mark(ctx.node('circle', { cx: sx(v), cy: cy + (j % 3 - 1) * 3, r: 4, fill: 'var(--surface-secondary,#fff)', stroke: color, 'data-stat-mark': 'outlier' }), row, index, `${name} · registered outlier ${j + 1}: ${exact(summary.rawOutliers[j])}${spec.unit ? ` ${spec.unit}` : ''} · n=${summary.samples}`));
    });
    metadata(ctx, `${description} · Box = q1–q3; line = median; whiskers = registered low/high.${missing ? ` ${missing} incomplete box(es) are not inferred.` : ''}`);
  });

  function densityPlot(ctx, mirrored) {
    const { spec, pad } = ctx, x = field(spec, 'x', 'value'), y = field(spec, 'y', 'density'), n = field(spec, 'n', 'n'), description = method(spec);
    const grouped = groups(ctx, field(spec, 'group', 'group'));
    let missing = 0;
    grouped.forEach(group => {
      const samples = group.points.map(p => p.row[n]).filter(v => v !== null && v !== undefined && v !== '');
      if (!samples.length && grouped.length === 1 && spec.sampleCount !== undefined) samples.push(spec.sampleCount);
      if (!samples.length) fail(`density group ${group.name} requires a registered sample count`);
      group.samples = count(ctx, samples[0], 'density sample count');
      if (samples.some(v => count(ctx, v, 'density sample count') !== group.samples)) fail(`density group ${group.name} has inconsistent sample counts`);
      group.points = group.points.map(p => ({ ...p, x: number(ctx, p.row[x], 'density coordinate'), y: ctx.numeric(p.row[y]) })).sort((a, b) => a.x - b.x);
      group.points.forEach((p, i) => {
        if (i && p.x === group.points[i - 1].x) fail(`density group ${group.name} has duplicate coordinates`);
        if (p.y === null) missing++;
        else if (p.y < 0) fail('registered density cannot be negative');
        else if (group.samples === 0 && p.y > 0) fail('positive density requires a positive registered sample count');
      });
    });
    const all = grouped.flatMap(g => g.points), maxDensity = Math.max(0, ...all.filter(p => p.y !== null).map(p => p.y));
    const height = Math.max(ctx.height, pad.top + pad.bottom + grouped.length * (mirrored ? 88 : 82));ctx.setHeight(height);
    const sx = xAxis(ctx, domain(all.map(p => p.x)), height), band = (height - pad.top - pad.bottom) / grouped.length, amplitude = band * (mirrored ? .35 : .62);
    grouped.forEach((group, gi) => {
      const cy = pad.top + (gi + (mirrored ? .5 : .82)) * band, dy = value => maxDensity ? value / maxDensity * amplitude : 0;
      label(ctx, pad.left - 10, cy + 4, group.name, 'end');
      line(ctx, { x1: pad.left, x2: ctx.width - pad.right, y1: cy, y2: cy });
      const segments = [];let segment = [];
      for (const p of group.points) { if (p.y === null) { if (segment.length) segments.push(segment);segment = []; } else segment.push(p); }if (segment.length) segments.push(segment);
      segments.forEach(points => {
        const top = points.map(p => `${sx(p.x)},${cy - dy(p.y)}`), bottom = mirrored ? [...points].reverse().map(p => `${sx(p.x)},${cy + dy(p.y)}`) : [`${sx(points.at(-1).x)},${cy}`, `${sx(points[0].x)},${cy}`];
        ctx.svg.append(ctx.node('path', { d: `M${top.join(' L')} L${bottom.join(' L')} Z`, fill: color, 'fill-opacity': .12, stroke: color, 'stroke-width': 1.2, 'pointer-events': 'none', 'data-density-segment': mirrored ? 'violin' : 'ridgeline' }));
      });
      group.points.forEach(p => {
        const desc = `${group.name} · ${x}=${exact(p.row[x])}; ${y}=${exact(p.row[y])} · n=${group.samples}`;
        if (p.y === null) { missingMark(ctx, p.row, p.index, sx(p.x), cy, desc);return; }
        ctx.mark(ctx.node('circle', { cx: sx(p.x), cy: cy - dy(p.y), r: group.points.length < 60 ? 3 : 2, class: 'sc-point', 'data-stat-mark': mirrored ? 'violin' : 'ridgeline' }), p.row, p.index, desc);
      });
    });
    metadata(ctx, `${description} · ${mirrored ? 'Half-thickness' : 'Height'} = registered density on a shared scale; no KDE or smoothing is estimated here. ${grouped.map(g => `${g.name}: n=${g.samples}`).join('; ')}.${missing ? ` ${missing} missing density point(s) remain gaps.` : ''}`);
  }
  api.register('ridgeline', ctx => densityPlot(ctx, false));
  api.register('violin', ctx => densityPlot(ctx, true));
})(window);
