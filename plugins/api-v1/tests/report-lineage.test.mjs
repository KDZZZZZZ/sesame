import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrigin, validateReasoning } from '../packages/reports/report-lineage.js';
import { resolveStructure, bindResults } from '../packages/reports/report-structure.js';
import { renderComposedReport } from '../packages/reports/report-compose.js';
import {readFileSync} from 'node:fs';
const ref = {id:'source',revision:'v1',digest:`sha256:${'1'.repeat(64)}`,kind:'data',schemaVersion:'1.0.0'};
const explanation = status => ({observations:['收盘位于约定水平上方。'],steps:['依指定规则保留上行假说。'],conclusion:'等待历史证据判断适用性。',history:{status,note:'同品种近期情景尚待检索。'}});

test('external predictions retain their nature and require actual acquisition evidence', () => {
 const row={evidence_refs:[ref],origin:{kind:'acquired',nature:'prediction',source:'External analyst release'}};
 assert.deepEqual(validateOrigin(row.origin,row),[]);
 assert.throws(()=>validateOrigin(row.origin,{...row,evidence_refs:[]}),/source identity and fixed evidence/);
 assert.throws(()=>validateOrigin({...row.origin,refs:[{id:'naked'}]},row),/fixed references/);
 assert.throws(()=>validateReasoning(explanation('not_applicable'),row),/prediction/);
});

test('explicit inferences need concise explanations but missing history never becomes a number', () => {
 const row={method_ref:'method@1',origin:{kind:'inferred',nature:'prediction'}};
 assert.throws(()=>validateOrigin(row.origin,row),/concise reasoning/);
 row.reasoning=explanation('pending');
 validateOrigin(row.origin,row);validateReasoning(row.reasoning,row);
 assert.throws(()=>validateReasoning(explanation('linked'),row),/own historical_basis/);
 assert.throws(()=>validateReasoning({...row.reasoning,steps:Array(5).fill('more')},row),/1–4/);
 assert.throws(()=>validateReasoning(explanation('not_applicable'),row),/prediction/);
 const computed={method_ref:'atr@1',origin:{kind:'derived',nature:'statistic'}};
 validateOrigin(computed.origin,computed);
 validateReasoning(explanation('not_applicable'),computed);
});

test('mixed fields preserve actual component sources without a type-only fallback', () => {
 const row={method_ref:'method@1',evidence_refs:[ref],reasoning:explanation('pending'),origin:{kind:'mixed',nature:'mixed',parts:[
  {path:'/price',kind:'acquired',nature:'fact',source:'Frozen quote'},
  {path:'/outlook',kind:'inferred',nature:'prediction'},
 ]}};
 validateOrigin(row.origin,row);
 assert.throws(()=>validateOrigin({...row.origin,parts:[row.origin.parts[0],row.origin.parts[0]]},row),/unique/);
 assert.throws(()=>validateReasoning(explanation('not_applicable'),row),/prediction/);
});

test('origin audit remains agent-only and does not add reader-facing source badges', () => {
 const structure=resolveStructure({sections:[{id:'review',title:'Research',fields:[{key:'target',type:'number',label:'Target',meaning:'Externally supplied estimate'}]}]});
 const rows=[{section_id:'review',field:'target',value:112,evidence_refs:[ref],origin:{kind:'acquired',nature:'prediction',source:'EXTERNAL_SOURCE_INTERNAL_LABEL'}}];
 const bound=bindResults(structure,rows);
 assert.deepEqual(bound.lineageAudit,[{section_id:'review',field:'target',status:'documented',issues:[]}]);
 const html=renderComposedReport({title:'Research',structure,bound,data:[],references:[ref],demo:false});
 assert.doesNotMatch(html,/EXTERNAL_SOURCE_INTERNAL_LABEL|来源未标注|获取字段|推断字段/);
 const legacy=bindResults(structure,[{section_id:'review',field:'target',value:112}]);
 assert.deepEqual(legacy.lineageAudit[0].issues,['actual_origin_not_declared']);
 assert.equal(legacy.completeness.status,'complete');
});

const visuals=JSON.parse(readFileSync(new URL('../packages/reports/examples/module-visual-fixtures.json',import.meta.url)));
const render=(structure,rows)=>renderComposedReport({title:'Research',structure,bound:bindResults(structure,rows),data:[],references:[],demo:true});
test('reader appendices omit inference origins and respect hidden or summary historical evidence',()=>{
 for(const display of ['hidden','summary']){
  const structure=resolveStructure({sections:[{module_id:'M14',fields:[{key:'inference_evidence',history_display:display}]}]});
  const rows=structuredClone(visuals.rows.filter(row=>row.section_id==='M14'&&row.field==='inference_evidence'));
  for(const step of rows[0].value){step.origin.note='INTERNAL_ORIGIN_SENTINEL';step.historical_basis.uncertainty='HISTORICAL_DETAIL_SENTINEL';}
  const html=render(structure,rows);
  assert.doesNotMatch(html,/INTERNAL_ORIGIN_SENTINEL|HISTORICAL_DETAIL_SENTINEL/);
  assert.doesNotMatch(html,/&quot;origin&quot;|&quot;inferred&quot;/);
  if(display==='hidden')assert.doesNotMatch(html,/data-step="history"/);
 }
});
test('inference history summaries link to the actual M13 detail section',()=>{
 const structure=resolveStructure({sections:[{module_id:'M14',fields:[{key:'inference_evidence',history_display:'summary'}]},{module_id:'M13',fields:['inference_evidence']}]});
 assert.match(render(structure,visuals.rows),/href="#section-M13"/);
});
test('knowledge-only explanations and pending result reasoning remain visible',()=>{
 const structure=resolveStructure({sections:[{id:'custom',title:'Custom',fields:[{key:'a',type:'text',label:'A',meaning:'A supplied observation'}]}]});
 const knowledge={mechanism:'KNOWN_MECHANISM',expected_observation:'EXPECTED_OBSERVATION',interpretation:'KNOWN_INTERPRETATION',agreement:'insufficient'};
 const html=render(structure,[{section_id:'custom',field:'a',value:'An observation',knowledge_basis:knowledge}]);
 assert.match(html,/KNOWN_MECHANISM/);assert.match(html,/KNOWN_INTERPRETATION/);
 const pending=render(structure,[{section_id:'custom',field:'a',status:'pending',reason:'Waiting for evidence',reasoning:explanation('pending'),confidence:{estimate:0.99,definition:'UNVALIDATED_ARBITRARY_CONFIDENCE'}}]);
 assert.match(pending,/data-step="observations"/);assert.doesNotMatch(pending,/UNVALIDATED_ARBITRARY_CONFIDENCE/);
});
