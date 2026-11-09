import test from 'node:test';
import assert from 'node:assert/strict';
import { researchPlan, workflowCollaboration } from '../packages/investment-research/src/workflow.js';
import { tradingPlan } from '../packages/trading-decision/workflow.js';

test('research plans select, reorder and add members with one explicit final synthesizer', () => {
  const plan = researchPlan({ stages: [[{ id: 'facts', role: 'fundamentals' }], [{ id: 'challenge', role: 'custom', instructions: 'Test the strongest alternative explanation.' }], [{ id: 'editor', role: 'manager' }]], synthesis: 'editor' });
  assert.deepEqual(plan.stages, [['facts'], ['challenge'], ['editor']]);
  assert.equal(plan.members.challenge.role, 'custom');
  assert.equal(workflowCollaboration(plan).agents.length, 3);
  assert.equal(researchPlan().synthesis, 'manager');
  assert.throws(() => researchPlan({ stages: [[{ id: 'facts', role: 'custom' }]], synthesis: 'facts' }), /instructions/);
  assert.throws(() => researchPlan({ stages: [[{ id: 'same', role: 'market' }], [{ id: 'same', role: 'manager' }]], synthesis: 'same' }), /unique/);
  assert.throws(() => researchPlan({ stages: [[{ id: 'manager', role: 'manager' }, { id: 'market', role: 'market' }]], synthesis: 'manager' }), /final/);
});

test('trading plans support ordered read-only reviewers and decision-only delivery', () => {
  const plan = tradingPlan({ reviews: [{ id: 'risk_check', instructions: 'Check concentration.' }], execute: false });
  assert.equal(plan.execute, false); assert.equal(plan.reviews[0].id, 'risk_check');
  assert.deepEqual(tradingPlan(), { reviews: [], execute: true });
  assert.throws(() => tradingPlan({ reviews: [{ id: 'executor' }] }), /reserved/);
  assert.throws(() => tradingPlan({ execute: 'false' }), /boolean/);
  assert.throws(() => tradingPlan({ execute: null }), /boolean/);
  assert.throws(() => tradingPlan({ reviews: null }), /reviews/);
});

test('workflow member ids cannot alias inherited JavaScript dictionary properties', () => {
  for (const id of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.throws(() => researchPlan({ stages: [[{ id, role: 'manager' }]], synthesis: id }), { code: 'INVALID_WORKFLOW' });
    assert.throws(() => tradingPlan({ reviews: [{ id }] }), { code: 'INVALID_WORKFLOW' });
  }
});
