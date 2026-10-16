import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bindExecution, selectResearch, verifyComposition } from '../packages/manual-trading/composition.js';
import { createAgentCapabilities } from '../packages/manual-trading/agent-tools.js';
import { setInstance } from '../packages/manual-trading/state.js';
import { records, closeRecords } from '../packages/manual-trading/records.js';

function fixture(prefix = 'alpha') {
  const entries = [
    { id: `${prefix}/execution`, tools: ['context', 'apply'], delegatable_tools: ['context', 'apply'] },
    { id: 'custom/notes', tools: [], delegatable_tools: [] },
    { id: 'custom/research', tools: ['lookup', 'configure'], delegatable_tools: ['lookup'] },
  ].map(entry => ({ ...entry, digest: `sha256:${entry.id}`, state: 'discoverable', loaded: true }));
  const calls = [], host = { plugins: { read: async (id, options) => { assert.deepEqual(options, { part: 'status' }); return entries.find(e => e.id === id); } }, capabilities: {
    list: async ({ pluginId }) => ({ items: entries.filter(entry => !pluginId || entry.id === pluginId).flatMap(entry => entry.delegatable_tools.map(localId => ({ id: `${entry.id}#${localId}`, pluginId: entry.id, localId, consumers: ['agent'] }))) }),
    invoke: async (id, input, options) => {
    calls.push({ id, input, options }); return { type: 'result', value: { account: { accountId: 'a', revision: '1' }, tools: ['context', 'apply'], readTools: ['context'], taskContext: { opaqueBinding: prefix }, quantityRules: { unit: 'contracts', signed: true, integer: true } } };
  } } };
  return { host, entries, calls, input: { plugin_id: `${prefix}/execution`, context_tool: 'context', apply_tool: 'apply', arguments: { binding_id: 'chosen' } } };
}

test('execution is selected by a generic tool binding, accepts unrelated implementations and never selects a backend', async () => {
  for (const prefix of ['alpha', 'unrelated']) {
    const f = fixture(prefix), value = await bindExecution(f.host, f.input);
    assert.equal(value.pluginId, `${prefix}/execution`);
    assert.equal(value.quantityRules.unit, 'contracts');
    assert.deepEqual(value.context, { opaqueBinding: prefix });
    assert.deepEqual(f.calls, [{ id: `${prefix}/execution#context`, input: { binding_id: 'chosen', action: 'identity' }, options: { signal: undefined } }]);
    assert.equal('backend' in value, false);
  }
  const f = fixture();
  await assert.rejects(bindExecution(f.host), { code: 'EXECUTION_REQUIRED' });
  assert.equal(f.calls.length, 0);
});

test('an account-only identity reports the complete missing execution contract and public binding entry', async () => {
  const f = fixture('sesame');
  f.entries[0].id = 'sesame/mt5';
  f.entries[0].delegatable_tools = ['mt5_trading_context', 'mt5_trading_order'];
  f.host.capabilities.invoke = async (id, input) => {
    f.calls.push({ id, input });
    return { type: 'result', value: { account: { accountId: 'fictional-account', revision: '1' } } };
  };
  await assert.rejects(bindExecution(f.host, { plugin_id: 'sesame/mt5', context_tool: 'mt5_trading_context', apply_tool: 'mt5_trading_order' }), error => {
    assert.equal(error.code, 'SOURCE_DATA_INVALID');
    for (const value of ['sesame/mt5#mt5_trading_context', 'tools', 'readTools', 'quantityRules', 'taskContext', 'portfolio_execution_configure', 'plugin_catalog']) assert.ok(error.message.includes(value), value);
    assert.match(error.message, /another|other implementation/i);
    return true;
  });
  assert.deepEqual(f.calls, [{ id: 'sesame/mt5#mt5_trading_context', input: { action: 'identity' } }], 'only the declared identity is read; no execution or repair is attempted');
});

test('missing execution implementations name the dependency and public catalog without invoking a backend', async () => {
  const f = fixture();
  f.host.plugins.read = async () => { throw Object.assign(new Error('plugin absent'), { code: 'PLUGIN_NOT_FOUND' }); };
  await assert.rejects(bindExecution(f.host, f.input), error => {
    assert.equal(error.code, 'PREREQUISITE_REQUIRED');
    for (const value of ['alpha/execution', 'plugin_discover', 'plugin_catalog']) assert.ok(error.message.includes(value), value);
    return true;
  });
  assert.equal(f.calls.length, 0);
});

test('invalid declared read-only membership reports the selected contract without accepting write access', async () => {
  const f = fixture(), invoke = f.host.capabilities.invoke;
  f.host.capabilities.invoke = async (...args) => {
    const result = await invoke(...args);
    result.value.readTools.push('apply');
    delete result.value.quantityRules;
    return result;
  };
  await assert.rejects(bindExecution(f.host, f.input), error => {
    assert.equal(error.code, 'SOURCE_DATA_INVALID');
    assert.match(error.message, /alpha\/execution#context/);
    assert.match(error.message, /readTools/);
    assert.match(error.message, /quantityRules/);
    return true;
  });
});

test('arbitrary method and skill plugins compose without main-only tools or automatic loading', async () => {
  const f = fixture(), selected = await selectResearch(f.host, { plugins: ['custom/notes', 'custom/research'] });
  assert.deepEqual(selected.plugins, ['custom/notes', 'custom/research']);
  assert.deepEqual(selected.tools, ['lookup']);
  await assert.rejects(selectResearch(f.host, { plugins: ['custom/research'], tools: ['configure'] }), { code: 'TOOL_NOT_DELEGATABLE' });
  f.entries[2].state = 'disabled';
  await assert.rejects(selectResearch(f.host, { plugins: ['custom/research'] }), { code: 'PREREQUISITE_REQUIRED' });
});

test('frozen composition rejects version drift instead of silently changing implementation', async () => {
  const f = fixture(), selected = await bindExecution(f.host, f.input);
  await verifyComposition(f.host, selected);
  f.entries[0].digest = 'sha256:changed';
  await assert.rejects(verifyComposition(f.host, selected), { code: 'PLUGIN_CHANGED' });
});

test('legacy export exposes other owners only as unresolved order blockers, not canceled or completed receipts', t => {
  const rows = [
    { id: 'own', conversationId: 'owner', kind: 'cancel', status: 'completed', receipt: { details: 'retained' } },
    { id: 'other-order', conversationId: 'other', kind: 'order', status: 'outcome_unknown', receipt: { details: 'private' } },
    { id: 'other-cancel', conversationId: 'other', kind: 'cancel', status: 'outcome_unknown' },
    { id: 'other-completed', conversationId: 'other', kind: 'order', status: 'completed' },
  ];
  const directory = mkdtempSync(join(tmpdir(), 'composition-export-'));
  const host = { context: { kind: 'main', sessionId: 'owner', storageRoot: directory } };
  for (const row of rows) records(host).put('commands', row);
  setInstance(host, { runtime: { invocation: new AsyncLocalStorage(), main: caller => assert.equal(caller.context.kind, 'main') } });
  t.after(() => { setInstance(host, null); closeRecords(host); rmSync(directory, { recursive: true, force: true }); });
  const result = createAgentCapabilities(host).find(tool => tool.name === 'manual_trading_execution_export').execute({});
  assert.deepEqual(result.items, [rows[0]]);
  assert.deepEqual(result.unresolved.map(row => row.id), ['other-order']);
  assert.equal('receipt' in result.unresolved[0], false);
  assert.equal(result.complete, true);
});
