import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createCapabilities } from '../index.js';
import { records } from '../backend/records.js';
import { assertTradingTask, verifyExecutionAuthorization } from '../tools/trading-context.js';

function fixture(t, kind = 'main') {
  const root = mkdtempSync(join(tmpdir(), 'mt5-v2-'));
  t.after(() => { records({ context: { storageRoot: root } }).close(); assert.equal(dirname(root), resolve(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  return { context: Object.freeze({ pluginId: 'sesame/mt5', pluginVersion: '1.0.0', pluginRevision: 'sha256:fixture', storageRoot: root, workspaceRoot: root, sessionId: 'session-1', runId: 'run-1', kind }) };
}

test('MT5 factory is pure and all native bindings are explicitly declared', () => {
  const host = new Proxy({}, { get() { throw new Error('Factory touched host'); } });
  const manifest = JSON.parse(readFileSync(new URL('../capabilities.json', import.meta.url)));
  assert.deepEqual(createCapabilities(host).map(row => row.name).sort(), manifest.capabilities.map(row => row.binding.name).sort());
  assert.ok(manifest.sources.some(row => row.contract === 'sesame.market/1'));
  assert.ok(manifest.hooks.some(row => row.event === 'lifecycle.beforeAgentTurn'));
});

test('private SQLite transactions roll back and durable command identities reject reuse', async t => {
  const host = fixture(t), store = records(host);
  assert.throws(() => store.transaction(() => { store.put('commands', { id: 'one', status: 'pending' }); throw new Error('rollback'); }), /rollback/);
  assert.equal(store.get('commands', 'one', true), undefined);
  let called = 0;
  const result = store.idempotent('operation', 'hash-a', () => ({ count: ++called }));
  assert.deepEqual(store.idempotent('operation', 'hash-a', () => { throw new Error('replayed'); }), result);
  assert.throws(() => store.idempotent('operation', 'hash-b', () => ({})), /identity|identity|ID/i);
  store.close();
  assert.deepEqual(records(host).idempotent('operation', 'hash-a', () => { throw new Error('replayed'); }), result);
});

test('delegated trading requires trusted Agent provenance and the frozen execution chain', t => {
  const host = fixture(t, 'subagent'), account = { accountId: '101', server: 'fixture', revision: '1' };
  const input = { role: 'executor', runId: 'workflow-1', tradingPlan: { id: 'plan-1', ownerConversationId: 'owner', account }, execution: { pluginId: 'fixture/execution', applyTool: 'execute', contextTool: 'context', account, context: { backend: 'mt5', account } } };
  assert.throws(() => assertTradingTask(host, account, true, false, { input }), /frozen|provenance|active/);
  const provenance = { agent: { pluginId: 'fixture/workflow', taskId: 'task-1', sessionId: 'session-1', status: 'running', input }, chain: [{ pluginId: 'fixture/workflow', capabilityId: 'fixture/workflow#submit' }, { pluginId: 'fixture/execution', capabilityId: 'fixture/execution#execute' }, { pluginId: 'sesame/mt5', capabilityId: 'sesame/mt5#mt5_trading_order' }] };
  const task = assertTradingTask(host, account, true, false, { provenance });
  assert.deepEqual(verifyExecutionAuthorization(task, 'mt5_trading_order', { command_id: 'command-00000001' }, Date.now(), { provenance }), { command_id: 'command-00000001' });
  assert.throws(() => verifyExecutionAuthorization(task, 'mt5_trading_order', {}, Date.now(), { provenance: { ...provenance, chain: provenance.chain.slice(1) } }), /chain/);
});
