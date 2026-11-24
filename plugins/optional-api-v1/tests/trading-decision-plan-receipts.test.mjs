import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentCapabilities } from '../packages/trading-decision/agent-tools.js';
import { setInstance } from '../packages/trading-decision/state.js';
import { fixture, unchanged } from './trading-decision-plans-fixture.mjs';

test('plan and Run receipts distinguish a frozen decision-only review from an executable target', async t => {
  const f = await fixture(t);
  setInstance(f.main, { runtime: f.runtime });
  t.after(() => setInstance(f.main, null));
  const tools = new Map(createAgentCapabilities(f.main).map(tool => [tool.name, tool]));
  const call = (name, args) => tools.get('trading_decision_' + name).execute(args);

  const executable = await call('plan', { action: 'save', plan: f.input({ id: 'executable' }) });
  assert.equal(executable.executionMode, 'target_execution');
  assert.equal(executable.supportsAttachedStops, false);
  assert.equal(f.storage.list('runs').length, 0);
  const review = await call('plan', { action: 'save', plan: f.input({ workflow: { execute: false } }) });
  assert.equal(review.executionMode, 'decision_only');
  const args = { plan_id: review.id, request_id: 'one-review' };
  const queued = await call('run', args);
  assert.equal(queued.executionMode, 'decision_only');
  assert.equal(queued.targetCount, null);
  assert.equal(queued.executionDisposition, null);

  await f.waitFor(() => f.active('manager').length === 1);
  const manager = f.active('manager')[0], child = f.child(manager.id);
  await f.call('context', child, queued.id);
  await f.call('decide', child, queued.id, unchanged);
  f.finish(manager.id);
  await f.waitFor(() => f.runtime.run(queued.id).executionDisposition === 'decision_only');
  const read = await call('runs', { action: 'read', run_id: queued.id });
  const { items } = await call('runs', { action: 'list', plan_id: review.id });
  for (const receipt of [read, items[0], await call('run', args)]) {
    assert.equal(receipt.executionMode, 'decision_only');
    assert.equal(receipt.executionDisposition, 'decision_only');
    assert.equal(receipt.targetCount, 0);
    assert.equal(receipt.supportsAttachedStops, false);
  }
  assert.equal(f.brokerCalls.some(call => call.name === 'fixture_apply'), false);
  assert.equal(f.storage.list('runs').length, 1);
  assert.equal(Object.hasOwn(f.runtime.run(queued.id), 'executionMode'), false);
});
