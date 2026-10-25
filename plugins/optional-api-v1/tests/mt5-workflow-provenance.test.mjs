import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyExecutionAuthorization } from '../packages/mt5/tools/trading-context.js';

const task = { pluginId: 'sesame/trading-decision', input: { execution: { pluginId: 'sesame/portfolio-execution', applyTool: 'portfolio_execution_apply' } } };
const chain = [
  { pluginId: 'sesame/trading-decision', capabilityId: 'sesame/trading-decision#trading_decision_apply' },
  { pluginId: 'sesame/portfolio-execution', capabilityId: 'sesame/portfolio-execution#portfolio_execution_apply' },
  { pluginId: 'sesame/mt5', capabilityId: 'sesame/mt5#mt5_trading_order' },
];

test('MT5 accepts the actual full capability IDs of a live workflow execution chain', () => {
  const input = { server: 'python', tool: 'order_send', arguments: { request: { symbol: 'FIXTURE' } } };
  assert.deepEqual(verifyExecutionAuthorization(task, 'mt5_trading_order', input, 1, { provenance: { chain } }), input);
});

test('MT5 rejects local-only, wrong-owner, direct-model and wrong-action chains', () => {
  for (const entries of [
    chain.map(entry => ({ ...entry, capabilityId: entry.capabilityId.split('#')[1] })),
    chain.slice(1),
    chain.map((entry, index) => index === 1 ? { ...entry, capabilityId: 'other/execution#portfolio_execution_apply' } : entry),
    chain.map((entry, index) => index === 2 ? { ...entry, capabilityId: 'sesame/mt5#mt5_trading_pause' } : entry),
  ]) assert.throws(() => verifyExecutionAuthorization(task, 'mt5_trading_order', {}, 1, { provenance: { chain: entries } }), { code: 'FORBIDDEN' });
});
