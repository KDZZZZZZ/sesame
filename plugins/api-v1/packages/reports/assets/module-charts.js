// Render already-bound chart rows through Sesame's existing visual components.
(function () {
  const config = JSON.parse(document.getElementById('sesame-module-charts').textContent);
  const zh = /^zh/i.test(document.documentElement.lang);
  const kit = new Set(['line', 'area', 'bar', 'hbar', 'scatter', 'heatmap']);
  const handles = [];
  const work = Promise.resolve().then(async () => {
    const errors = [];
    for (const entry of config) {
      const plot = document.getElementById(entry.id);
      const details = document.getElementById(`${entry.id}-details`);
      const table = details.querySelector('.module-chart-table');
      const selectedRow = document.createElement('div');
      selectedRow.className = 'module-chart-table'; selectedRow.hidden = true; details.append(selectedRow);
      let grid;
      const ensureTable = () => grid ??= SesameCharts.table(table, entry.rows, entry.columns);
      details.addEventListener('toggle', () => { if (details.open) ensureTable(); });
      const select = row => {
        const index = entry.rows.indexOf(row);
        details.open = true;
        selectedRow.hidden = index >= 0;
        ensureTable().select(index);
        if (index < 0) SesameCharts.table(selectedRow, [row], Object.keys(row));
        window.SesameAppendix?.reveal(details);
      };
      const draw = () => {
        if (plot.dataset.chartStatus) return;
        try {
          const spec = { ...entry.options, kind: entry.kind, title: entry.title, caption: entry.caption, onSelect: select };
          const handle = kit.has(entry.kind)
            ? reportKit.chart(plot, { ...spec, data: entry.rows })
            : SesameCharts.chart(plot, { ...spec, rows: entry.rows, ...(entry.nodes ? { nodes: entry.nodes } : {}) });
          if (handle?.destroy) handles.push(handle);
          plot.dataset.chartStatus = 'ready';
        } catch (error) {
          plot.dataset.chartStatus = 'error';
          plot.classList.add('status-error');
          plot.textContent = `${zh ? '图表数据需要修正：' : 'Chart data needs correction: '}${error.message}`;
          errors.push(error);
        }
      };
      const folded = plot.closest('details.module-field');
      if (folded && !folded.open) folded.addEventListener('toggle', () => { if (folded.open) draw(); });
      else draw();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (errors.length) throw new Error(errors.map(error => error.message).join('; '));
  });
  if (window.report?.track) window.report.track(work).catch(() => {});
  else work.catch(error => console.error(error));
  window.addEventListener('pagehide', () => { for (const handle of handles) handle.destroy(); reportKit.destroy(document.querySelector('main')); });
})();
