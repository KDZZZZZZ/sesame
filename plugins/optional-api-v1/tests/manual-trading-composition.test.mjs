import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from '@sesame/plugin-sdk/schema';
import { bindExecution, selectResearch, verifyComposition } from '../packages/manual-trading/composition.js';
import { createAgentTools } from '../packages/manual-trading/agent-tools.js';
import { setInstance } from '../packages/manual-trading/state.js';

function fixture(prefix = 'alpha') {
  const entries = [
    { id: `${prefix}/execution`, tools: ['context', 'apply'], delegatable_tools: ['context', 'apply'] },
    { id: 'custom/notes', tools: [], delegatable_tools: [] },
    { id: 'custom/research', tools: ['lookup', 'configure'], delegatable_tools: ['lookup'] },
  ].map(entry => ({ ...entry, digest: `sha256:${entry.id}`, state: 'discoverable', loaded: true }));
  const calls = [], host = { plugins: { inspect: id => entries.find(e => e.id === id), discover: () => ({ items: entries }), isActive: id => entries.some(e => e.id === id && e.loaded) }, tools: { call: async request => {
    calls.push(request); return { account: { accountId: 'a', revision: '1' }, tools: ['context', 'apply'], readTools: ['context'], taskContext: { opaqueBinding: prefix }, quantityRules: { unit: 'contracts', signed: true, integer: true } };
  } } };
  return { host, entries, calls, input: { plugin_id: `${prefix}/execution`, context_tool: 'context', apply_tool: 'apply', arguments: { binding_id: 'chosen' } } };
}

test('execution is selected by a generic tool binding, accepts unrelated implementations and never selects a backend', async () => {
  for (const prefix of ['alpha', 'unrelated']) {
    const f = fixture(prefix), value = await bindExecution(f.host, f.input);
    assert.equal(value.pluginId, `${prefix}/execution`);
    assert.equal(value.quantityRules.unit, 'contracts');
    assert.deepEqual(value.context, { opaqueBinding: prefix });
    assert.deepEqual(f.calls, [{ pluginId: `${prefix}/execution`, name: 'context', arguments: { binding_id: 'chosen', action: 'identity' } }]);
    assert.equal('backend' in value, false);
  }
  const f = fixture();
  await assert.rejects(bindExecution(f.host), { code: 'EXECUTION_REQUIRED' });
  assert.equal(f.calls.length, 0);
});

test('arbitrary method and skill plugins compose without main-only tools or automatic loading', () => {
  const f = fixture(), selected = selectResearch(f.host, { plugins: ['custom/notes', 'custom/research'] });
  assert.deepEqual(selected.plugins, ['custom/notes', 'custom/research']);
  assert.deepEqual(selected.tools, ['lookup']);
  assert.throws(() => selectResearch(f.host, { plugins: ['custom/research'], tools: ['configure'] }), { code: 'TOOL_NOT_DELEGATABLE' });
  f.entries[2].state = 'disabled';
  assert.throws(() => selectResearch(f.host, { plugins: ['custom/research'] }), { code: 'PREREQUISITE_REQUIRED' });
});

test('frozen composition rejects version drift instead of silently changing implementation', async () => {
  const f = fixture(), selected = await bindExecution(f.host, f.input);
  verifyComposition(f.host, selected);
  f.entries[0].digest = 'sha256:changed';
  assert.throws(() => verifyComposition(f.host, selected), { code: 'PLUGIN_CHANGED' });
});

test('legacy export exposes other owners only as unresolved order blockers, not canceled or completed receipts', t => {
  const records = [
    { id: 'own', conversationId: 'owner', kind: 'cancel', status: 'completed', receipt: { details: 'retained' } },
    { id: 'other-order', conversationId: 'other', kind: 'order', status: 'outcome_unknown', receipt: { details: 'private' } },
    { id: 'other-cancel', conversationId: 'other', kind: 'cancel', status: 'outcome_unknown' },
    { id: 'other-completed', conversationId: 'other', kind: 'order', status: 'completed' },
  ];
  const host = { scope: { kind: 'main', conversationId: 'owner' }, storage: { directory: 'composition-export-test', list: () => records },
    tools: { Type, define: (name, _description, _properties, execute) => ({ name, execute }) } };
  setInstance(host, { runtime: { main: caller => assert.equal(caller.scope.kind, 'main') } });
  t.after(() => setInstance(host, null));
  const result = createAgentTools(host).find(tool => tool.name === 'manual_trading_execution_export').execute({});
  assert.deepEqual(result.items, [records[0]]);
  assert.deepEqual(result.unresolved.map(row => row.id), ['other-order']);
  assert.equal('receipt' in result.unresolved[0], false);
  assert.equal(result.complete, true);
});
