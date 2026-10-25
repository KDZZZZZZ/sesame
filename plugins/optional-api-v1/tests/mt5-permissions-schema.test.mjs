import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { createCapabilities } from '../packages/mt5/index.js';

const manifest = JSON.parse(await readFile(new URL('../packages/mt5/capabilities.json', import.meta.url), 'utf8'));
const plugin = JSON.parse(await readFile(new URL('../packages/mt5/plugin.json', import.meta.url), 'utf8'));
const id = 'mt5_trading_permissions';
const definition = manifest.capabilities.find(item => item.id === id);
const hostRoot = process.env.SESAME_HOST_ROOT;

test('permission tool has an explicit object root while retaining its two exact action branches', () => {
  assert.equal(definition.inputSchema.type, 'object', 'Model function parameters require an explicit root object type');
  assert.deepEqual(Object.keys(definition.inputSchema).sort(), ['anyOf', 'type']);
  assert.equal(definition.inputSchema.anyOf.length, 2);
  for (const branch of definition.inputSchema.anyOf) {
    assert.equal(branch.type, 'object');
    assert.equal(branch.additionalProperties, false);
  }
  assert.deepEqual(definition.inputSchema.anyOf.map(branch => branch.required), [['action'], ['action', 'command_id', 'expected_version']]);
});

test('adding the object root preserves acceptance of the original read and enable union', () => {
  const previous = { anyOf: definition.inputSchema.anyOf };
  const cases = [null, undefined, false, 1, 'read', [], ['read'], {}, { action: 'read' },
    { action: 'enable', command_id: 'permission-enable-001', expected_version: 8 }];
  for (const action of [undefined, 'read', 'enable', 'other', null]) {
    for (const command of [undefined, null, 15, 'short', 'permission-enable-001', 'x'.repeat(128), 'x'.repeat(129), 'invalid.command-id']) {
      for (const version of [undefined, null, 0, 1, 8, 1.5, '8']) {
        const value = { ...(action === undefined ? {} : { action }), ...(command === undefined ? {} : { command_id: command }), ...(version === undefined ? {} : { expected_version: version }) };
        cases.push(value, { ...value, account: 'another-account' });
      }
    }
  }
  for (const input of cases) assert.equal(Value.Check(definition.inputSchema, input), Value.Check(previous, input), `Acceptance changed for ${JSON.stringify(input)}`);
  assert.equal(Value.Check(definition.inputSchema, { action: 'read' }), true);
  assert.equal(Value.Check(definition.inputSchema, { action: 'enable', command_id: 'permission-enable-001', expected_version: 8 }), true);
  for (const input of [null, [], {}, { action: 'enable' }, { action: 'read', expected_version: 8 }, { action: 'enable', command_id: 'permission-enable-001', expected_version: 0 }]) {
    assert.equal(Value.Check(definition.inputSchema, input), false);
  }
});

test('registered permission capability and Agent tool parameters preserve the explicit object root', { skip: !hostRoot }, async () => {
  const load = relative => import(pathToFileURL(join(hostRoot, relative)).href);
  const [{ PluginRegistry }, { CapabilityService }, { validateCapabilityDefinitions }] = await Promise.all([
    load('modules/agent/plugin-registry.js'), load('modules/plugins/capability-service.js'), load('modules/plugins/tool-contract.js'),
  ]);
  // Registration and definition projection use only this in-memory settings
  // stub; do not initialize a runtime, open a database or activate native MT5.
  const runtime = { store: { directory: join(tmpdir(), 'sesame-permissions-schema-memory-only'),
    get(collection, key) {
      assert.ok(collection === 'settings' && key === 'plugins' || collection === 'plugin_loadout' && key === 'fixture-main');
      return null;
    } } };
  runtime.plugins = new PluginRegistry(runtime);
  runtime.capabilities = new CapabilityService(runtime);
  const entry = { ...plugin, digest: 'fixture-permissions-schema', capabilityManifest: manifest, resources: [],
    tool_names: manifest.capabilities.filter(item => item.consumers.includes('agent')).map(item => item.id), runtime_status: 'ready' };
  validateCapabilityDefinitions(entry, createCapabilities({ context: { kind: 'main', sessionId: 'fixture-main' } }), 'main');
  runtime.plugins.register(entry);
  const caller = runtime.authority.bind({ sessionId: 'fixture-main', kind: 'main' }, runtime.capabilities.hostEntry);
  const registered = runtime.capabilities.resolve(`${plugin.id}#${id}`, caller).descriptor;
  assert.equal(registered.inputSchema.type, 'object');
  const tool = runtime.plugins.definitions({ conversationId: 'fixture-main' }).find(item => item.name === id);
  assert.ok(tool); assert.equal(typeof tool.execute, 'function');
  assert.equal(tool.parameters.type, 'object');
  assert.deepEqual(tool.parameters, definition.inputSchema);
  assert.notEqual(tool.parameters, registered.inputSchema, 'The actual registry projection keeps its cloned schema');
  const serialized = JSON.parse(JSON.stringify({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  assert.equal(serialized.function.parameters.type, 'object');
  assert.deepEqual(serialized.function.parameters.anyOf, definition.inputSchema.anyOf);
});
