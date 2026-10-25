import test from 'node:test';
import assert from 'node:assert/strict';
import { collaboration } from '../packages/trading-decision/team.js';
import { fixture } from './trading-decision-plans-fixture.mjs';

const pairs = graph => graph.relationships.map(({ from, to }) => `${from}>${to}`).sort();
test('trading collaboration is the explicit manager to executor relationship', () => {
  const graph = collaboration();
  assert.deepEqual(graph.agents.map(agent => agent.id), ['manager', 'executor']);
  assert.deepEqual(pairs(graph), ['manager>executor']);
  assert.ok(graph.agents.every(agent => agent.title && agent.role === agent.id));
});

test('the trading decision sends one explicit two-agent collaboration and binds its actual child Runs', async t => {
  const f = await fixture(t);
  const plan = await f.runtime.configure(f.main, f.input());
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
