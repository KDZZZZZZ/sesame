/* Sesame structural charts — MIT, Sesame contributors.
 * Original SVG implementation; no imported layout engine or third-party artwork. */
(function (global) {
  'use strict';
  const fail = message => { throw Error(`SesameCharts/structure: ${message}`); };
  const check = (condition, message) => { if (!condition) fail(message); };
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
  const id = (value, field) => { check(text(value), `${field} must be a nonempty string ID`); return value; };
  const field = (spec, key, fallback) => { check(spec[key] === undefined || text(spec[key]), `${key} must name a field`); return spec[key] ?? fallback; };
  const language = (en, zh) => document.documentElement.lang.startsWith('zh') ? zh : en;
  const label = (row, key, fallback) => { check(row[key] === undefined || row[key] === null || typeof row[key] === 'string' || typeof row[key] === 'number' && Number.isFinite(row[key]), `${key} must be a text label`); return row[key] === undefined || row[key] === null ? fallback : String(row[key]); };
  const short = (value, length = 20) => value.length > length ? value.slice(0, Math.max(1, length - 1)) + '…' : value;
  const ink = 'var(--report-ink)', muted = 'var(--report-muted)', accent = 'var(--report-accent)', negative = 'var(--report-negative)';
  const palette = [accent, 'var(--chart-series-1,var(--report-accent))', 'var(--chart-series-3,var(--report-muted))', 'var(--chart-series-4,var(--report-accent))'];
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  function rowsAreRecords(rows) {
    check(Array.isArray(rows) && rows.length <= 2500, 'rows must contain at most 2,500 fixed records');
    check(rows.every(row => row && typeof row === 'object' && !Array.isArray(row)), 'every row must be a record');
  }
  function amount(ctx, value, name) {
    const n = ctx.numeric(value);
    check(n !== null && n >= 0, `${name} must be an observed, nonnegative amount`);
    const match = String(value).match(/^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    check(match && String(value).length <= 512, `${name} is outside the decimal display budget`);
    const scale = (match[3] || '').length - Number(match[4] || 0);
    check(Math.abs(scale) <= 400, `${name} is outside the decimal display budget`);
    const c = BigInt((match[1] || '') + match[2] + (match[3] || ''));
    check(n !== 0 || c === 0n, `${name} is too small for finite SVG coordinates`);
    return { n, c, s: scale };
  }
  function sum(values) {
    const s = Math.max(0, ...values.map(value => value.s));
    return { c: values.reduce((value, next) => value + next.c * 10n ** BigInt(s - next.s), 0n), s };
  }
  const equals = (a, b) => { const s = Math.max(a.s, b.s); return a.c * 10n ** BigInt(s - a.s) === b.c * 10n ** BigInt(s - b.s); };
  const geometryNumber = value => { const n = Number(value.c.toString() + 'e' + -value.s); check(Number.isFinite(n), 'aggregate exceeds finite SVG coordinates'); return n; };
  const caption = (ctx, x, y, value, attrs = {}) => ctx.svg.append(ctx.node('text', { x, y, class: 'sc-axis', 'pointer-events': 'none', ...attrs }, value));
  function on(ctx, element, name, listener, options) {
    element.addEventListener(name, listener, options);
    ctx.onCleanup(() => element.removeEventListener(name, listener, options));
  }
  function focusRecords(ctx, marks, matches) {
    const reset = ctx.html('button', 'sc-structure-reset', language('Show all', '显示全部'));
    reset.type = 'button'; reset.hidden = true; reset.style.marginTop = '8px';
    ctx.frame.append(reset);
    const clear = () => { marks.forEach(item => { item.element.style.opacity = ''; item.element.removeAttribute('data-focused'); }); reset.hidden = true; };
    on(ctx, ctx.target, 'chartselect', event => {
      if (!marks.some(item => item.row === event.detail?.row)) return;
      marks.forEach(item => { const active = Boolean(matches(item, event.detail.row)); item.element.style.opacity = active ? '1' : '.16'; item.element.setAttribute('data-focused', String(active)); });
      reset.hidden = false;
    });
    on(ctx, reset, 'click', clear);
    on(ctx, ctx.svg, 'keydown', event => { if (event.key === 'Escape') clear(); });
  }

  function treemap(ctx) {
    const { spec, rows, svg, node, width, height, mark } = ctx;
    const keys = { id: field(spec, 'id', 'id'), parent: field(spec, 'parent', 'parentId'), value: field(spec, 'value', 'value'), label: field(spec, 'label', 'label'), side: field(spec, 'side', 'side') };
    const records = new Map(), roots = [], marks = [];
    rows.forEach((row, index) => {
      const key = id(row[keys.id], keys.id); check(!records.has(key), `duplicate hierarchy ID ${key}`);
      const side = row[keys.side]; check(side === undefined || ['long', 'short', 'neutral'].includes(side), `${key}: side must be long, short or neutral`);
      records.set(key, { key, row, index, children: [], name: label(row, keys.label, key), side });
    });
    for (const record of records.values()) {
      const parent = record.row[keys.parent];
      if (parent === null || parent === undefined || parent === '') roots.push(record);
      else { const owner = records.get(id(parent, keys.parent)); check(owner && owner !== record, `${record.key}: missing or self parent`); owner.children.push(record); }
    }
    const visited = new Set(), visiting = new Set();
    function total(record, inherited = 'neutral', depth = 0, ancestry = []) {
      check(depth < 32 && !visiting.has(record.key), 'hierarchy has a cycle or more than 32 levels');
      visiting.add(record.key); record.side = record.side || inherited; record.path = [...ancestry, record.name];
      const raw = record.row[keys.value];
      if (record.children.length) {
        record.total = sum(record.children.map(child => total(child, record.side, depth + 1, record.path)));
        if (raw !== undefined && raw !== null) check(equals(amount(ctx, raw, `${record.key}.${keys.value}`), record.total), `${record.key}: declared parent total differs from leaf sum`);
      } else record.total = amount(ctx, raw, `${record.key}.${keys.value}`);
      record.value = geometryNumber(record.total); visiting.delete(record.key); visited.add(record.key); return record.total;
    }
    roots.forEach(root => total(root)); check(visited.size === records.size, 'hierarchy contains an unrooted cycle');
    const totalValue = geometryNumber(sum(roots.map(root => root.total))), zeroLeaves = [...records.values()].filter(record => !record.children.length && record.total.c === 0n);
    const top = 22, bottom = Math.max(top + 80, height - 12), sideColor = side => side === 'short' ? negative : side === 'long' ? accent : muted;
    // Recursively bisect by cumulative leaf value. Parents are labels, never an
    // additional area added to their descendants' observed amounts.
    function partition(items, x, y, w, h, depth = 0) {
      items = items.filter(item => item.value > 0); if (!items.length) return;
      if (items.length > 1) {
        const value = items.reduce((a, item) => a + item.value, 0), half = value / 2;
        let split = 1, left = items[0].value;
        while (split < items.length - 1 && Math.abs(left + items[split].value - half) < Math.abs(left - half)) left += items[split++].value;
        const ratio = left / value;
        if (w >= h) { partition(items.slice(0, split), x, y, w * ratio, h, depth); partition(items.slice(split), x + w * ratio, y, w * (1 - ratio), h, depth); }
        else { partition(items.slice(0, split), x, y, w, h * ratio, depth); partition(items.slice(split), x, y + h * ratio, w, h * (1 - ratio), depth); }
        return;
      }
      const item = items[0];
      if (item.children.length) {
        partition(item.children, x, y, w, h, depth + 1); return;
      }
      const g = node('g', { 'data-structure-kind': 'leaf', 'data-record-id': item.key, 'data-side': item.side });
      g.append(node('rect', { x: x + .75, y: y + .75, width: Math.max(.1, w - 1.5), height: Math.max(.1, h - 1.5), rx: 1, fill: sideColor(item.side), 'fill-opacity': .17 + Math.min(depth, 3) * .035 }));
      if (w >= 45 && h >= 22) g.append(node('text', { x: x + 7, y: y + 16, class: 'sc-label', 'pointer-events': 'none' }, short(item.name, Math.max(3, Math.floor((w - 14) / 7)))));
      if (w >= 68 && h >= 43) g.append(node('text', { x: x + 7, y: y + 33, class: 'sc-axis', 'pointer-events': 'none' }, ctx.format(item.value, spec.unit)));
      mark(g, item.row, item.index, `${item.path.join(' › ')} [${item.key}] · ${item.side}: ${item.row[keys.value]}${spec.unit ? ' ' + spec.unit : ''}`);
      marks.push({ element: g, row: item.row });
    }
    if (totalValue > 0) partition(roots, 0, top, width, bottom - top);
    else caption(ctx, width / 2, height / 2, language('Zero total — no proportional area', '合计为零，无比例面积'), { 'text-anchor': 'middle' });
    const sides = [...new Set([...records.values()].filter(record => !record.children.length).map(record => record.side))];
    sides.forEach((side, index) => { svg.append(node('rect', { x: index * 94, y: 3, width: 8, height: 8, fill: sideColor(side), opacity: .55 })); caption(ctx, index * 94 + 14, 11, side); });
    if (zeroLeaves.length) {
      const details = ctx.html('details', 'sc-structure-zero'), summary = ctx.html('summary', null, language(`${zeroLeaves.length} zero-value records`, `${zeroLeaves.length} 条零值记录`)), list = ctx.html('div');
      list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;max-height:160px;overflow:auto';
      for (const item of zeroLeaves) {
        const button = ctx.html('button', null, `${short(item.name, 24)} · ${ctx.format(0, spec.unit)}`); button.type = 'button'; button.style.maxWidth = '100%'; button.setAttribute('aria-label', `${item.name} [${item.key}]: ${item.row[keys.value]} ${spec.unit || ''}`);
        on(ctx, button, 'click', () => { ctx.target.dispatchEvent(new CustomEvent('chartselect', { bubbles: true, detail: { row: item.row, index: item.index } })); spec.onSelect?.(item.row, item.index); });
        list.append(button);
      }
      details.append(summary, list); ctx.frame.append(details);
    }
    focusRecords(ctx, marks, (item, row) => item.row === row);
  }

  function threads(ctx) {
    const { spec, rows, node, mark, width } = ctx, marks = [], seen = new Set();
    check(rows.length <= 200, 'threads supports at most 200 routes; filter the fixed records before plotting');
    const recordKey = field(spec, 'id', 'recordId'), fields = [field(spec, 'signal', 'signalId'), field(spec, 'order', 'orderId'), field(spec, 'fill', 'fillId')];
    const headings = spec.stageLabels ?? ['Signal', 'Order', 'Fill']; check(Array.isArray(headings) && headings.length === 3 && headings.every(text), 'stageLabels requires three labels');
    const lane = 50, left = 18, right = width - 18, xs = [left, width / 2, right], totalHeight = Math.max(150, rows.length * lane + 48);
    ctx.setHeight(totalHeight);
    headings.forEach((value, i) => caption(ctx, xs[i], 15, value, { 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle' }));
    let missing = 0;
    rows.forEach((row, index) => {
      const key = id(row[recordKey], recordKey); check(!seen.has(key), `duplicate route record ${key}`); seen.add(key);
      const route = fields.map(name => { check(Object.hasOwn(row, name), `${key}: ${name} must be recorded or explicitly null`); return row[name] === null ? null : id(row[name], name); });
      check(route.some(Boolean), `${key}: empty route`); missing += route.filter(value => value === null).length;
      const g = node('g', { 'data-structure-kind': 'thread', 'data-record-id': key }), y = index * lane + 38, color = palette[index % palette.length];
      for (let stage = 0; stage < 2; stage++) if (route[stage] !== null && route[stage + 1] !== null) {
        const x0 = xs[stage], x1 = xs[stage + 1], bend = (x0 + x1) / 2;
        g.append(node('path', { d: `M${x0},${y} C${bend},${y - 11} ${bend},${y + 11} ${x1},${y}`, fill: 'none', stroke: color, 'stroke-width': 2, opacity: .65, 'data-source-id': route[stage], 'data-target-id': route[stage + 1] }));
      }
      route.forEach((value, stage) => {
        g.append(node('circle', { cx: xs[stage], cy: y, r: value === null ? 3 : 4, fill: value === null ? 'none' : color, stroke: color, 'stroke-dasharray': value === null ? '2 2' : 'none' }));
        g.append(node('text', { x: xs[stage], y: y + 18, class: 'sc-axis', 'text-anchor': stage === 0 ? 'start' : stage === 2 ? 'end' : 'middle', 'pointer-events': 'none' }, value === null ? '—' : short(value, Math.floor((width / 3 - 10) / 6.5))));
      });
      mark(g, row, index, `${key}: ${route.map((value, i) => `${headings[i]} ${value === null ? 'not recorded' : value}`).join(' → ')}`);
      marks.push({ element: g, row });
    });
    if (missing) ctx.note(language(`${missing} stages are explicitly unrecorded; no links cross a gap.`, `${missing} 个阶段明确无记录，缺口之间不补连线。`));
    focusRecords(ctx, marks, (item, row) => item.row === row);
  }

  function graph(ctx, kind) {
    const { spec, rows } = ctx, network = kind === 'network';
    check(Array.isArray(spec.nodes) && spec.nodes.length > 0 && spec.nodes.length <= 100, 'nodes requires 1–100 fixed node records');
    check(!network || rows.length <= 500, 'networks support at most 500 actual links');
    const nodes = new Map(), keys = { node: field(spec, 'nodeId', 'id'), label: field(spec, 'nodeLabel', 'label'), id: field(spec, 'id', 'id'), source: field(spec, 'source', 'source'), target: field(spec, 'target', 'target'), value: field(spec, network ? 'weight' : 'value', network ? 'weight' : 'value') };
    spec.nodes.forEach((row, index) => {
      check(row && typeof row === 'object' && !Array.isArray(row), 'node must be a fixed record');
      const key = id(row[keys.node], keys.node); check(!nodes.has(key), `duplicate node ${key}`);
      nodes.set(key, { key, row, index, name: label(row, keys.label, key), incoming: [], outgoing: [] });
    });
    const seen = new Set(), links = rows.map((row, index) => {
      const key = id(row[keys.id], keys.id); check(!seen.has(key), `duplicate link ${key}`); seen.add(key);
      const source = nodes.get(id(row[keys.source], keys.source)), target = nodes.get(id(row[keys.target], keys.target));
      check(source && target, `${key}: edge endpoint has no node record`); check(source !== target, `${key}: self links must be excluded explicitly`);
      const value = amount(ctx, row[keys.value], `${key}.${keys.value}`), link = { key, row, index, source, target, value };
      if (network) { const sign = row[field(spec, 'sign', 'sign')]; check([-1, 0, 1].includes(sign), `${key}: sign must be -1, 0 or 1`); link.sign = sign; }
      source.outgoing.push(link); target.incoming.push(link); return link;
    });
    return { nodes: [...nodes.values()], links, keys };
  }

  function flow(ctx) {
    const { spec, node, mark, width } = ctx, data = graph(ctx, 'flow'), batchKey = field(spec, 'batch', 'batch'), batches = new Set();
    if (!data.links.length) { caption(ctx, width / 2, ctx.height / 2, language('No observed flows', '尚无流向观测'), { 'text-anchor': 'middle' }); return; }
    data.links.forEach(link => batches.add(id(link.row[batchKey], batchKey))); check(batches.size === 1, 'flow requires exactly one recorded batch; filter other batches first');
    for (const item of data.nodes) {
      item.inflow = sum(item.incoming.map(link => link.value)); item.outflow = sum(item.outgoing.map(link => link.value));
      const role = item.row[field(spec, 'role', 'role')] ?? 'transit';
      check(['source', 'sink', 'transit'].includes(role), `${item.key}: invalid flow role`);
      check(item.incoming.length || item.outgoing.length, `${item.key}: disconnected flow node`);
      if (role === 'source') check(!item.incoming.length && item.outgoing.length, `${item.key}: source must have only outgoing links`);
      else if (role === 'sink') check(!item.outgoing.length && item.incoming.length, `${item.key}: sink must have only incoming links`);
      else check(item.incoming.length && item.outgoing.length && equals(item.inflow, item.outflow), `${item.key}: transit inflow and outflow must conserve exactly; declare external source/sink explicitly`);
      item.total = role === 'source' ? item.outflow : item.inflow; item.value = geometryNumber(item.total); item.level = 0; item.degree = item.incoming.length;
    }
    const queue = data.nodes.filter(item => !item.degree), ordered = [];
    while (queue.length) { const item = queue.shift(); ordered.push(item); for (const link of item.outgoing) { link.target.level = Math.max(link.target.level, item.level + 1); if (--link.target.degree === 0) queue.push(link.target); } }
    check(ordered.length === data.nodes.length, 'flow contains a cycle; publish an acyclic batch allocation');
    const levels = Math.max(...data.nodes.map(item => item.level)) + 1, vertical = width < 560, groups = Array.from({ length: levels }, (_, level) => ordered.filter(item => item.level === level));
    const maximumParallel = Math.max(...groups.map(group => group.length)), height = vertical ? Math.max(ctx.height, levels * 100 + 25) : Math.max(ctx.height, 260, maximumParallel * 22 + 64); ctx.setHeight(height);
    const cross = vertical ? width - 40 : height - 64, axis = vertical ? height - 80 : width - 90;
    const magnitude = Math.max(Number.MIN_VALUE, ...data.nodes.map(item => item.value)), gap = Math.min(14, cross / (maximumParallel * 3)), minimum = vertical ? .8 : 3;
    const unit = Math.min(...groups.map(group => {
      const total = group.reduce((value, item) => value + item.value / magnitude, 0);
      return total ? Math.max(1, cross - Math.max(0, group.length - 1) * gap - group.length * minimum) / total : 1;
    }));
    for (const group of groups) {
      const sizes = group.map(item => Math.max(minimum, item.value / magnitude * unit)), used = sizes.reduce((a, b) => a + b, 0) + (group.length - 1) * gap;
      let cursor = Math.max(0, (cross - used) / 2);
      group.forEach((item, i) => { item.a = 34 + item.level / Math.max(1, levels - 1) * axis; item.b = 20 + cursor; item.size = sizes[i]; item.inCursor = item.b; item.outCursor = item.b; cursor += sizes[i] + gap; });
    }
    const marks = [], point = (a, b) => vertical ? [b, a] : [a, b + 12];
    data.links.forEach(link => {
      const thickness = link.value.n / magnitude * unit, sourceAt = link.source.outCursor + thickness / 2, targetAt = link.target.inCursor + thickness / 2;
      link.source.outCursor += thickness; link.target.inCursor += thickness;
      const from = point(link.source.a + 12, sourceAt), to = point(link.target.a, targetAt), mid = (link.source.a + 12 + link.target.a) / 2, c1 = point(mid, sourceAt), c2 = point(mid, targetAt);
      const g = node('g', { 'data-structure-kind': 'flow-link', 'data-record-id': link.key, 'data-source-id': link.source.key, 'data-target-id': link.target.key });
      const d = `M${from} C${c1} ${c2} ${to}`;
      g.append(node('path', { d, fill: 'none', stroke: accent, 'stroke-width': Math.max(.8, thickness), 'stroke-opacity': .27, ...(link.value.n === 0 ? { 'stroke-dasharray': '2 3' } : {}) }), node('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(10, thickness), 'pointer-events': 'stroke' }));
      mark(g, link.row, link.index, `${link.key} · ${[...batches][0]}: ${link.source.name} → ${link.target.name} · ${link.row[data.keys.value]}${spec.unit ? ' ' + spec.unit : ''}`);
      marks.push({ element: g, row: link.row, link });
    });
    for (const item of data.nodes) {
      const [x, y] = point(item.a, item.b), rect = vertical ? { x, y, width: item.size, height: 12 } : { x, y, width: 12, height: item.size };
      ctx.svg.append(node('rect', { ...rect, rx: 1, fill: accent, opacity: .65, 'data-node-id': item.key }));
      const sink = item.level === levels - 1, available = vertical ? Math.max(60, item.size) : axis / Math.max(1, levels - 1) - 20;
      if (!vertical || item.size >= 45) caption(ctx, vertical ? x : x + (sink ? -5 : 17), vertical ? y - 6 : y + Math.min(item.size / 2 + 4, 15), short(item.name, Math.max(6, Math.floor(available / 6.8))), { 'text-anchor': !vertical && sink ? 'end' : 'start', 'data-node-label': item.key });
    }
    ctx.note(language(`Batch ${[...batches][0]} · internal amounts conserve exactly; dashed links carry zero.`, `批次 ${[...batches][0]} · 内部流量精确守恒，虚线表示零流量。`));
    focusRecords(ctx, marks, (item, row) => item.row === row);
  }

  function network(ctx, force) {
    const { spec, width, node, mark } = ctx, data = graph(ctx, 'network'), height = Math.max(ctx.height, Math.min(500, width * .78)), marks = [];
    check(spec.directed === undefined || typeof spec.directed === 'boolean', 'directed must be a boolean');
    ctx.setHeight(height);
    const ordered = [...data.nodes].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0), bounds = { left: 30, right: width - 30, top: 34, bottom: height - 34 };
    const cx = width / 2, cy = height / 2, rx = (width - 96) / 2, ry = (height - 96) / 2;
    ordered.forEach((item, i) => { const angle = -Math.PI / 2 + 2 * Math.PI * i / ordered.length; item.x = cx + Math.cos(angle) * rx; item.y = cy + Math.sin(angle) * ry; item.radius = 6; });
    const maxWeight = Math.max(1, ...data.links.map(link => link.value.n));
    if (force) {
      // A deterministic finite solve, not a running simulation. Layout distance
      // is deliberately not interpreted as a correlation or any data value.
      const k = Math.sqrt((width - 60) * (height - 68) / Math.max(1, ordered.length));
      for (let iteration = 0; iteration < 140; iteration++) {
        ordered.forEach(item => { item.dx = (cx - item.x) * .013; item.dy = (cy - item.y) * .013; });
        for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
          const a = ordered[i], b = ordered[j], dx = a.x - b.x, dy = a.y - b.y, distance = Math.max(1, Math.hypot(dx, dy)), push = Math.min(18, k * k / (distance * distance) * 2);
          a.dx += dx / distance * push; a.dy += dy / distance * push; b.dx -= dx / distance * push; b.dy -= dy / distance * push;
        }
        for (const link of data.links) {
          if (link.value.n === 0) continue;
          const a = link.source, b = link.target, dx = b.x - a.x, dy = b.y - a.y, pull = .025 + .04 * link.value.n / maxWeight;
          a.dx += dx * pull; a.dy += dy * pull; b.dx -= dx * pull; b.dy -= dy * pull;
        }
        const cool = 1 - iteration / 160;
        ordered.forEach(item => { item.x = clamp(item.x + clamp(item.dx, -8, 8) * cool, bounds.left, bounds.right); item.y = clamp(item.y + clamp(item.dy, -8, 8) * cool, bounds.top, bounds.bottom); });
      }
    }
    const linkColor = link => link.sign < 0 ? negative : link.sign > 0 ? accent : muted;
    const pairs = new Map();
    data.links.forEach(link => { const key = [link.source.key, link.target.key].sort().join('\0'), group = pairs.get(key) ?? []; group.push(link); pairs.set(key, group); });
    data.links.forEach(link => {
      const g = node('g', { 'data-structure-kind': 'network-link', 'data-record-id': link.key, 'data-sign': link.sign, 'data-source-id': link.source.key, 'data-target-id': link.target.key });
      link.element = g; link.path = node('path', { fill: 'none', stroke: linkColor(link), 'stroke-width': .8 + 3.2 * Math.sqrt(link.value.n / maxWeight), 'stroke-opacity': .55, ...(link.sign < 0 || link.value.n === 0 ? { 'stroke-dasharray': '4 3' } : {}) });
      link.hit = node('path', { fill: 'none', stroke: 'transparent', 'stroke-width': 12, 'pointer-events': 'stroke' }); g.append(link.path, link.hit);
      if (spec.directed === true) { link.arrow = node('path', { fill: linkColor(link), 'pointer-events': 'none' }); g.append(link.arrow); }
      mark(g, link.row, link.index, `${link.key}: ${link.source.name} ${spec.directed ? '→' : '↔'} ${link.target.name} · weight ${link.row[data.keys.value]} · sign ${link.sign}`);
      marks.push({ element: g, row: link.row, link });
    });
    const update = () => {
      for (const item of ordered) {
        item.element?.setAttribute('transform', `translate(${item.x} ${item.y})`);
        if (item.caption) { const left = item.x > width / 2, available = left ? item.x - 18 : width - item.x - 18; item.caption.setAttribute('x', left ? -11 : 11); item.caption.setAttribute('text-anchor', left ? 'end' : 'start'); item.caption.textContent = short(item.name, Math.max(3, Math.min(width < 500 ? 13 : 22, Math.floor(available / 6.5)))); }
      }
      for (const group of pairs.values()) group.forEach((link, i) => {
        const a = link.source, b = link.target, dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy)), bend = (i - (group.length - 1) / 2) * 16 * (a.key < b.key ? 1 : -1);
        const mx = (a.x + b.x) / 2 - dy / distance * bend, my = (a.y + b.y) / 2 + dx / distance * bend, d = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
        link.path.setAttribute('d', d); link.hit.setAttribute('d', d);
        if (link.arrow) { const tx = b.x - mx, ty = b.y - my, length = Math.max(1, Math.hypot(tx, ty)), ux = tx / length, uy = ty / length, x = b.x - ux * 8, y = b.y - uy * 8; link.arrow.setAttribute('d', `M${x},${y} L${x - ux * 7 - uy * 3},${y - uy * 7 + ux * 3} L${x - ux * 7 + uy * 3},${y - uy * 7 - ux * 3} Z`); }
      });
    };
    for (const item of ordered) {
      const g = node('g', { 'data-structure-kind': 'network-node', 'data-node-id': item.key }); item.element = g;
      g.append(node('circle', { r: item.radius, fill: accent, 'fill-opacity': .9, stroke: 'var(--report-paper)', 'stroke-width': 1.5 }));
      const left = item.x > width * .7, caption = node('text', { x: left ? -11 : 11, y: 4, class: 'sc-axis', 'text-anchor': left ? 'end' : 'start', 'pointer-events': 'none' }, short(item.name, width < 500 ? 13 : 22));
      item.caption = caption; g.append(caption); mark(g, item.row, -1, `${item.name} [${item.key}]`); marks.push({ element: g, row: item.row, node: item });
      if (force) {
        g.style.touchAction = 'none'; let pointer = null;
        const coordinate = event => { const point = ctx.svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY; const matrix = ctx.svg.getScreenCTM(); return matrix ? point.matrixTransform(matrix.inverse()) : { x: item.x, y: item.y }; };
        const move = event => { if (!pointer || event.pointerId !== pointer.id) return; const point = coordinate(event); item.x = clamp(point.x + pointer.dx, bounds.left, bounds.right); item.y = clamp(point.y + pointer.dy, bounds.top, bounds.bottom); update(); };
        const finish = event => { if (!pointer || event?.pointerId !== undefined && event.pointerId !== pointer.id) return; const prior = pointer; pointer = null; global.removeEventListener('pointermove', move); global.removeEventListener('pointerup', finish); global.removeEventListener('pointercancel', finish); global.removeEventListener('blur', finish); try { if (g.hasPointerCapture(prior.id)) g.releasePointerCapture(prior.id); } catch {} };
        on(ctx, g, 'pointerdown', event => { if (event.button !== 0 || pointer) return; event.preventDefault(); const point = coordinate(event); pointer = { id: event.pointerId, dx: item.x - point.x, dy: item.y - point.y }; try { g.setPointerCapture(event.pointerId); } catch {} global.addEventListener('pointermove', move); global.addEventListener('pointerup', finish); global.addEventListener('pointercancel', finish); global.addEventListener('blur', finish); });
        on(ctx, g, 'lostpointercapture', finish); ctx.onCleanup(() => finish());
      }
    }
    update();
    ctx.note(language('Distance is layout only. Edges show supplied weight and sign; dashed edges are negative or zero.', '距离仅用于布局。边表示已提供的权重和符号；虚线表示负向或零权重。'));
    focusRecords(ctx, marks, (item, row) => {
      const selectedNode = ordered.find(node => node.row === row), selectedLink = data.links.find(link => link.row === row);
      return item.row === row || selectedNode && (item.link?.source === selectedNode || item.link?.target === selectedNode || item.node && data.links.some(link => link.source === selectedNode && link.target === item.node || link.target === selectedNode && link.source === item.node)) || selectedLink && (item.node === selectedLink.source || item.node === selectedLink.target);
    });
  }

  check(global.SesameCharts && typeof global.SesameCharts.register === 'function', 'load the SesameCharts registry before structural charts');
  for (const [kind, render] of Object.entries({ treemap, threads, flow, 'network-circular': ctx => network(ctx, false), 'network-force': ctx => network(ctx, true) })) {
    global.SesameCharts.register(kind, ctx => { rowsAreRecords(ctx.rows); return render(ctx); });
  }
})(window);
