import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { createCapabilities } from '../packages/plugin-manager/tools.js';

test('committed manager schemas match the SDK factories and expose only explicit install/update inputs', () => {
  const declarations=JSON.parse(readFileSync(new URL('../packages/plugin-manager/capabilities.json', import.meta.url))).capabilities;
  const tools=declarations.map(item=>({name:item.id,parameters:item.inputSchema}));
  assert.deepEqual(createCapabilities({}).map(item=>item.name),tools.map(item=>item.name));
  const schema = tools.find(tool => tool.name === 'plugin_install_catalog').parameters;
  const args = { plugin_id: 'sesame/mt5', catalog_digest: `sha256:${'1'.repeat(64)}`, command_id: 'schema-catalog-fixture' };
  assert.equal(Value.Check(schema, args), true);
  assert.equal(Value.Check(schema, { ...args, action: 'update', expected_digest: `sha256:${'2'.repeat(64)}` }), true);
  for (const input of [{ ...args, action: 'force' }, { ...args, action: 'update', expected_digest: 'main' }, { ...args, bypass_version: true }]) assert.equal(Value.Check(schema, input), false);
  const create = tools.find(tool => tool.name === 'plugin_create').parameters;
  const native = { command_id: 'schema-native-fixture', name: 'sample', description: 'Fixture', template: 'native', publisher: 'fixture', min_host: '0.2.2' };
  assert.equal(Value.Check(create, native), true);
  assert.equal(Value.Check(create, { ...native, template: 'unknown' }), false);
});

test('management declarations reject identities and conditional inputs that their implementations reject', () => {
  const declarations = JSON.parse(readFileSync(new URL('../packages/plugin-manager/capabilities.json', import.meta.url))).capabilities;
  const schema = id => declarations.find(item => item.id === id).inputSchema;
  const catalog = { plugin_id: 'sesame/mt5', catalog_digest: `sha256:${'1'.repeat(64)}`, command_id: 'catalog-command-0001' };
  const create = { name: 'sample', description: 'Fixture', command_id: 'create-command-0001' };
  for (const [id, input] of [['plugin_install_catalog', catalog], ['plugin_create', create]]) {
    for (const command_id of ['a'.repeat(16), 'A_1-'.repeat(32)]) assert.equal(Value.Check(schema(id), { ...input, command_id }), true, id);
    for (const command_id of ['x', 'a'.repeat(15), 'a'.repeat(129), 'invalid command id', 'invalid/command/id']) {
      assert.equal(Value.Check(schema(id), { ...input, command_id }), false, `${id}: ${command_id}`);
    }
  }
  const digest = `sha256:${'2'.repeat(64)}`;
  for (const input of [catalog, { ...catalog, action: 'install' }, { ...catalog, action: 'update', expected_digest: digest }]) assert.equal(Value.Check(schema('plugin_install_catalog'), input), true);
  for (const input of [{ ...catalog, action: 'update' }, { ...catalog, expected_digest: digest }, { ...catalog, action: 'install', expected_digest: digest }]) assert.equal(Value.Check(schema('plugin_install_catalog'), input), false);
  assert.equal(Value.Check(schema('plugin_read'), { pluginId: 'sesame/ict', part: 'resource' }), false);
  assert.equal(Value.Check(schema('plugin_read'), { pluginId: 'sesame/ict', part: 'resource', path: 'prompt.md' }), true);
  assert.equal(Value.Check(schema('plugin_read'), { pluginId: 'sesame/ict', part: 'manifest' }), true);
});
