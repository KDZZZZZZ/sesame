import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseToken, parseWorkflow, validateWorkflowSet, WorkflowSyntaxError } from './definition.mjs';
import { closestName, createPlanState, dependencyMet, necessaryUnfinished, reportStep, resolve, resumeAfterChild, revisePlan, closePlan } from './resolver.mjs';

import { createTodoPlan } from './todos.mjs';

const factorUrl = new URL('../../optional-api-v1/packages/auto-factor-mining/workflows/factor.development.yaml', import.meta.url);
const strategyUrl = new URL('../../optional-api-v1/packages/strategy-development/workflows/strategy.development.yaml', import.meta.url);
const read = url => readFile(url, 'utf8');

function apply(definition, state, input) {
  const result = reportStep(definition, state.plan, { at: 1, ...input, produced: (input.produced ?? []).map(token => typeof token === 'string' ? parseToken(token) : token) });
  if (result.ok) state.plan = result.plan;
  return result;
}
function open(definition, fields = {}) {
  const result = createPlanState({ id: fields.id ?? 'p4k7m2x9qa', title: fields.title ?? '测试计划', definition, have: fields.have ?? [], refs: fields.refs ?? {}, conditions: fields.conditions ?? {}, at: 1 });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result;
}
const done = (definition, state, step, produced = [], extra = {}) => {
  const result = apply(definition, state, { step, status: 'done', produced, ...extra });
  assert.equal(result.ok, true, `${step}: ${JSON.stringify(result.error)}`);
  return result;
};
const names = view => view.partition ? null : null;
void names;

function assertPartition(definition, plan) {
  const view = resolve(definition, plan);
  const actual = new Set([...view.partition.ready, ...view.partition.running, ...view.partition.waiting, ...view.partition.unreachable].map(item => item.step));
  assert.deepEqual([...actual].sort(), [...view.necessary].sort());
  assert.equal(actual.size, view.partition.ready.length + view.partition.running.length + view.partition.waiting.length + view.partition.unreachable.length);
  for (const item of [...view.partition.waiting, ...view.partition.unreachable]) assert.ok(item.reason?.kind, item.step);
  for (const item of view.partition.ready) assert.equal(dependencyMet(definition, plan, item.step), true, item.step);
  for (const item of view.ready) assert.equal(dependencyMet(definition, plan, item.step), true, item.step);
  if (plan.status !== 'abandoned') {
    const met = view.goals.every(name => plan.artifacts[name] && !plan.artifacts[name].expired && plan.artifacts[name].version > 0);
    if (met && !view.running.length && !view.failed.length) assert.equal(view.status, 'completed');
  }
  assert.equal(plan.status, view.status);
  return view;
}

test('parses both shipped workflow definitions', async () => {
  const factor = parseWorkflow(await read(factorUrl));
  const strategy = parseWorkflow(await read(strategyUrl));
  assert.equal(factor.id, 'factor.development');
  assert.equal(factor.goal, 'QualifiedFactor');
  assert.equal(Object.keys(factor.steps).length, 11);
  assert.deepEqual(factor.externals.sort(), ['ResearchRequest', 'StrategyFactorGap']);
  assert.deepEqual(factor.outcomes.SanityResult, ['pass', 'fail']);
  assert.deepEqual(factor.outcomes.FactorDecision, ['accept', 'revise', 'reject']);
  assert.deepEqual(factor.steps.compute.uses, ['tool/factor_compute']);
  assert.equal(factor.imports.StrategyFactorGap, 'sesame/strategy-development');
  assert.match(factor.steps.sanity_check.hint, /缺失值/);
  assert.equal(factor.steps.decide.requires_if_valid.map(ref => ref.name).join(','), 'EffectivenessEvidence,RedundancyEvidence,RobustnessEvidence');
  assert.equal(strategy.id, 'strategy.development');
  assert.equal(Object.keys(strategy.steps).length, 10);
  assert.deepEqual(strategy.externals, ['UserRequest']);
  assert.equal(strategy.steps.factors.fallback, 'sesame/auto-factor-mining:factor.development');
  assert.equal(strategy.steps.report.when, 'user_requests_report');
  assert.deepEqual(strategy.steps.report.uses,['sesame/reports:tool/components_show']);
  assert.deepEqual(strategy.steps.market.uses,['sesame/data-access:tool/data_snapshot','tool/strategy_development_plan']);
  assert.equal(validateWorkflowSet([factor, strategy]), null);
});

test('rejects undeclared outcomes, duplicate keys and cycles in standard YAML', () => {
  const sample = {workflow:'sample', goal:'A', steps:{one:{title:'One',produces:['A']},two:{title:'Two',requires:['A'],produces:['B']}}};
  assert.equal(parseWorkflow(JSON.stringify(sample)).id,'sample');
  assert.throws(()=>parseWorkflow('workflow: sample\nworkflow: other'), /unique|duplicate/i);
  sample.steps.one.requires=['B'];
  assert.throws(()=>parseWorkflow(JSON.stringify(sample)), /成环/);
  sample.steps.one.requires=['External:pass'];
  assert.throws(()=>parseWorkflow(JSON.stringify(sample)), /undeclared outcome/);
  sample.steps.one.requires=[]; sample.steps.one.next=['two'];
  assert.throws(()=>parseWorkflow(JSON.stringify(sample)), /unknown field/);
});

test('factor normal path, sanity failure and a violated early completion', async () => {
  const definition = parseWorkflow(await read(factorUrl));
  const state = { plan: open(definition, { have: ['ResearchRequest'], title: 'BTC 4h 动量因子开发' }).plan };
  assert.deepEqual(resolve(definition, state.plan).ready.map(item => item.step), ['research_spec']);
  for (const step of ['research_spec', 'data', 'search_space', 'propose', 'compute']) done(definition, state, step);
  const started = apply(definition, state, { step: 'redundancy', status: 'started', runs: [{ id: 'run_51b0', status: 'running' }] });
  assert.equal(started.ok, true);
  const recorded = done(definition, state, 'sanity_check', ['SanityResult:fail'], { runs: [{ id: 'run_8c1d', status: 'completed', error: false, tagged: true }] });
  assert.equal(recorded.view.status,'active');
  assert.deepEqual(recorded.view.progress,{done:6,total:11});
  assert.deepEqual(recorded.view.ready.map(item=>item.step),['decide']);
  assertPartition(definition, state.plan);

  const early = open(definition, { have: ['ResearchRequest'], id: 'pearly' });
  const violated = reportStep(definition, early.plan, { step: 'compute', status: 'done', produced: [], at: 1 });
  assert.equal(violated.ok, true);
  assert.equal(violated.violation, true);
});

test('revise blocks the goal, and redoing propose expires the old downstream products', async () => {
  const definition = parseWorkflow(await read(factorUrl));
  const state = { plan: open(definition, { have: ['ResearchRequest'] }).plan };
  for (const step of ['research_spec', 'data', 'search_space', 'propose', 'compute']) done(definition, state, step);
  done(definition, state, 'sanity_check', ['SanityResult:pass']);
  done(definition, state, 'effectiveness');
  done(definition, state, 'redundancy');
  done(definition, state, 'robustness');
  const saved = structuredClone(state.plan);
  done(definition, state, 'decide', ['FactorDecision:revise']);
  let view = assertPartition(definition, state.plan);
  assert.equal(view.status, 'blocked');
  const rejected = done(definition, { plan: saved }, 'decide', ['FactorDecision:reject']);
  assert.equal(rejected.view.status, 'blocked');

  const redo = apply(definition, state, { step: 'propose', status: 'started' });
  assert.equal(redo.ok, true);
  assert.equal(state.plan.steps.propose.iteration, 1);
  assert.equal(state.plan.steps.propose.status, 'running');
  done(definition, state, 'propose');
  view = assertPartition(definition, state.plan);
  assert.equal(view.status, 'active');
  assert.equal(state.plan.artifacts.FactorExpression.version, 2);
  assert.equal(state.plan.artifacts.FactorValues.expired, true);
  assert.equal(state.plan.steps.compute.status, 'pending');
  assert.equal(state.plan.steps.compute.iteration, 1);
  assert.ok(view.ready.some(item => item.step === 'compute'));
  assert.equal(view.ready.some(item => item.step === 'sanity_check'), false);
});

test('strategy report is conditional, reuse skips producers, and a factor fallback returns to factors', async () => {
  const factor = parseWorkflow(await read(factorUrl));
  const strategy = parseWorkflow(await read(strategyUrl));
  const quiet = open(strategy, { have: ['UserRequest'], id: 'pstrategy' });
  assert.equal(resolve(strategy, quiet.plan).active.includes('report'), false);
  assert.equal(resolve(strategy, quiet.plan).progress.total, 9);
  const asked = open(strategy, { have: ['UserRequest'], id: 'pstrategy2', conditions: { user_requests_report: true } });
  assert.equal(resolve(strategy, asked.plan).active.includes('report'), true);
  assert.equal(resolve(strategy, asked.plan).progress.total, 10);
  const unknown = revisePlan(strategy, quiet.plan, { conditions: { missing_flag: true } });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'unknown_condition');

  const reused = open(factor, { have: ['FactorSpec', 'EvaluationProtocol'], id: 'preuse' });
  assert.equal(reused.plan.steps.research_spec.status, 'done');
  assert.deepEqual(resolve(factor, reused.plan).ready.map(item => item.step), ['data', 'search_space']);

  const development = { plan: open(strategy, { have: ['UserRequest'], id: 'pdev' }).plan };
  done(strategy, development, 'mandate');
  const failed = apply(strategy, development, { step: 'factors', status: 'failed', note: '因子库没有适用于 4h 周期的动量类合格因子', fallback: 'sesame/auto-factor-mining:factor.development', fallbackPlanId: 'pchild' });
  assert.equal(failed.ok, true);
  const child = open(factor, { have: ['StrategyFactorGap'], id: 'pchild', title: '回退' });
  child.plan.parent = { planId: 'pdev', step: 'factors', iteration: 0 };
  assert.deepEqual(resolve(factor, child.plan).ready.map(item => item.step), ['research_spec']);
  const returned = resumeAfterChild(strategy, development.plan, 'factors', 2);
  assert.equal(returned.plan.steps.factors.status, 'pending');
  assert.equal(returned.plan.steps.factors.iteration, 1);
  assert.ok(returned.view.ready.some(item => item.step === 'factors'));
});

test('failure stays retryable and skip makes hard dependents unreachable', async () => {
  const definition = parseWorkflow(await read(factorUrl));
  const state = { plan: open(definition, { have: ['ResearchRequest'] }).plan };
  for (const step of ['research_spec', 'data', 'search_space', 'propose']) done(definition, state, step);
  const blocked = apply(definition, state, { step: 'compute', status: 'started' });
  assert.equal(blocked.ok, true);
  const again = apply(definition, state, { step: 'compute', status: 'started', runs: [{ id: 'run_compute', status: 'running' }] });
  assert.equal(again.ok, true);
  assert.equal(again.alreadyRunning.step, 'compute');
  assert.equal(state.plan.steps.compute.status, 'running');
  assert.equal(state.plan.steps.compute.iteration, 0);
  assert.deepEqual(state.plan.steps.compute.runs.map(run => run.id), ['run_compute']);
  const failed = apply(definition, state, { step: 'compute', status: 'failed', note: '计算进程退出' });
  assert.equal(failed.ok, true);
  const skipped = apply(definition, state, { step: 'compute', status: 'skipped', note: '这个公式不再计算' });
  assert.equal(skipped.ok, true);
  const view = assertPartition(definition, state.plan);
  assert.equal(view.status, 'blocked');
  assert.ok(view.partition.unreachable.some(item => item.step === 'sanity_check'));
});

test('a finished plan reopens when a conditional step is requested', async () => {
  const strategy = parseWorkflow(await read(strategyUrl));
  const state = { plan: open(strategy, { have: ['UserRequest'], id: 'pclose' }).plan };
  for (const step of ['mandate', 'market', 'factors', 'design', 'implement']) done(strategy, state, step);
  done(strategy, state, 'code_check', ['CodeCheck:pass']);
  done(strategy, state, 'backtest');
  done(strategy, state, 'validate', ['StrategyValidation:pass']);
  done(strategy, state, 'deliver');
  assert.equal(state.plan.status, 'completed');
  const reopened = revisePlan(strategy, state.plan, { conditions: { user_requests_report: true } });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.view.status, 'active');
  assert.deepEqual(reopened.view.ready.map(item => item.step), ['report']);
  const closed = closePlan(strategy, reopened.plan, { outcome: 'completed' });
  assert.equal(closed.ok, false);
  assert.equal(closed.error.code, 'close_incomplete');
  const abandoned = closePlan(strategy, reopened.plan, { outcome: 'abandoned', note: '用户改做别的' });
  assert.equal(abandoned.ok, true);
  assert.equal(abandoned.plan.status, 'abandoned');
});

test('temporary plans become ready from after, and refuse cycles', () => {
  const openTodos = steps => createTodoPlan({
    id:'padhoc', title:'黄金周度复盘', steps:steps.map(item=>({...item,description:item.title})),
  });
  const built = openTodos([
    { step: 'collect', title: '取行情与事件' },
    { step: 'structure', title: '价格结构分析', after: ['collect'] },
    { step: 'events', title: '事件影响分析', after: ['collect'] },
    { step: 'report', title: '综合并发布报告', after: ['structure', 'events'] },
  ]);
  assert.equal(built.ok, true);
  assert.deepEqual(built.view.todos.filter(todo=>todo.state==='ready').map(todo=>todo.step), ['collect']);
  const cycled = openTodos([{ step: 'a', title: '甲', after: ['b'] }, { step: 'b', title: '乙', after: ['a'] }]);
  assert.equal(cycled.ok, false);
  assert.equal(cycled.error.code, 'invalid_plan');
});

test('an early start is recorded as a deviation and its product stays usable', async () => {
  const strategy = parseWorkflow(await read(strategyUrl));
  const state = { plan: open(strategy, { have: ['UserRequest'], id: 'p9d3c6t2vb', title: 'BTC 趋势策略' }).plan };
  for (const step of ['mandate', 'market', 'factors', 'design', 'implement']) done(strategy, state, step);
  const started = reportStep(strategy, state.plan, { step: 'backtest', status: 'started', at: 1 });
  assert.equal(started.ok, true);
  assert.equal(started.violation, true);
  assert.equal(started.plan.steps.backtest.status, 'running');
  assert.equal(started.plan.steps.backtest.iteration, 0);
  const finished = reportStep(strategy, started.plan, { step: 'backtest', status: 'done', at: 2 });
  assert.equal(finished.ok, true);
  assert.equal(finished.violation, true);
  assert.equal(finished.plan.artifacts.BacktestResult.expired, false);
  assert.ok(resolve(strategy, finished.plan).ready.some(item => item.step === 'validate'));
});

test('random reports keep every unfinished necessary step in exactly one explained bucket', async () => {
  const factor = parseWorkflow(await read(factorUrl));
  const strategy = parseWorkflow(await read(strategyUrl));
  const random = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const definition of [factor, strategy]) {
    const rand = random(20261120 + definition.id.length);
    const externals = definition.externals.filter(() => rand() > 0.4);
    let plan = open(definition, { have: externals, id: `prand${definition.id.length}`, conditions: Object.fromEntries(definition.conditions.map(name => [name, rand() > 0.5])) }).plan;
    assertPartition(definition, plan);
    const steps = Object.keys(definition.steps);
    for (let turn = 0; turn < 40; turn++) {
      const step = steps[Math.floor(rand() * steps.length)];
      const status = ['started', 'done', 'failed', 'skipped'][Math.floor(rand() * 4)];
      const produced = [];
      for (const product of definition.steps[step]?.produces ?? []) {
        const outcomes = definition.outcomes[product];
        if (outcomes) produced.push(`${product}:${outcomes[Math.floor(rand() * outcomes.length)]}`);
      }
      const before = structuredClone(plan);
      const result = reportStep(definition, plan, { step, status, produced: produced.map(parseToken), note: status === 'failed' || status === 'skipped' ? '随机试验' : undefined, at: turn + 2 });
      plan = result.ok ? result.plan : before;
      assertPartition(definition, plan);
      assert.equal(necessaryUnfinished(definition, plan).size, resolve(definition, plan).necessary.size);
    }
  }
  assert.equal(closestName('sanity', Object.keys(factor.steps)), 'sanity_check');
});

