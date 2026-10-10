// Original Sesame reportKit layout with optional, independently written unit charts. MIT.
import { readFileSync, writeFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const data = JSON.parse(read('examples/demo-data.json'));
const html = `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>A recovery with uneven evidence · Sesame report demo</title><style>${read('assets/editorial.css')}</style></head>
<body><nav class="demo-controls" aria-label="Demo controls"><button id="theme" type="button">Dark theme</button></nav><main id="report"></main>
<script>${read('assets/report-kit.js')}</script><script>${read('assets/editorial-charts.js')}</script><script>
const data=${json(data)};
const rows=data.monthly, observed=rows.filter(row=>row.change!==null), positive=observed.filter(row=>Number(row.change)>0), negative=observed.filter(row=>Number(row.change)<0);
const outline={
 title:'A recovery with uneven evidence.',eyebrow:'FICTIONAL DEMO · Research',subtitle:'Eight invented observations test how a report explains variation and preserves the missing data.',
 meta:[{label:'Period',value:'Jan–Aug'},{label:'Measure',value:'Change (%)'},{label:'Source',value:'Authored demo sample'}],
 verdict:{tone:'caution',headline:'Positive months outnumber negative months, but March is unobserved.',detail:'Five of the seven observed changes are positive. The missing month prevents a complete reading of the period; this is a demonstration, not a market finding.'},
 metrics:[{label:'Observed months',value:observed.length,format:'integer',hint:'Out of eight in the sample'},{label:'Positive changes',value:positive.length,format:'integer',tone:'positive'},{label:'Negative changes',value:negative.length,format:'integer',tone:'negative'},{label:'Missing month',value:rows.length-observed.length,format:'integer',tone:'caution'}],
 sections:[
  {title:'The pattern over time',takeaway:'April has the largest observed increase; June has the largest decrease.',blocks:[
   {type:'chart',kind:'line',title:'Monthly change',caption:'Percentage points · March remains a gap',data:rows,x:'month',y:'change',unit:'%',baseline:0,labels:{change:'Change'}},
   {type:'findings',items:[{tone:'neutral',claim:'The two largest moves have opposite signs.',evidence:[{label:'April',value:rows.find(row=>row.month==='Apr').change,unit:'%'},{label:'June',value:rows.find(row=>row.month==='Jun').change,unit:'%'}],caveat:'Each month is one fictional observation, not an estimate of future behavior.'}]}
  ]},
  {title:'The size of the evidence',takeaway:'The observations behind each month are uneven. Compare their counts before reading a pattern into the changes.',blocks:[
   {type:'custom',render(el){
    const control=document.createElement('div');control.className='report-toolbar';
    control.innerHTML='<label>View <select id="view"><option value="units">Count the observations</option><option value="bar">Compare monthly changes</option></select></label><label>Filter <input id="filter" type="search" placeholder="Month or exact value"></label><span id="count" class="report-source" role="status"></span>';
    const plot=document.createElement('div');plot.id='units';
    const caption=document.createElement('p');caption.className='report-caption';caption.id='units-note';
    const detail=document.createElement('details');detail.className='report-inspect';const summary=document.createElement('summary');summary.textContent='Inspect the values';detail.append(summary);
    const tableHost=document.createElement('div');tableHost.id='table';detail.append(tableHost);el.append(control,plot,caption,detail);
    function render(){
     const q=document.getElementById('filter').value.trim().toLowerCase(),visible=rows.filter(row=>!q||Object.values(row).some(value=>String(value??'').toLowerCase().includes(q)));
     document.getElementById('count').textContent=visible.length+' / '+rows.length+' rows';
     const table=SesameCharts.table(tableHost,visible,[{key:'month',title:'Month'},{key:'change',title:'Change (%)'},{key:'observations',title:'Observations'}]);
     const units=document.getElementById('view').value==='units';
     SesameCharts.chart(plot,{kind:units?'units':'bar',rows:visible,x:'month',y:units?'observations':'change',unit:units?'observations':'%',unitValue:2,title:units?'Observations by month':'Monthly change',onSelect:(_,index)=>{detail.open=true;table.select(index);}});
     caption.textContent=units?'Each dot is exactly 2 observations. Select a dot to inspect its source row.':'Bars use a zero baseline. Negative changes keep their negative sign.';
    }
    document.getElementById('filter').addEventListener('input',render);document.getElementById('view').addEventListener('change',render);render();
   }}
  ]}
 ],
 method:{steps:['The source JSON was manually authored for this demonstration. Counts above are derived from these rows; no investment calculation was performed.','The first chart uses the original Sesame reportKit. The second is an optional unit chart with selectable marks and exact-value inspection.'],limits:['No securities, accounts, trading results or measured performance are represented.','March change is null; no zero, interpolation or inferred return is substituted.'],sources:[{label:'Dataset',value:'examples/demo-data.json · provenance: demo'},{label:'Display',value:'SVG coordinates use Number; source strings are retained in the inspection table.'}]}
};
reportKit.render('#report',outline);
document.getElementById('theme').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.getElementById('theme').textContent=dark?'Light theme':'Dark theme';});
</script></body></html>`;
writeFileSync(new URL('../examples/editorial-demo.html', import.meta.url), html);
