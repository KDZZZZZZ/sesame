// Only declarative chart inputs reach this runtime. All drawing uses built-ins.
(() => {
  const charts = JSON.parse(document.getElementById('sesame-module-charts').textContent);
  const kit = new Set(['line','area','bar','hbar','scatter','heatmap']);
  const work = Promise.resolve().then(async () => {
    for (const chart of charts) {
      const rows = chart.rows ?? await reportKit.rows(chart.dataId, { maxRows: 2500 });
      const extra = Object.fromEntries(await Promise.all((chart.chartData??[]).map(async item=>[item.property,await reportKit.rows(item.data_id,{maxRows:2500})])));
      const evidence = document.getElementById(`${chart.id}-evidence`);
      if (evidence && (!chart.rows || chart.chartData?.length)) evidence.textContent = JSON.stringify({ data_id: chart.dataId, rows, ...(chart.nodes ? {nodes:chart.nodes} : {}), ...extra }, null, 2);
      const spec = { ...chart.options, kind: chart.kind, title: chart.title, caption: chart.caption };
      const target = document.getElementById(chart.id);
      if (kit.has(chart.kind)) {
        const figure = reportKit.chart(target, { ...spec, data: rows });
        // The document owns the visible caption. Keep title/caption in the
        // built-in model so its SVG remains named, including after resize.
        figure.querySelector(':scope > figcaption')?.remove();
      }
      else SesameCharts.chart(target, { ...spec, rows, ...(chart.nodes ? { nodes: chart.nodes } : {}), ...extra });
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  if (window.report?.track) window.report.track(work).catch(() => {});
  else work.catch(error => console.error(error));
  window.addEventListener('pagehide', () => { reportKit.destroy(document.querySelector('main')); SesameCharts.destroy(document.querySelector('main')); });
})();
