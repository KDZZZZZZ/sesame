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
  rows,takeaway:'Supplied values only',source_note:'Synthetic fixed input'});
const document = block => ({kind:'document',sections:[{title:'Fixture',blocks:[block]}]});
const sourceRows = [{day:-1,index:100},{day:0,index:101}];
const options = extra => ({x:'day',y:'index',...extra});
function moduleFixture(kind, definitionOptions, valueOptions, dataRows=sourceRows) {
  const rows=[{section_id:'event',field:'relative_chart',value:{rows:dataRows,takeaway:'Recorded comparison',source_note:'Synthetic fixed input',...(valueOptions===undefined?{}:{options:valueOptions})}}];
  const bytes=Buffer.from(JSON.stringify(rows));
  const host={resources:{read:async(actual,request)=>{
    assert.deepEqual(actual,ref);
    return request.part==='manifest'?{content:{format:'json-rows',path:'rows.json',provenance:{kind:'demo'}}}:{content:bytes.toString('base64'),total:bytes.length};
  }}};
  const content={kind:'modules',results_ref:ref,structure:{locale:'en',sections:[{id:'event',title:'Event comparison',fields:[{
    key:'relative_chart',label:'Relative path',type:'chart',meaning:'Recorded comparison only',
    chart:{kind,columns:['day','index'],options:definitionOptions,data_requirements:'Fixed synthetic rows',evidence_role:'descriptive'},
  }]}]}};
  return {host,request:envelope(content,[{id:'research-results',ref,usage:'Synthetic fixed results'}])};
}
const chartConfig = result => JSON.parse(result.files[0].content.match(/<script id="sesame-module-charts" type="application\/json">([\s\S]*?)<\/script>/)[1])[0];

test('provider rejects the actual invalid xType before packaging document inline or bound charts', async () => {
  for(const kind of kinds) for(const binding of [false,true]) {
    const block=chart(kind,options({xType:'linear'}),sourceRows);
    if(binding){delete block.rows;block.data_id='recorded';}
    await assert.rejects(renderReport({},envelope(document(block),binding?[{id:'recorded',ref,usage:'Fixed data'}]:[])),/xType.*time.*number.*category/,`${kind}, binding=${binding}`);
  }
});

test('provider rejects invalid module axis definitions and result-option overrides', async () => {
  for(const kind of kinds) for(const override of [false,true]) {
    const fixture=moduleFixture(kind,options({xType:override?'number':'linear'}),override?{xType:'linear'}:undefined);
    await assert.rejects(renderReport(fixture.host,fixture.request),/xType.*time.*number.*category/,`${kind}, result override=${override}`);
  }
});

test('accepted axis types and existing omitted/null inference stay unchanged through both provider paths', async () => {
  for(const xType of ['time','number','category',undefined,null]) {
    const supplied=xType===undefined?{}:{xType};
    const rows=xType==='time'?[{day:'2024-09-17',index:100},{day:'2024-09-18',index:101}]:sourceRows;
    const block=chart('line',options(supplied),rows),before=structuredClone(block);
    const result=await renderReport({},envelope(document(block)));
    assert.deepEqual(block,before,'Provider must not rewrite recorded rows or options');
    assert.equal(chartConfig(result).options.xType,xType);
    const fixture=moduleFixture('line',options(supplied),undefined,rows);
    assert.equal(chartConfig(await renderReport(fixture.host,fixture.request)).options.xType,xType);
  }
});

test('axis validation does not constrain chart kinds whose runtime ignores xType', async () => {
  for(const kind of ['heatmap','candlestick']) {
    const extra=kind==='heatmap'?{value:'index'}:{time:'day',open:'index',high:'index',low:'index',close:'index'};
    const rows=kind==='candlestick'?[{day:'2024-09-17',index:100},{day:'2024-09-18',index:101}]:sourceRows;
    const block=chart(kind,options({...extra,xType:'linear'}),rows);
    assert.equal(chartConfig(await renderReport({},envelope(document(block)))).options.xType,'linear');
    const fixture=moduleFixture(kind,options({...extra,xType:'linear'}),undefined,rows);
    assert.equal(chartConfig(await renderReport(fixture.host,fixture.request)).options.xType,'linear');
  }
});
