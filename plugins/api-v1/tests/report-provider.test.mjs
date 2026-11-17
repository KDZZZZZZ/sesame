import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Errors } from '@sesame/plugin-sdk/schema/value';
import { reportRenderInputSchema, REPORT_RENDER_OUTPUT_SCHEMA } from '@sesame/plugin-sdk/report-contract';
import { renderReport, publishReport } from '../packages/reports/report-provider.js';
import { resolveReportStyle } from '../packages/reports/report-styles.js';

// All refs and values below are synthetic contract fixtures, not research results.
const ref = (id, kind='resource') => ({id,kind,revision:'fixture-v1',digest:'sha256:'+'a'.repeat(64),schemaVersion:'1.0.0'});
const content = {kind:'document',sections:[{title:'Fixture',blocks:[{type:'paragraph',text:'Synthetic values only'}]}]};
const metadata = {title:'Fixture',summary:'Synthetic software check',locale:'en',provenanceKind:'demo',features:['interactive']};
const envelope = input => ({metadata,data:[],related:[],references:[],input});
const publishArgs = extra => ({operation_id:'fixture-op',title:metadata.title,summary:metadata.summary,provenance_kind:'demo',data:[],content,...extra});
const freeze = value => { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; };

test('a published document shows one demo label rather than duplicating renderer metadata', async () => {
  const result = await renderReport({}, envelope({ content }));
  const html = result.files.find(file => file.path === 'index.html').content;
  const labels = html.match(/<(?:p|aside)\b(?=[^>]*data-sesame-provenance="demo"|[^>]*>演示样本<)[^>]*>/g) ?? [];
  assert.equal(labels.length, 1);
  assert.match(html, /data-sesame-provenance="demo"/);
});

test('answer surface is pinned in provider output while default report output stays unchanged', async () => {
  const ordinary = await renderReport({}, envelope({ content }));
  const explicitReport = await renderReport({}, envelope({ content, target: 'report' }));
  assert.deepEqual(explicitReport, ordinary);
  assert.deepEqual(ordinary.presentation.metadata, { layout: 'unified' });
  assert.doesNotMatch(ordinary.files[0].content, /data-report-surface="answer"|data-report-answer-style/);
  const answer = await renderReport({}, envelope({ content, target: 'answer' }));
  assert.deepEqual(answer.presentation.metadata, { layout: 'unified', surface: 'answer', protocol: 'sesame-components/1' });
  assert.match(answer.files[0].content, /<html\b[^>]*data-report-surface="answer"/);
  assert.match(answer.files[0].content, /<style data-report-answer-style>/);
  assert.match(answer.files[0].content, /Synthetic values only/);
  const manifest = JSON.parse(await readFile(new URL('../packages/reports/capabilities.json', import.meta.url), 'utf8'));
  const providerSchema = manifest.capabilities.find(item => item.id === 'report_render').inputSchema;
  assert.equal(Object.hasOwn(providerSchema.properties, 'target'), false, 'target belongs only to plugin-owned input');
  assert.deepEqual(Errors(providerSchema, envelope({ content, target: 'answer' })), []);
  const nonDocument = { kind: 'signal-study', run: {} };
  assert.ok(Errors(providerSchema, envelope({ content: nonDocument, target: 'report' })).length);
  assert.ok(Errors(providerSchema, envelope({ content: nonDocument, target: 'answer' })).length);
  await assert.rejects(renderReport({}, envelope({ content: nonDocument, target: 'answer' })), /document/);
  for (const target of ['chat-html', '<script>bad</script>', { css: 'body{display:none}' }]) {
    await assert.rejects(renderReport({}, envelope({ content, target })), /target/);
  }
  for (const extra of [{ css: 'body{display:none}' }, { body_html: '<p>raw</p>' }]) {
    await assert.rejects(renderReport({}, envelope({ content, target: 'answer', ...extra })), /HTML|CSS|input/);
  }
});

test('answer target travels through the existing facade as complete provider input', async () => {
  const calls = [], host = { capabilities: { invoke: async (id, request) => {
    calls.push({ id, request });
    const rendered = await renderReport({}, envelope(request.input));
    return { type: 'result', value: { ref: ref('answer-publication', 'report'), presentation: rendered.presentation } };
  } } };
  const result = await publishReport(host, publishArgs({ target: 'answer' }));
  assert.equal(calls[0].id, 'host.reports.publish');
  assert.deepEqual(calls[0].request.input, { content, target: 'answer' });
  assert.equal(Object.hasOwn(calls[0].request, 'target'), false);
  assert.equal(result.presentation.metadata.surface, 'answer');
});

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
  const original=freeze(publishArgs({references:[source,evidence,source],artifact_id:'existing',expected_revision:'current',locale:'zh-CN',features:['interactive']}));
  const before=structuredClone(original),result=await publishReport(host,original,signal);
  assert.equal(result,receipt);assert.deepEqual(original,before);assert.equal(calls.length,1);
  const [id,input,options]=calls[0];assert.equal(id,'host.reports.publish');assert.equal(options.signal,signal);
  assert.deepEqual(input.input,{content});
  assert.deepEqual(input.references,[source,evidence]);assert.equal(input.artifactId,'existing');assert.equal(input.expectedRevision,'current');
  assert.equal(Object.hasOwn(input,'provider'),false);assert.equal(input.input.content,content);
});

test('complete inputRef is forwarded without retyping, reading or accepting an alternate provider', async () => {
  const calls=[],input_ref={ref:ref('input-json'),entry:'input.json'};
  const host={capabilities:{invoke:async(id,args)=>{calls.push({id,args});return {type:'result',value:{ref:ref('out','report')}};}},resources:{read:()=>assert.fail('Host must read inputRef')}};
  const args=publishArgs({input_ref});delete args.content;
  await publishReport(host,args);
  assert.deepEqual(calls[0].args.inputRef,input_ref);assert.equal(Object.hasOwn(calls[0].args,'input'),false);
  for(const extra of [{content},{style:{}},{target:'answer'},{target:'report'},{provider:'other/report'},{html_path:'report.html'},{body_html:'<h1>raw</h1>'}]) await assert.rejects(publishReport(host,{...args,...extra}),/input_ref|content|property|HTML|provider/i);
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

test('a visual report consumes results without parsing source programs or imposing research fields', async () => {
  const source = ref('producer-source', 'strategy.source');
  const host = { resources: { read: () => assert.fail('Producer-owned source is opaque to the visual renderer') } };
  const request = freeze({ ...envelope({ content }), references: [source] });
  const rendered = await renderReport(host, request);
  assert.match(rendered.files[0].content, /Synthetic values only/);
  for (const input of [{ content, strategy_source: source }, { content: { kind: 'backtest' } }, { content: { kind: 'modules' } }]) {
    await assert.rejects(renderReport(host, envelope(input)), /input|layout/i);
  }
});

test('old saved user token versions retain their original dimensions without offering public presets', async () => {
  const saved={base:'visual',reason:'A previously saved user request',tokens:{body_size:17}};
  const style=await resolveReportStyle({state:{read:async()=>({version:1,value:{style:saved}})}},{saved_id:'prior-user-style',saved_version:1});
  assert.equal(style.tokens.content_width,1160);assert.equal(style.tokens.body_size,17);assert.equal(style.id,'unified');
  await assert.rejects(resolveReportStyle({}, {preset:'visual'}),/style property/);
  await assert.rejects(resolveReportStyle({}, {custom:saved}),/style property/);
});

test('the documented host publication example uses the current input contract and preserves values', async () => {
  const guide=await readFile(new URL('../packages/reports/references/delivery.md',import.meta.url),'utf8');
  const args=JSON.parse(guide.match(/```json\r?\n([\s\S]*?)\r?\n```/)[1]);
  assert.equal(args.provenanceKind,'demo');assert.equal(Object.hasOwn(args.input,'style'),false);
  const original=structuredClone(args.input);
  const result=await renderReport({}, {metadata:{title:args.title,summary:args.summary,locale:args.locale,space:args.space,provenanceKind:args.provenanceKind,features:['interactive']},data:args.data,related:[],references:[],input:freeze(args.input)});
  assert.deepEqual(args.input,original);assert.match(result.files[0].content,/data-report-layout="unified"/);
});
