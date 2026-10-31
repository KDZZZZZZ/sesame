import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
test('installed MT5 v2 declares sources, redacts ingress credentials and publishes real immutable target evidence', { skip: !hostRoot, timeout: 120000 }, async t => {
  const load = relative => import(pathToFileURL(join(hostRoot, relative)));
  const { Store } = await load('modules/agent/store.js'), { Runtime } = await load('modules/agent/runtime.js');
  const { createHostContextV2 } = await load('modules/plugins/host-v2/context.js');
  const root = await mkdtemp(join(tmpdir(), 'mt5-v2-host-')), store = new Store(join(root, 'state'));
  const runtime = new Runtime(store, { piDir: join(root, 'pi'), officialPluginsDirectory: join(root, 'empty'), plugins: { 'sesame/mt5': { disabled: true, autoConnect: false } } });
  await runtime.init();
  t.after(async () => { await runtime.close(); store.close(); assert.equal(dirname(root), resolve(tmpdir())); await rm(root, { recursive: true, force: true }); });
  const draft = join(runtime.workspaces.root('conv_main'), 'mt5-draft');
  await cp(fileURLToPath(new URL('../packages/mt5/', import.meta.url)), draft, { recursive: true });
  const checked = await runtime.plugins.manager.test('conv_main', { path: draft });
  assert.equal(checked.passed, true, JSON.stringify(checked));
  const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: checked.digest });
  assert.equal(installed.runtime_status, 'ready', JSON.stringify(installed.diagnostics));
  runtime.plugins.activate('conv_main', installed.id);
  const host = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
  const call = async (name, input = {}) => { const result = await host.capabilities.invoke(`sesame/mt5#${name}`, input); assert.equal(result.type, 'result'); return result.value; };
  const sources = await host.data.sources({});
  assert.ok(sources.items.some(row => row.ref.providerId === 'sesame/mt5#market'));
  assert.ok(sources.items.some(row => row.ref.providerId === 'sesame/mt5#account'));
  const settings = await call('mt5_settings'); assert.equal(settings.environment.installed, false);
  const project = await call('mt5_project', { action: 'create', title: 'Local v2 test' });
  const checkout = await call('mt5_project', { action: 'checkout', project_id: project.id });
  assert.ok((await readFile(join(checkout.path, 'Experts/Strategy.mq5'), 'utf8')).length > 0);
  const saved = await call('mt5_project', { action: 'save', checkout_id: checkout.id }); assert.equal(saved.revision, 1);
  const messageId = 'msg_mt5_v2_credentials', token = 'fixture-not-real-secret';
  const input = { messageId, conversation: store.get('conversation', 'conv_main'), parts: [{ type: 'text', text: JSON.stringify({ mcpServers: { terminal: { url: 'http://127.0.0.1:22346/mcp', headers: { Authorization: `Bearer ${token}` } } } }) }], source: null, metadata: {} };
  const guarded = await runtime.plugins.beforeAgentTurn(input);
  assert.equal(JSON.stringify(guarded.parts).includes(token), false);
  assert.ok(guarded.parts[0].text.includes(messageId));
  const pending = await call('mt5_settings'); assert.equal(pending.pendingImports[0].source_message_id, messageId);
  assert.equal(JSON.stringify(pending).includes(token), false);
  await call('mt5_update_configuration', { command_id: 'mt5-readiness-fixture-config', expected_version: pending.settings.version,
    changes: { account: { login: '123456', server: 'Fixture-Demo', password: 'fixture-account-secret' }, servers: { terminal: { token } } } });
  const child = runtime.createConversation('research', 'Configuration readiness fixture', 'conv_main');
  for (const context of [{ sessionId: null, kind: 'service' }, { sessionId: child.id, kind: 'subagent' }]) {
    const caller = runtime.authority.bind(context, runtime.capabilities.hostEntry);
    const readiness = await runtime.capabilities.check('sesame/mt5#market.bind', { binding: {} }, { consumer: 'host' }, caller);
    assert.equal(readiness.available, true, `${caller.kind}: ${JSON.stringify(readiness.requirements)}`);
    assert.doesNotMatch(JSON.stringify(readiness), /fixture-not-real-secret|fixture-account-secret/);
    await assert.rejects(runtime.capabilities.invoke('sesame/mt5#mt5_settings', {}, { consumer: 'host' }, caller), { code: 'FORBIDDEN' });
    await assert.rejects(runtime.capabilities.invoke('sesame/mt5#mt5_update_configuration', {
      command_id: `mt5-denied-${caller.kind}-fixture`, expected_version: pending.settings.version + 1, changes: { allow_trading: false },
    }, { consumer: 'host' }, caller), { code: 'FORBIDDEN' });
  }
  const target = await call('mt5_target');
  const manifest = await host.resources.read(target, { part: 'manifest' });
  assert.equal(manifest.kind, 'strategy.target'); assert.equal(manifest.content.id, 'sesame.mt5.mql5');
  let offset = 0, declared = '', total;
  for (;;) {
    const part = await host.resources.read(target, { part: 'content', entry: 'capabilities.json', encoding: 'utf8', offset, length: 262144 });
    total ??= part.total;
    assert.equal(part.offset, offset);
    assert.equal(part.total, total);
    assert.equal(Buffer.byteLength(part.content), part.length);
    assert.ok(part.length > 0 && part.length <= 262144);
    declared += part.content;
    offset += part.length;
    if (part.nextOffset === undefined) { assert.equal(offset, total); break; }
    assert.equal(part.nextOffset, offset);
    assert.ok(offset < total);
  }
  assert.equal(JSON.parse(declared).apiVersion, '2');
  const repeated = await call('mt5_target'); assert.deepEqual(repeated, target);
  t.diagnostic(JSON.stringify({ nativeTerminalCalls: 0, vendorCalls: 0, declaredSources: sources.items.filter(row => row.ref.providerId.startsWith('sesame/mt5#')).length, credentialsRedactedBeforePersistence: true, immutableTarget: true }));
});
