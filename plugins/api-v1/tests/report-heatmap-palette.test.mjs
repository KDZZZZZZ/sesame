import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderStructuredReport } from '../packages/reports/report-content.js';

const host = process.env.SESAME_HOST_ROOT;
// Synthetic presentation fixtures only: no market values, app or account access.
const fixtures = [
  [{x:'A',y:'positive',value:1},{x:'B',y:'positive',value:2},{x:'C',y:'positive',value:3}],
  [{x:'A',y:'mixed',value:-2},{x:'B',y:'mixed',value:0},{x:'C',y:'mixed',value:2},{x:'D',y:'mixed',value:null},{x:'A',y:'sparse',value:'1.2500000000000'}],
  [{x:'A',y:'negative',value:-3},{x:'B',y:'negative',value:-1}],
  [{x:'A',y:'missing',value:null}],
];
const signedRows = [{label:'negative',value:-2},{label:'zero',value:0},{label:'positive',value:3}];
const mix = (color, base, percent) => color.map((v,i) => Math.round(v*percent/100+base[i]*(1-percent/100))).concat(255);
const near = (actual, expected, label) => assert.ok(actual.every((v,i)=>Math.abs(v-expected[i])<=1), `${label}: ${JSON.stringify(actual)} versus ${JSON.stringify(expected)}`);

test('heatmaps and signed bars follow report roles and custom/dark tokens without changing scales, missingness or source rows', { skip: !host, timeout: 60000 }, async t => {
  const { chromium } = createRequire(join(host,'package.json'))('playwright');
  const browser=await chromium.launch({headless:true}); t.after(()=>browser.close());
  const errors=[];
  const variants=[
    {name:'default',style:undefined,light:{accent:[51,78,172],context:[52,52,52]},dark:{accent:[155,179,255],context:[228,228,231]}},
    {name:'user-custom',style:{custom:{reason:'Synthetic user-specified color test',tokens:{accent:'#8057c2',context:'#5f7770',accent_dark:'#d6b3ff',context_dark:'#acb9b4'}}},light:{accent:[128,87,194],context:[95,119,112]},dark:{accent:[214,179,255],context:[172,185,180]}},
  ];
  for(const variant of variants){
    const page=await browser.newPage({viewport:{width:720,height:900}});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    const blocks=[...fixtures.map((rows,i)=>({type:'chart',kind:'heatmap',title:`Fixture ${i+1}`,columns:['x','y','value'],options:{x:'x',y:'y',value:'value'},rows,takeaway:'Only supplied values and explicit gaps',source_note:'Synthetic fixture; not research evidence'})),...['bar','hbar'].map(kind=>({type:'chart',kind,title:`Signed ${kind}`,columns:['label','value'],options:{x:'label',y:'value',tone:'signed'},rows:signedRows,takeaway:'Original signed values',source_note:'Synthetic fixture only'}))];
    const input={title:'Synthetic report color fixture',summary:'Software presentation checks only',locale:'en',provenance_kind:'demo',data:[],...(variant.style?{style:variant.style}:{}),content:{kind:'document',sections:[{title:'Supplied cells and signed bars',blocks}]}};
    const original=structuredClone(input),html=await renderStructuredReport({},input);
    assert.deepEqual(input,original);
    await page.setContent(html);
    await page.waitForSelector('#content-chart-4 .kit-cell');
    await page.evaluate(()=>{window.initialHeatmapSVGs=[...document.querySelectorAll('.module-chart-plot svg')];});
    let geometry;
    for(const theme of ['light','dark']){
      await page.emulateMedia({colorScheme:theme});
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      const result=await page.evaluate(()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
        const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
        const plots=[...document.querySelectorAll('.module-chart-plot')];
        return {fills:plots.map(plot=>[...plot.querySelectorAll('.kit-cell')].map(cell=>rgba(getComputedStyle(cell).fill))),bars:plots.slice(4).map(plot=>[...plot.querySelectorAll('.kit-bar')].map(bar=>({color:rgba(getComputedStyle(bar).fill)}))),barLabels:plots.slice(4).map(plot=>[...plot.querySelectorAll('.kit-value')].map(label=>label.textContent)),geometry:plots.map(plot=>({viewBox:plot.querySelector('svg').getAttribute('viewBox'),cells:[...plot.querySelectorAll('.kit-cell,.kit-bar')].map(cell=>['x','y','width','height'].map(key=>cell.getAttribute(key)))})),rows:JSON.parse(document.getElementById('sesame-module-charts').textContent).map(chart=>chart.rows),sameSVGs:plots.every((plot,i)=>plot.querySelector('svg')===initialHeatmapSVGs[i])};
      });
      const base=theme==='dark'?[21,21,25]:[250,250,250],neutral=(theme==='dark'?[18,18,21]:[250,250,250]).concat(255),roles=variant[theme];
      assert.deepEqual(result.rows,[...fixtures,signedRows,signedRows]);assert.equal(result.sameSVGs,true);
      if(geometry)assert.deepEqual(result.geometry,geometry,'Theme changes only colors');else geometry=result.geometry;
      assert.deepEqual(result.fills.map(cells=>cells.length),[3,8,2,1,0,0]);
      [12,36,60].forEach((percent,i)=>near(result.fills[0][i],mix(roles.accent,base,percent),`${variant.name}/${theme} positive ${i}`));
      near(result.fills[1][0],mix(roles.context,base,60),`${variant.name}/${theme} negative branch`);
      near(result.fills[1][1],mix(roles.accent,base,12),`${variant.name}/${theme} zero`);
      near(result.fills[1][2],mix(roles.accent,base,60),`${variant.name}/${theme} positive branch`);
      near(result.fills[1][3],neutral,`${variant.name}/${theme} explicit missing`);
      for(const i of [5,6,7])near(result.fills[1][i],neutral,`${variant.name}/${theme} absent cell ${i}`);
      [12,60].forEach((percent,i)=>near(result.fills[2][i],mix(roles.context,base,percent),`${variant.name}/${theme} negative-only ${i}`));
      near(result.fills[3][0],neutral,`${variant.name}/${theme} all missing`);
      for(const [index,bars] of result.bars.entries()){
        assert.equal(bars.length,3);
        near(bars[0].color,(theme==='dark'?[255,122,143]:[178,67,67]).concat(255),`${variant.name}/${theme} signed ${index} negative`);
        near(bars[1].color,(theme==='dark'?[161,161,170]:[98,98,98]).concat(255),`${variant.name}/${theme} signed ${index} zero`);
        for(const bar of bars.slice(2))near(bar.color,(theme==='dark'?[95,227,169]:[36,115,74]).concat(255),`${variant.name}/${theme} signed ${index} nonnegative`);
        assert.deepEqual(result.barLabels[index],['-2','0','3'],'Visible labels retain signed values');
      }
      if(process.env.SESAME_HEATMAP_SCREENSHOTS){await mkdir(process.env.SESAME_HEATMAP_SCREENSHOTS,{recursive:true});await page.locator('#content-chart-2').screenshot({path:join(process.env.SESAME_HEATMAP_SCREENSHOTS,`heatmap-${variant.name}-${theme}.png`)});}
    }
    for(const id of ['content-chart-5','content-chart-6']){
      await page.locator(`#${id} .kit-bar`).first().hover();
      assert.match(await page.locator(`#${id} .kit-tooltip`).innerText(),/-2/,'Hover retains the original negative value');
    }
    await page.locator('#content-chart-2 .kit-cell').nth(3).hover();
    assert.match(await page.locator('#content-chart-2 .kit-tooltip').innerText(),/—/,'Missing cells never become zero');
    await page.locator('#content-chart-2 .kit-cell').nth(4).hover();
    assert.match(await page.locator('#content-chart-2 .kit-tooltip').innerText(),/1\.2500000000000/,'Original precision remains in the hover readout');
    await page.close();
  }
  assert.deepEqual(errors,[]);
});
