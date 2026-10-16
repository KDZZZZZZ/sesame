import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { createTools } from '../packages/plugin-manager/tools.js';

test('committed manager schemas match the SDK factories and expose only explicit install/update inputs', () => {
  const string = description => Type.String({ description, minLength: 1, maxLength: 20000 });
  const tools = createTools({ tools: { Type, string, optional: description => Type.Optional(string(description)), define: (name, description, properties) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }) }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(tools)), JSON.parse(readFileSync(new URL('../packages/plugin-manager/tools.json', import.meta.url))));
  const schema = tools.find(tool => tool.name === 'plugin_install_catalog').parameters;
  const args = { plugin_id: 'sesame/mt5', catalog_digest: `sha256:${'1'.repeat(64)}`, command_id: 'schema-catalog-fixture' };
  assert.equal(Value.Check(schema, args), true);
  assert.equal(Value.Check(schema, { ...args, action: 'update', expected_digest: `sha256:${'2'.repeat(64)}` }), true);
  for (const input of [{ ...args, action: 'force' }, { ...args, action: 'update', expected_digest: 'main' }, { ...args, bypass_version: true }]) assert.equal(Value.Check(schema, input), false);
});
