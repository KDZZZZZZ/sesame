// Reproducible, offline showcase of independent Sesame components. MIT.
import { readFileSync, writeFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const groups = ['statistical', 'temporal', 'structural'].map(group => ({ group, ...JSON.parse(read(`examples/${group}-fixtures.json`)) }));
if (groups.some(group => group.provenance.kind !== 'demo')) throw new Error('Gallery inputs must be explicitly fictional demo data');
const charts = groups.flatMap(group => group.charts.map(chart => ({ ...chart, family: group.group })));
const assets = ['report-kit.js', 'editorial-charts.js', 'charts-statistics.js', 'charts-temporal.js', 'charts-structure.js'];
const html = `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>A chart for each question · Sesame</title><style>${read('assets/editorial.css')}
.gallery-controls{max-width:880px;margin:0 auto 28px;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}.gallery-controls label{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.gallery-controls select{max-width:100%;font-size:13px}.gallery-picked{margin:12px 0;color:var(--report-muted);font-size:12px}.gallery-plot{min-width:0}
@media(max-width:500px){.gallery-controls label{width:100%}.gallery-controls select{width:100%;min-width:0}}
</style></head><body>
<nav class="gallery-controls" aria-label="Chart gallery controls"><label>Explore a question <select id="chart-choice"></select></label><button id="theme" type="button">Dark theme</button></nav><main id="report"></main>
${assets.map(name => `<script>${read(`assets/${name}`)}</script>`).join('\n')}
<script>
const examples=${json(charts)}, choice=document.getElementById('chart-choice');
for(const entry of examples){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.title;choice.append(option);}
function render(){
 const entry=examples.find(item=>item.id===choice.value),rows=entry.spec.rows;
 reportKit.render('#report',{
  title:entry.title,eyebrow:'FICTIONAL DEMO · Sesame chart collection',
  subtitle:'An interactive example of a reusable report component. All values are invented samples.',
  meta:[{label:'Chart',value:entry.spec.kind},{label:'Source',value:'Explicit demo fixture'},{label:'Collection',value:examples.length+' optional views'}],
  verdict:{tone:'neutral',headline:entry.caption.replace(/^FICTIONAL DEMO[ ·:—-]*/, '')},
  sections:[{title:'Explore the evidence',takeaway:'Select a mark to inspect its exact source row. Use Tab and Enter for keyboard inspection.',blocks:[{type:'custom',render(el){
   const plot=document.createElement('div');plot.id='gallery-plot';plot.className='gallery-plot';el.append(plot);
   const picked=document.createElement('p');picked.className='gallery-picked';picked.id='selection-status';picked.setAttribute('role','status');el.append(picked);
   const details=document.createElement('details');details.className='report-inspect';details.id='inspection';const summary=document.createElement('summary');summary.textContent='Inspect the source rows';details.append(summary);
   const tableHost=document.createElement('div');tableHost.id='source-table';details.append(tableHost);el.append(details);
   const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];let visible=rows,table=SesameCharts.table(tableHost,visible,columns);
   const extra=document.createElement('div');extra.id='selected-external-row';extra.hidden=true;details.append(extra);
   SesameCharts.chart(plot,{...entry.spec,onSelect:(row,index)=>{
    details.open=true;picked.textContent=index>=0?'Selected source row '+(index+1):'Selected record from the fixed node data';
    if(index>=0&&visible.includes(row)){extra.hidden=true;table.select(visible.indexOf(row));}
    else{extra.hidden=false;table.select(-1);SesameCharts.table(extra,[row],Object.keys(row));}
   },onFilter:(filtered,indices)=>{visible=filtered;table=SesameCharts.table(tableHost,visible,columns);picked.textContent=filtered.length+' / '+rows.length+' source rows match the visible filters';extra.hidden=true;}});
  }}]}],
  method:{steps:['Every chart uses the same report typography and palette. Components draw supplied values and preserve source rows.','The sample is fictional; histogram, quartile and density values are authored fixtures, not financial calculations or evidence.'],limits:['Layout distances in relationship diagrams do not encode correlation or causality.','Do not copy demo results into market research. Register actual observations and derived calculations before reporting.'],sources:[{label:'Fixture',value:'examples/'+entry.family+'-fixtures.json'},{label:'Origin',value:'demo'}]}
 });
 document.documentElement.dataset.chart=entry.spec.kind;
}
choice.addEventListener('change',render);
document.getElementById('theme').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.getElementById('theme').textContent=dark?'Light theme':'Dark theme';});
render();
</script></body></html>`;
writeFileSync(new URL('../examples/chart-gallery.html', import.meta.url), html);
console.log(`Built ${charts.length} interactive chart examples (${Buffer.byteLength(html)} bytes)`);
