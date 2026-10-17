import test from 'node:test';
import assert from 'node:assert/strict';
import { collaboration } from '../packages/auto-factor-mining/team.js';
import { fixture, input, finished } from '../packages/auto-factor-mining/tests/host-fixture.js';
import { evaluate } from '../packages/factor-evaluator/evaluator.js';

test('factor collaboration declares Agent roles and causal feedback, without evaluator or report task nodes', () => {
  const graph = collaboration();
  assert.deepEqual(graph.agents.map(agent => agent.id), ['supervisor', 'researcher', 'coder', 'reviewer', 'reflector']);
  assert.ok(graph.agents.every(agent => agent.title && agent.role === agent.id));
  assert.deepEqual(graph.relationships.map(({ from, to }) => `${from}>${to}`).sort(), [
    'supervisor>researcher', 'researcher>coder', 'coder>reviewer', 'reviewer>reflector',
    'reflector>supervisor', 'reviewer>supervisor', 'reflector>researcher',
  ].sort());
  assert.ok(graph.relationships.every(link => link.label && link.from !== link.to));
});

test('factor workflow freezes collaboration once and reuses each Agent identity across rounds and final selection', async t => {
  const f = await fixture({ evaluator: evaluate }); t.after(() => f.runtime.dispose());
  const request = input(); request.config.rounds = 2;
  const created = await f.runtime.create(f.main, request), done = await finished(f, created.id);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  const root = f.jobs.get(done.workflow.id), graph = root.options.task.collaboration;
  assert.deepEqual(graph, collaboration()); assert.equal(root.options.task.agentId, undefined);
  assert.ok(done.tasks.length > graph.agents.length, 'Several assignments belong to the same stable identities');
  for (const task of done.tasks) {
    const child = f.jobs.get(task.runRef.id);
    assert.equal(child.parentRunId, done.workflow.id);
    assert.equal(child.options.task.agentId, task.role);
    assert.equal(child.options.task.role, task.role);
    assert.equal(child.options.task.stage, task.mode);
    assert.equal(child.options.task.iteration, task.round);
    assert.ok(graph.agents.some(agent => agent.id === child.options.task.agentId));
  }
  for (const agent of graph.agents) {
    const turns = done.tasks.filter(task => task.role === agent.id);
    assert.ok(turns.length >= 1);
    assert.deepEqual(new Set(turns.map(task => f.jobs.get(task.runRef.id).options.task.agentId)), new Set([agent.id]));
    assert.ok(new Set(turns.map(task => task.round)).size >= 2);
  }
  const selection = done.tasks.find(task => task.mode === 'selection');
  assert.equal(f.jobs.get(selection.runRef.id).options.task.agentId, 'supervisor');
  assert.ok(f.saved.emitted.some(event => event.type === 'handoff'), 'Keep actual result-consumption evidence for audit');
  assert.equal(graph.agents.length, 5, 'Assignments and evaluator operations do not grow the collaboration');
});
