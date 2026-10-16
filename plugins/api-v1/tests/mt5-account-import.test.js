import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, hostForStore, mt5Import } from './mt5-host.js';
import { Type } from '@sesame/plugin-sdk/schema';
import { createTools } from '../../optional-api-v1/packages/mt5/tools/configuration.js';
const { MT5Official } = await mt5Import('official.js');
const { MT5ConfigImports, extractMT5Account } = await mt5Import('config-import.js');
const { importConfiguration, updateConfiguration } = await mt5Import('configuration.js');

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mt5-account-import-')), store = new Store(directory);
  const host = { ...hostForStore(store), scope: { kind: 'main', conversationId: 'conv_main' },
    messages: { read: (id, optional) => store.get('message', id, optional) }, configuration: { exclusive: action => action() } };
  const official = await new MT5Official(host, null).init();
  let changes = 0, clock = Date.now();
  const imports = new MT5ConfigImports(host, () => clock, () => official.settings().account);
  const mt5 = { official, monitor: { settingsChanged() { changes++; } } };
  const prepare = (id, texts) => {
    const parts = imports.prepare(id, { scope: 'main', id: 'conv_main' }, texts.map(text => ({ type: 'text', text })), null, {});
    store.put('message', { id, role: 'user', conversation_id: 'conv_main', content: parts }); return parts;
  };
  const request = id => ({ command_id: `import_${id}_command`, source_message_id: id, expected_version: official.config.version });
  t.after(async () => { await official.close(); await rm(directory, { recursive: true, force: true }); });
  return { host, official, store, imports, mt5, prepare, request, changes: () => changes, expire: () => { clock += 86400001; } };
}

test('account reference import updates live settings and persistence without exposing credentials or logging in', async t => {
  const f = await setup(t), password = 'fixture-private-Password!A';
  const input = { mt5Account: { login: '700123', server: 'Fixture-Demo', password } };
  const parts = f.prepare('msg_account', [JSON.stringify(input), `Use this for the requested Tester: ${password}`]);
  assert.doesNotMatch(JSON.stringify({ parts, pending: f.imports.pending() }), /fixture-private-Password/);
  if (process.platform !== 'win32') assert.equal((await stat(f.imports.path('msg_account'))).mode & 0o777, 0o600);
  const args = f.request('msg_account'), result = await importConfiguration(f.host, f.mt5, f.imports, args);
  assert.equal(result.status, 'applied'); assert.equal(result.result.account.password_configured, true);
  assert.equal(f.official.config.account.password, password, 'already available to the same running Tester instance');
  assert.equal(JSON.parse(await readFile(f.official.file)).account.password, password);
  assert.equal(f.changes(), 1);
  assert.deepEqual(await importConfiguration(f.host, f.mt5, f.imports, args), result);
  assert.equal(f.changes(), 1, 'idempotent retry must not reapply or reconnect');
  assert.deepEqual(f.imports.pending(), []);
  assert.doesNotMatch(JSON.stringify({ result, messages: f.store.list('message'), events: f.store.events, changes: f.store.list('configuration_change') }), /fixture-private-Password/);
  assert.deepEqual(f.store.list('mt5_command'), []); assert.equal(f.official.python.child, undefined);
  const reopened = await new MT5Official(f.host, null).init(); t.after(() => reopened.close());
  assert.equal(reopened.config.account.password, password);
});

test('one-line password is bound to the known account and refuses an intervening account switch', async t => {
  const f = await setup(t);
  await f.official.configure({ expected_version: 1, account: { login: '700123', server: 'Fixture-Demo' } });
  f.prepare('msg_bound', ['MT5 password: bound-private-password']);
  await f.official.configure({ expected_version: 2, account: { login: '700124' } });
  await assert.rejects(importConfiguration(f.host, f.mt5, f.imports, f.request('msg_bound')), { code: 'mt5_account_binding_changed' });
  assert.equal(f.official.settings().account.password_configured, false);
  assert.equal(f.official.config.account.login, '700124');
  assert.equal(f.changes(), 0);
  f.prepare('msg_new_bound', ['MT5 密码： new-private-password']);
  await importConfiguration(f.host, f.mt5, f.imports, f.request('msg_new_bound'));
  assert.equal(f.official.config.account.password, 'new-private-password');
});

test('one reference can safely carry MCP and broker credentials together', async t => {
  const f = await setup(t), password = 'account-with-quote-"-secret';
  f.prepare('msg_combined', [JSON.stringify({ mcpServers: { terminal: { type: 'http', url: 'http://127.0.0.1:22346/mcp', headers: { Authorization: 'Bearer fixture-mcp-private' } } }, mt5Account: { login: '700123', server: 'Fixture-Demo', password } })]);
  const receipt = await importConfiguration(f.host, f.mt5, f.imports, f.request('msg_combined'));
  assert.equal(receipt.result.servers.terminal.authenticated, true);
  assert.equal(receipt.result.account.password_configured, true);
  assert.equal(f.official.config.account.password, password);
  assert.doesNotMatch(JSON.stringify({ receipt, messages: f.store.list('message'), events: f.store.events }), /fixture-mcp-private|account-with-quote/);
});

test('credential ingress remains explicit, main-user-only, expiring and safe on malformed input', async t => {
  const f = await setup(t), valid = JSON.stringify({ mt5Account: { login: '700123', server: 'Fixture-Demo', password: 'private-secret' } });
  assert.equal(extractMT5Account('a bare password is ordinary chat'), null);
  for (const text of ['MT5 password: private-secret', '{"mt5Account":{"password":"private-secret"', valid.replace('700123', '-1'), valid.replace('private-secret', 'private-secret\\n')]) {
    assert.throws(() => extractMT5Account(text), error => error.code === 'mt5_account_import_invalid' && !error.message.includes('private-secret'));
  }
  for (const [conversation, source, metadata] of [[{ scope: 'subagent', id: 'conv_sub' }, null, {}], [{ scope: 'main', id: 'conv_main' }, 'conv_sub', {}], [{ scope: 'main', id: 'conv_main' }, null, { origin: 'automation' }]]) {
    assert.throws(() => f.imports.prepare('msg_denied', conversation, [{ type: 'text', text: valid }], source, metadata), { status: 403 });
  }
  f.prepare('msg_expire', [valid]); f.expire();
  await assert.rejects(importConfiguration(f.host, f.mt5, f.imports, f.request('msg_expire')), { code: 'mt5_import_expired' });
  assert.deepEqual(f.imports.pending(), []);
  assert.equal(f.official.settings().account.password_configured, false);
  await assert.rejects(updateConfiguration(f.host, f.mt5, { command_id: 'ordinary_password_denied', expected_version: 1, changes: { account: { password: 'private-secret' } } }), error => !error.message.includes('private-secret'));
  assert.doesNotMatch(JSON.stringify(f.store.events), /private-secret/);
});

test('version conflict preserves the reference for a fresh version retry', async t => {
  const f = await setup(t);
  f.prepare('msg_version', [JSON.stringify({ mt5Account: { login: '700123', server: 'Fixture-Demo', password: 'version-private' } })]);
  const args = f.request('msg_version');
  await f.official.configure({ expected_version: 1, allow_host_operations: false });
  await assert.rejects(importConfiguration(f.host, f.mt5, f.imports, args), { code: 'version_conflict' });
  assert.equal(f.imports.pending().length, 1);
  await importConfiguration(f.host, f.mt5, f.imports, { ...f.request('msg_version'), command_id: 'version_retry_command' });
  assert.equal(f.official.settings().allow_host_operations, false);
  assert.equal(f.official.settings().account.password_configured, true);
});

test('conflicting multipart credentials fail before persistence and tool metadata remains credential-free', async t => {
  const f = await setup(t), config = password => JSON.stringify({ mt5Account: { login: '700123', server: 'Fixture-Demo', password } });
  assert.throws(() => f.prepare('msg_conflict', [config('first-private'), config('second-private')]), error => error.code === 'mt5_account_import_invalid' && !/first-private|second-private/.test(error.message));
  assert.deepEqual(f.imports.pending(), []); assert.deepEqual(f.store.list('message'), []);
  const host = { tools: { Type, define: (name, description, properties) => ({ name, label: name, description, parameters: Type.Object(properties, { additionalProperties: false }) }) } };
  const tools = createTools(host, f.mt5, f.imports), declared = JSON.parse(await readFile(new URL('../../optional-api-v1/packages/mt5/tools.json', import.meta.url)));
  for (const tool of tools) assert.deepEqual(JSON.parse(JSON.stringify(tool)), declared.find(item => item.name === tool.name));
  assert.doesNotMatch(JSON.stringify(tools.map(tool => tool.parameters)), /password|token|Authorization/);
});
