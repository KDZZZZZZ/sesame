/* Sesame decision tree — MIT, Sesame contributors.
 * Original deterministic SVG layout. Branches represent recorded conditions,
 * never inferred probabilities, quantities, or recommendations. */
(function (global) {
  'use strict';
  const fail = message => { throw Error(`SesameCharts/decision-tree: ${message}`); };
  const field = (spec, name, fallback) => {
    if (spec[name] !== undefined && (typeof spec[name] !== 'string' || !spec[name].trim())) fail(`${name} must name a field`);
    return spec[name] ?? fallback;
  };
  const identifier = value => {
    if ((typeof value !== 'string' || !value.trim()) && (typeof value !== 'number' || !Number.isFinite(value))) fail('node IDs and parent IDs must be nonempty strings or finite numbers');
    return String(value);
  };
  const text = (value, fallback = '') => {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) fail('labels, conditions and details must be text');
    return String(value);
  };
  const muted = 'var(--report-muted)', context = 'var(--report-context,var(--report-muted))';

  function decisionTree(ctx) {
    const { spec, rows, width, node, svg, mark, frame, html } = ctx;
    const keys = { id: field(spec, 'id', 'id'), parent: field(spec, 'parent', 'parentId'), label: field(spec, 'label', 'label'), condition: field(spec, 'condition', 'condition'), detail: field(spec, 'detail', 'detail') };
    const records = new Map(), roots = [];
    rows.forEach((row, index) => {
      const key = identifier(row[keys.id]);
      if (records.has(key)) fail(`duplicate node ID ${key}`);
      records.set(key, { key, row, index, children: [], label: text(row[keys.label], key), condition: text(row[keys.condition]), detail: text(row[keys.detail]) });
    });
    for (const record of records.values()) {
      const raw = record.row[keys.parent];
      if (raw === undefined || raw === null || raw === '') roots.push(record);
      else {
        const parent = records.get(identifier(raw));
        if (!parent || parent === record) fail(`${record.key}: missing or self parent`);
        record.parent = parent; parent.children.push(record);
      }
    }
    if (roots.length !== 1) fail('a decision tree requires one root; check for multiple roots or a cycle');
    const root = roots[0], ordered = [], stack = [{ record: root, depth: 0 }];
    let maxDepth = 0;
    while (stack.length) {
      const { record, depth } = stack.pop();
      record.depth = depth; ordered.push(record); maxDepth = Math.max(maxDepth, depth);
      for (let i = record.children.length - 1; i >= 0; i--) stack.push({ record: record.children[i], depth: depth + 1 });
    }
    if (ordered.length !== records.size) fail('the tree contains a disconnected cycle');

    const margin = 24, rowGap = 20, inset = 14;
    const styles = {
      condition: { size: 12, weight: 400, lineHeight: 18, fill: muted },
      label: { size: 14, weight: 500, lineHeight: 21, fill: 'var(--sc-node-ink,var(--report-ink))' },
      detail: { size: 12, weight: 400, lineHeight: 18, fill: muted },
    };
    const language = document.documentElement.lang || 'en';
    const words = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(language, { granularity: 'word' }) : null;
    const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(language, { granularity: 'grapheme' }) : null;
    let disposed = false, scene, selected = null, scale = 1, tx = 0, ty = 0;
    const viewport = html('div', 'sc-decision-viewport'), controls = html('div', 'sc-decision-controls');
    const listeners = [], pointers = new Map();
    viewport.style.height = `${spec.height ?? 480}px`;
    viewport.tabIndex = 0; viewport.setAttribute('role', 'group');
    viewport.setAttribute('aria-label', spec.title || '决策树');
    controls.setAttribute('role', 'toolbar'); controls.setAttribute('aria-label', '决策树视图');
    frame.classList.add('sc-decision-frame'); frame.prepend(viewport); viewport.append(svg); frame.append(controls);
    svg.setAttribute('role', 'group'); svg.setAttribute('data-decision-style', 'compact');
    svg.setAttribute('data-decision-layout', 'horizontal');
    const listen = (element, event, handler, options) => {
      element.addEventListener(event, handler, options);
      listeners.push(() => element.removeEventListener(event, handler, options));
    };
    function button(label, title, action) {
      const button = html('button', 'sc-decision-control'); button.type = 'button';
      button.textContent = label; button.title = title; button.setAttribute('aria-label', title);
      controls.append(button); listen(button, 'click', action); return button;
    }
    const matrix = () => svg.getScreenCTM();
    const fitScale = () => matrix()?.a || 1;
    const world = (x, y) => new DOMPoint(x, y).matrixTransform(matrix().inverse());
    const center = () => { const r = svg.getBoundingClientRect(); return world(r.x + r.width / 2, r.y + r.height / 2); };
    const clampScale = value => Math.max(Math.min(.15 / fitScale(), 1), Math.min(3.5 / fitScale(), value));
    function updateView() {
      scene?.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
      const actual = fitScale() * scale;
      svg.dataset.decisionZoom = String(actual); svg.dataset.decisionPan = `${tx},${ty}`;
      minusButton.disabled = actual <= Math.min(.15, fitScale()) + .0001;
      plusButton.disabled = actual >= 3.5 - .0001;
    }
    function zoom(value, anchor = center()) {
      const next = clampScale(value), ratio = next / scale;
      tx = anchor.x - (anchor.x - tx) * ratio; ty = anchor.y - (anchor.y - ty) * ratio;
      scale = next; updateView();
    }
    const minusButton = button('−', '缩小', () => zoom(scale / 1.25));
    const plusButton = button('+', '放大', () => zoom(scale * 1.25));
    const fitButton = button('⛶', '显示全貌', () => { scale = 1; tx = ty = 0; updateView(); });

    function highlight(record) {
      selected = record;
      const path = new Set(); for (let p = record; p; p = p.parent) path.add(p);
      for (const item of ordered) {
        item.group?.classList.toggle('sc-decision-active', path.has(item));
        item.edge?.classList.toggle('sc-decision-active', path.has(item));
        item.branch?.classList.toggle('sc-decision-active', path.has(item));
      }
    }
    listen(ctx.target, 'chartselect', event => {
      if (event.target !== ctx.target) return;
      const record = ordered.find(item => item.row === event.detail.row && item.index === event.detail.index);
      if (record) highlight(record);
    });
    listen(viewport, 'wheel', event => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      zoom(scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * .002), world(event.clientX, event.clientY));
    }, { passive: false });
    listen(viewport, 'dblclick', event => {
      event.preventDefault(); zoom(1 / fitScale(), world(event.clientX, event.clientY));
    });
    listen(viewport, 'keydown', event => {
      // Node Enter/Space continue to use the shared chart/table selection contract.
      if (event.target.closest('[data-decision-kind="node"]')) return;
      if (event.key === '+' || event.key === '=') zoom(scale * 1.25);
      else if (event.key === '-') zoom(scale / 1.25);
      else if (event.key === '0' || event.key === 'Home') fitButton.click();
      else if (event.key === '1') zoom(1 / fitScale());
      else if (/^Arrow(Left|Right|Up|Down)$/.test(event.key)) {
        const distance = 40 / fitScale();
        tx += event.key === 'ArrowLeft' ? distance : event.key === 'ArrowRight' ? -distance : 0;
        ty += event.key === 'ArrowUp' ? distance : event.key === 'ArrowDown' ? -distance : 0;
        updateView();
      } else return;
      event.preventDefault();
    });
    let gesture, moved = false, suppressClickUntil = 0;
    function startGesture() {
      const points = [...pointers.values()];
      if (!points.length) { gesture = null; return; }
      const a = points[0], b = points[1] || a;
      gesture = { x: a.x, y: a.y, tx, ty, scale, anchor: world((a.x + b.x) / 2, (a.y + b.y) / 2), distance: Math.hypot(a.x - b.x, a.y - b.y) };
    }
    listen(viewport, 'pointerdown', event => {
      if (event.button !== 0) return;
      if (!pointers.size) moved = false;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); startGesture();
    });
    listen(viewport, 'pointermove', event => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...pointers.values()], a = points[0], b = points[1];
      if (!moved && !b && Math.hypot(a.x - gesture.x, a.y - gesture.y) < 4) return;
      moved = true; event.preventDefault(); viewport.classList.add('sc-decision-dragging');
      for (const id of pointers.keys()) if (!viewport.hasPointerCapture(id)) viewport.setPointerCapture(id);
      if (b && gesture.distance) {
        const anchor = world((a.x + b.x) / 2, (a.y + b.y) / 2);
        scale = clampScale(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance);
        tx = anchor.x - (gesture.anchor.x - gesture.tx) * scale / gesture.scale;
        ty = anchor.y - (gesture.anchor.y - gesture.ty) * scale / gesture.scale;
      } else {
        tx = gesture.tx + (a.x - gesture.x) / fitScale(); ty = gesture.ty + (a.y - gesture.y) / fitScale();
      }
      updateView();
    });
    const endPointer = event => {
      if (!pointers.delete(event.pointerId)) return;
      if (moved) suppressClickUntil = performance.now() + 250;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      startGesture(); if (!pointers.size) viewport.classList.remove('sc-decision-dragging');
    };
    listen(global, 'pointerup', endPointer); listen(global, 'pointercancel', endPointer);
    listen(viewport, 'click', event => {
      if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    listen(viewport, 'focusin', event => {
      if (pointers.size) return;
      const group = event.target.closest('[data-decision-kind="node"]');
      if (!group) return;
      const b = group.getBoundingClientRect(), v = viewport.getBoundingClientRect(), padding = 12;
      const dx = b.left < v.left + padding ? v.left + padding - b.left : b.right > v.right - padding ? v.right - padding - b.right : 0;
      const dy = b.top < v.top + padding ? v.top + padding - b.top : b.bottom > v.bottom - padding ? v.bottom - padding - b.bottom : 0;
      tx += dx / fitScale(); ty += dy / fitScale(); updateView();
    });

    const applyTextStyle = (element, style) => {
      // Inline declarations keep node text legible when shared chart classes
      // define smaller axis labels or a selected group inherits a stroke.
      element.style.fontSize = `${style.size}px`; element.style.fontWeight = String(style.weight);
      element.style.fill = style.fill; element.style.stroke = 'none';
      element.style.fontFamily = 'var(--report-sans, sans-serif)';
    };
    function render() {
      if (disposed) return;
      svg.replaceChildren();
      svg.append(node('style', {}, `
        .sc-decision-frame .sc-decision-viewport{overflow:hidden;touch-action:none;user-select:none;cursor:grab;outline-offset:2px}
        .sc-decision-frame .sc-decision-dragging{cursor:grabbing}
        .sc-decision-frame .sc-decision-viewport>svg{display:block;width:100%;height:100%;overflow:hidden}
        .sc-decision-frame .sc-tooltip{display:none}
        .sc-decision-controls{display:flex;position:absolute;right:0;bottom:0;gap:2px;padding:3px;background:var(--report-paper);border-radius:6px}
        .sc-decision-controls .sc-decision-control{border:1px solid transparent;border-radius:4px;background:transparent;color:var(--report-muted);font:18px/1 sans-serif;min-width:32px;min-height:32px;padding:4px;cursor:pointer}
        .sc-decision-controls .sc-decision-control:hover,.sc-decision-control:focus-visible{border-color:var(--report-line);color:var(--report-accent)}
        .sc-decision-controls .sc-decision-control:disabled{opacity:.35;cursor:default}
        .sc-decision-node{cursor:pointer}
        .sc-decision-frame .sc-decision-node:hover,.sc-decision-frame .sc-decision-node:focus-visible,.sc-decision-frame .sc-decision-node.sc-selected{stroke:none;outline:none}
        .sc-decision-marker{stroke:var(--report-context,var(--report-muted));stroke-width:2}
        .sc-decision-node[data-depth="0"],.sc-decision-node.sc-decision-active,.sc-decision-node:hover,.sc-decision-node:focus-visible{--sc-node-ink:var(--report-accent)}
        .sc-decision-node[data-depth="0"] .sc-decision-marker,.sc-decision-node.sc-decision-active .sc-decision-marker,.sc-decision-node:hover .sc-decision-marker,.sc-decision-node:focus-visible .sc-decision-marker{stroke:var(--report-accent)}
        .sc-decision-node:focus-visible .sc-decision-underline{stroke:var(--report-accent);stroke-dasharray:3 2}
        .sc-decision-links .sc-decision-active{stroke:var(--report-accent);stroke-width:1.8}
        @media print{
          .sc-decision-controls{display:none!important}
          .sc-decision-frame .sc-decision-viewport{height:auto!important;overflow:visible!important}
          .sc-decision-frame .sc-decision-viewport>svg{height:auto!important;overflow:visible!important}
          .sc-decision-scene{transform:none!important}
        }
      `));
      const probe = node('text', { visibility: 'hidden', 'aria-hidden': 'true' }); svg.append(probe);
      function wrap(value, available, style) {
        applyTextStyle(probe, style);
        const measure = value => { probe.textContent = value; return probe.getComputedTextLength(); };
        const result = [];
        for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
          if (!paragraph.trim()) { result.push(''); continue; }
          let current = '';
          const tokens = words ? Array.from(words.segment(paragraph), part => part.segment) : paragraph.split(/(\s+)/u);
          for (let token of tokens) {
            if (!current) token = token.trimStart();
            if (!token) continue;
            if (measure(current + token) <= available) { current += token; continue; }
            // Keep closing punctuation with the preceding character/word;
            // Chinese full stops should not become a line of their own.
            if (current && /^[，。！？、；：）】》」』,.!?;:%％]/u.test(token)) {
              const carry = current.match(/([A-Za-z0-9_-]+|\S)$/u)?.[0] || '';
              if (carry && current.length > carry.length && measure(carry + token) <= available) {
                result.push(current.slice(0, -carry.length).trimEnd()); current = carry + token; continue;
              }
            }
            if (current.trim()) { result.push(current.trimEnd()); current = ''; }
            token = token.trimStart();
            if (measure(token) <= available) { current = token; continue; }
            // An unbroken URL/identifier must wrap too; never truncate it or
            // reduce the text size to fit the whole diagram into the viewport.
            const chars = graphemes ? Array.from(graphemes.segment(token), part => part.segment) : Array.from(token);
            for (const char of chars) {
              if (current && measure(current + char) > available) { result.push(current); current = ''; }
              current += char;
            }
          }
          if (current) result.push(current.trimEnd());
        }
        return result;
      }
      const measuredWidth = (lines, style) => {
        applyTextStyle(probe, style);
        return Math.max(0, ...lines.map(line => { probe.textContent = line; return probe.getComputedTextLength(); }));
      };
      const columns = Array(maxDepth + 1).fill(0), branches = Array(maxDepth + 1).fill(0);
      for (const record of ordered) {
        record.conditionLines = record.condition ? wrap(record.condition, 112, styles.condition) : [];
        record.conditionHeight = record.conditionLines.length * styles.condition.lineHeight;
        record.conditionWidth = measuredWidth(record.conditionLines, styles.condition);
        record.parts = [];
        let offset = 8, textWidth = 0;
        for (const name of ['label', 'detail']) {
          if (!record[name]) continue;
          const style = styles[name], lines = wrap(record[name], 194, style);
          textWidth = Math.max(textWidth, measuredWidth(lines, style));
          if (record.parts.length) offset += 4;
          record.parts.push({ name, style, lines, offset }); offset += lines.length * style.lineHeight;
        }
        record.w = Math.max(112, textWidth + inset + 8);
        record.boxHeight = Math.max(40, offset + 8);
        record.h = record.parent ? Math.max(record.boxHeight, record.conditionHeight) : record.boxHeight + (record.conditionHeight ? record.conditionHeight + 12 : 0);
        columns[record.depth] = Math.max(columns[record.depth], record.w);
        branches[record.depth] = Math.max(branches[record.depth], record.conditionWidth);
      }
      probe.remove();
      for (let i = ordered.length - 1; i >= 0; i--) {
        const record = ordered[i];
        record.childrenHeight = record.children.reduce((sum, child) => sum + child.subtreeHeight, 0) + Math.max(0, record.children.length - 1) * rowGap;
        record.subtreeHeight = Math.max(record.h, record.childrenHeight);
      }
      const columnX = [margin];
      for (let depth = 1; depth <= maxDepth; depth++) columnX[depth] = columnX[depth - 1] + columns[depth - 1] + branches[depth] + 64;
      root.top = margin;
      for (const record of ordered) {
        record.x = columnX[record.depth]; record.y = record.top + (record.subtreeHeight - record.h) / 2;
        record.boxY = record.y + (record.h - record.boxHeight) / 2;
        if (!record.parent && record.conditionHeight) record.boxY = record.y + record.conditionHeight + 12;
        record.cy = record.boxY + record.boxHeight / 2;
        let childTop = record.top + (record.subtreeHeight - record.childrenHeight) / 2;
        for (const child of record.children) { child.top = childTop; childTop += child.subtreeHeight + rowGap; }
      }
      const totalHeight = Math.max(120, root.subtreeHeight + margin * 2);
      ctx.setHeight(spec.height ?? 480);
      // Natural geometry remains intact. Only this viewport transforms; source
      // records, layout coordinates, row indices and exported topology do not.
      svg.setAttribute('viewBox', `0 0 ${Math.max(width, columnX[maxDepth] + columns[maxDepth] + margin)} ${totalHeight}`);
      scene = node('g', { class: 'sc-decision-scene' }); svg.append(scene);
      const links = node('g', { class: 'sc-decision-links', fill: 'none', stroke: context, 'stroke-width': 1.2, 'aria-hidden': 'true', 'pointer-events': 'none' });
      scene.append(links);
      for (const record of ordered) {
        if (!record.parent) continue;
        const parent = record.parent, startX = parent.x + parent.w;
        record.conditionX = record.x - branches[record.depth] - 20;
        const before = record.conditionX - 8, elbow = (startX + before) / 2;
        // Leave a real gap around branch text; no line or opaque label card
        // covers another condition, including long wrapped Chinese labels.
        const tail = record.conditionWidth ? `M${record.conditionX + record.conditionWidth + 8},${record.cy}` : '';
        const d = `M${startX},${parent.cy} C${elbow},${parent.cy} ${elbow},${record.cy} ${before},${record.cy} ${tail} H${record.x}`;
        record.edge = node('path', { d, 'data-decision-kind': 'link', 'data-source-id': parent.key, 'data-target-id': record.key });
        links.append(record.edge);
      }
      for (const record of ordered) {
        if (record.conditionHeight) {
          const branch = node('g', { 'data-decision-kind': 'condition', 'data-target-id': record.key, 'aria-hidden': 'true', 'pointer-events': 'none' });
          const element = node('text', { 'data-decision-part': 'condition' });
          applyTextStyle(element, styles.condition);
          const x = record.parent ? record.conditionX : record.x + inset, y = record.parent ? record.cy - record.conditionHeight / 2 : record.y;
          record.conditionLines.forEach((lineText, i) => element.append(node('tspan', { x, y: y + styles.condition.size + i * styles.condition.lineHeight }, lineText)));
          branch.append(element); scene.append(branch); record.branch = branch;
        }
        const group = node('g', { class: 'sc-decision-node', 'data-decision-kind': 'node', 'data-node-id': record.key, 'data-depth': record.depth, 'data-decision-role': record.children.length ? 'decision' : 'outcome' });
        group.append(node('rect', { x: record.x, y: record.boxY, width: record.w, height: record.boxHeight, fill: 'transparent', stroke: 'none' }));
        if (record.children.length) {
          group.append(node('line', { class: 'sc-decision-marker', x1: record.x, x2: record.x, y1: record.boxY + 10, y2: record.boxY + record.boxHeight - 10 }));
          group.append(node('line', { class: 'sc-decision-underline', x1: record.x + inset, x2: record.x + record.w, y1: record.boxY + record.boxHeight, y2: record.boxY + record.boxHeight, stroke: 'var(--report-line)', 'stroke-width': 1 }));
        } else group.append(node('circle', { class: 'sc-decision-marker', cx: record.x, cy: record.cy, r: 3, fill: 'var(--report-paper,transparent)' }));
        for (const part of record.parts) {
          const element = node('text', { 'data-decision-part': part.name, 'pointer-events': 'none' });
          applyTextStyle(element, part.style);
          part.lines.forEach((lineText, i) => element.append(node('tspan', { x: record.x + inset, y: record.boxY + part.offset + part.style.size + i * part.style.lineHeight }, lineText)));
          group.append(element);
        }
        const ancestry = [];
        for (let parent = record.parent; parent; parent = parent.parent) ancestry.unshift(parent.label);
        mark(group, record.row, record.index, [...ancestry, record.condition, record.label, record.detail].filter(Boolean).join(' › '));
        scene.append(group); record.group = group;
      }
      scale = 1; tx = ty = 0; updateView(); highlight(selected);
    }
    render();
    // Reflow once fonts finish loading rather than leaving fallback-font line
    // lengths in a report exported with its final typeface. Core owns resize.
    document.fonts?.addEventListener('loadingdone', render);
    ctx.onCleanup(() => {
      disposed = true; document.fonts?.removeEventListener('loadingdone', render);
      for (const id of pointers.keys()) if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
      pointers.clear(); listeners.forEach(remove => remove()); frame.classList.remove('sc-decision-frame');
    });
  }
  global.SesameCharts.register('decision-tree', decisionTree);
})(window);
