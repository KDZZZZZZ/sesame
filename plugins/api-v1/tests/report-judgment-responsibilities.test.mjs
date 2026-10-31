import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStructure, bindResults } from '../packages/reports/report-structure.js';

test('asset overview exposes separate horizon, news impact and sentiment judgments', () => {
  const structure = resolveStructure({template_id:'R01'});
  const field = (id,key) => structure.sections.find(s=>s.module_id===id)?.fields.find(f=>f.key===key);
  for (const [id,key] of [['M01','timeframe_states'],['M07','news_judgments'],['M08','sentiment_judgments']]) {
    assert.equal(field(id,key)?.display,'visible');
    assert.equal(field(id,key)?.presentation.kind,'judgments');
    assert.ok(field(id,key)?.agent_guidance.interpretation);
  }
  assert.ok(structure.judgment_brief.template.questions.some(q=>q.suggested_fields.includes('M01.timeframe_states')));
  assert.ok(!structure.visual_plan.details.includes('M01.timeframe_states'));
});

test('business judgments distinguish value, structure choice and conditional strategy use', () => {
  const cases = [['R04','M04','valuation_judgments'],['R06','M10','structure_judgments'],['R08','M16','use_judgments'],['R10','M18','strategy_judgments'],['R11','M19','allocation_judgments']];
  for (const [template,module,key] of cases) {
    const field=resolveStructure({template_id:template}).sections.find(s=>s.module_id===module).fields.find(f=>f.key===key);
    assert.ok(field,`${template} has a place for its actual decision`);
    assert.equal(field.required,false);
    assert.equal(field.type,'array');
  }
  assert.doesNotMatch(JSON.stringify(resolveStructure({template_id:'R11'}).sections.map(s=>s.title)),/新权重尚未评估/);
  const event=resolveStructure({template_id:'R03'}).sections.find(s=>s.module_id==='M14');
  assert.ok(!event.fields.some(f=>['confidence','outlook_chart'].includes(f.key)), 'historical event review does not default to current forecast probability');
});

test('user-selected results remain authoritative and suggestions do not require invented research', () => {
  const input={template_id:'R01',sections:[{module_id:'M01',method_refs:['user/chosen-method@1'],fields:['reference_price']}]};
  const structure=resolveStructure(input);
  assert.deepEqual(structure.sections[0].fields.map(f=>f.key),['reference_price']);
  assert.deepEqual(structure.sections[0].method_refs,['user/chosen-method@1']);
  assert.equal(structure.judgment_brief.explicit_selection,true);
  assert.equal(bindResults(structure,[]).completeness.status,'empty');
  assert.deepEqual(resolveStructure({template_id:'R01',sections:[]}).sections,[]);
});

test('reference alignment preserves the actual questions and distinguishes product extensions', () => {
  const overview=resolveStructure({template_id:'R01'});
  const references=overview.judgment_brief.template.tc_alignment.fields;
  const named=name=>references.find(item=>item.tc_field===name);
  assert.ok(named('价值状态').suggested_fields.includes('M03.factor_results'));
  assert.ok(named('新闻情绪').suggested_fields.includes('M08.sentiment'));
  assert.ok(!named('新闻情绪').suggested_fields.includes('M07.news_judgments'));
  assert.ok(named('关注程度').suggested_fields.includes('M07.attention'));
  assert.match(named('关注程度').question,/24/);
  assert.ok(overview.sections.find(s=>s.module_id==='M03').fields.some(f=>f.key==='factor_results'&&f.display==='visible'));
  assert.ok(overview.sections.find(s=>s.module_id==='M07').fields.some(f=>f.key==='attention'&&f.display==='visible'));
  assert.deepEqual(resolveStructure().compositions.find(t=>t.id==='R01').reference_fields,overview.judgment_brief.template.tc_alignment);
  const review=resolveStructure({template_id:'R08'}).judgment_brief.template.tc_alignment.fields;
  assert.ok(review.some(item=>item.relation==='sesame_extension'&&item.tc_field===null));
});

test('all report choices and baseline questions remain shallow enough for bounded model output', () => {
  const catalog=resolveStructure();
  assert.deepEqual(Object.keys(catalog.template_index),Array.from({length:11},(_,i)=>`R${String(i+1).padStart(2,'0')}`));
  assert.equal(Object.keys(catalog.module_index).length,19);
  for (const template_id of Object.keys(catalog.template_index)) {
    const structure=resolveStructure({template_id});
    const source=structure.judgment_brief.template.tc_alignment.fields;
    const visible=Object.values(structure.analysis_questions);
    assert.equal(visible.length,source.length,template_id);
    for (const field of source) assert.ok(visible.some(value=>value.includes(field.question)),`${template_id}: ${field.question}`);
    // Even the host's shorter preview retains these complete plain strings.
    assert.ok(visible.every(value=>typeof value==='string'&&value.length<=120));
  }
  assert.equal(Object.keys(resolveStructure({template_id:'R10'}).analysis_questions).length,14,'array preview must not lose the questions after the eighth');
  assert.deepEqual(resolveStructure({template_id:'R01',sections:[]}).analysis_questions,{},'user removal is not overridden');
  const selected=resolveStructure({template_id:'R04',sections:[{module_id:'M04',fields:['valuation_judgments']}]});
  assert.ok(Object.values(selected.analysis_questions).every(value=>!value.includes('评级')),'an explicit valuation-only choice does not restore consensus questions');
});
