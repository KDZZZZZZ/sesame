import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseWorkflow } from './definition.mjs';
import { createTodoPlan, reviseTodoPlan, reportTodo, resumeTodoAfterChild, resolveTodos, closeTodoPlan } from './todos.mjs';

const read = async (pkg, name) => parseWorkflow(await readFile(new URL('../../optional-api-v1/packages/'+pkg+'/workflows/'+name+'.yaml',import.meta.url),'utf8'),'sesame/'+pkg);
const factor = await read('auto-factor-mining','factor.development');
const strategy = await read('strategy-development','strategy.development');
const todo = (step, presets, after) => ({step, title:'完成 '+step, description:'核对输入并保存 '+step+' 的结果。', ...(presets ? {presets} : {}), ...(after ? {after} : {})});
const todos = [todo('goal',['research_spec']),todo('prep',['data','search_space']),todo('make',['compute','propose']),
  todo('check',['sanity_check']),todo('evaluate',['effectiveness','robustness']),todo('redund',['redundancy']),todo('decide',['decide']),todo('tell',null,['decide'])];
function ok(r) { assert.equal(r.ok,true,JSON.stringify(r.error)); return r; }
function start(options={}) { return ok(createTodoPlan({id:'plan',title:'研究',definition:factor,have:['ResearchRequest'],steps:todos,...options})).plan; }
const report = (p, step, status='done',extra={}) => ok(reportTodo(p.definition,p,{step,status,...extra}));
const row = (p,s) => resolveTodos(p.definition,p).todos.find(t=>t.step===s);
const ready = p => resolveTodos(p.definition,p).todos.filter(t=>t.state==='ready').map(t=>t.step);
function prepared() {
  let p=start(); assert.deepEqual(ready(p),['goal']);
  p=report(p,'goal').plan; assert.deepEqual(ready(p),['prep']);
  assert.deepEqual(row(p,'make').reason.steps,['prep']);
  p=report(p,'prep').plan; assert.deepEqual(ready(p),['make']);
  const r=report(p,'make'); assert.equal(r.violation,false);
  assert.deepEqual(r.presets,['propose','compute']); return r.plan;
}
function partition(p) {
  const v=resolveTodos(p.definition,p);
  if (!v.presetView) return;
  for (const step of v.presetView.necessary) {
    const owners=p.todos.filter(t=>!['done','skipped'].includes(t.status) && t.presets.includes(step));
    assert.equal(owners.length + v.unarranged.filter(u=>u.step===step).length,1,step);
  }
}

test('factor rejection names the outcome owner, drops redundant work, and reports the blocked goal', () => {
  let p=report(prepared(),'check','done',{produced:['SanityResult:fail']}).plan;
  assert.equal(row(p,'evaluate').reason.kind,'outcome'); assert.deepEqual(row(p,'evaluate').reason.steps,['check']);
  assert.equal(row(p,'decide').state,'ready');
  p=report(p,'decide','done',{produced:['FactorDecision:reject']}).plan;
  assert.equal(row(p,'redund').state,'not_needed');
  p=report(p,'tell').plan; assert.equal(p.status,'blocked');
  assert.ok(resolveTodos(factor,p).unarranged.some(s=>s.step==='register')); partition(p);
});

test('partial completion detaches omitted presets; completing and redoing a group propagates expiry', () => {
  let p=report(prepared(),'check','done',{produced:['SanityResult:pass']}).plan;
  const partial=report(p,'evaluate','done',{presets:['effectiveness']}); p=partial.plan;
  assert.deepEqual(partial.released,['robustness']);
  assert.deepEqual(p.todos.find(t=>t.step==='evaluate').presets,['effectiveness']);
  assert.equal(resolveTodos(factor,p).unarranged.find(s=>s.step==='robustness').ready,true);
  assert.ok(row(p,'decide').reason.presets.includes('robustness')); partition(p);
  p=ok(reviseTodoPlan(factor,p,{steps:[todo('robust',['robustness'])]})).plan;
  for (const s of ['redund','robust']) p=report(p,s).plan;
  p=report(p,'decide','done',{produced:['FactorDecision:accept']}).plan;
  p=report(p,'tell').plan; assert.equal(p.status,'active');
  assert.ok(resolveTodos(factor,p).unarranged.some(s=>s.step==='register'&&s.ready));
  const closed=ok(closeTodoPlan(factor,p,{outcome:'completed'})); assert.equal(closed.view.status,'completed');
  p=report(p,'make','started').plan;
  const r=report(p,'make'); p=r.plan;
  for(const s of ['check','evaluate','redund','robust','decide']) {
    assert.equal(p.todos.find(t=>t.step===s).status,'pending',s);
    assert.equal(p.todos.find(t=>t.step===s).iteration,1,s);
  }
  partition(p);
});

test('reference alone, reused work, multiple preset outcomes, and ad hoc work', () => {
  const empty=start({steps:undefined}); assert.deepEqual(empty.todos,[]); assert.equal(empty.status,'active'); partition(empty);
  const reused=start({have:['FactorSpec','EvaluationProtocol']}); assert.equal(row(reused,'goal').state,'not_needed');
  const grouped=ok(createTodoPlan({id:'g',title:'检查并评价',definition:factor,have:['FactorValues','FactorExpression','EvaluationProtocol','ResearchData'],steps:[todo('g',['effectiveness','sanity_check'])]})).plan;
  assert.equal(ready(grouped)[0],'g');
  const early=report(start(),'make'); assert.equal(early.violation,true); assert.ok(early.missing.length);
  const adhoc=ok(createTodoPlan({id:'a',title:'短任务',steps:[todo('first'),todo('second',null,['first'])]})).plan;
  assert.deepEqual(adhoc.steps,{}); assert.deepEqual(adhoc.artifacts,{}); assert.equal(adhoc.workflow,'adhoc');
  assert.deepEqual(ready(adhoc),['first']);
  const no=closeTodoPlan(null,adhoc,{outcome:'completed'}); assert.equal(no.error.code,'close_incomplete');
  let p=report(adhoc,'first').plan; p=report(p,'second','done',{note:'已核对。'}).plan;
  assert.equal(p.status,'completed'); assert.equal(row(p,'second').note,'已核对。');
  p=ok(reviseTodoPlan(null,p,{steps:[todo('more',null,['second'])]})).plan; assert.equal(p.status,'active');
});

test('invalid open, revise and reports leave the prior plan intact', () => {
  const rejected=(r,code)=>assert.equal(r.error?.code,code,JSON.stringify(r));
  const p=start(), snapshot=JSON.stringify(p);
  for(const [steps,code] of [
    [[todo('new',['not_a_step'])],'unknown_preset'], [[todo('new',['data'])],'preset_taken'],
    [[todo('bad',null,['absent'])],'invalid_plan'], [[todo('a',null,['b']),todo('b',null,['a'])],'invalid_plan'],
    [[{step:'bad',title:'无说明'}],'invalid_plan'], [[{...todo('bad'),description:'x'.repeat(201)}],'invalid_plan'],
    [[todo('same'),todo('same')],'invalid_plan'],
  ]) rejected(reviseTodoPlan(factor,p,{steps}),code);
  rejected(reviseTodoPlan(factor,p,{remove:['decide']}),'invalid_plan'); assert.equal(JSON.stringify(p),snapshot);
  const adhoc=ok(createTodoPlan({id:'a',title:'单步',steps:[todo('first')]})).plan;
  for(const x of [{steps:[todo('first',['research_spec'])]}, {conditions:{flag:true}}, {have:['X']},{refs:{X:'ref'}}]) rejected(reviseTodoPlan(null,adhoc,x),'no_reference');
  const denied=createTodoPlan({id:'s',title:'策略',definition:strategy,steps:[todo('r',['report'])]});
  rejected(denied,'preset_inactive'); assert.equal(denied.error.vars.condition,'user_requests_report');
  const skipped=report(p,'goal','skipped',{note:'终止'}).plan;
  rejected(reviseTodoPlan(factor,skipped,{steps:[todo('again',['research_spec'])]}),'step_skipped');
  assert.equal(row(skipped,'prep').reason.kind,'skipped');
  const running=report(p,'goal','started').plan; rejected(reviseTodoPlan(factor,running,{remove:['goal']}),'todo_locked');
  const bad=reportTodo(factor,prepared(),{step:'check',status:'done'}); rejected(bad,'outcome_required');
  rejected(reportTodo(factor,p,{step:'goal',status:'done',presets:['compute']}),'unknown_preset');
});

test('failed grouped work can enter and leave its declared fallback', () => {
  let p=ok(createTodoPlan({id:'s',title:'策略',definition:strategy,have:['UserRequest'],steps:[todo('first',['mandate','factors'])]})).plan;
  const fallback=strategy.steps.factors.fallback;
  const r=report(p,'first','failed',{presets:['mandate'],note:'需要因子',fallback,fallbackPlanId:'child',gap:'StrategyFactorGap'});
  p=r.plan; assert.deepEqual(r.presets,['mandate','factors']); assert.equal(p.steps.mandate.status,'done');
  assert.equal(row(p,'first').reason.kind,'fallback');
  const resumed=resumeTodoAfterChild(strategy,p,'first',123);assert.equal(resumed.plan.steps.factors.iteration,1);
  assert.equal(row(resumed.plan,'first').iteration,1); assert.equal(row(resumed.plan,'first').state,'ready');
});
test('arbitrary report sequences keep necessary unfinished presets partitioned exactly once', () => {
  for (let seed=1; seed<=16; seed++) {
    let number=seed, p=start();
    function pick(xs) { number=(1664525*number+1013904223)>>>0; return xs[number%xs.length]; }
    for(let turn=0;turn<16;turn++) {
      partition(p);
      const candidate=pick(p.todos.filter(t=>t.status!=='skipped'));
      if(!candidate) break;
      const status=candidate.status==='done'?'started':pick(['started','done','done','failed','skipped']);
      const produced=status==='done' ? candidate.presets.flatMap(name=>factor.steps[name].produces)
        .filter(name=>factor.outcomes[name]).map(name=>name+':'+pick(factor.outcomes[name])) : [];
      const snapshot=JSON.stringify(p);
      const result=reportTodo(factor,p,{step:candidate.step,status,produced,note:'测试记录'});
      assert.equal(JSON.stringify(p),snapshot);
      if(result.ok) p=result.plan;
    }
    partition(p);
  }
});

test('merged preset readiness anticipates a required internal outcome, and wrong outcomes flag the actual report', () => {
  const def=parseWorkflow(`workflow: demo
goal: Final
artifacts:
  Verdict:
    outcomes: [no, yes]
steps:
  first:
    title: 确认
    produces: [Verdict]
  second:
    title: 使用结论
    requires: [Verdict:yes]
    produces: [Final]
`);
  const opened=ok(createTodoPlan({id:'a',title:'检查',definition:def,steps:[todo('both',['second','first'])]})).plan;
  assert.equal(row(opened,'both').state,'ready');
  const rejected=reportTodo(def,opened,{step:'both',status:'done',produced:['Verdict:invalid']});
  assert.equal(rejected.error.code,'invalid_outcome'); assert.deepEqual(opened.artifacts,{});
  const mismatch=report(opened,'both','done',{produced:['Verdict:no']});
  assert.equal(mismatch.violation,true); assert.ok(mismatch.missing.includes('Verdict:yes'));
});

test('historical groups retain their attribution and cannot reclaim a preset already assigned to another open todo', () => {
  let p=report(start(),'goal').plan;
  p=ok(reviseTodoPlan(factor,p,{steps:[todo('second_goal',['research_spec'])]})).plan;
  const again=reportTodo(factor,p,{step:'goal',status:'started'});
  assert.equal(again.error.code,'preset_taken');
  const failed=reportTodo(factor,p,{step:'goal',status:'failed',note:'不应截取正在做的待办'});
  assert.equal(failed.error.code,'preset_taken');
});

test('after-only dependencies and missing external inputs produce different wait reasons', () => {
  const p=start({have:[]});
  const reason=row(p,'goal').reason;
  assert.equal(reason.kind,'external');
  assert.deepEqual(reason.inputs,['ResearchRequest','StrategyFactorGap']);
  assert.equal(p.status,'needs_input'); assert.deepEqual(row(p,'tell').reason.steps,['decide']);
});

test('a retry and a running todo both recheck current after dependencies at completion', () => {
  const opened=ok(createTodoPlan({id:'ad',title:'核对资料',steps:[todo('input'),todo('read',null,['input'])]})).plan;
  const failed=report(opened,'read','failed',{note:'缺资料'}).plan;
  const retried=report(failed,'read');
  assert.equal(retried.violation,true); assert.deepEqual(retried.missing,['input']);
  let p=report(opened,'input').plan;
  p=report(p,'read','started').plan; p=report(p,'input','started').plan;
  const done=report(p,'read');assert.equal(done.violation,true);assert.deepEqual(done.missing,['input']);
  for (const field of ['conditions','refs','have']) {
    const result=reviseTodoPlan(null,opened,{[field]:field==='have'?[]:{}});
    assert.equal(result.error.code,'no_reference');
  }
});
