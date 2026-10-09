// Original Sesame demonstration builder. MIT. Uses only the local package.
import { readFileSync, writeFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const data = JSON.parse(read('examples/demo-data.json'));
const html = `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Evidence in view · Sesame report demo</title><style>${read('assets/editorial.css')}</style></head>
<body><main>
<div class="demo-banner">FICTIONAL DEMO · No market, account or backtest results</div>
<header class="report-header"><p class="eyebrow">Sesame / research notebook / report 1</p><h1>Evidence in view.</h1><p class="lede">A small, inspectable dataset. Five chart forms. Every mark leads back to the original value.</p></header>
<div class="metrics"><div class="metric"><strong>8</strong><span>fictional monthly observations</span></div><div class="metric"><strong>1</strong><span>missing change value, left empty</span></div><div class="metric"><strong>0</strong><span>external runtime dependencies</span></div></div>
<div class="report-toolbar"><label>View <select id="view"><option value="line">Change over time</option><option value="bar">Compare changes</option></select></label><label>Filter <input id="filter" type="search" placeholder="Month or exact value"></label><button id="theme" type="button">Dark theme</button><span id="count" class="report-source" role="status"></span></div>
<div class="report-grid">
<section class="report-panel wide"><h2>Variation, with the gap intact.</h2><p class="takeaway">March has no observation. The line breaks; it does not invent zero. Select a point or use the keyboard to locate its exact row below.</p><div id="timeline"></div></section>
<section class="report-panel"><h2>Two measures, one observation.</h2><p class="takeaway">Fictional risk (%) against change (%). This display makes no causal or predictive claim.</p><div id="scatter"></div></section>
<section class="report-panel"><h2>Read across the cells.</h2><p class="takeaway">Fictional score by group and period. A dashed cell means missing; negative values use a separate color.</p><div id="matrix"></div></section>
<section class="report-panel wide"><h2>Count the evidence.</h2><p class="takeaway">Each dot is exactly 2 fictional observations. The chart rejects fractional dots instead of rounding away records.</p><div id="units"></div></section>
<section class="report-panel wide"><h2>The values remain visible.</h2><p class="takeaway">Table cells preserve the source strings, including trailing decimal places. Filtering affects the timeline, scatter, counts and table together.</p><div id="table"></div></section>
</div>
<details><summary>Source and method</summary><p>All values were manually authored for this demonstration. They do not describe securities, clients, trades or measured performance. March change and risk are deliberately null. No imputation, currency conversion or investment calculation is performed.</p><p>SVG coordinates use JavaScript numbers; exact source text is retained in tables and tooltips. The matrix is an independent six-row example. All scripts, styles and data are included in this HTML, so this page can be reopened without a network.</p></details>
<footer class="report-footer"><p>Original Sesame components · MIT · report runtime 1.0.0</p><p class="report-source">Source: examples/demo-data.json · fictional sample · 2026-10-09</p></footer>
</main><script>${read('assets/editorial-charts.js')}</script><script>
const data=${json(data)};
function render(){
 const q=document.getElementById('filter').value.trim().toLowerCase();
 const rows=data.monthly.filter(row=>!q||Object.values(row).some(value=>String(value??'').toLowerCase().includes(q)));
 document.getElementById('count').textContent=rows.length+' / '+data.monthly.length+' rows';
 const table=SesameCharts.table('#table',rows,[{key:'month',title:'Month'},{key:'change',title:'Change (%)'},{key:'risk',title:'Risk (%)'},{key:'observations',title:'Observations'}]);
 const select=(_,index)=>table.select(index);
 SesameCharts.chart('#timeline',{kind:document.getElementById('view').value,rows,x:'month',y:'change',unit:'%',title:'Fictional monthly change',onSelect:select});
 SesameCharts.chart('#scatter',{kind:'scatter',rows,x:'risk',y:'change',unit:'%',title:'Fictional risk and change',onSelect:select});
 SesameCharts.chart('#units',{kind:'units',rows,x:'month',y:'observations',unit:'observations',unitValue:2,title:'Fictional observation count',onSelect:select});
}
SesameCharts.chart('#matrix',{kind:'matrix',rows:data.matrix,x:'period',y:'group',value:'score',unit:'score',title:'Fictional grouped scores'});
document.getElementById('filter').addEventListener('input',render);document.getElementById('view').addEventListener('change',render);
document.getElementById('theme').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.getElementById('theme').textContent=dark?'Light theme':'Dark theme';});
render();
</script></body></html>`;
writeFileSync(new URL('../examples/editorial-demo.html', import.meta.url), html);
