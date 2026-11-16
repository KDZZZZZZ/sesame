import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../packages/reports/report-provider.js';

// Small synthetic reproductions of the real R03 `xType: "linear"` failure.
// No market values, renderer receipts, or daily resources are manufactured.
const ref = {id:'axis-fixture',revision:'fixed-v1',digest:'sha256:'+'a'.repeat(64),kind:'data',schemaVersion:'1.0.0'};
const kinds = ['line','area','bar','hbar','scatter'];
const metadata = {title:'Axis contract fixture',summary:'Synthetic software test',locale:'en',provenanceKind:'demo',features:['interactive']};
const envelope = (content, data=[]) => ({metadata,data,related:[],references:[],input:{content}});
const chart = (kind, options, rows) => ({type:'chart',kind,title:'Recorded values',columns:['day','index'],options,
  rows});
const document = block => ({kind:'document',sections:[{title:'Fixture',blocks:[block]}]});
const sourceRows = [{day:-1,index:100},{day:0,index:101}];
const options = extra => ({x:'day',y:'index',...extra});
const chartConfig = result => JSON.parse(result.files[0].content.match(/<script id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1])[0];

test('provider rejects the actual invalid xType before packaging document inline or bound charts', async () => {
  for(const kind of kinds) for(const binding of [false,true]) {
    const block=chart(kind,options({xType:'linear'}),sourceRows);
    if(binding){delete block.rows;block.data_id='recorded';}
    await assert.rejects(renderReport({},envelope(document(block),binding?[{id:'recorded',ref,usage:'Fixed data'}]:[])),/xType.*time.*number.*category/,`${kind}, binding=${binding}`);
  }
});



test('accepted axis types and existing omitted/null inference stay unchanged through the provider', async () => {
  for(const xType of ['time','number','category',undefined,null]) {
    const supplied=xType===undefined?{}:{xType};
    const rows=xType==='time'?[{day:'2024-09-17',index:100},{day:'2024-09-18',index:101}]:sourceRows;
    const block=chart('line',options(supplied),rows),before=structuredClone(block);
    const result=await renderReport({},envelope(document(block)));
    assert.deepEqual(block,before,'Provider must not rewrite recorded rows or options');
    assert.equal(chartConfig(result).options.xType,xType);
  }
});

test('axis validation does not constrain chart kinds whose runtime ignores xType', async () => {
  for(const kind of ['heatmap','candlestick']) {
    const extra=kind==='heatmap'?{value:'index'}:{time:'day',open:'index',high:'index',low:'index',close:'index'};
    const rows=kind==='candlestick'?[{day:'2024-09-17',index:100},{day:'2024-09-18',index:101}]:sourceRows;
    const block=chart(kind,options({...extra,xType:'linear'}),rows);
    assert.equal(chartConfig(await renderReport({},envelope(document(block)))).options.xType,'linear');
  }
});
