import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Value } from '@sesame/plugin-sdk/schema/value';

test('configuration tool metadata exposes bounded, credential-free account choices and preference versions', () => {
  const declared = JSON.parse(readFileSync(new URL('../packages/configuration/capabilities.json', import.meta.url)));
  const schema = declared.capabilities.find(capability => capability.id === 'configuration_update').inputSchema;
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
