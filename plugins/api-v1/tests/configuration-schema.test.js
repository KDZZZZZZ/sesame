import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Type } from '@sesame/plugin-sdk/schema';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { createTools } from '../packages/configuration/tools.js';

test('configuration tool metadata exposes bounded, credential-free account choices and preference versions', () => {
  const string = description => Type.String({ description, minLength: 1, maxLength: 20000 });
  const tools = createTools({ tools: { Type, optional: description => Type.Optional(string(description)), define: (name, description, properties) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }) }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(tools)), JSON.parse(readFileSync(new URL('../packages/configuration/tools.json', import.meta.url))));
  const schema = tools.find(tool => tool.name === 'configuration_update').parameters;
  const source = { provider: { pluginId: 'sesame/example', providerId: 'account' }, connection: { id: 'configured', revision: 'exact-revision' }, accountId: 'a' };
  const args = { command_id: 'preferences-test-01', target: 'preferences', expected_version: 2, changes: { account_view: { source } } };
  assert.equal(Value.Check(schema, args), true);
  assert.equal(Value.Check(schema, { ...args, changes: { locale: 'en' } }), true);
  for (const change of [
    { account_view: { source: { ...source, password: 'private-fixture' } } },
    { account_view: { source: { ...source, connection: { id: 'configured' } } } },
    { account_view: { sources: Array.from({ length: 33 }, () => source) } },
    { account_view: {} },
  ]) assert.equal(Value.Check(schema, { ...args, changes: change }), false);
});
