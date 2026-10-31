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
  const tr = (zh, en) => document.documentElement.lang.startsWith('zh') ? zh : en;
  const exact = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const numericParameter = value => (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)));
  const numeric = value => value === null ? null : numericParameter(value) ? Number(value) : fail('Metrics must be finite numbers, exact decimal strings or null');
  const pair = row => JSON.stringify([row.symbol, row.timeframe]);
  const statusLabel = value => ({ completed: tr('完成', 'Completed'), failed: tr('失败', 'Failed'), not_run: tr('未运行', 'Not run') })[value];
  const selectedLabel = value => value ? tr('已选', 'Yes') : tr('未选', 'No');
  // Format only the three displayed metrics. Decimal strings retain their full
  // integer precision; parameters and the original evidence are never rounded.
  const metricDisplay = value => {
    if (value === null) return '—';
    if (typeof value === 'number') return value.toLocaleString(tr('zh-CN', 'en-US'), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const negative = value.startsWith('-'), [integer, fraction = ''] = value.replace(/^-/, '').split('.');
    let cents = BigInt(integer + fraction.padEnd(2, '0').slice(0, 2));
    if ((fraction[2] ?? '0') >= '5') cents += 1n;
    const digits = String(cents).padStart(3, '0');
    return `${negative && cents !== 0n ? '-' : ''}${digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${digits.slice(-2)}`;
  };

  function validate(rows, parameters, parameterLabels) {
    if (!Array.isArray(parameters) || !parameters.length || parameters.length > 32 || parameters.some(key => typeof key !== 'string' || !key) || new Set(parameters).size !== parameters.length) fail('Provide 1–32 unique parameter keys');
    if (parameterLabels !== undefined && (!parameterLabels || typeof parameterLabels !== 'object' || Array.isArray(parameterLabels) || Object.entries(parameterLabels).some(([key, label]) => !parameters.includes(key) || typeof label !== 'string' || !label.trim() || label.length > 64 || /[\u0000-\u001f\u007f]/.test(label)))) fail('Parameter labels must name declared parameters using short, nonempty single-line strings');
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


  function render(target, config) {
    if (typeof target === 'string') target = document.querySelector(target);
    if (!target) fail('A report target is required');
    const groups = validate(config.rows, config.parameters, config.parameterLabels);
    const parameterLabel = key => Object.hasOwn(config.parameterLabels ?? {}, key) ? config.parameterLabels[key] : key;
    const metrics = [['sharpe', tr('夏普', 'Sharpe'), ''], ['max_drawdown_pct', tr('最大回撤', 'Max drawdown'), '%'], ['net_profit', tr('净盈亏', 'Net profit'), config.currency]];
    const symbols = [...new Set(config.rows.map(row => row.symbol))], timeframes = [...new Set(config.rows.map(row => row.timeframe))];
    const missing = (symbol, timeframe) => ({ symbol, timeframe, sharpe: null, max_drawdown_pct: null, net_profit: null });
    reportKit.render(target, {
      title: config.title, eyebrow: config.demo ? tr('Strategy · 演示样本', 'Strategy · DEMO SAMPLE') : 'Strategy',
      verdict: { tone: 'neutral', headline: config.summary },
      sections: [
        ...(config.graph ? [{ title: tr('策略逻辑', 'Strategy logic'), takeaway: tr('信号、条件与动作来自同一策略修订。', 'Signals, conditions and actions come from the same strategy revision.'), blocks: [{ type: 'custom', render: node => SesameSvlGraph.render(node, config.graph, config.definition) }] }] :
          config.strategyEvidence ? [{ title: tr('策略说明', 'Strategy description'), takeaway: config.strategyEvidence.summary, blocks: [{ type: 'custom', render: node => {
            if (config.strategyLogicHtml) { const logic = el('div'); logic.innerHTML = config.strategyLogicHtml; node.append(logic); SesameSvlGraph.mount(logic); }
            const evidence = el('details'); evidence.setAttribute('data-report-evidence', '');
            evidence.append(el('summary', tr('原生源码与运行证据', 'Native source and run evidence')), el('p', config.strategyEvidence.engine), el('pre', JSON.stringify(config.strategyEvidence.references, null, 2), 'backtest-node')); node.append(evidence);
          } }] }] : []),
        { title: tr('品种 × 周期', 'Symbols × timeframes'), takeaway: config.selectionRule, blocks: [{ type: 'custom', render: explorer }] },
      ],
      method: { steps: [config.sourceNote], limits: [tr('热力图显示已记录的选中参数组；颜色切换不会重新选优。', 'The matrix shows recorded selected trials; changing color metrics never reselects winners.')], sources: [...(config.source ? [{ label: 'SVL', value: JSON.stringify(config.source) }] : []), { label: tr('固定数据', 'Frozen data'), value: config.dataId }] },
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
      let redrawTrials = () => {};
      function select(row, focus = true) {
        const trials = groups.get(pair(row)) ?? [];
        redrawTrials = () => {};
        reportKit.destroy(detail); SesameCharts.destroy(detail); detail.replaceChildren();
        detail.append(el('h3', `${row.symbol} · ${row.timeframe}`));
        if (!trials.length) { detail.append(el('p', tr('此组合没有回测记录。', 'No backtest was recorded for this combination.'))); return; }
        detail.append(el('p', `${tr('全部参数组', 'All parameter sets')}: ${trials.length} · ${trials[0].sample}`, 'report-source'));
        const parameter = selector(tr('分析参数', 'Parameter'), config.parameters.map(key => [key, parameterLabel(key)])), toolbar = el('div', null, 'backtest-controls');
        const trialGrid = el('section', null, 'backtest-trial-grid'); detail.append(trialGrid, toolbar); toolbar.append(parameter.label);
        const plots = el('div', null, 'backtest-sensitivity'), plotPages = el('div'); detail.append(plots, plotPages);
        detail.append(el('p', tr('每点保留完整参数组，其他参数也可能不同；不合并相同横坐标。', 'Each point retains its full parameter set; other parameters may differ. Equal x-coordinates are not averaged.'), 'report-source'));
        const exactBox = el('details'), exactRow = el('pre', '', 'backtest-node'); exactBox.setAttribute('data-report-evidence', ''); exactBox.append(el('summary', tr('完整试验记录', 'Complete trial record')), exactRow);
        const inspect = trial => { exactRow.textContent = JSON.stringify(trial, null, 2); exactBox.open = true; window.SesameAppendix?.reveal(exactBox); };
        if (config.parameters.length === 2) {
          const [xKey, yKey] = config.parameters, xValues = [], yValues = [], xSeen = new Set(), ySeen = new Set(), cells = new Map();
          let duplicate = false;
          for (const trial of trials) {
            const x = exact(trial.parameters[xKey]), y = exact(trial.parameters[yKey]), key = JSON.stringify([x, y]);
            if (cells.has(key)) duplicate = true;
            cells.set(key, trial);
            if (!xSeen.has(x)) { xSeen.add(x); xValues.push(x); }
            if (!ySeen.has(y)) { ySeen.add(y); yValues.push(y); }
          }
          trialGrid.append(el('h4', tr('全部参数试验', 'All parameter trials')));
          if (duplicate) trialGrid.append(el('p', tr('参数对存在重复或显示值相同，无法一格对应一项试验；以下逐项散点与表格保留全部记录，不平均、不合并。', 'Parameter pairs are repeated or share display values. The scatter plots and table retain every trial separately; no averaging or merging.'), 'report-source'));
          else {
            const xPage = axisPage(xValues, `${parameterLabel(xKey)} · ${tr('范围', 'range')}`), yPage = axisPage(yValues, `${parameterLabel(yKey)} · ${tr('范围', 'range')}`), pages = el('div', null, 'backtest-controls');
            if (xValues.length > 20) pages.append(xPage.label);
            if (yValues.length > 20) pages.append(yPage.label);
            const grid = el('div', null, 'sc-table-wrap'), note = el('p', tr('横轴与纵轴对应原始参数值；✓ 为原记录选中。颜色切换不重选，失败和未运行保留。', 'Axes retain original parameter values; ✓ marks the recorded selection. Color changes never reselect; failed and unrun trials remain.'), 'report-source');
            trialGrid.append(pages, grid, note);
            redrawTrials = () => {
              const [metric, name, unit] = metrics.find(item => item[0] === color.input.value);
              const max = trials.reduce((value, trial) => trial.status === 'completed' && trial[metric] !== null ? Math.max(value, Math.abs(numeric(trial[metric]))) : value, 0) || 1;
              const xs = xValues.slice(Number(xPage.input.value) * 20, (Number(xPage.input.value) + 1) * 20), ys = yValues.slice(Number(yPage.input.value) * 20, (Number(yPage.input.value) + 1) * 20);
              const table = el('table', null, 'sc-table'), caption = el('caption', `${parameterLabel(yKey)} × ${parameterLabel(xKey)} · ${name}${unit ? ` (${unit})` : ''}`), head = el('thead'), header = el('tr'), body = el('tbody');
              const corner = el('th', parameterLabel(yKey)); corner.title = `${parameterLabel(yKey)} \\ ${parameterLabel(xKey)}`; corner.style.padding = '6px'; header.append(corner);
              caption.style.textAlign = 'left';
              for (const x of xs) { const cell = el('th', x); cell.scope = 'col'; cell.style.padding = '6px'; header.append(cell); }
              head.append(header); table.append(caption, head, body);
              for (const y of ys) {
                const line = el('tr'), label = el('th', y); label.scope = 'row'; label.style.padding = '6px'; line.append(label);
                for (const x of xs) {
                  const cell = el('td'), trial = cells.get(JSON.stringify([x, y])); cell.style.padding = '6px';
                  if (!trial) { const absent = el('span', '—'); absent.title = tr('无试验记录', 'No trial recorded'); cell.append(absent); }
                  else {
                    const value = trial.status === 'completed' ? numeric(trial[metric]) : null;
                    const text = trial.status !== 'completed' ? statusLabel(trial.status) : value === null ? tr('未定义', 'Undefined') : metricDisplay(trial[metric]);
                    const button = el('button', `${text}${trial.selected ? ' ✓' : ''}`); button.type = 'button'; button.dataset.trialId = trial.trial_id; button.dataset.selected = String(trial.selected);
                    button.title = `${trial.trial_id}\n${parameterLabel(xKey)}: ${x}; ${parameterLabel(yKey)}: ${y}\n${statusLabel(trial.status)} · ${selectedLabel(trial.selected)}\n${name}: ${exact(trial[metric])}${unit ? ` ${unit}` : ''}`;
                    button.setAttribute('aria-label', `${parameterLabel(xKey)} ${x} · ${parameterLabel(yKey)} ${y} · ${text} · ${statusLabel(trial.status)} · ${selectedLabel(trial.selected)}`);
                    button.style.cssText = 'font:inherit;color:var(--report-ink);min-width:4rem;padding:.45rem .35rem;border:1px solid var(--report-line);border-radius:3px';
                    const tone = value === 0 ? 'var(--report-context)' : metric === 'net_profit' ? value < 0 ? 'var(--report-negative)' : 'var(--report-positive,var(--success,var(--report-default-success)))' : 'var(--report-accent)';
                    button.style.backgroundColor = value === null ? 'var(--report-paper)' : `color-mix(in srgb, ${tone} ${12 + 38 * Math.abs(value) / max}%, var(--report-paper))`;
                    if (trial.selected) button.style.border = '2px solid var(--report-ink)';
                    button.addEventListener('click', () => inspect(trial)); cell.append(button);
                  }
                  line.append(cell);
                }
                body.append(line);
              }
              grid.replaceChildren(table); trialGrid.dataset.metric = metric;
            };
            xPage.input.addEventListener('change', redrawTrials); yPage.input.addEventListener('change', redrawTrials); redrawTrials();
          }
        }
        const complete = trials.filter(row => row.status === 'completed');
        let plotStart = 0, plotEnd = Math.min(1000, complete.length);
        function sensitivity() {
          reportKit.destroy(plots); plots.replaceChildren();
          const key = parameter.input.value, numericAxis = complete.every(row => numericParameter(row.parameters[key]));
          for (const [metric, name, unit] of metrics) {
            const chart = el('div'); plots.append(chart);
            const rows = complete.slice(plotStart, plotEnd).map(row => ({ ...row, parameter_value: numericAxis ? row.parameters[key] : exact(row.parameters[key]) }));
            if (!rows.length) { chart.append(el('p', `${name}: ${tr('暂无成功回测。', 'No completed trial.')} `)); continue; }
            reportKit.chart(chart, { kind: 'scatter', title: `${parameterLabel(key)} → ${name}`, caption: unit || name, data: rows, x: 'parameter_value', y: metric, tone: metric === 'net_profit' ? 'signed' : 'neutral', xType: numericAxis ? 'number' : 'category', unit, onSelect: row => inspect(trials.find(trial => trial.trial_id === row.trial_id)) });
          }
        }
        parameter.input.addEventListener('change', sensitivity);
        pager(plotPages, complete.length, 1000, tr('图中试验', 'Plotted trials'), (start, end) => { plotStart = start; plotEnd = end; sensitivity(); })();
        const table = el('div', null, 'sc-table-wrap backtest-trials'), pages = el('div'); detail.append(table, pages, exactBox);
        // Separate parameter columns prevent a parameter called "status" or "net_profit" from replacing recorded evidence.
        pager(pages, trials.length, 50, tr('表中试验', 'Table trials'), (start, end) => {
          table.replaceChildren(); const grid = el('table', null, 'sc-table'), head = el('thead'), header = el('tr'), body = el('tbody');
          const labels = [tr('试验', 'Trial'), tr('状态', 'Status'), tr('选中', 'Selected'), ...config.parameters.map(parameterLabel), ...metrics.map(([, name, unit]) => unit ? `${name} (${unit})` : name)];
          labels.forEach(label => header.append(el('th', label))); head.append(header); grid.append(head, body);
          for (const [index, trial] of trials.slice(start, end).entries()) {
            const line = el('tr'), id = el('td'), button = el('button', `${tr('组合', 'Trial')} ${start + index + 1}`); button.type = 'button'; button.title = trial.trial_id; button.dataset.trialId = trial.trial_id; button.addEventListener('click', () => inspect(trial)); id.append(button); line.append(id);
            [statusLabel(trial.status), selectedLabel(trial.selected), ...config.parameters.map(key => exact(trial.parameters[key])), ...metrics.map(([key]) => metricDisplay(trial[key]))].forEach(value => line.append(el('td', value))); body.append(line);
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
      color.input.addEventListener('change', () => redrawTrials());
      matrixRender(); select(config.rows[0], false);
    }
  }
  Object.defineProperty(global, 'SesameBacktest', { value: Object.freeze({ render, validate }), configurable: false });
})(window);
