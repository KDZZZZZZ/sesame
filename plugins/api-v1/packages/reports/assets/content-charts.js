// Only declarative chart inputs reach this runtime. All drawing uses built-ins.
(() => {
  const charts = JSON.parse(document.getElementById('sesame-module-charts').textContent);
  const kit = new Set(['line','area','bar','hbar','scatter','heatmap']);
  const work = Promise.resolve().then(async () => {
    for (const chart of charts) {
      const rows = chart.rows ?? await reportKit.rows(chart.dataId, { maxRows: 2500 });
      const extra = Object.fromEntries(await Promise.all((chart.chartData??[]).map(async item=>[item.property,await reportKit.rows(item.data_id,{maxRows:2500})])));
      const target = document.getElementById(chart.id);
      const interactions = window.SesameReportInteractions;
      const draw = () => {
        reportKit.destroy(target); SesameCharts.destroy(target); target.replaceChildren();
        const selected = interactions ? interactions.filter(rows, chart.filter, chart.scope) : rows;
        const options = interactions ? interactions.options(chart.options, chart.optionControls, chart.scope) : chart.options;
        const spec = { ...options, kind: chart.kind, title: chart.title };
        if (!selected.length) { const empty = document.createElement('p'); empty.textContent = /^zh/i.test(document.documentElement.lang) ? '没有匹配的数据' : 'No matching data'; target.append(empty); return; }
        if (kit.has(chart.kind)) {
          const figure = reportKit.chart(target, { ...spec, data: selected });
          // The document owns visible prose; retain accessible chart naming.
          figure.querySelector(':scope > figcaption')?.remove();
        }
        else SesameCharts.chart(target, { ...spec, rows: selected, ...(chart.nodes ? { nodes: chart.nodes } : {}), ...extra });
      };
      draw();
      if (chart.scope) interactions.subscribe(chart.scope, () => {
        const work = Promise.resolve().then(draw).then(() => new Promise(resolve => requestAnimationFrame(resolve)));
        if (window.report?.track) window.report.track(work).catch(() => {}); else work.catch(error => console.error(error));
      });
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  if (window.report?.track) window.report.track(work).catch(() => {});
  else work.catch(error => console.error(error));
  window.addEventListener('pagehide', () => { reportKit.destroy(document.querySelector('main')); SesameCharts.destroy(document.querySelector('main')); });
})();
