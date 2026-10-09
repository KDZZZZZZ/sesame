import { mt5Import, mt5Path, hostForStore } from './mt5-host.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './mt5-host.js';
const { MT5Official } = await mt5Import('official.js');
import { createServer } from 'node:http';
import { assertPrivatePath } from './private-path.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mt5agent-import-'));
  const dataDirectory = join(directory, 'native');
  await mkdir(join(dataDirectory, 'config'), { recursive: true });
  const store = new Store(join(directory, 'app'));
  const official = new MT5Official(hostForStore(store), { directory: dataDirectory, dataDirectory });
  t.after(async () => { await official.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const write = (name, text, encoding = 'utf16le') => writeFile(join(dataDirectory, 'config', name), `${encoding === 'utf16le' ? '\uFEFF' : ''}${text}`, encoding);
  return { official, store, dataDirectory, write };
}

test('a new connection reuses native MCP settings without exporting passwords and keeps application default permissions', async t => {
  const { official, store, dataDirectory, write } = await setup(t);
  await write('assistant.ini', '[MCP.MetaTrader]\r\nEnable=1\r\nEndpoint=http://127.0.0.1:22346/mcp\r\nApiKey=native-terminal-secret\r\n[MCP.MetaEditor]\r\nEnable=1\r\nEndpoint=http://127.0.0.1:22345/mcp\r\nApiKey=native-editor-secret\r\n[Assistant]\r\nApiKey=unrelated-ai-secret\r\nPermissionsTrade=1\r\nPermissionsShell=1\r\n');
  await write('common.ini', '[Common]\nLogin=700123\nServer=Example-Demo\nPassword=do-not-import-password\n[Experts]\nEnabled=1\n', 'utf8');
  const original = await readFile(join(dataDirectory, 'config/assistant.ini'));
  await official.init();
  const settings = official.settings();
  assert.equal(settings.servers.terminal.authenticated, true);
  assert.equal(settings.servers.metaeditor.authenticated, true);
  assert.deepEqual(settings.account, { login: '700123', server: 'Example-Demo', password_configured: false });
  assert.equal(settings.allow_trading, true);
  assert.equal(settings.allow_host_operations, true);
  assert.equal(settings.startup_configured, false);
  assert.doesNotMatch(JSON.stringify(settings), /native-terminal-secret|native-editor-secret|unrelated-ai-secret|do-not-import-password/);
  assert.doesNotMatch(await readFile(official.file, 'utf8'), /unrelated-ai-secret|do-not-import-password|PermissionsTrade/);
  assert.deepEqual(await readFile(join(dataDirectory, 'config/assistant.ini')), original);
  assert.equal(store.list('mt5_command').length, 0);
  await assertPrivatePath(official.file);
});

test('explicit import refreshes native keys and authenticates through real MCP discovery', async t => {
  const { official, write } = await setup(t);
  await official.init();
  const received = [];
  const server = createServer(async (req, res) => {
    received.push(req.headers.authorization);
    if (req.headers.authorization !== 'Bearer imported-only-secret') { res.writeHead(401); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks));
    if (request.method.startsWith('notifications/')) { res.writeHead(202); res.end(); return; }
    const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18', serverInfo: { name: 'Native import fixture', version: '6140' }, capabilities: { tools: {} } }
      : request.method === 'tools/list' ? { tools: [{ name: 'get_workspace_info', description: 'Workspace', inputSchema: { type: 'object', properties: {} } }] }
        : { structuredContent: { mql5_folder: 'C:\\MT5\\MQL5' }, content: [] };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await write('assistant.ini', `[MCP.MetaTrader]\nEnable=1\nEndpoint=http://127.0.0.1:${server.address().port}/mcp\nApiKey=imported-only-secret\n`, 'utf8');
  const settings = await official.configure({ expected_version: 1, import_native: true });
  assert.equal(settings.servers.terminal.authenticated, true);
  assert.equal(settings.version, 2);
  const catalog = await official.catalog('terminal');
  assert.equal(catalog.items[0].status, 'connected');
  assert.equal(catalog.items[0].tools[0].name, 'get_workspace_info');
  assert.ok(received.length > 0);
  assert.ok(received.every(header => header === 'Bearer imported-only-secret'));
  assert.doesNotMatch(JSON.stringify(catalog), /imported-only-secret/);
});

test('opaque native key storage is not imported as a Bearer token or allowed to overwrite a saved key', async t => {
  const { official, write } = await setup(t);
  const opaque = 'a1'.repeat(84);
  await write('assistant.ini', `[MCP.MetaTrader]\nEnable=1\nEndpoint=http://127.0.0.1:22346/mcp\nApiKey=${opaque}\n`);
  await official.init();
  assert.equal(official.settings().servers.terminal.authenticated, false);
  await official.configure({ expected_version: official.config.version, servers: { terminal: { token: 'working-exported-key' } } });
  await official.configure({ expected_version: official.config.version, import_native: true });
  assert.equal(official.config.servers.terminal.token, 'working-exported-key');
  await write('assistant.ini', '[MCP.MetaTrader]\nEnable=1\nEndpoint=http://127.0.0.1:22346/mcp\nApiKey=unverified-new-format\n');
  await official.configure({ expected_version: official.config.version, import_native: true });
  assert.equal(official.config.servers.terminal.token, 'working-exported-key');
  assert.doesNotMatch(await readFile(official.file, 'utf8'), /unverified-new-format|a1a1a1a1/);
});

test('refresh and restart preserve disabled connections and user permissions', async t => {
  const { official, store, write } = await setup(t);
  await official.init();
  await official.configure({ expected_version: 1, servers: { terminal: { enabled: false, token: '' } }, allow_trading: true, allow_host_operations: true });
  await write('assistant.ini', '[MCP.MetaTrader]\nEnable=1\nEndpoint=http://127.0.0.1:22346/mcp\nApiKey=changed-native-secret\n');
  const restarted = await new MT5Official(hostForStore(store), official.native).init();
  t.after(() => restarted.close());
  assert.equal(restarted.settings().version, 2);
  assert.equal(restarted.settings().servers.terminal.authenticated, false, 'a cleared key must not reappear on startup');
  assert.equal(restarted.settings().servers.terminal.enabled, false);
  const refreshed = await restarted.configure({ expected_version: 2, import_native: true });
  assert.equal(refreshed.servers.terminal.authenticated, true);
  assert.equal(refreshed.servers.terminal.enabled, false, 'import must not re-enable a connection the user turned off');
  assert.equal(refreshed.allow_trading, true);
  assert.equal(refreshed.allow_host_operations, true);
});

test('ambiguous native configuration is rejected without modifying the saved connection', async t => {
  const { official, write } = await setup(t);
  await official.init();
  const before = official.settings();
  await write('assistant.ini', '[MCP.MetaTrader]\nEnable=1\nEndpoint=http://127.0.0.1:22346/mcp\nApiKey=first-private-key\nApiKey=second-private-key\n');
  await assert.rejects(official.configure({ expected_version: before.version, import_native: true }), error => error.status === 422 && !/private-key/.test(error.message));
  assert.deepEqual(official.settings(), before);
});

test('native import ignores unknown INI sections without losing recognized connection settings', async t => {
  const { official, write } = await setup(t);
  await official.init();
  await write('assistant.ini', '[constructor]\nApiKey=unrelated-private-key\n[__proto__]\nEnable=1\n[MCP.MetaTrader]\nEnable=1\nEndpoint=http://127.0.0.1:22346/mcp\nApiKey=native-terminal-secret\n');
  const settings = await official.configure({ expected_version: 1, import_native: true });
  assert.equal(settings.servers.terminal.authenticated, true);
  assert.equal(settings.allow_trading, true);
  assert.doesNotMatch(JSON.stringify(settings), /unrelated-private-key|native-terminal-secret/);
});

test('unsafe endpoints and mixed permission changes cannot cross the import boundary', async t => {
  const { official, write } = await setup(t);
  await official.init();
  const before = official.settings();
  for (const url of ['https://example.com/mcp', 'http://private-secret@127.0.0.1/mcp', 'http://127.0.0.1/mcp?key=private-secret']) {
    await write('assistant.ini', `[MCP.MetaTrader]\nEnable=1\nEndpoint=${url}\nApiKey=private-native-token\n`);
    await assert.rejects(official.configure({ expected_version: 1, import_native: true }), error => error.status === 422 && !/private-secret|private-native-token/.test(error.message));
    assert.deepEqual(official.settings(), before);
  }
  await assert.rejects(official.configure({ expected_version: 1, import_native: true, allow_trading: true }), /不能同时/);
  await assert.rejects(official.configure({ expected_version: 99, import_native: true }), error => error.code === 'version_conflict');
  assert.deepEqual(official.settings(), before);
});

test('saved terminal credentials can be used by an authorized login without granting new permissions', async t => {
  const { official } = await setup(t);
  await official.init();
  // Broker/Python I/O boundary only; policy, config, command state and audit use
  // the real application implementation. This cannot start a terminal.
  const broker = { available: () => true, close: async () => {}, call: async (_tool, _args, account) => ({ result: account.login === '700123' && !account.password, last_error: [1, 'Success'] }) };
  await official.configure({ expected_version: 1, allow_trading: false, account: { login: '700123' } });
  await official.python.close();
  official.python = broker;
  const input = { command_id: 'saved-login-command-0001', server: 'python', tool: 'login', arguments: {} };
  await assert.rejects(official.call(input, null), error => error.status === 403);
  await official.configure({ expected_version: 2, allow_trading: true });
  await official.python.close();
  official.python = broker;
  const result = await official.call(input, null);
  assert.equal(result.status, 'returned');
  assert.equal(result.result.result, true);
  assert.equal(official.settings().account.password_configured, false);
});
