// Local views of fixed records. This runtime has no network or analysis API.
(() => {
  const payload = JSON.parse(document.getElementById('sesame-report-interactions').textContent);
  const scopes = new Map(payload.scopes.map(scope => [scope.id, new Map(scope.controls.map(control => [control.id, structuredClone(control)]))]));
  const listeners = new Map(), widgets = new Map();
  const zh = /^zh/i.test(payload.locale), tr = (cn, en) => zh ? cn : en;
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const filter = (rows, filters = [], scope) => rows.filter(row => filters.every(item => {
    const control = scopes.get(scope).get(item.control), value = row[item.field];
    if (control.kind === 'select') return value === control.value;
    const number = control.format === 'time' && typeof value === 'string' ? Date.parse(value) : value;
    return typeof number === 'number' && Number.isFinite(number) && number >= control.value[0] && number <= control.value[1];
  }));
  const value = (scope, id) => scopes.get(scope)?.get(id)?.value;
  const subscribe = (scope, listener) => { if (!listeners.has(scope)) listeners.set(scope, new Set()); listeners.get(scope).add(listener); return () => listeners.get(scope).delete(listener); };
  const set = (scope, id, next) => {
    const control = scopes.get(scope).get(id);
    if (control.kind === 'select' && !control.options.some(option => option.value === next)) return;
    if (control.kind === 'range' && (!Array.isArray(next) || next.length !== 2 || !next.every(Number.isFinite)
      || next[0] < control.min || next[1] > control.max || next[0] > next[1])) return;
    if (JSON.stringify(control.value) === JSON.stringify(next)) return;
    control.value = structuredClone(next);
    widgets.get(scope)?.get(id)?.();
    listeners.get(scope)?.forEach(listener => listener());
  };
  const options = (supplied, mapping = {}, scope) => ({ ...supplied, ...Object.fromEntries(Object.entries(mapping).map(([key, id]) => [key, value(scope, id)])) });
  for (const [scope, controls] of scopes) {
    const target = document.getElementById(scope).querySelector(':scope > .report-controls'), updates = new Map(); widgets.set(scope, updates);
    for (const [id, control] of controls) {
      const wrapper = element('label', undefined, 'report-control'); wrapper.append(element('span', control.label));
      if (control.kind === 'select') {
        const select = element('select'); select.dataset.control = id; select.setAttribute('aria-label', control.label);
        control.options.forEach((option, index) => { const node = element('option', option.label ?? String(option.value ?? '—')); node.value = String(index); select.append(node); });
        const update = () => { select.value = String(control.options.findIndex(option => option.value === control.value)); };
        update(); updates.set(id, update);
        select.addEventListener('change', () => set(scope, id, control.options[Number(select.value)].value)); wrapper.append(select);
      } else {
        const range = element('span', undefined, 'report-range-control'), inputs = [0, 1].map(index => {
          const input = element('input'); input.type = 'range'; input.min = control.min; input.max = control.max; input.step = control.step ?? 'any'; input.dataset.control = id;
          input.setAttribute('aria-label', `${control.label} · ${index ? tr('至', 'To') : tr('从', 'From')}`);
          input.addEventListener('input', () => { const next = [...control.value]; next[index] = Number(input.value); next[index] = index ? Math.max(next[0], next[1]) : Math.min(next[0], next[1]); set(scope, id, next); });
          range.append(input); return input;
        });
        const output = element('output'); range.append(output);
        const format = number => control.format === 'time' ? new Date(number).toISOString().slice(0, 19).replace('T', ' ') : new Intl.NumberFormat(payload.locale, { maximumFractionDigits: 6 }).format(number);
        const update = () => { inputs.forEach((input, index) => { input.value = control.value[index]; }); output.textContent = control.value.map(format).join(' – '); };
        update(); updates.set(id, update); wrapper.append(range);
      }
      target.append(wrapper);
    }
  }
  for (const spec of payload.tables) {
    const target = document.getElementById(spec.id), rows = [...target.querySelectorAll('tbody > tr')];
    const records = spec.rows.map(row => Object.fromEntries(spec.columns.map((column, index) => [column, row[index]])));
    let page = 0, printing = false;
    const nav = element('div', undefined, 'report-pagination'), prev = element('button', '‹'), next = element('button', '›'), label = element('span');
    prev.type = next.type = 'button'; prev.setAttribute('aria-label', tr('上一页', 'Previous page')); next.setAttribute('aria-label', tr('下一页', 'Next page')); label.setAttribute('aria-live', 'polite');
    if (spec.pageSize) { nav.append(prev, label, next); target.append(nav); }
    const render = () => {
      const shown = new Set(filter(records, spec.filter, spec.scope)), filtered = records.map((row, index) => shown.has(row) ? index : -1).filter(index => index >= 0);
      const pages = Math.max(1, Math.ceil(filtered.length / (spec.pageSize ?? Math.max(1, filtered.length)))); page = Math.min(page, pages - 1);
      const visible = new Set(printing || !spec.pageSize ? filtered : filtered.slice(page * spec.pageSize, (page + 1) * spec.pageSize));
      rows.forEach((row, index) => {
        row.hidden = !visible.has(index);
        if (spec.selection) row.setAttribute('aria-selected', String(records[index][spec.selection.column] === value(spec.scope, spec.selection.control)));
      });
      nav.hidden = printing || pages <= 1; prev.disabled = page === 0; next.disabled = page === pages - 1; label.textContent = `${page + 1} / ${pages}`;
    };
    if (spec.selection) rows.forEach((row, index) => {
      row.tabIndex = 0; row.dataset.reportSelectable = ''; const select = () => set(spec.scope, spec.selection.control, records[index][spec.selection.column]);
      row.addEventListener('click', select); row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    });
    prev.addEventListener('click', () => { page--; render(); }); next.addEventListener('click', () => { page++; render(); });
    subscribe(spec.scope, () => { page = 0; render(); });
    window.addEventListener('beforeprint', () => { printing = true; render(); });
    window.addEventListener('afterprint', () => { printing = false; render(); }); render();
  }
  window.SesameReportInteractions = Object.freeze({ filter, options, subscribe });
})();
