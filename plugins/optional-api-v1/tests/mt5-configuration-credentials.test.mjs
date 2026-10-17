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
import { changesSchema } from '../packages/mt5/backend/configuration.js';

const manifest = JSON.parse(await readFile(new URL('../packages/mt5/capabilities.json', import.meta.url), 'utf8'));
const definition = manifest.capabilities.find(item => item.id === 'mt5_update_configuration');
const credentials = {
  terminal: '+terminal/fixture="token"', metaeditor: 'editor-fixture-token', marketdata: 'marketdata-fixture-token',
  account: 'account-fixture-"password"', tester: 'tester-fixture-password',
};
const changes = () => ({
  servers: {
    terminal: { url: 'http://127.0.0.1:24446/mcp', enabled: true, token: credentials.terminal },
    metaeditor: { token: credentials.metaeditor }, marketdata: { enabled: true, token: credentials.marketdata },
  },
  account: { login: '700456', server: 'Fixture-Demo', password: credentials.account },
  tester_agent: { address: '127.0.0.1', port: 2001, password: credentials.tester },
});
const request = (input = changes(), version = 1, commandId = 'configure-direct-credentials-01') => ({ command_id: commandId, expected_version: version, changes: input });
function assertNoCredentials(value, additional = []) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of [...Object.values(credentials), ...additional]) {
    assert.equal(text.includes(secret), false, 'Raw credential must not appear in public or audit data');
    assert.equal(text.includes(JSON.stringify(secret).slice(1, -1)), false, 'JSON-escaped credential must not appear in public or audit data');
  }
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mt5-direct-credentials-')), events = [];
  const host = { context: { storageRoot: root, pluginId: 'sesame/mt5', kind: 'main', sessionId: 'conv_main' }, events: { emit: event => events.push(event) } };
  const official = await new MT5Official(host, null).init();
  let notifications = 0;
  const mt5 = { official, monitor: { settingsChanged() { notifications++; } } };
  setInstance(host, { mt5 });
  t.after(async () => {
    setInstance(host, null); await official.close(); records(host).close();
    assert.equal(resolve(root, '..'), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  return { root, host, official, mt5, events, notifications: () => notifications,
    invoke: input => createCapabilities(host).find(item => item.name === definition.id).execute(input) };
}

test('the declared and executable configuration contracts accept credentials directly without an import reference', () => {
  assert.equal(Value.Check(definition.inputSchema, request()), true);
  assert.equal(Value.Check(changesSchema, changes()), true);
  assert.deepEqual(definition.inputSchema.properties.changes, JSON.parse(JSON.stringify(changesSchema)));
  const shape = definition.inputSchema.properties.changes.anyOf[1].properties;
  for (const name of ['terminal', 'metaeditor', 'marketdata']) assert.equal(shape.servers.properties[name].properties.token.writeOnly, true);
  assert.equal(shape.account.properties.password.writeOnly, true);
  assert.equal(shape.tester_agent.properties.password.writeOnly, true);
});

test('direct credentials save atomically, take effect immediately and persist with only redacted receipts', async t => {
  const f = await fixture(t), closed = [];
  f.official.clients.set('terminal', { close: () => closed.push('terminal') });
  const receipt = await f.invoke(request());
  assert.equal(receipt.status, 'applied');
  assert.equal(receipt.result.version, 2);
  assert.equal(receipt.result.servers.terminal.authenticated, true);
  assert.equal(receipt.result.account.password_configured, true);
  assert.equal(receipt.result.tester_agent.password_configured, true);
  assert.equal(receipt.changes.servers.terminal.token, '[redacted]');
  assert.equal(receipt.changes.account.password, '[redacted]');
  assert.equal(receipt.changes.tester_agent.password, '[redacted]');
  assert.deepEqual(closed, ['terminal']); assert.equal(f.official.clients.size, 0);
  assert.equal(f.notifications(), 1);
  assert.equal(f.official.config.servers.terminal.token, credentials.terminal);
  assert.equal(f.official.config.account.password, credentials.account);
  assert.equal(f.official.config.tester_agent.password, credentials.tester);
  assert.equal(records(f.host).list('mt5_command').length, 0, 'Saving does not launch, log in or trade');
  const restored = await new MT5Official(f.host, null).init();
  try { assert.deepEqual(restored.config, f.official.config); } finally { await restored.close(); }
  assertNoCredentials([receipt, f.events, records(f.host).list('configuration_change')]);
  for (const name of ['mt5.sqlite', 'mt5.sqlite-wal']) assertNoCredentials(await readFile(join(f.root, name), 'utf8').catch(() => ''));
});

test('the same real credential input is idempotent and a different secret conflicts even though both receipts are redacted', async t => {
  const f = await fixture(t), input = request();
  const first = await f.invoke(input), repeated = await f.invoke(input);
  assert.deepEqual(repeated, first); assert.equal(f.official.settings().version, 2); assert.equal(f.notifications(), 1);
  const changed = structuredClone(input); changed.changes.account.password = 'different-fixture-password';
  await assert.rejects(f.invoke(changed), error => {
    assertNoCredentials(error.message, [changed.changes.account.password]); return error.code === 'idempotency_conflict';
  });
  await assert.rejects(f.invoke(request(changes(), 1, 'configure-stale-credentials-01')), { code: 'version_conflict' });
  assert.equal(f.official.settings().version, 2);
  assertNoCredentials([f.events, records(f.host).list('configuration_change')]);
});

test('omitted credentials remain saved while explicit empty values clear each credential', async t => {
  const f = await fixture(t); await f.invoke(request());
  await f.invoke(request({ servers: { terminal: { enabled: false } }, tester_agent: { port: 2002 } }, 2, 'configure-preserve-credentials-01'));
  assert.equal(f.official.config.servers.terminal.token, credentials.terminal);
  assert.equal(f.official.config.account.password, credentials.account);
  assert.equal(f.official.config.tester_agent.password, credentials.tester);
  const receipt = await f.invoke(request({ servers: { terminal: { token: '' } }, account: { password: '' }, tester_agent: { password: '' } }, 3, 'configure-clear-credentials-01'));
  assert.equal(receipt.result.servers.terminal.authenticated, false);
  assert.equal(receipt.result.account.password_configured, false);
  assert.equal(receipt.result.tester_agent.password_configured, false);
  assertNoCredentials([receipt, f.events, records(f.host).list('configuration_change')]);
});

test('a failed save sanitizes both new and already saved secrets in the thrown error and retained failure', async t => {
  const f = await fixture(t), input = request(), savedSecret = 'previous-fixture-token';
  f.official.config.servers.terminal.token = savedSecret;
  f.official.configure = async () => {
    throw Object.assign(new Error(`Cannot save ${credentials.terminal}; ${JSON.stringify(credentials.account)}; old ${savedSecret}`), { status: 503, code: 'fixture_save_failed' });
  };
  await assert.rejects(f.invoke(input), error => {
    assert.equal(error.status, 503); assertNoCredentials(error.message, [savedSecret]); assert.match(error.message, /\[redacted\]/);
    return error.code === 'fixture_save_failed';
  });
  assert.equal(f.official.settings().version, 1);
  assert.equal(f.official.config.servers.terminal.token, savedSecret, 'A failed update preserves the existing credential');
  const repeated = await f.invoke(input);
  assert.equal(repeated.status, 'failed'); assert.equal(repeated.error.code, 'fixture_save_failed');
  assertNoCredentials([repeated, f.events, records(f.host).list('configuration_change')], [savedSecret]);
});

test('malformed credentials, credential-bearing endpoints and delegated writes fail without persistence', async t => {
  const f = await fixture(t);
  for (const invalid of [
    { account: { password: 'line\nbreak' } }, { tester_agent: { password: 123 } },
    { servers: { terminal: { token: 'zero\0byte' } } },
    { servers: { terminal: { url: 'http://user:private-url-secret@127.0.0.1:24446/mcp' } } },
  ]) await assert.rejects(f.invoke(request(invalid)), error => error.code === 'invalid_request');
  f.host.context.kind = 'subagent';
  await assert.rejects(f.invoke(request()), { code: 'FORBIDDEN' });
  assert.equal(f.official.settings().version, 1);
  assert.deepEqual(records(f.host).list('configuration_change'), []); assert.deepEqual(f.events, []);
});
