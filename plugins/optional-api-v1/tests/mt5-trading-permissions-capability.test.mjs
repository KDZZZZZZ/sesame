import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { createCapabilities } from '../packages/mt5/index.js';
import { setInstance } from '../packages/mt5/state.js';

const manifest = JSON.parse(await readFile(new URL('../packages/mt5/capabilities.json', import.meta.url), 'utf8'));
const plugin = JSON.parse(await readFile(new URL('../packages/mt5/plugin.json', import.meta.url), 'utf8'));
const id = 'mt5_trading_permissions';
const definition = manifest.capabilities.find(item => item.id === id);

test('permission preparation is discoverable, declares its writes and accepts only its two explicit contracts', () => {
  assert.ok(plugin.main_tool_names.includes(id));
  assert.ok(definition.effects.includes('may-restart-terminal'));
  assert.ok(definition.effects.includes('application-configuration'));
  assert.equal(Value.Check(definition.inputSchema, { action: 'read' }), true);
  assert.equal(Value.Check(definition.inputSchema, { action: 'enable', command_id: 'permission-enable-001', expected_version: 8 }), true);
  for (const input of [
    {}, { action: 'enable' }, { action: 'read', command_id: 'permission-enable-001' },
    { action: 'enable', command_id: 'permission-enable-001', expected_version: 8, account: 'another' },
    { action: 'enable', command_id: 'permission-enable-001', expected_version: 0 },
  ]) assert.equal(Value.Check(definition.inputSchema, input), false);
  const fields = new Set(manifest.configuration.fields.map(field => field.id));
  for (const requirement of definition.configurationRequirements) assert.ok(fields.has(requirement.field));
  assert.deepEqual(definition.configurationRequirements.filter(item => !item.optional).map(item => item.field), ['terminal_token', 'account_login', 'account_server']);
  assert.equal(definition.configurationRequirements.find(item => item.field === 'account_password').optional, true, 'A cached terminal login does not require a new password');
});

test('public plugin dispatch returns separate native permission states without writes, and rejects delegated mutation', async () => {
  const host = { context: { kind: 'main', sessionId: 'conv_fixture' } };
  const account = { login: '7001', server: 'Fixture-Demo', type: 'demo', read_only: false };
  let reads = 0;
  const mt5 = {
    official: { config: { version: 8, account, allow_trading: true }, redact: value => value },
    market: { connected: async () => { reads++; return { scope: account, info: { account, terminal: { server_connected: true, experts_trade_allowed: false, mcp_trade_allowed: true } } }; } },
  };
  setInstance(host, { mt5 });
  try {
    const capability = createCapabilities(host).find(item => item.name === id);
    const output = await capability.execute({ action: 'read' });
    assert.equal(output.configuration_version, 8);
    assert.equal(output.account.read_only, false);
    assert.equal(output.application.allow_trading, true);
    assert.equal(output.terminal.experts_trade_allowed, false);
    assert.equal(output.terminal.mcp_trade_allowed, true);
    assert.equal(Value.Check(definition.outputSchema, output), true);
    assert.equal(reads, 1);
    host.context.kind = 'subagent';
    await assert.rejects(capability.execute({ action: 'enable', command_id: 'permission-enable-001', expected_version: 8 }), { code: 'FORBIDDEN' });
    assert.equal(reads, 1, 'Delegate rejection occurs before native inspection or mutation');
  } finally { setInstance(host, null); }
});
