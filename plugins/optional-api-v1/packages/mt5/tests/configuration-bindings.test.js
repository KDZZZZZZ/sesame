import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import manifest from '../capabilities.json' with { type: 'json' };
import { Value } from '@sesame/plugin-sdk/schema/value';
import { configurationStatus, changesSchema } from '../backend/configuration.js';
import { records } from '../backend/records.js';
import { createCapabilities } from '../tools/dependencies.js';

const at = (value, path) => path.split('/').slice(1).reduce((current, key) => current?.[key], value);
const put = (value, path, input) => {
  const keys = path.split('/').slice(1), leaf = keys.pop();
  keys.reduce((current, key) => current[key] ??= {}, value)[leaf] = input;
};
const requirements = (id, input) => manifest.capabilities.find(row => row.id === id).configurationRequirements?.filter(row => !row.optional && (!row.when || Value.Check(row.when, input))).map(row => row.field) ?? [];

test('unified MT5 fields read the existing redacted settings and write valid existing update inputs', () => {
  const settings = { version: 4, servers: Object.fromEntries(['terminal', 'metaeditor', 'marketdata'].map(server => [server, {
    url: server === 'marketdata' ? 'https://www.metatrader.com/mcp' : 'http://127.0.0.1:22346/mcp', enabled: true, authenticated: true,
  }])), account: { login: '123', server: 'Fixture', password_configured: true },
  tester_agent: { address: '127.0.0.1', port: 2000, password_configured: true }, allow_trading: false, allow_host_operations: false };
  settings.account.password = 'fixture-account-secret';
  settings.servers.terminal.token = 'fixture-terminal-secret';
  settings.tester_agent.password = 'fixture-tester-secret';
  const read = configurationStatus({ official: { settings: () => settings } });
  const updateSchema = manifest.capabilities.find(row => row.id === 'mt5_update_configuration').inputSchema;
  const fields = manifest.configuration.fields.filter(field => field.binding.read === 'configuration.read');
  assert.equal(fields.length, 17);
  for (const field of fields) {
    const binding = field.binding;
    assert.equal(binding.read, 'configuration.read'); assert.equal(binding.update, 'mt5_update_configuration');
    assert.equal(at(read, binding.versionPath), 4);
    if (field.schema.writeOnly) { assert.equal(binding.valuePath, undefined); assert.equal(at(read, binding.configuredPath), true); }
    const value = field.schema.writeOnly ? 'fixture-secret' : at(read, binding.valuePath);
    assert.equal(Value.Check(field.schema, value), true, field.id);
    const input = { command_id: 'configure-field-fixture-01', expected_version: at(read, binding.versionPath) };
    put(input, binding.writePath, value);
    assert.equal(Value.Check(updateSchema, input), true, field.id);
    assert.equal(Value.Check(changesSchema, input.changes), true, field.id);
  }
  assert.doesNotMatch(JSON.stringify(read), /fixture-(?:account|terminal|tester)-secret/);
  const status = manifest.capabilities.find(row => row.id === 'configuration.read');
  assert.deepEqual(status.consumers, ['host']);
  assert.equal(Value.Check(status.outputSchema, read), true);
});

test('all configured MT5 fields have accurate capability usage and native paths keep automatic discovery optional', () => {
  for (const field of manifest.configuration.fields) assert.ok(manifest.capabilities.some(capability => capability.configurationRequirements?.some(item => item.field === field.id)), field.id);
  const paths = manifest.configuration.fields.filter(field => field.binding.read === 'dependencies.read');
  assert.deepEqual(paths.map(field => field.id), ['terminal_directory', 'data_directory', 'python', 'wine', 'wine_prefix']);
  for (const field of paths) {
    assert.equal(field.binding.update, 'dependencies.configure'); assert.equal(field.binding.versionPath, '/version');
    assert.equal(field.binding.clearValue, null);
    const uses = manifest.capabilities.flatMap(capability => capability.configurationRequirements ?? []).filter(item => item.field === field.id);
    assert.ok(uses.length); assert.ok(uses.every(item => item.optional === true));
  }
  const optional = (id, input) => manifest.capabilities.find(item => item.id === id).configurationRequirements?.filter(item => item.optional && (!item.when || Value.Check(item.when, input))).map(item => item.field) ?? [];
  assert.ok(optional('mt5_compile', {}).includes('python'));
  assert.ok(!optional('mt5_start_terminal', {}).includes('python'));
  assert.ok(optional('mt5_cache', { action: 'sync' }).includes('terminal_url'));
  assert.deepEqual(optional('mt5_cache', { action: 'bars' }), []);
  assert.deepEqual(optional('mt5_backtest', { action: 'get' }), []);
  assert.ok(optional('mt5_system', { server: 'launcher', tool: 'tester_agent_install' }).includes('tester_password'));
  assert.ok(!optional('mt5_test', { server: 'terminal', tool: 'tester_get_status' }).includes('tester_password'));
  assert.deepEqual(requirements('dependencies.read', {}), []);
  assert.deepEqual(requirements('dependencies.configure', {}), []);
});

test('dependency adapters reuse the original records, command receipts and CAS without probing or starting native processes', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mt5-configuration-authority-'));
  const host = { context: { storageRoot: directory, sessionId: 'main', kind: 'main', pythonPath: '' } };
  t.after(() => { records(host).close(); rmSync(directory, { recursive: true, force: true }); });
  let closed = 0;
  const mt5 = { host, options: { disabled: true }, jobs: new Map(), tester: { pending: new Map() }, deployments: { list: () => [] },
    official: { jobs: new Map(), python: { close: async () => { closed++; } } } };
  const handlers = new Map(createCapabilities(host, mt5).map(item => [item.name, item.execute]));
  const read = handlers.get('dependencies.read'), configure = handlers.get('dependencies.configure');
  assert.equal(typeof read, 'function'); assert.equal(typeof configure, 'function');
  const first = await read({}); assert.equal(first.version, 1); assert.equal(closed, 0);
  const descriptor = manifest.capabilities.find(item => item.id === 'dependencies.read');
  assert.deepEqual(descriptor.consumers, ['host']); assert.equal(Value.Check(descriptor.outputSchema, first), true);
  const input = { command_id: 'native-path-configure-01', expected_version: 1, changes: { wine_prefix: directory } };
  const updated = await configure(input);
  assert.equal(updated.version, 2); assert.equal(closed, 1); assert.equal(mt5.compilerReady, false);
  assert.deepEqual(await handlers.get('mt5_dependencies')({ ...input, action: 'configure' }), updated, 'legacy retries reuse the same command receipt');
  assert.equal((await read({})).settings.wine_prefix, directory);
  await assert.rejects(configure({ ...input, command_id: 'native-path-stale-01' }), { code: 'version_conflict' });
  const clear = { command_id: 'native-path-clear-01', expected_version: 2, changes: { terminal_directory: null, data_directory: null, python: null, wine: null, wine_prefix: null } };
  assert.equal((await configure(clear)).version, 3);
  assert.ok(Object.values((await read({})).settings).every(value => value === null));
  assert.equal(records(host).list('mt5_dependency_command').length, 2);
  host.context.kind = 'service';
  assert.equal((await read({})).version, 3);
  await assert.rejects(configure({ ...clear, command_id: 'native-path-child-01', expected_version: 3 }), error => error.status === 403);
});

test('configuration prerequisites follow the chosen native service and preserve diagnostic and offline paths', () => {
  assert.deepEqual(requirements('mt5_call', { server: 'marketdata' }), ['marketdata_token']);
  assert.deepEqual(requirements('mt5_call', { server: 'terminal' }), ['terminal_token']);
  assert.deepEqual(requirements('mt5_call', { server: 'python' }), []);
  assert.deepEqual(requirements('mt5_backtest', { action: 'get' }), []);
  assert.deepEqual(requirements('mt5_backtest', { action: 'start' }), ['account_login', 'account_server', 'account_password']);
  assert.ok(requirements('market.subscribeBars', {}).includes('terminal_token'));
  assert.equal(requirements('market.queryBars', {}).includes('terminal_token'), false, 'retained history is still readable when the native connection is unavailable');
  assert.equal(requirements('mt5_trading_context', {}).includes('terminal_token'), false, 'Python account reads do not require Terminal MCP');
  for (const id of ['configuration.read', 'mt5_settings', 'mt5_update_configuration', 'mt5_import_configuration', 'mt5_connect', 'mt5_catalog', 'mt5_dependencies', 'mt5_start_terminal', 'mt5_project', 'mt5_target']) assert.deepEqual(requirements(id, {}), [], id);
  const ids = new Set(manifest.configuration.fields.map(field => field.id));
  for (const capability of manifest.capabilities) for (const row of capability.configurationRequirements ?? []) assert.ok(ids.has(row.field), `${capability.id}: ${row.field}`);
});
