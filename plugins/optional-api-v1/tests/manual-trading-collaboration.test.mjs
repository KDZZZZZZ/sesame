import test from 'node:test';
import assert from 'node:assert/strict';
import { collaboration } from '../packages/manual-trading/team.js';
import { fixture, alternateModel, unchanged } from './manual-trading-plans-fixture.mjs';

const pairs = graph => graph.relationships.map(({ from, to }) => `${from}>${to}`).sort();
const teamPairs = [
  ...['market', 'fundamentals', 'news', 'sentiment'].flatMap(role => [`${role}>bull`, `${role}>bear`]),
  'bull>bear', 'bear>bull', 'bull>risk', 'bear>risk', 'risk>manager', 'manager>executor',
].sort();

test('manual collaboration declares only active frozen-plan roles and meaningful relations, independent of debate count', () => {
  const single = collaboration({ mode: 'single', debateRounds: 3, agentModels: { news: alternateModel } });
  assert.deepEqual(single.agents.map(agent => agent.id), ['manager', 'executor']);
  assert.deepEqual(pairs(single), ['manager>executor']);
  const team = collaboration({ mode: 'team', debateRounds: 1 });
  assert.deepEqual(team, collaboration({ mode: 'team', debateRounds: 3 }));
  assert.deepEqual(team.agents.map(agent => agent.id), ['market', 'fundamentals', 'news', 'sentiment', 'bull', 'bear', 'risk', 'manager', 'executor']);
  assert.deepEqual(pairs(team), teamPairs);
  assert.ok(team.agents.every(agent => agent.title && agent.role === agent.id));
  assert.ok(team.relationships.every(link => link.label && link.from !== link.to));
  assert.equal(new Set(pairs(team)).size, team.relationships.length);
});

test('single mode sends one explicit two-agent collaboration and binds its actual child Runs', async t => {
  const f = await fixture(t);
  const plan = await f.runtime.configure(f.main, f.input({ mode: 'single', agent_models: { news: alternateModel } }));
  const run = f.runtime.trigger(plan.id, { kind: 'manual', id: 'single-collaboration' });
  await f.completeSingle(run.id);
  const done = f.runtime.run(run.id), root = f.runs.read(done.workflow.id);
  assert.deepEqual(root.task.collaboration, collaboration(done.plan));
  assert.equal(root.task.agentId, undefined, 'The workflow controller is not an Agent participant');
  assert.deepEqual(done.tasks.map(task => task.role), ['manager', 'executor']);
  for (const task of done.tasks) {
    const child = f.runs.read(task.id);
    assert.equal(child.task.agentId, task.role);
    assert.equal(child.task.role, task.role);
    assert.equal(child.parentRunId, root.id);
  }
});

test('multiple debate rounds preserve nine identities while work details and handoff audit remain separate', async t => {
  const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input({ mode: 'team', debate_rounds: 2 }));
  const run = f.runtime.trigger(plan.id, { kind: 'manual', id: 'team-collaboration' });
  await f.waitFor(() => f.active().length === 4);
  const declared = structuredClone(f.runs.read(f.runtime.run(run.id).workflow.id).task.collaboration);
  for (const job of f.active()) f.finish(job.id, `Observed ${job.request.input.role} evidence`);
  for (const role of ['bull', 'bear', 'bull', 'bear', 'risk']) {
    await f.waitFor(() => f.active(role).length === 1);
    const job = f.active(role)[0];
    await f.call('context', f.child(job.id), run.id, 'team');
    f.finish(job.id, `Observed ${role} conclusion`);
  }
  await f.completeSingle(run.id);
  const done = f.runtime.run(run.id), root = f.runs.read(done.workflow.id);
  assert.equal(done.status, 'completed');
  assert.deepEqual(root.task.collaboration, declared, 'Reading reports and completing work must not change the declared graph');
  assert.equal(declared.agents.length, 9); assert.deepEqual(pairs(declared), teamPairs);
  assert.equal(done.tasks.length, 11);
  for (const task of done.tasks) {
    const child = f.runs.read(task.id);
    assert.equal(child.task.agentId, task.role);
    assert.equal(child.task.stage, task.role);
    assert.equal(child.task.iteration, task.round);
    assert.ok(declared.agents.some(agent => agent.id === child.task.agentId));
  }
  for (const role of ['bull', 'bear']) {
    const turns = done.tasks.filter(task => task.role === role).map(task => f.runs.read(task.id));
    assert.equal(turns.length, 2); assert.notEqual(turns[0].id, turns[1].id);
    assert.equal(turns[0].task.agentId, turns[1].task.agentId);
    assert.notEqual(turns[0].task.iteration, turns[1].task.iteration);
  }
});
