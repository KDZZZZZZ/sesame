import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { createCapabilities } from '../packages/configuration/index.js';

test('model configuration exposes only the context window and leaves omitted settings unchanged', async () => {
  const declared = JSON.parse(readFileSync(new URL('../packages/configuration/capabilities.json', import.meta.url)));
  const schema = declared.capabilities.find(capability => capability.id === 'configuration_update').inputSchema;
  const model = schema.properties.changes.anyOf.find(candidate => candidate.properties?.context_window);
  assert.equal(Object.hasOwn(model.properties, 'max_tokens'), false);
  assert.equal(Object.hasOwn(model.properties.context_window, 'default'), false, 'a patch must not default an omitted existing window');
  assert.match(model.properties.context_window.description, /256000/);
  const args = { command_id: 'model-context-test-01', target: 'model', changes: { provider: 'fixture', model: 'fixture-model' } };
  assert.equal(Value.Check(schema, args), true);
  for (const context_window of [1024, 200000, 256000, 10000000]) {
    assert.equal(Value.Check(schema, { ...args, changes: { ...args.changes, context_window } }), true);
  }
  for (const context_window of [1023, 10000001, 256000.5, '256000']) {
    assert.equal(Value.Check(model, { ...args.changes, context_window }), false);
  }
  assert.equal(Value.Check(schema, { ...args, changes: { ...args.changes, max_tokens: 8192 } }), false);

  const calls = [], host = { capabilities: { invoke: async (...input) => { calls.push(input); return { type: 'result', value: { status: 'queued' } }; } } };
  const update = createCapabilities(host).find(capability => capability.name === 'configuration_update');
  await update.execute(args);
  assert.deepEqual(calls[0].slice(0, 2), ['host.configuration.update', args]);
  assert.equal(Object.hasOwn(calls[0][1].changes, 'context_window'), false);
  await update.execute({ ...args, changes: { ...args.changes, context_window: 200000 } });
  assert.equal(calls[1][1].changes.context_window, 200000, 'an explicit existing window stays unchanged');
});

test('configuration instructions describe the 256k fallback without advertising removed output settings', () => {
  for (const file of ['prompt.md', 'README.md', 'skills/configure-application/SKILL.md']) {
    const text = readFileSync(new URL(`../packages/configuration/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bmax_tokens\b/, file);
    assert.match(text, /256000/, file);
    assert.match(text, /省略.*保留/, file);
  }
});

test('configuration tool metadata exposes bounded, credential-free account choices and preference versions', () => {
  const declared = JSON.parse(readFileSync(new URL('../packages/configuration/capabilities.json', import.meta.url)));
  const schema = declared.capabilities.find(capability => capability.id === 'configuration_update').inputSchema;
  const source = { provider: { pluginId: 'sesame/example', providerId: 'account' }, connection: { id: 'configured', revision: 'exact-revision' }, accountId: 'a' };
  const args = { command_id: 'preferences-test-01', target: 'preferences', expected_version: 2, changes: { account_view: { source } } };
  assert.equal(Value.Check(schema, args), true);
  assert.equal(Value.Check(schema, { ...args, changes: { locale: 'en' } }), true);
  const selected = { ...source, accountConnectionId: 'native-account-connection' };
  assert.equal(Value.Check(schema, { ...args, changes: { account_view: { selected: [selected] } } }), true);
  assert.equal(Value.Check(schema, { ...args, changes: { account_view: { selected: [] } } }), true);
  assert.equal(Value.Check(schema, { ...args, changes: { account_view: { sources: [selected] } } }), true);
  for (const change of [
    { account_view: { source: { ...source, password: 'private-fixture' } } },
    { account_view: { source: { ...source, connection: { id: 'configured' } } } },
    { account_view: { sources: Array.from({ length: 33 }, () => source) } },
    { account_view: { selected: Array.from({ length: 33 }, () => selected) } },
    { account_view: { selected: [{ provider: source.provider }] } },
    { account_view: { selected: [{ ...selected, password: 'private-fixture' }] } },
    { account_view: {} },
  ]) assert.equal(Value.Check(schema, { ...args, changes: change }), false);
});
