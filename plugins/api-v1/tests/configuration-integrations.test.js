import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCapabilities } from '../packages/configuration/index.js';

test('configuration adds unified immediate wrappers while preserving legacy entry points', async () => {
  const calls = [], host = { capabilities: { invoke: async (...args) => { calls.push(args); return { type: 'result', value: { available: true } }; } }, views: { open: input => input } };
  const capabilities = createCapabilities(host);
  const declared = JSON.parse(await readFile(new URL('../packages/configuration/capabilities.json', import.meta.url)));
  assert.deepEqual(capabilities.map(item => item.name), declared.capabilities.map(item => item.id));
  for (const suffix of ['catalog', 'check', 'apply']) {
    const id = `configuration_integration_${suffix}`, value = { plugin_id: 'fixture/source' };
    const operation = capabilities.find(item => item.name === id);
    // SDK definitions expose the declared execute boundary to host dispatch.
    await operation.execute(value);
    assert.equal(calls.at(-1)[0], `host.configuration.${suffix}`);
    assert.deepEqual(calls.at(-1)[1], value);
  }
  const apply = declared.capabilities.find(item => item.id === 'configuration_integration_apply');
  assert.equal(apply.execution, 'immediate'); assert.equal(apply.inputSchema.properties.values.writeOnly, true);
  assert.deepEqual(await capabilities.find(item => item.name === 'configuration_open').execute({}), { surface: 'settings' });
  assert.deepEqual(await capabilities.find(item => item.name === 'configuration_integration_open').execute({}), { surface: 'integrations' });
});

test('configuration forwards original credentials and rejects display placeholders', async () => {
  const calls = [], host = { capabilities: { invoke: async (...args) => { calls.push(args); return { type: 'result', value: { status: 'applied' } }; } } };
  const tools = createCapabilities(host), apply = tools.find(item => item.name === 'configuration_integration_apply'), update = tools.find(item => item.name === 'configuration_update');
  const values = { api_key: 'fixture-original-key', api_secret: 'fixture-original-secret' };
  await apply.execute({ plugin_id: 'sesame/binance', values });
  assert.deepEqual(calls[0][1].values, values);
  for (const execute of [() => apply.execute({ values: { api_key: '[redacted]' } }), () => update.execute({ target: 'environment', changes: { BINANCE_API_KEY: '[redacted]' } })]) {
    await assert.rejects(async () => execute(), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(calls.length, 1, 'invalid placeholders never reach the configuration writer');
  await apply.execute({ values: { environment: 'testnet', api_key: null } });
  assert.equal(calls.at(-1)[1].values.api_key, null, 'explicit clearing stays supported');
});
