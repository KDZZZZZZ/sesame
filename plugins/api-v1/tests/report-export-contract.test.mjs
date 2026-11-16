import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCapabilities } from '../packages/reports/index.js';
import { renderReport, publishReport } from '../packages/reports/report-provider.js';
import { reportExportAdvice } from '../packages/reports/shared/report-export-contract.js';

const ref = { id: 'report', revision: 'fixed-revision', digest: `sha256:${'a'.repeat(64)}`, kind: 'report', schemaVersion: '1.0.0' };

test('provider uses unified structured content without writing previews or fabricating chart inputs', async () => {
  const signal=new AbortController().signal;
  const host={capabilities:{invoke:()=>assert.fail('Rendering does not publish or write workspace files')}};
  const content={kind:'document',sections:[{title:'Supplied evidence',blocks:[{type:'paragraph',text:'Actual evidence {{TITLE}} <script>literal text</script>'},{type:'details',title:'Inspect',blocks:[{type:'paragraph',text:'Verified detail'}]}]}]};
  const envelope={metadata:{title:'</title><script>bad()</script>',locale:'zh-CN',summary:'',provenanceKind:'derived',features:[]},data:[],related:[],references:[],input:{content}};
  const result=await renderReport(host,envelope,signal);
  const html=result.files[0].content;
  assert.match(html,/data-sesame-report-template="report\/1"/);assert.match(html,/lang="zh-CN"/);assert.match(html,/data-report-layout="unified"/);
  assert.match(html,/Actual evidence \{\{TITLE\}\} &lt;script&gt;literal text/);assert.doesNotMatch(html,/<script>bad\(\)|<script>literal text/);
  assert.ok(html.includes(await readFile(new URL('../packages/reports/assets/editorial.css',import.meta.url),'utf8')));
  assert.equal(result.entry,'index.html');assert.equal(Object.hasOwn(result,'ref'),false);
  await assert.rejects(renderReport(host,{...envelope,input:{body_html:'<h1>uploaded</h1>'}}),/HTML.*disabled/);
});

test('publication facade returns host export advice without inventing rendered or verified output', async () => {
  const answer={ref,renderStatus:'not_checked',exportability:{checked:'source',outputVerified:false,candidateFormats:['png'],formats:{pdf:{status:'unsupported'}}}},calls=[];
  const host={views:{inspect:()=>assert.fail('Publication must not claim to inspect or export')},capabilities:{invoke:async(id,args)=>{calls.push({id,args});return {type:'result',value:answer};}},resources:{publish:()=>assert.fail('Only the host service publishes')}};
  const args={operation_id:'publication',title:'Evidence',summary:'Supplied results',provenance_kind:'observed',data:[],input_ref:{ref:{...ref,kind:'resource'},entry:'input.json'}};
  assert.equal(await publishReport(host,args),answer);assert.equal(calls[0].id,'host.reports.publish');assert.deepEqual(calls[0].args.inputRef,args.input_ref);
  await assert.rejects(publishReport(host,{...args,html_path:'source.html'}),/HTML.*disabled/);assert.equal(calls.length,1);
});

test('report_export_check targets only a fixed ref on the dedicated host preflight surface', async () => {
  const signal = new AbortController().signal, answer = { checked: 'rendered-preflight', outputVerified: false, supportedFormats: ['png'], formats: { pdf: { status: 'unsupported', reasons: [{ code: 'shadow_dom', message: 'Closed shadow DOM' }] } } };
  const tool = createCapabilities({ views: { inspect: async (input, options) => {
    assert.deepEqual(input, { surface: 'report-export', ref }); assert.equal(options.signal, signal); return answer;
  } } }).find(tool => tool.name === 'report_export_check');
  assert.deepEqual(await tool.execute({ ref }, signal), answer);
  const manifest = JSON.parse(await readFile(new URL('../packages/reports/capabilities.json', import.meta.url), 'utf8'));
  for (const id of ['report_render', 'report_export_check']) {
    const declaration = manifest.capabilities.find(value => value.id === id);
    assert.equal(declaration.binding.name, id); assert.equal(declaration.inputSchema.additionalProperties, false);
  }
  assert.deepEqual(manifest.capabilities.find(value => value.id === 'report_export_check').effects, ['presentation.render']);
});

test('source-only checks never convert a plain report into a verified export claim', () => {
  const result = reportExportAdvice('<h1>Plain report</h1>');
  assert.equal(result.checked, 'source'); assert.deepEqual(result.supportedFormats, []);
  assert.deepEqual(result.candidateFormats, ['pdf', 'png']);
  assert.equal(result.formats.pdf.status, 'needs-render-check'); assert.equal(result.outputVerified, false);
});
