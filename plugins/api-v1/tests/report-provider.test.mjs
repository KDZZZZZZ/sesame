import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { graph as sourceGraph } from '@sesame/plugin-sdk/svl';
import { reportRenderInputSchema, REPORT_RENDER_OUTPUT_SCHEMA } from '@sesame/plugin-sdk/report-contract';
import { renderReport, publishReport } from '../packages/reports/report-provider.js';
import { buildBacktestReport } from '../packages/reports/backtest-template.js';
import { resolveReportStyle } from '../packages/reports/report-styles.js';

// All refs and values below are synthetic contract fixtures, not research results.
const ref = (id, kind='resource') => ({id,kind,revision:'fixture-v1',digest:'sha256:'+'a'.repeat(64),schemaVersion:'1.0.0'});
const content = {kind:'document',sections:[{title:'Fixture',blocks:[{type:'paragraph',text:'Synthetic values only'}]}]};
const metadata = {title:'Fixture',summary:'Synthetic software check',locale:'en',provenanceKind:'demo',features:['interactive']};
const envelope = input => ({metadata,data:[],related:[],references:[],input});
const publishArgs = extra => ({operation_id:'fixture-op',title:metadata.title,summary:metadata.summary,provenance_kind:'demo',data:[],content,...extra});
const freeze = value => { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; };

test('Report declares a host-only immediate provider with plugin-owned recursive content schema', async () => {
  const c=JSON.parse(await readFile(new URL('../packages/reports/capabilities.json',import.meta.url),'utf8'));
  const provider=c.capabilities.find(item=>item.id==='report_render');
  assert.deepEqual(c.services,[{id:'report',contract:'sesame.report/1',consumer:'host',configSchema:{type:'object',properties:{},additionalProperties:false},operations:{render:'report_render'}}]);
  assert.deepEqual(provider.consumers,['host']);assert.equal(provider.execution,'immediate');
  assert.notEqual(provider.resultRetention,'summary','full internal result supports interrupted host publication recovery');
  assert.deepEqual(provider.inputSchema,reportRenderInputSchema(provider.inputSchema.properties.input));
  assert.deepEqual(provider.outputSchema,REPORT_RENDER_OUTPUT_SCHEMA);
  assert.match(provider.inputSchema.properties.input.$id,/^urn:/);
  assert.ok(provider.inputSchema.properties.input.$defs.block.oneOf.some(item=>item.properties.type.const==='group'));
  for(const cap of c.capabilities){const style=cap.inputSchema?.properties?.style;if(style&&cap.id!=='report_style_save')assert.deepEqual(Object.keys(style.properties).sort(),['custom','saved_id','saved_version']);}
});

test('publication facade delegates unchanged content and fixed evidence to the host-selected provider', async () => {
  const calls=[],receipt={ref:ref('published','report'),renderStatus:'not_checked'},signal=new AbortController().signal;
  const host={capabilities:{invoke:async(...args)=>{calls.push(args);return {type:'result',value:receipt};}},resources:{publish:()=>assert.fail('Provider cannot publish report resources')}};
  const source=ref('actual-svl','strategy.source'),evidence=ref('actual-native-run');
  const original=freeze(publishArgs({strategy_source:source,strategy_evidence:{engine:'synthetic-engine',summary:'Recorded fixture',references:[evidence]},references:[source],artifact_id:'existing',expected_revision:'current',locale:'zh-CN',features:['interactive','strategy_details']}));
  const before=structuredClone(original),result=await publishReport(host,original,signal);
  assert.equal(result,receipt);assert.deepEqual(original,before);assert.equal(calls.length,1);
  const [id,input,options]=calls[0];assert.equal(id,'host.reports.publish');assert.equal(options.signal,signal);
  assert.deepEqual(input.input,{content, strategy_source:source,strategy_evidence:original.strategy_evidence});
  assert.deepEqual(input.references,[source,evidence]);assert.equal(input.artifactId,'existing');assert.equal(input.expectedRevision,'current');
  assert.equal(Object.hasOwn(input,'provider'),false);assert.equal(input.input.content,content);
});

test('complete inputRef is forwarded without retyping, reading or accepting an alternate provider', async () => {
  const calls=[],input_ref={ref:ref('input-json'),entry:'input.json'};
  const host={capabilities:{invoke:async(id,args)=>{calls.push({id,args});return {type:'result',value:{ref:ref('out','report')}};}},resources:{read:()=>assert.fail('Host must read inputRef')}};
  const args=publishArgs({input_ref});delete args.content;
  await publishReport(host,args);
  assert.deepEqual(calls[0].args.inputRef,input_ref);assert.equal(Object.hasOwn(calls[0].args,'input'),false);
  for(const extra of [{content},{style:{}},{provider:'other/report'},{html_path:'report.html'},{body_html:'<h1>raw</h1>'}]) await assert.rejects(publishReport(host,{...args,...extra}),/input_ref|content|property|HTML|provider/i);
  assert.equal(calls.length,1);
  await assert.rejects(publishReport({capabilities:{invoke:async()=>({type:'job',job:{}})}},args),/immediate/);
});

test('fixed inert attachments preserve bytes and reject changed refs or media before loading content', async () => {
  const attachment=ref('fixed-json'),bytes=Buffer.from('{"value":"9007199254740993.00001","missing":null,"text":"<script>not executable</script>"}');
  const reads=[];let mediaType='application/json';
  const host={resources:{read:async(actual,request)=>{reads.push(request);assert.deepEqual(actual,attachment);return request.part==='manifest'?{blobs:[{path:'original.json',mediaType}]}:{content:bytes.toString('base64'),total:bytes.length};},publish:()=>assert.fail('No provider publication')}};
  const input={content,assets:[{path:'evidence/original.json',ref:attachment,entry:'original.json',media_type:'application/json'}]};
  const request=freeze({...envelope(input),references:[attachment]});
  const result=await renderReport(host,request);
  assert.deepEqual(Buffer.from(result.files[1].content,result.files[1].encoding),bytes);assert.equal(result.presentation.id,'sesame/reports');assert.equal(Object.hasOwn(result,'ref'),false);
  const count=reads.length;
  await assert.rejects(renderReport(host,{...request,references:[{...attachment,revision:'changed'}]}),/declared/);assert.equal(reads.length,count);
  mediaType='text/html';await assert.rejects(renderReport(host,request),/media type/);assert.equal(reads.filter(item=>item.part==='content').length,1);
  for(const path of ['../bad.json','INDEX.HTML','sesame-report-input.json','x.js']) await assert.rejects(renderReport(host,{...request,input:{...input,assets:[{...input.assets[0],path}]}}),/safe|unique|extension/);
});

const nativeArgs=extra=>({title:'Native fixture',summary:'Recorded synthetic trial matrix',data_id:'trials',parameters:['period'],selection_rule:'Recorded development selection; never recomputed',source_note:'Synthetic engine fixture',currency:'USD',strategy_evidence:{engine:'native-fixture',summary:'Actual fixture source and run evidence',references:[ref('native-evidence')]},references:[ref('native-evidence')],...extra});
test('native backtest input renders the same explorer without inventing SVL source or graph', async () => {
  const reads=[],host={resources:{read:async(actual,request)=>{reads.push({actual,request});assert.equal(request.part,'manifest');return {content:{}};}}};
  const args=freeze(nativeArgs()),before=structuredClone(args),result=await buildBacktestReport(host,args);
  assert.deepEqual(args,before);assert.equal(result.graph,undefined);
  const config=JSON.parse(result.html.match(/const config = (.+);\nasync function initialize/)[1]);
  assert.deepEqual(config.strategyEvidence,args.strategy_evidence);assert.equal(Object.hasOwn(config,'graph'),false);assert.equal(Object.hasOwn(config,'source'),false);
  assert.equal(config.dataId,'trials');assert.deepEqual(config.parameters,['period']);
  assert.equal(reads.length,1);
  await assert.rejects(buildBacktestReport(host,{...args,references:[]}),/declared/);
  await assert.rejects(buildBacktestReport(host,{...args,strategy_evidence:undefined}),/SVL|native strategy_evidence/);
  await assert.rejects(buildBacktestReport(host,{...args,parameters:[]}),/recorded parameter/);
});

test('actual SVL source retains same-source graph digest validation', async () => {
  const source=JSON.parse(await readFile(new URL('../packages/strategy-authoring/examples/close-threshold.svl.json',import.meta.url),'utf8'));
  const graph=sourceGraph(source),sourceRef=ref('svl','strategy.source'),bytes=Buffer.from(JSON.stringify(source));let sourceDigest=graph.sourceDigest;
  const host={resources:{read:async(actual,request)=>{assert.deepEqual(actual,sourceRef);return request.part==='manifest'?{content:{sourcePath:'source.json',sourceDigest},blobs:[{path:'source.json'}]}:{content:bytes.toString('base64'),total:bytes.length};}}};
  const args=nativeArgs({strategy_source:sourceRef,strategy_evidence:undefined,references:[sourceRef]});
  assert.equal((await buildBacktestReport(host,args)).graph.sourceDigest,graph.sourceDigest);
  sourceDigest='sha256:'+'b'.repeat(64);await assert.rejects(buildBacktestReport(host,args),/must match/);
});

test('old saved user token versions retain their original dimensions without offering public presets', async () => {
  const saved={base:'visual',reason:'A previously saved user request',tokens:{body_size:17}};
  const style=await resolveReportStyle({state:{read:async()=>({version:1,value:{style:saved}})}},{saved_id:'prior-user-style',saved_version:1});
  assert.equal(style.tokens.content_width,1160);assert.equal(style.tokens.body_size,17);assert.equal(style.id,'unified');
  await assert.rejects(resolveReportStyle({}, {preset:'visual'}),/style property/);
  await assert.rejects(resolveReportStyle({}, {custom:saved}),/style property/);
});

test('the documented host publication example uses the current input contract and preserves values', async () => {
  const guide=await readFile(new URL('../packages/reports/skills/report-design/style-guide.md',import.meta.url),'utf8');
  const args=JSON.parse(guide.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(args.provenanceKind,'demo');assert.equal(Object.hasOwn(args.input,'style'),false);
  const original=structuredClone(args.input);
  const result=await renderReport({}, {metadata:{title:args.title,summary:args.summary,locale:args.locale,space:args.space,provenanceKind:args.provenanceKind,features:['interactive']},data:args.data,related:[],references:[],input:freeze(args.input)});
  assert.deepEqual(args.input,original);assert.match(result.files[0].content,/data-report-layout="unified"/);
});
