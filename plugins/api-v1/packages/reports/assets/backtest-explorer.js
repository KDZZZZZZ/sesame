/* Sesame Strategy report explorer, MIT. Displays frozen evidence without fitting or ranking. */
(function (global) {
  'use strict';
  const fail = message => { throw new Error(`SesameBacktest: ${message}`); };
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  };
  const svg = (tag, attrs, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text != null) node.textContent = String(text);
    return node;
  };
  const tr = (zh, en) => document.documentElement.lang.startsWith('zh') ? zh : en;
  const exact = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const numericParameter = value => (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)));
  const numeric = value => value === null ? null : numericParameter(value) ? Number(value) : fail('Metrics must be finite numbers, exact decimal strings or null');
  const pair = row => JSON.stringify([row.symbol, row.timeframe]);

  function validate(rows, parameters) {
    if (!Array.isArray(parameters) || !parameters.length || parameters.length > 32 || parameters.some(key => typeof key !== 'string' || !key) || new Set(parameters).size !== parameters.length) fail('Provide 1–32 unique parameter keys');
    if (!Array.isArray(rows) || !rows.length || rows.length > 100000) fail('Provide 1–100,000 frozen trial rows');
    const ids = new Set(), groups = new Map(), samples = new Set();
    for (const row of rows) {
      if (!row || typeof row.trial_id !== 'string' || !row.trial_id || ids.has(row.trial_id)) fail('Trial IDs must be present and unique across all cells');
      ids.add(row.trial_id);
      if (!['symbol', 'timeframe', 'sample'].every(key => typeof row[key] === 'string' && row[key]) || !['completed', 'failed', 'not_run'].includes(row.status)) fail('Each trial needs symbol, timeframe, sample and an explicit status');
      samples.add(row.sample);
      if (typeof row.selected !== 'boolean' || !row.parameters || Array.isArray(row.parameters) || !parameters.every(key => Object.hasOwn(row.parameters, key) && row.parameters[key] !== undefined)) fail('Trials need explicit selected flags and every declared parameter');
      for (const key of ['sharpe', 'max_drawdown_pct', 'net_profit']) {
        if (!Object.hasOwn(row, key)) fail(`Missing metric column: ${key}; use null when undefined`);
        numeric(row[key]);
      }
      if (row.max_drawdown_pct !== null && numeric(row.max_drawdown_pct) < 0) fail('Drawdown is a nonnegative percentage magnitude');
      if (row.selected && row.status !== 'completed') fail('Failed or unrun trials cannot be selected');
      if (!groups.has(pair(row))) groups.set(pair(row), []);
      groups.get(pair(row)).push(row);
    }
    if (samples.size !== 1) fail('Do not mix training and holdout rows in a selection matrix; use one frozen comparison cohort');
    for (const trials of groups.values()) {
      const count = trials.filter(row => row.selected).length;
      if (count !== (trials.some(row => row.status === 'completed') ? 1 : 0)) fail('Record exactly one prespecified winner for each completed symbol/timeframe cell');
    }
    return groups;
  }

  function selector(labelText, options, selected) {
    const label = el('label', labelText), input = el('select');
    input.setAttribute('aria-label', labelText);
    for (const [value, title] of options) { const option = el('option', title); option.value = value; input.append(option); }
    if (selected !== undefined) input.value = selected;
    label.append(input);
    return { label, input };
  }
  function pager(target, count, size, label, change) {
    let page = 0;
    const wrap = el('div', null, 'backtest-pagination'), back = el('button', '←'), next = el('button', '→'), status = el('span');
    back.type = next.type = 'button';
    back.setAttribute('aria-label', `${label}: ${tr('上一页', 'previous page')}`);
    next.setAttribute('aria-label', `${label}: ${tr('下一页', 'next page')}`);
    status.setAttribute('aria-live', 'polite');
    wrap.append(back, status, next); target.append(wrap);
    const update = () => {
      back.disabled = page === 0; next.disabled = (page + 1) * size >= count;
      status.textContent = `${label} · ${count ? page * size + 1 : 0}–${Math.min((page + 1) * size, count)} / ${count}`;
      change(page * size, Math.min((page + 1) * size, count));
    };
    back.addEventListener('click', () => { if (page > 0) { page--; update(); } });
    next.addEventListener('click', () => { if ((page + 1) * size < count) { page++; update(); } });
    return update;
  }

  function graphView(target, graph, source) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail('Use the exact graph produced by strategy_graph');
    const nodeDetails = new Map((source?.nodes ?? []).map(node => [node.id, node]));
    const draw = (container, part, definitions) => {
      const nodes = part.nodes, ids = new Set(nodes.map(node => node.id));
      if (ids.size !== nodes.length || nodes.length > 2000 || part.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) fail('Invalid graph identity');
      const levels = new Map(nodes.map(node => [node.id, 0]));
      for (let index = 0; index < nodes.length; index++) {
        let changed = false;
        for (const edge of part.edges) if (levels.get(edge.to) <= levels.get(edge.from)) { levels.set(edge.to, levels.get(edge.from) + 1); changed = true; }
        if (!changed) break;
        if (index === nodes.length - 1) fail('Cyclic graph');
      }
      const lanes = new Map(), positions = new Map();
      for (const node of nodes) {
        const level = levels.get(node.id), slot = lanes.get(level) || 0;
        lanes.set(level, slot + 1); positions.set(node.id, [24 + level * 220, 24 + slot * 70]);
      }
      const width = Math.max(640, (Math.max(0, ...levels.values()) + 1) * 220 + 28), height = Math.max(100, Math.max(0, ...lanes.values()) * 70 + 28);
      const frame = el('div', null, 'backtest-logic'), plot = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': tr('SVL 策略逻辑', 'SVL strategy logic') });
      plot.style.width = `${width}px`; frame.append(plot); container.append(frame);
      const disclosure = el('details'), detail = el('pre', '', 'backtest-node');
      disclosure.append(el('summary', tr('节点定义', 'Node definition')), detail); container.append(disclosure);
      for (const edge of part.edges) {
        const a = positions.get(edge.from), b = positions.get(edge.to);
        plot.append(svg('path', { d: `M${a[0] + 188} ${a[1] + 23} C${a[0] + 205} ${a[1] + 23},${b[0] - 20} ${b[1] + 23},${b[0]} ${b[1] + 23}` }));
      }
      for (const node of nodes) {
        const [x, y] = positions.get(node.id), group = svg('g', { tabindex: 0, role: 'button', 'aria-label': `${node.id}: ${node.operator}` });
        const short = text => text.length > 25 ? text.slice(0, 24) + '…' : text;
        group.append(svg('title', {}, `${node.id}: ${node.operator}`), svg('rect', { x, y, width: 188, height: 46, rx: 6 }), svg('text', { x: x + 9, y: y + 17 }, short(node.id)), svg('text', { x: x + 9, y: y + 34 }, short(node.operator)));
        const select = () => { detail.textContent = JSON.stringify({ ...(definitions.get(node.id) ?? node), ...(node.functionId ? { resolvedFunctionId: node.functionId } : {}) }, null, 2); disclosure.open = true; };
        group.addEventListener('click', select);
        group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
        plot.append(group);
      }
    };
    const definitions = el('details');
    definitions.append(el('summary', tr('参数、输入与初始状态', 'Parameters, inputs and initial state')), el('pre', JSON.stringify({ parameters: source?.parameters, inputs: source?.inputs, state: source?.state, semantics: source?.semantics }, null, 2), 'backtest-node'));
    target.append(definitions);
    const steps = (container, list) => {
      for (const step of list ?? []) {
        const flow = el('div', null, 'backtest-flow');
        if (step.forEach) {
          flow.classList.add('backtest-loop');
          flow.append(el('strong', `${step.id} · ${tr('逐项', 'For each')} ${step.forEach.item} ∈ ${exact(step.forEach.input)} · ${tr('最多', 'limit')} ${step.forEach.maxItems}`));
          steps(flow, step.steps);
        } else {
          flow.append(el('span', step.when ? `${tr('条件', 'When')}: ${step.when}` : tr('每次事件', 'Every event')));
          flow.append(el('span', `→ ${(step.actions ?? []).join(' → ') || '—'}`));
          if (step.elseActions?.length) flow.append(el('span', `${tr('否则', 'Otherwise')} → ${step.elseActions.join(' → ')}`));
        }
        container.append(flow);
      }
    };
    // Event conditions, bounded loops and actions are distinct from data-dependency edges.
    for (const handler of graph.handlers ?? []) {
      const block = el('div', null, 'backtest-handler');
      block.append(el('strong', `${handler.id} · ${handler.event.type} · ${handler.event.input ?? ''}`));
      steps(block, handler.steps);
      target.append(block);
    }
    draw(target, graph, nodeDetails);
    const functions = new Map((source?.functions ?? []).map(fn => [fn.id, fn]));
    for (const extension of source?.extensions ?? []) for (const fn of extension.module?.functions ?? []) functions.set(`${extension.id}/${fn.id}`, fn);
    for (const fn of graph.functions ?? []) {
      const block = el('details'); block.append(el('summary', `${tr('函数', 'Function')}: ${fn.id}`)); target.append(block);
      block.append(el('pre', JSON.stringify({ parameters: fn.parameters, output: fn.output, result: fn.result }, null, 2), 'backtest-node'));
      let drawn = false;
      block.addEventListener('toggle', () => {
        if (block.open && !drawn) { drawn = true; draw(block, fn, new Map((functions.get(fn.id)?.nodes ?? []).map(node => [node.id, node]))); }
      });
    }
  }

  function render(target, config) {
    if (typeof target === 'string') target = document.querySelector(target);
    if (!target) fail('A report target is required');
    const groups = validate(config.rows, config.parameters);
    const metrics = [['sharpe', tr('夏普', 'Sharpe'), ''], ['max_drawdown_pct', tr('最大回撤', 'Max drawdown'), '%'], ['net_profit', tr('净盈亏', 'Net profit'), config.currency]];
    const symbols = [...new Set(config.rows.map(row => row.symbol))], timeframes = [...new Set(config.rows.map(row => row.timeframe))];
    const missing = (symbol, timeframe) => ({ symbol, timeframe, sharpe: null, max_drawdown_pct: null, net_profit: null });
    reportKit.render(target, {
      title: config.title, eyebrow: config.demo ? tr('Strategy · 演示样本', 'Strategy · DEMO SAMPLE') : 'Strategy',
      verdict: { tone: 'neutral', headline: config.summary },
      sections: [
        { title: tr('策略逻辑', 'Strategy logic'), takeaway: tr('信号、条件与动作来自同一策略修订。', 'Signals, conditions and actions come from the same strategy revision.'), blocks: [{ type: 'custom', render: node => graphView(node, config.graph, config.definition) }] },
        { title: tr('品种 × 周期', 'Symbols × timeframes'), takeaway: config.selectionRule, blocks: [{ type: 'custom', render: explorer }] },
      ],
      method: { steps: [config.sourceNote], limits: [tr('热力图显示已记录的选中参数组；颜色切换不会重新选优。', 'The matrix shows recorded selected trials; changing color metrics never reselects winners.')], sources: [{ label: 'SVL', value: JSON.stringify(config.source) }, { label: tr('固定数据', 'Frozen data'), value: config.dataId }] },
    });
    function explorer(container) {
      const controls = el('div', null, 'backtest-controls');
      if (config.selectionMetric && !metrics.some(([key]) => key === config.selectionMetric)) fail('Use a supported selection metric or extend the editable template');
      const color = selector(tr('热力指标', 'Color metric'), metrics.map(([key, name]) => [key, name]), config.selectionMetric ?? 'sharpe'); controls.append(color.label);
      const axisPage = (items, label) => selector(label, Array.from({ length: Math.ceil(items.length / 20) }, (_, i) => [String(i), `${i * 20 + 1}–${Math.min((i + 1) * 20, items.length)} / ${items.length}`]));
      const symbolPage = axisPage(symbols, tr('品种范围', 'Symbol range')), timeframePage = axisPage(timeframes, tr('周期范围', 'Timeframe range'));
      if (symbols.length > 20) controls.append(symbolPage.label);
      if (timeframes.length > 20) controls.append(timeframePage.label);
      container.append(controls);
      const matrix = el('div', null, 'backtest-matrix'), legend = el('p', null, 'report-source'), detail = el('section', null, 'backtest-detail'); detail.tabIndex = -1; container.append(matrix, legend, detail);
      function select(row, focus = true) {
        const trials = groups.get(pair(row)) ?? [];
        reportKit.destroy(detail); SesameCharts.destroy(detail); detail.replaceChildren();
        detail.append(el('h3', `${row.symbol} · ${row.timeframe}`));
        if (!trials.length) { detail.append(el('p', tr('此组合没有回测记录。', 'No backtest was recorded for this combination.'))); return; }
        detail.append(el('p', `${tr('全部参数组', 'All parameter sets')}: ${trials.length} · ${trials[0].sample}`, 'report-source'));
        const parameter = selector(tr('分析参数', 'Parameter'), config.parameters.map(key => [key, key])), toolbar = el('div', null, 'backtest-controls'); toolbar.append(parameter.label); detail.append(toolbar);
        const plots = el('div', null, 'backtest-sensitivity'), plotPages = el('div'); detail.append(plots, plotPages);
        detail.append(el('p', tr('每点保留完整参数组，其他参数也可能不同；不合并相同横坐标。', 'Each point retains its full parameter set; other parameters may differ. Equal x-coordinates are not averaged.'), 'report-source'));
        const exactBox = el('details'), exactRow = el('pre', '', 'backtest-node'); exactBox.append(el('summary', tr('完整试验记录', 'Complete trial record')), exactRow);
        const inspect = trial => { exactRow.textContent = JSON.stringify(trial, null, 2); exactBox.open = true; };
        const complete = trials.filter(row => row.status === 'completed');
        let plotStart = 0, plotEnd = Math.min(1000, complete.length);
        function sensitivity() {
          reportKit.destroy(plots); plots.replaceChildren();
          const key = parameter.input.value, numericAxis = complete.every(row => numericParameter(row.parameters[key]));
          for (const [metric, name, unit] of metrics) {
            const chart = el('div'); plots.append(chart);
            const rows = complete.slice(plotStart, plotEnd).map(row => ({ ...row, parameter_value: numericAxis ? row.parameters[key] : exact(row.parameters[key]) }));
            if (!rows.length) { chart.append(el('p', `${name}: ${tr('暂无成功回测。', 'No completed trial.')} `)); continue; }
            reportKit.chart(chart, { kind: 'scatter', title: `${key} → ${name}`, caption: unit || name, data: rows, x: 'parameter_value', y: metric, xType: numericAxis ? 'number' : 'category', unit, onSelect: row => inspect(trials.find(trial => trial.trial_id === row.trial_id)) });
          }
        }
        parameter.input.addEventListener('change', sensitivity);
        pager(plotPages, complete.length, 1000, tr('图中试验', 'Plotted trials'), (start, end) => { plotStart = start; plotEnd = end; sensitivity(); })();
        const table = el('div', null, 'sc-table-wrap'), pages = el('div'); detail.append(table, pages, exactBox);
        // Separate parameter columns prevent a parameter called "status" or "net_profit" from replacing recorded evidence.
        pager(pages, trials.length, 50, tr('表中试验', 'Table trials'), (start, end) => {
          table.replaceChildren(); const grid = el('table', null, 'sc-table'), head = el('thead'), header = el('tr'), body = el('tbody');
          const labels = [tr('试验', 'Trial'), tr('状态', 'Status'), tr('选中', 'Selected'), ...config.parameters, ...metrics.map(([, name, unit]) => unit ? `${name} (${unit})` : name)];
          labels.forEach(label => header.append(el('th', label))); head.append(header); grid.append(head, body);
          for (const trial of trials.slice(start, end)) {
            const line = el('tr'), id = el('td'), button = el('button', trial.trial_id); button.type = 'button'; button.addEventListener('click', () => inspect(trial)); id.append(button); line.append(id);
            [trial.status, trial.selected, ...config.parameters.map(key => trial.parameters[key]), ...metrics.map(([key]) => trial[key])].forEach(value => line.append(el('td', exact(value)))); body.append(line);
          }
          table.append(grid);
        })();
        if (focus) detail.focus({ preventScroll: true });
      }
      function matrixRender() {
        const [metric, name, unit] = metrics.find(item => item[0] === color.input.value);
        const rows = symbols.slice(Number(symbolPage.input.value) * 20, (Number(symbolPage.input.value) + 1) * 20).flatMap(symbol => timeframes.slice(Number(timeframePage.input.value) * 20, (Number(timeframePage.input.value) + 1) * 20).map(timeframe => groups.get(pair({ symbol, timeframe }))?.find(row => row.selected) ?? missing(symbol, timeframe)));
        const height = Math.max(240, new Set(rows.map(row => row.symbol)).size * 38 + 90);
        const colorMax = config.rows.reduce((max, row) => row.selected && row[metric] !== null ? Math.max(max, Math.abs(numeric(row[metric]))) : max, 0) || 1;
        SesameCharts.chart(matrix, { kind: 'matrix', rows, x: 'timeframe', y: 'symbol', value: metric, colorMax, title: `${tr('选中参数组', 'Selected parameter sets')} · ${name}`, height, unit, onSelect: row => select(row) });
        matrix.dataset.metric = metric;
        legend.textContent = `${tr('跨页统一色阶 · 数值幅度', 'Consistent scale across pages · magnitude')} 0–${SesameCharts.format(colorMax, unit)}${metric === 'max_drawdown_pct' ? tr(' · 越低越好', ' · lower is better') : ''}`;
      }
      for (const input of [color.input, symbolPage.input, timeframePage.input]) input.addEventListener('change', matrixRender);
      matrixRender(); select(config.rows[0], false);
    }
  }
  Object.defineProperty(global, 'SesameBacktest', { value: Object.freeze({ render, validate }), configurable: false });
})(window);
