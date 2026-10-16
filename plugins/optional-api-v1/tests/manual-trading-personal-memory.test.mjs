import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../packages/manual-trading/plans.js';
import { taskTools, taskPlugins } from '../packages/manual-trading/team.js';
import { fixture, unchanged } from './manual-trading-plans-fixture.mjs';

const memoryTools = ['memory_trading_context', 'memory_read'];
const memory = f => f.entries.find(entry => entry.id === 'sesame/memory');
const removeMemory = f => f.entries.splice(f.entries.indexOf(memory(f)), 1);
const savedRun = (f, plan, id) => f.runtime.save({ id, planId: plan.id, plan, status: 'queued', createdAt: f.time, tasks: [], reports: [] });

test('only risk and manager receive the two personal-memory reads; executor authority is unchanged', async t => {
  const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input({ mode: 'team', research: { plugins: ['custom/research'] } }));
  for (const role of ROLES) {
    const expected = ['risk', 'manager'].includes(role) ? memoryTools : [];
    assert.deepEqual(taskTools(plan, role).filter(name => name.startsWith('memory_')), expected, role);
    assert.equal(taskPlugins(plan, role).includes('sesame/memory'), expected.length > 0, role);
  }
  assert.deepEqual(taskTools(plan, 'executor'), ['manual_trading_apply']);
  assert.deepEqual(taskPlugins(plan, 'executor'), plan.execution.plugins);
});

test('both workflow modes report missing personal-memory dependencies before Agent or account dispatch', async t => {
  const missing = [
    ['plugin absent', removeMemory, 'PREREQUISITE_REQUIRED', /sesame\/memory/],
    ['plugin disabled', f => { memory(f).state = 'disabled'; }, 'PREREQUISITE_REQUIRED', /sesame\/memory/],
    ...memoryTools.map(name => [name, f => { memory(f).tools = memory(f).tools.filter(tool => tool !== name); }, 'TOOL_NOT_DELEGATABLE', new RegExp(name)]),
  ];
  for (const mode of ['single', 'team']) for (const [label, change, code, reason] of missing) await t.test(`${mode}: ${label}`, async t => {
    const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input({ mode }));
    const run = savedRun(f, plan, 'preflight-memory'), before = structuredClone(run), reads = f.brokerCalls.length;
    change(f);
    const result = await f.runtime.dependencies(f.main, run.id);
    assert.equal(result.available, false); assert.equal(result.details.cause.code, code); assert.match(result.reason, reason);
    assert.deepEqual(f.runtime.run(run.id), before);
    assert.equal(f.requests.length, 0); assert.equal(f.brokerCalls.length, reads);
  });
});

test('memory disappearing after preflight remains a resumable dependency interruption at role dispatch', async t => {
  for (const role of ['risk', 'manager']) await t.test(role, async t => {
    const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input({ mode: 'team' }));
    const run = savedRun(f, plan, 'dispatch-memory');
    assert.equal((await f.runtime.dependencies(f.main, run.id)).available, true);
    memory(f).tools = memory(f).tools.filter(name => name !== 'memory_read');
    f.runtime.workHosts.set(run.id, f.main);
    await assert.rejects(f.runtime.task(run.id, role, 0, new AbortController().signal), error => {
      assert.equal(error.code, 'DEPENDENCY_UNAVAILABLE');
      assert.equal(error.details.cause.code, 'TOOL_NOT_DELEGATABLE');
      assert.match(error.message, /memory_read/);
      assert.equal(error.details.requirements[0].capability, 'sesame/manual-trading#workflow_dependencies');
      assert.deepEqual(error.details.requirements[0].input, { runId: run.id });
      return true;
    });
    assert.equal(f.requests.length, 0); assert.equal(f.runtime.run(run.id).tasks.length, 0);
  });
});

test('missing memory interrupts the real workflow ledger without producing a failed report or trade', async t => {
  const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input());
  removeMemory(f);
  const run = f.runtime.trigger(plan.id, { kind: 'manual', id: 'memory-required' });
  await f.waitFor(() => f.runtime.run(run.id).status === 'interrupted' && f.runtime.running.size === 0);
  const retained = f.runtime.run(run.id), workflow = f.runs.read(retained.workflow.id);
  assert.equal(workflow.status, 'interrupted'); assert.match(workflow.interrupts[0].reason, /sesame\/memory/);
  assert.equal(workflow.interrupts[0].requirements[0].capability, 'sesame/manual-trading#workflow_dependencies');
  assert.equal(retained.report, undefined); assert.equal(retained.completedAt ?? null, null); assert.equal(retained.execution, undefined);
  assert.equal(f.requests.length, 0); assert.equal(f.brokerCalls.some(call => call.name === 'fixture_apply'), false);
});

test('memory availability cannot expand or block the executor after the manager freezes its decision', async t => {
  const f = await fixture(t), plan = await f.runtime.configure(f.main, f.input());
  const run = f.runtime.trigger(plan.id, { kind: 'manual', id: 'frozen-decision' });
  await f.waitFor(() => f.active('manager').length === 1);
  const manager = f.active('manager')[0];
  assert.deepEqual(manager.request.allowedCalls.filter(call => call.pluginId === 'sesame/memory'), memoryTools.map(capabilityId => ({ pluginId: 'sesame/memory', capabilityId })));
  await f.call('context', f.child(manager.id), run.id);
  await f.call('decide', f.child(manager.id), run.id, unchanged);
  removeMemory(f); f.finish(manager.id);
  await f.waitFor(() => f.active('executor').length === 1);
  const executor = f.active('executor')[0];
  assert.deepEqual(executor.request.allowedCalls, [{ pluginId: 'sesame/manual-trading', capabilityId: 'manual_trading_apply' }]);
  assert.equal((await f.runtime.dependencies(f.main, run.id)).available, true);
  await f.call('apply', f.child(executor.id), run.id); f.finish(executor.id);
  await f.waitFor(() => f.runtime.run(run.id).status === 'completed' && f.runtime.running.size === 0);
});
