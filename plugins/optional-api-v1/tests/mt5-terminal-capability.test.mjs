import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { createCapabilities } from '../packages/mt5/index.js';
import { setInstance } from '../packages/mt5/state.js';
import { MT5Official } from '../packages/mt5/backend/official.js';
import { records } from '../packages/mt5/backend/records.js';
import { digest, now } from '../packages/mt5/backend/support.js';
import { stableJSON } from '../packages/mt5/backend/contracts.js';

const manifest = JSON.parse(await readFile(new URL('../packages/mt5/capabilities.json', import.meta.url), 'utf8'));
const plugin = JSON.parse(await readFile(new URL('../packages/mt5/plugin.json', import.meta.url), 'utf8'));
const commandId = 'open-selected-terminal-01';
const definition = manifest.capabilities.find(item => item.id === 'mt5_start_terminal');
const tool = host => createCapabilities(host).find(item => item.name === 'mt5_start_terminal');

test('terminal startup is an explicitly declared main-agent capability with a complete minimal contract', () => {
  assert.ok(definition, 'Terminal launch must not require guessing a native launcher method');
  assert.ok(tool({}));
  assert.ok(plugin.main_tool_names.includes(definition.id));
  assert.deepEqual(definition.consumers, ['agent', 'host']);
  assert.deepEqual(Object.keys(definition.inputSchema.properties), ['command_id']);
  assert.equal(Value.Check(definition.inputSchema, { command_id: commandId }), true);
  assert.equal(Value.Check(definition.inputSchema, { command_id: commandId, terminal: 'another.exe' }), false);
  assert.ok(definition.usage.prerequisites.length);
  assert.ok(definition.usage.limitations.length);
});

async function fixture(t, { native = true, portable = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mt5-terminal-capability-'));
  const host = { context: { storageRoot: root, pluginId: 'sesame/mt5', kind: 'main', sessionId: 'conv_main' } };
  const installation = native ? { directory: join(root, 'installed'), terminal: join(root, 'installed/terminal64.exe'), dataDirectory: join(root, portable ? 'installed' : 'terminal-data') } : null;
  const official = await new MT5Official(host, installation).init();
  const mt5 = { native: installation, official };
  setInstance(host, { mt5 });
  t.after(async () => {
    setInstance(host, null);
    await official.close(); records(host).close();
    assert.equal(resolve(root, '..'), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  return { host, official, mt5, invoke: input => tool(host).execute(input) };
}

test('launch forwards only the configured terminal and existing data mode, without MCP keys, login overrides or custom INI', async t => {
  for (const portable of [false, true]) {
    const f = await fixture(t, { portable }), calls = [];
    assert.equal(f.official.config.servers.terminal.token, '');
    f.official.config.startup_ini = '[StartUp]\nExpert=NotRequested\n';
    f.official.config.account = { login: '12345678', server: 'Fixture-Demo' };
    const expected = { id: commandId, status: 'returned', result: { status: 'spawned', pid: 12345 } };
    f.official.call = async (...args) => { calls.push(args); return expected; };
    assert.deepEqual(await f.invoke({ command_id: commandId }), expected);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][0], { command_id: commandId, server: 'launcher', tool: 'start_terminal', arguments: { portable } });
    assert.equal(calls[0][1], 'conv_main');
  }
});

test('missing native installation and disabled launch permission fail before dispatch', async t => {
  const absent = await fixture(t, { native: false });
  await assert.rejects(absent.invoke({ command_id: commandId }), error => error.code === 'PREREQUISITE_REQUIRED' && error.details?.submission_attempted === false);
  assert.deepEqual(records(absent.host).list('mt5_command'), []);
  const denied = await fixture(t);
  denied.official.config.allow_trading = false;
  await assert.rejects(denied.invoke({ command_id: commandId }), error => error.code === 'mt5_permission_denied' && error.details?.submission_attempted === false);
  assert.equal(denied.official.config.allow_trading, false);
  assert.deepEqual(records(denied.host).list('mt5_command'), []);
});

test('subagents and undeclared launch arguments cannot bypass the main-agent entry', async t => {
  const f = await fixture(t);
  f.official.call = () => assert.fail('Invalid or delegated launch must not reach the native command path');
  await assert.rejects(f.invoke({ command_id: commandId, profile: 'Different account' }), { code: 'invalid_request' });
  f.host.context.kind = 'subagent';
  await assert.rejects(f.invoke({ command_id: commandId }), { code: 'FORBIDDEN' });
});

test('returned and unknown native launch receipts are reused with the same command ID without starting again', async t => {
  for (const status of ['returned', 'unknown']) {
    const f = await fixture(t), data = { server: 'launcher', tool: 'start_terminal', arguments: { portable: false } };
    const receipt = { id: commandId, conversation_id: 'conv_main', ...data, operation_class: 'trading', status,
      result: status === 'returned' ? { status: 'spawned', pid: 12345, message: 'Launch requested only' } : null,
      error: status === 'unknown' ? 'Outcome unknown; inspect before retrying' : null, dataset_id: null, created_at: now(), completed_at: now() };
    delete receipt.arguments;
    records(f.host).put('mt5_command', { ...receipt, fingerprint: digest(stableJSON({ ...data, owner: 'conv_main', version: f.official.config.version })) });
    f.official.tools = () => assert.fail('A repeated native command must not rediscover or launch the terminal');
    assert.deepEqual(await f.invoke({ command_id: commandId }), receipt);
    assert.equal(Value.Check(definition.outputSchema, receipt), true);
    assert.equal(records(f.host).list('mt5_command').length, 1);
  }
});
